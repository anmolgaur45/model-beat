"""Monday metrics: everything the weekly ops check needs, in one read-only run.

Prints: signup funnel (waitlist by source, new this week), pipeline health
(runs, gaps, volumes), model moves (model_events feeding the digest), and the
week's top stories. Ends with the manual dashboards that have no API here.

Usage: cd pipeline && python scripts/weekly_metrics.py
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.db import get_connection  # noqa: E402

WEEK = timedelta(days=7)
# Cloud Scheduler fires every 3h; anything past 4h means a run was missed.
GAP_ALERT = timedelta(hours=4)


def section(title: str) -> None:
    print(f"\n{'=' * 8} {title} {'=' * (60 - len(title))}")


def main() -> None:
    now = datetime.now(timezone.utc)
    since = now - WEEK
    conn = get_connection()

    section("Signups (waitlist table)")
    rows = conn.execute(
        "SELECT COALESCE(source, '?'), count(*), count(*) FILTER (WHERE created_at >= %s) "
        "FROM waitlist GROUP BY 1 ORDER BY 2 DESC",
        (since,),
    ).fetchall()
    total = new_total = 0
    for source, n, new in rows:
        total += n
        new_total += new
        print(f"  {source:<16} {n:>4} total   +{new} this week")
    print(f"  {'ALL':<16} {total:>4} total   +{new_total} this week")
    for email, stack, source, created in conn.execute(
        "SELECT email, stack, source, created_at FROM waitlist "
        "WHERE created_at >= %s ORDER BY created_at DESC",
        (since,),
    ).fetchall():
        print(f"  new: {created:%m-%d} [{source}] {email}" + (f" | stack: {stack}" if stack else ""))

    section("Pipeline health (last 7 days)")
    runs = conn.execute(
        "SELECT ran_at, articles_ingested, clusters_updated FROM pipeline_runs "
        "WHERE ran_at >= %s ORDER BY ran_at",
        (since,),
    ).fetchall()
    if not runs:
        print("  NO RUNS RECORDED — check Cloud Run job + Scheduler immediately")
    else:
        arts = sum(r[1] for r in runs)
        clus = sum(r[2] for r in runs)
        print(f"  {len(runs)} runs (expect ~56 at every-3h), {arts} articles, {clus} cluster updates")
        last = runs[-1][0]
        print(f"  last run: {last:%Y-%m-%d %H:%M} UTC ({(now - last).total_seconds() / 3600:.1f}h ago)")
        gaps = [
            (a[0], b[0])
            for a, b in zip(runs, runs[1:])
            if b[0] - a[0] > GAP_ALERT
        ]
        if now - last > GAP_ALERT:
            gaps.append((last, now))
        for start, end in gaps:
            print(f"  GAP: {start:%m-%d %H:%M} -> {end:%m-%d %H:%M} UTC ({(end - start).total_seconds() / 3600:.1f}h)")
        if not gaps:
            print("  no gaps > 4h")

    section("Model moves (model_events, last 7 days)")
    events = conn.execute(
        "SELECT e.detected_at, e.event_type, e.summary FROM model_events e "
        "WHERE e.detected_at >= %s ORDER BY e.detected_at DESC",
        (since,),
    ).fetchall()
    if not events:
        print("  none detected")
    for detected, etype, summary in events:
        print(f"  {detected:%m-%d} [{etype}] {summary}")

    section("Top stories this week (digest candidates)")
    for headline, score, day, n_articles in conn.execute(
        "SELECT c.headline, c.significance_score, c.first_published_at::date, "
        "       (SELECT count(*) FROM articles a WHERE a.cluster_id = c.id) "
        "FROM clusters c WHERE c.first_published_at >= %s "
        "ORDER BY c.significance_score DESC NULLS LAST LIMIT 10",
        (since,),
    ).fetchall():
        print(f"  [{score}] {day} ({n_articles} src) {headline}")

    conn.close()

    section("Manual checks (no API here)")
    print("  beehiiv subscribers + open rate: https://app.beehiiv.com")
    print("  traffic + referrers:             https://vercel.com (Analytics tab)")
    print("  search impressions/clicks:       https://search.google.com/search-console")
    print("  gates: 1,000 digest subs by ~day 120 (from 2026-07-02); checker conv 3-5%;")
    print("         >=5% of subs file stack profiles -> start concierge MVP")


if __name__ == "__main__":
    main()
