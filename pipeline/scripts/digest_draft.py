"""Assemble raw material for the Thursday digest in the locked issue format.

Emits markdown to stdout and pipeline/digest/draft-YYYY-MM-DD.md (gitignored):
top editorial clusters with themodelbeat.com permalinks, the model-moves
section (model_events + new tracker models), and marked placeholders for the
parts only a human (or an in-session curation pass, see .claude/skills/digest)
may write: subject, preview, story cut-down, and the "One take". This script
never sends anything.

Usage: cd pipeline && python scripts/digest_draft.py [days]
"""

import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.db import get_connection  # noqa: E402

SITE = "https://themodelbeat.com"
CANDIDATES = 8  # editor cuts to 5-6; builder relevance beats raw significance


def slugify_headline(headline: str) -> str:
    """Mirror of frontend/src/lib/story.ts slugifyHeadline (slug is decorative;
    the uuid resolves the story, so drift is harmless)."""
    slug = re.sub(r"[^a-z0-9]+", "-", headline.lower()).strip("-")[:80]
    return slug.rstrip("-")


def story_url(cluster_id: str, headline: str) -> str:
    slug = slugify_headline(headline)
    return f"{SITE}/story/{cluster_id}/{slug}" if slug else f"{SITE}/story/{cluster_id}"


def main() -> None:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    conn = get_connection()

    stories = conn.execute(
        """
        SELECT c.id, c.headline, c.summary, c.significance_score,
               c.first_published_at::date,
               (SELECT count(DISTINCT a.source_name) FROM articles a WHERE a.cluster_id = c.id)
        FROM clusters c
        WHERE c.first_published_at >= %s
          AND c.category != 'Research Papers'
        ORDER BY c.significance_score DESC NULLS LAST, c.first_published_at DESC
        LIMIT %s
        """,
        (since, CANDIDATES),
    ).fetchall()

    moves = conn.execute(
        """
        SELECT m.slug, e.event_type, e.summary, e.source_url, e.detected_at::date
        FROM model_events e JOIN models m ON m.id = e.model_id
        WHERE e.detected_at >= %s
        ORDER BY e.detected_at DESC
        """,
        (since,),
    ).fetchall()

    new_models = conn.execute(
        """
        SELECT slug, name, vendor, released_at::date, price_in, price_out, context_window
        FROM models
        WHERE first_seen_at >= %s
        ORDER BY first_seen_at DESC
        """,
        (since,),
    ).fetchall()
    conn.close()

    lines = [
        f"<!-- Digest raw material, {since:%b %d} to {now:%b %d, %Y}. "
        f"{CANDIDATES} story candidates below: cut to 5-6, verify facts against the DB, "
        "no em dashes anywhere. Full checklist: .claude/skills/digest -->",
        "",
        'Subject: [TO WRITE: the week\'s two biggest facts, no clickbait]',
        "Preview: Plus: [TO WRITE: 2-3 more items]",
        "",
        "## The week on the beat",
        "",
    ]
    for cid, headline, summary, score, day, n_sources in stories:
        lines.append(f"**{headline}**")
        if summary:
            lines.append(summary.strip())
        lines.append(f"[{day:%b %d}, {n_sources} sources, significance {score:g}/10] "
                     f"{story_url(str(cid), headline)}")
        lines.append("")

    lines += ["## Model moves", ""]
    if not moves and not new_models:
        lines.append("*(quiet week: no price, context, or catalog changes detected)*")
    for slug, _etype, summary, source_url, day in moves:
        lines.append(f"- Price/spec change: {summary} ({day:%b %d}). {SITE}/models/{slug} (source: {source_url})")
    for slug, name, vendor, released, p_in, p_out, ctx in new_models:
        bits = [f"released {released:%b %d, %Y}" if released else "release date unknown"]
        if p_in is not None:
            bits.append(f"${p_in:g}/M in, ${p_out:g}/M out")
        if ctx:
            bits.append(f"{ctx:,} context")
        lines.append(f"- New: {name} ({vendor}; {'; '.join(bits)}). {SITE}/models/{slug}")
    lines += [
        "",
        "## One take",
        "",
        "[TO WRITE: Anmol's paragraph. If Claude drafts it, label it",
        '"Reference draft, rewrite this in your own words before sending".]',
        "",
        "Until next Thursday,",
        "Anmol",
        "",
    ]

    draft = "\n".join(lines)
    out_dir = Path(__file__).resolve().parents[1] / "digest"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"draft-{now:%Y-%m-%d}.md"
    out_path.write_text(draft, encoding="utf-8")
    print(draft)
    print(f"[saved to {out_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
