import httpx
import structlog
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..models import NormalizedArticle
from ..processing.normalize import build_normalized_article
from ..sources import HN_SOURCE

log = structlog.get_logger()

HN_BASE = "https://hacker-news.firebaseio.com/v0"
FETCH_LIMIT = 150
BATCH_SIZE = 20

AI_KEYWORDS = [
    "ai", "llm", "gpt", "claude", "gemini", "openai", "anthropic", "hugging",
    "transformer", "mistral", "llama", "deepseek", "neural", "diffusion",
    "machine learning", "deep learning", "language model", "inference",
]


def _is_ai_related(title: str) -> bool:
    lower = title.lower()
    return any(kw in lower for kw in AI_KEYWORDS)


_TRANSPORT = httpx.HTTPTransport(retries=3)


def _fetch_item(client: httpx.Client, item_id: int) -> dict | None:
    try:
        resp = client.get(f"{HN_BASE}/item/{item_id}.json", timeout=5.0)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def ingest_hn() -> list[NormalizedArticle]:
    try:
        with httpx.Client(timeout=10.0, transport=_TRANSPORT) as client:
            resp = client.get(f"{HN_BASE}/topstories.json")
            resp.raise_for_status()
            top_ids: list[int] = resp.json()
    except Exception as exc:
        log.warning("hn.fetch_failed", error=str(exc))
        return []

    ids_to_fetch = top_ids[:FETCH_LIMIT]
    results: list[NormalizedArticle] = []

    with httpx.Client(timeout=5.0, transport=_TRANSPORT) as client:
        with ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
            futures = {executor.submit(_fetch_item, client, id_): id_ for id_ in ids_to_fetch}
            for future in as_completed(futures):
                item = future.result()
                if not item or item.get("type") != "story":
                    continue
                title = item.get("title", "")
                if not title or not _is_ai_related(title):
                    continue

                url = item.get("url") or f"https://news.ycombinator.com/item?id={item['id']}"
                article = build_normalized_article(
                    title=title,
                    url=url,
                    excerpt=None,
                    author=item.get("by"),
                    published_at=item.get("time"),
                    source=HN_SOURCE,
                )
                if article:
                    results.append(article)

    log.info("hn.ingested", count=len(results))
    return results
