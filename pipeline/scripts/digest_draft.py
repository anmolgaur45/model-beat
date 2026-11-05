"""Assemble raw material for the Thursday digest in the locked issue format.

Emits markdown to stdout and pipeline/digest/draft-YYYY-MM-DD.md (gitignored):
top editorial clusters with themodelbeat.com permalinks, the model-moves
section (model_events + new tracker models), and marked placeholders for the
parts only a human (or a curation pass, see the digest runbook) may write: subject,
preview, story cut-down, and the "Personal take". This script never sends anything
and never overwrites a draft that already exists.

Usage: cd pipeline && python scripts/digest_draft.py [days]
"""

import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.db import get_connection  # noqa: E402

SITE = "https://themodelbeat.com"
CANDIDATES = 8  # editor cuts to 5-6; builder relevance beats raw significance
BULK_MODELS = 5  # this many models moving on one date means the source re-ran its suite


def slugify_headline(headline: str) -> str:
    """Mirror of frontend/src/lib/story.ts slugifyHeadline (slug is decorative;
    the uuid resolves the story, so drift is harmless)."""
    slug = re.sub(r"[^a-z0-9]+", "-", headline.lower()).strip("-")[:80]
    return slug.rstrip("-")


def story_url(cluster_id: str, headline: str) -> str:
    slug = slugify_headline(headline)
    return f"{SITE}/story/{cluster_id}/{slug}" if slug else f"{SITE}/story/{cluster_id}"


def money(value) -> str:
    return f"${value:g}" if value is not None else "?"


def move_pct(summary: str) -> int:
    match = re.search(r"([+-]\d+)%\)", summary)  # "... (was $0.086, -9%)"
    return int(match.group(1)) if match else 0


def moves_lines(moves: list[tuple], new_models: list[tuple], since: date) -> list[str]:
    """Sort the week's tracker events for checking. Pure, so it's testable without a DB."""
    vendor, context, other = [], [], []
    benchmarks: dict[date, list[tuple]] = {}
    floors: dict[str, list[tuple]] = {}
    for row in moves:
        slug, _name, etype, scope, summary, source_url, day, *_ = row
        line = f"- {summary} ({day:%b %d}). {SITE}/models/{slug} (source: {source_url})"
        if etype == "price" and scope == "vendor":
            vendor.append(line)
        elif etype == "price" and scope == "floor":
            floors.setdefault(slug, []).append(row)
        elif etype == "benchmark":
            benchmarks.setdefault(day, []).append(row)
        elif etype == "context":
            context.append(line)
        else:
            other.append(line)

    bench_lines = []
    for day, rows in sorted(benchmarks.items(), reverse=True):
        models = {row[0] for row in rows}
        if len(models) >= BULK_MODELS:
            bench_lines.append(
                f"- {day:%b %d}: {len(models)} models moved, so the source re-ran its suite "
                f"(one revision line in the issue). Example: {rows[0][4]}"
            )
            continue
        for slug, _name, _etype, _scope, summary, source_url, _day, *_ in rows:
            bench_lines.append(
                f"- {summary} ({day:%b %d}). {SITE}/models/{slug} (source: {source_url})"
            )

    floor_lines = []
    biggest_first = sorted(
        floors.items(),
        key=lambda item: max(abs(move_pct(row[4])) for row in item[1]),
        reverse=True,
    )
    for slug, rows in biggest_first:
        name, p_in, p_out, provider, quant, list_in, list_out = rows[0][1], *rows[0][7:]
        if (p_in, p_out) == (list_in, list_out):
            continue  # the lab itself is cheapest, so there's no third-party story
        biggest = max((move_pct(row[4]) for row in rows), key=abs)
        count = f"{len(rows)} move" + ("s" if len(rows) > 1 else "")
        floor_lines.append(
            f"- {name}: {count}, largest {biggest:+d}%. Now {money(p_in)}/{money(p_out)} "
            f"via {provider} ({quant}), list {money(list_in)}/{money(list_out)}. "
            f"{SITE}/models/{slug}"
        )

    fresh, older = [], []
    for slug, name, maker, released, p_in, p_out, ctx in new_models:
        bits = [f"released {released:%b %d, %Y}" if released else "release date unknown"]
        if p_in is not None:
            out = f"${p_out:g}/M out" if p_out is not None else "output price unknown"
            bits.append(f"${p_in:g}/M in, {out}")
        if ctx:
            bits.append(f"{ctx:,} context")
        line = f"- {name} ({maker or 'no vendor listed'}; {'; '.join(bits)}). {SITE}/models/{slug}"
        (older if released and released < since else fresh).append(line)

    sections = [
        ("Vendor list price: confirm on the lab's page before printing", vendor),
        ("Benchmarks", bench_lines),
        ("Context: confirm before printing", context),
        ("Cheapest third-party host: at most one line in the issue", floor_lines),
        ("Other events", other),
        ("New this week: confirm each price on the lab's page", fresh),
        ("Added to the tracker but released earlier: usually not news", older),
    ]
    lines: list[str] = []
    for title, rows in sections:
        if rows:
            lines += [f"**{title}**", *rows, ""]
    return lines or ["*(quiet week: no price, context, or catalog changes detected)*", ""]


def main() -> None:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    now = datetime.now(timezone.utc)
    out_dir = Path(__file__).resolve().parents[1] / "digest"
    out_path = out_dir / f"draft-{now:%Y-%m-%d}.md"
    if out_path.exists():
        # By now it may hold the curated issue and the rewritten take.
        sys.exit(f"{out_path} already exists, nothing written. Delete it to regenerate.")
    since = now - timedelta(days=days)
    conn = get_connection()

    # No category filter: real papers never reach the top 8, and research-papers also
    # holds real news (a significance-10 cluster from the Oct 1 issue was filed there).
    stories = conn.execute(
        """
        SELECT c.id, c.headline, c.summary, c.significance_score,
               c.first_published_at::date,
               (SELECT count(DISTINCT a.source_name) FROM articles a WHERE a.cluster_id = c.id)
        FROM clusters c
        WHERE c.first_published_at >= %s
        ORDER BY c.significance_score DESC NULLS LAST, c.first_published_at DESC
        LIMIT %s
        """,
        (since, CANDIDATES),
    ).fetchall()

    # Catalog events are left out because new_models below already lists those models.
    moves = conn.execute(
        """
        SELECT m.slug, m.name, e.event_type, e.price_scope, e.summary, e.source_url,
               e.detected_at::date, m.price_in, m.price_out, m.floor_provider, m.floor_quant,
               m.vendor_price_in, m.vendor_price_out
        FROM model_events e JOIN models m ON m.id = e.model_id
        WHERE e.detected_at >= %s AND e.event_type != 'catalog'
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
        f"{CANDIDATES} story candidates below: cut to 5-6, check facts in the skill's source "
        "order, no em dashes anywhere. Full checklist: the digest runbook -->",
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
    lines += moves_lines(moves, new_models, since.date())
    lines += [
        "## Personal take",
        "",
        "[TO WRITE: Anmol's paragraph. Label any draft",
        '"Reference draft, rewrite this in your own words before sending".]',
        "",
        "Until next Thursday,",
        "Anmol",
        "",
    ]

    draft = "\n".join(lines)
    out_dir.mkdir(exist_ok=True)
    out_path.write_text(draft, encoding="utf-8")
    print(draft)
    print(f"[saved to {out_path}]", file=sys.stderr)


if __name__ == "__main__":
    main()
