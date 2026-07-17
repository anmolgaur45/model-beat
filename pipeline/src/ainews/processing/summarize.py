"""AI summaries (Phase J).

One original 1-2 sentence synthesis per cluster, generated from the cluster's
member articles by Gemini 3.1 Flash-Lite on Vertex AI. Bills to GCP credits via
Application Default Credentials (no API key). Mirrors the backfill bounds of
`score_pending` and is skipped when no Vertex project is configured.
"""

import re
from datetime import datetime, timedelta, timezone

import psycopg
import structlog

from ..config import settings

log = structlog.get_logger()

_RELEVANCE_DAYS = 4
_MAX_WORDS = 90
_MEMBERS_PER_CLUSTER = 3

_PROMPT = """\
You are summarizing an AI/tech news story for a news reader. Write an original, neutral \
summary in plain prose, scaled to how much the story actually matters.

Length: use only as many sentences as the story needs — about 2 sentences for a routine item, \
up to 5 sentences (max {max_words} words) for a major story. Never pad a minor story to fill space.

For a significant story (see the significance score below), cover BOTH what happened AND why it \
matters — the concrete context, stakes, or likely impact: what is new, who is affected, what it \
changes or follows. Convey importance through specifics, never through hype or opinion. For a minor \
story, a tight factual summary is enough.

Rules:
- Original wording only. Do not copy phrases or sentences from the sources.
- Neutral and factual. No marketing language, no editorializing, no hype words.
- No preamble ("This article...", "The story...") — state the news directly.
- Plain text only, no markdown.
- Product and model names: use EXACTLY the name and version written in the headline or \
excerpts (e.g. if they say "Opus", write "Opus", never "Claude 3 Opus" or any version \
you remember). Never add, upgrade, or guess a version number that the sources do not state.

Significance: {significance}/10
Headline: {headline}

Source excerpts:
{excerpts}

Summary:"""


def build_prompt(
    headline: str, members: list[tuple[str, str | None]], significance: int
) -> str:
    """Assemble the summary prompt from a headline, member (source, excerpt) pairs, and score.

    Pure and unit-testable: no network or DB. `members` is ordered most-authoritative
    first; only the first few excerpts are included to bound token cost. `significance`
    (1-10) tells the model how much depth the story warrants.
    """
    lines: list[str] = []
    for source_name, excerpt in members[:_MEMBERS_PER_CLUSTER]:
        if excerpt:
            lines.append(f"- [{source_name}] {excerpt.strip()[:300]}")
        else:
            lines.append(f"- [{source_name}]")
    excerpts = "\n".join(lines) if lines else "(no excerpts available)"
    return _PROMPT.format(
        max_words=_MAX_WORDS,
        significance=significance,
        headline=headline.strip(),
        excerpts=excerpts,
    )


def clean_summary(text: str) -> str:
    """Normalize model output: strip markdown/whitespace and cap at the word budget.

    Pure and unit-testable. Returns "" for empty/blank input so callers can skip it.
    """
    if not text:
        return ""
    text = text.strip().strip("`").strip()
    # drop a leading label the model sometimes emits despite the instruction
    text = re.sub(r"^(summary|tl;?dr)\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    words = text.split(" ")
    if len(words) > _MAX_WORDS:
        text = " ".join(words[:_MAX_WORDS]).rstrip(",;:") + "…"
    return text


def _fetch_members(conn: psycopg.Connection, cluster_id: str) -> list[tuple[str, str | None]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_name, body_excerpt FROM articles
            WHERE cluster_id = %s
            ORDER BY significance_base DESC
            LIMIT %s
            """,
            (cluster_id, _MEMBERS_PER_CLUSTER),
        )
        return cur.fetchall()


def summarize_pending(conn: psycopg.Connection) -> int:
    """Generate summaries for clusters above the significance tier that lack one.

    Only the latest 300 clusters or the last 4 days (whichever is more) are
    considered, so a backlog never balloons the per-run Vertex spend.
    """
    if not settings.vertex_project:
        log.warning("summarize.skipped", reason="no VERTEX_PROJECT configured")
        return 0

    relevance_cutoff = datetime.now(timezone.utc) - timedelta(days=_RELEVANCE_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, headline, significance_score FROM clusters
            WHERE summary IS NULL
              AND significance_score >= %s
              AND first_published_at >= %s
            ORDER BY significance_score DESC, first_published_at DESC
            LIMIT %s
            """,
            (settings.summary_min_score, relevance_cutoff, settings.summary_max_per_run),
        )
        rows = cur.fetchall()

    if not rows:
        log.info("summarize.none_pending")
        return 0

    # Imported lazily so the package imports cleanly where google-genai isn't installed
    from google import genai

    client = genai.Client(
        vertexai=True,
        project=settings.vertex_project,
        location=settings.vertex_location,
    )

    total = 0
    failed = 0
    for cluster_id, headline, significance in rows:
        members = _fetch_members(conn, str(cluster_id))
        prompt = build_prompt(headline, members, int(round(significance or 0)))
        try:
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
            )
            summary = clean_summary(response.text or "")
        except Exception as exc:
            log.warning("summarize.failed", cluster=str(cluster_id)[:8], error=str(exc))
            failed += 1
            continue

        if not summary:
            failed += 1
            continue

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE clusters SET summary = %s WHERE id = %s",
                (summary, cluster_id),
            )
        conn.commit()
        total += 1
        if total % 25 == 0:
            log.info("summarize.progress", done=total, total=len(rows))

    log.info("summarize.done", summarized=total, failed=failed)
    return total
