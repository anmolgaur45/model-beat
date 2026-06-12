import re
import httpx
import structlog
from datetime import datetime, timezone

from ..models import NormalizedArticle
from ..processing.normalize import build_normalized_article, is_github_rolling_build
from ..sources import GITHUB_SOURCE, GITHUB_REPOS

log = structlog.get_logger()

SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60


def _clean_github_body(body: str | None) -> str | None:
    if not body:
        return None
    text = re.sub(r"```[\s\S]*?```", "", body)
    text = re.sub(r"`[^`\n]+`", "", text)
    text = re.sub(r"^\s*\*\s+[\w\s]+:.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*]\s+[a-f0-9]{7,}\b.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() or None


def _fetch_releases(client: httpx.Client, owner: str, repo: str) -> list[NormalizedArticle]:
    try:
        resp = client.get(
            f"https://api.github.com/repos/{owner}/{repo}/releases",
            params={"per_page": 5},
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        releases = resp.json()
    except Exception as exc:
        log.warning("github.fetch_failed", repo=f"{owner}/{repo}", error=str(exc))
        return []

    cutoff = datetime.now(tz=timezone.utc).timestamp() - SEVEN_DAYS_SECONDS
    results: list[NormalizedArticle] = []

    for release in releases:
        if release.get("draft") or release.get("prerelease"):
            continue
        published_at = release.get("published_at")
        if not published_at:
            continue
        try:
            pub_ts = datetime.fromisoformat(published_at.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if pub_ts < cutoff:
            continue

        tag = release.get("tag_name", "")
        name = release.get("name")
        if is_github_rolling_build(tag, name):
            continue

        title = f"{repo} {tag}"
        if name and name != tag:
            title += f" — {name}"

        article = build_normalized_article(
            title=title,
            url=release.get("html_url", ""),
            excerpt=_clean_github_body(release.get("body")),
            author=None,
            published_at=published_at,
            source=GITHUB_SOURCE,
        )
        if article:
            results.append(article)

    return results


_TRANSPORT = httpx.HTTPTransport(retries=3)


def ingest_github() -> list[NormalizedArticle]:
    results: list[NormalizedArticle] = []
    with httpx.Client(transport=_TRANSPORT) as client:
        for owner, repo in GITHUB_REPOS:
            results.extend(_fetch_releases(client, owner, repo))
    log.info("github.ingested", count=len(results))
    return results
