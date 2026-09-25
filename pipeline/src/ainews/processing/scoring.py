import json

import psycopg
import structlog

from ..config import settings
from .llm import gemini_text

log = structlog.get_logger()

_BATCH_PROMPT = """\
Rate the significance of each AI/tech article on a 1–10 scale.
Use the FULL range — typical AI industry news should score 4–6.

1–2: Noise or filler — financial speculation, SEO content, or barely AI-related
3–4: Minor — routine blog post, small incremental update, or niche interest
5–6: Notable — new product/feature launch, solid research result, company news worth reading
7–8: Major — new model release from a top AI lab, strong research breakthrough, broad industry impact
9–10: Transformative — paradigm-shifting announcement (think GPT-4, ChatGPT launch, AlphaFold)

SOURCE GUIDANCE: Official announcements of new models from top labs (OpenAI Blog, Anthropic News, \
Google DeepMind Blog, Google AI Blog, Meta AI Blog) should score 7–9. Coverage of the same event \
by tech press (Bloomberg, Verge, TechCrunch) should score 6–8. GitHub releases of major OSS \
projects (transformers, vllm, llama.cpp) score 5–7.

Articles:
{articles}

Respond with a JSON array only, no markdown, one object per article in the same order:
[{{"id": "<id>", "score": <integer 1-10>}}, ...]"""


def _format_articles(batch: list[tuple]) -> str:
    lines = []
    for i, (article_id, title, excerpt, source_name) in enumerate(batch, 1):
        lines.append(f"{i}. [id={article_id}, source={source_name}] {title}")
        if excerpt:
            lines.append(f"   {excerpt[:200]}")
    return "\n".join(lines)


def _parse_batch_response(raw: str, batch: list[tuple]) -> tuple[dict[str, int], bool]:
    """Parse JSON array response, return (id→score dict, parse_failed).

    Falls back to neutral 5 on any error — the failure flag makes those visible
    in logs instead of silently blending into genuine 5s.
    """
    try:
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw
        results = json.loads(raw)
        return {str(r["id"]): max(1, min(10, int(r["score"]))) for r in results}, False
    except Exception as exc:
        log.warning("scoring.parse_failed", error=str(exc), raw_prefix=raw[:120])
        return {str(row[0]): 5 for row in batch}, True


_BACKFILL_MIN = 300
_BACKFILL_DAYS = 4


def _score_singly(conn: psycopg.Connection, batch: list[tuple]) -> int:
    """Score a failed batch one article at a time; returns how many were scored.

    Gemini refuses a whole prompt when any one headline trips its blocklist, so a
    single refused article empties the batch it lands in. It then stays NULL, is
    retried every run, and took the final batch of every run down with it for two
    months (2026-07-24 -> 09-25). Singly, only the refused article stays NULL.

    Two failures in a row mean the model itself is unavailable (quota, outage),
    not one bad headline, so stop there rather than multiply calls into it.
    """
    scored = 0
    misses = 0
    for row in batch:
        raw = gemini_text(_BATCH_PROMPT.format(articles=_format_articles([row])))
        if raw is None:
            misses += 1
            if misses >= 2:
                break
            continue
        misses = 0
        score = _parse_batch_response(raw.strip(), [row])[0].get(str(row[0]))
        if score is None:
            continue
        with conn.cursor() as cur:
            cur.execute("UPDATE articles SET impact_score = %s WHERE id = %s", (score, row[0]))
        scored += 1
    conn.commit()
    log.info("scoring.isolated", scored=scored, of=len(batch))
    return scored


def score_pending(conn: psycopg.Connection, batch_size: int = 10) -> int:
    """Score articles with no impact_score using Vertex Gemini in batches.

    Only processes the latest 300 articles or the last 4 days, whichever is more.
    """
    if not settings.vertex_project:
        log.warning("scoring.skipped", reason="no VERTEX_PROJECT configured")
        return 0

    from datetime import datetime, timedelta, timezone
    four_days_ago = datetime.now(timezone.utc) - timedelta(days=_BACKFILL_DAYS)
    # The floor is what enforces the docstring. This used to select the latest
    # 300 UNSCORED rows at any age, so a refused article from 2026-07-24 was
    # still being retried two months later. LEAST picks whichever window is
    # wider: the 300th newest article's date, or four days ago.
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, body_excerpt, source_name FROM articles "
            "WHERE impact_score IS NULL AND published_at >= LEAST(%s, "
            "(SELECT published_at FROM articles ORDER BY published_at DESC OFFSET %s LIMIT 1)) "
            "ORDER BY published_at DESC",
            (four_days_ago, _BACKFILL_MIN - 1),
        )
        rows = cur.fetchall()

    if not rows:
        log.info("scoring.none_pending")
        return 0

    total = 0
    fallback_batches = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        prompt = _BATCH_PROMPT.format(articles=_format_articles(batch))

        raw = gemini_text(prompt)
        if raw is None:
            # Leave the batch NULL so the next run retries it. Stamping the
            # neutral fallback here made outages permanent: 5 days of articles
            # got written impact 5 during the 2026-07-05 credit exhaustion and
            # could not self-heal. NULL already scores as neutral downstream.
            log.warning("scoring.batch_failed", batch_start=i)
            fallback_batches += 1
            if len(batch) > 1:
                total += _score_singly(conn, batch)
            continue
        scores, failed = _parse_batch_response(raw.strip(), batch)
        if failed:
            fallback_batches += 1

        with conn.cursor() as cur:
            for article_id, _, _, _ in batch:
                score = scores.get(str(article_id))
                if score is None:
                    continue
                cur.execute(
                    "UPDATE articles SET impact_score = %s WHERE id = %s",
                    (score, article_id),
                )
        conn.commit()
        total += len(batch)

        if total % 100 == 0:
            log.info("scoring.progress", scored=total, total=len(rows))

    log.info("scoring.done", scored=total, fallback_batches=fallback_batches)
    return total
