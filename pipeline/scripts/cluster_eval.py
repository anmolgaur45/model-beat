"""Read-only eval harness for clustering + significance scoring (Phase F1).

Dumps the last 14 days of clusters, computes score distributions, and flags
suspect clusters using embedding distances:
  - false-merge suspects: clusters whose members are far apart in embedding space
  - missed-merge suspects: cross-cluster article pairs closer than the threshold

Outputs (all under pipeline/eval/, gitignored):
  snapshot.json   clusters + member articles (no embeddings)
  report.md       distributions, tier rates, suspect lists
  label_sheet.csv 100-cluster sample for manual labeling

Usage: cd pipeline && python scripts/cluster_eval.py
"""

import csv
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.config import settings  # noqa: E402
from ainews.db import get_connection  # noqa: E402

DAYS = 14
OUT_DIR = Path(__file__).resolve().parents[1] / "eval"
TIER_HIGH = 8.5
TIER_NOTABLE = 7.0


def fetch(conn):
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, headline, category, significance_score, first_published_at, article_count
            FROM clusters WHERE first_published_at >= %s
            ORDER BY first_published_at DESC
            """,
            (since,),
        )
        clusters = [
            {
                "id": str(r[0]), "headline": r[1], "category": r[2],
                "score": float(r[3]), "first_published_at": r[4].isoformat(),
                "article_count": r[5],
            }
            for r in cur.fetchall()
        ]

    ids = [c["id"] for c in clusters]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, cluster_id, title, source_name, published_at,
                   significance_base, impact_score, embedding
            FROM articles WHERE cluster_id = ANY(%s::uuid[])
            """,
            (ids,),
        )
        articles = [
            {
                "id": str(r[0]), "cluster_id": str(r[1]), "title": r[2],
                "source_name": r[3], "published_at": r[4].isoformat(),
                "significance_base": float(r[5] or 0), "impact_score": r[6],
                "embedding": np.asarray(r[7], dtype=np.float32) if r[7] is not None else None,
            }
            for r in cur.fetchall()
        ]
    return clusters, articles


def cos_dist_matrix(embs: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    normed = embs / np.clip(norms, 1e-9, None)
    return 1.0 - normed @ normed.T


def main():
    OUT_DIR.mkdir(exist_ok=True)
    conn = get_connection()
    try:
        clusters, articles = fetch(conn)
    finally:
        conn.close()

    by_cluster: dict[str, list[dict]] = {}
    for a in articles:
        by_cluster.setdefault(a["cluster_id"], []).append(a)

    # ── snapshot.json (no embeddings) ──
    snap = [
        {**c, "articles": [
            {k: v for k, v in a.items() if k != "embedding"}
            for a in by_cluster.get(c["id"], [])
        ]}
        for c in clusters
    ]
    (OUT_DIR / "snapshot.json").write_text(json.dumps(snap, indent=1), encoding="utf-8")

    # ── score distributions ──
    scores = [c["score"] for c in clusters]
    score_hist = Counter(int(s) for s in scores)
    n = len(clusters)
    high = sum(1 for s in scores if s >= TIER_HIGH)
    notable = sum(1 for s in scores if TIER_NOTABLE <= s < TIER_HIGH)

    impact_hist = Counter(a["impact_score"] for a in articles if a["impact_score"] is not None)
    impact_null = sum(1 for a in articles if a["impact_score"] is None)
    neutral5 = impact_hist.get(5, 0)

    # ── false-merge suspects: max intra-cluster pairwise distance ──
    false_suspects = []
    for cid, members in by_cluster.items():
        embs = [m["embedding"] for m in members if m["embedding"] is not None]
        if len(embs) < 2:
            continue
        d = cos_dist_matrix(np.stack(embs))
        max_d = float(d.max())
        if max_d > settings.cluster_distance_threshold:
            c = next(c for c in clusters if c["id"] == cid)
            false_suspects.append({
                "cluster_id": cid, "headline": c["headline"], "score": c["score"],
                "n": len(members), "max_intra_dist": round(max_d, 3),
                "titles": [m["title"] for m in members],
            })
    false_suspects.sort(key=lambda x: -x["max_intra_dist"])

    # ── missed-merge suspects: nearest cross-cluster pair under threshold ──
    embedded = [a for a in articles if a["embedding"] is not None]
    missed_suspects = []
    if len(embedded) > 1:
        embs = np.stack([a["embedding"] for a in embedded])
        cids = np.array([a["cluster_id"] for a in embedded])
        times = np.array([datetime.fromisoformat(a["published_at"]).timestamp() for a in embedded])
        d = cos_dist_matrix(embs)
        window_s = settings.cluster_window_hours * 3600
        seen_pairs: set[tuple[str, str]] = set()
        ii, jj = np.where(d < settings.cluster_distance_threshold)
        for i, j in zip(ii, jj):
            if i >= j or cids[i] == cids[j]:
                continue
            if abs(times[i] - times[j]) > window_s:
                continue
            pair = tuple(sorted((cids[i], cids[j])))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            missed_suspects.append({
                "dist": round(float(d[i, j]), 3),
                "a": {"cluster_id": cids[i], "title": embedded[i]["title"]},
                "b": {"cluster_id": cids[j], "title": embedded[j]["title"]},
            })
        missed_suspects.sort(key=lambda x: x["dist"])

    # ── label sheet: all multi-article clusters first, fill with singletons ──
    multi = [c for c in clusters if c["article_count"] > 1]
    solo = [c for c in clusters if c["article_count"] <= 1]
    rng = np.random.default_rng(42)
    sample = multi[:100]
    if len(sample) < 100 and solo:
        fill = rng.choice(len(solo), size=min(100 - len(sample), len(solo)), replace=False)
        sample += [solo[int(i)] for i in fill]
    with (OUT_DIR / "label_sheet.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["cluster_id", "score", "n_articles", "headline", "member_titles", "label"])
        for c in sample:
            titles = " || ".join(a["title"] for a in by_cluster.get(c["id"], []))
            w.writerow([c["id"], c["score"], c["article_count"], c["headline"], titles, ""])

    # ── report.md ──
    lines = [
        f"# Cluster/Score Eval — {datetime.now(timezone.utc).date()} (last {DAYS} days)",
        "",
        f"Clusters: {n} · Articles: {len(articles)} · "
        f"threshold={settings.cluster_distance_threshold} window={settings.cluster_window_hours}h",
        "",
        "## Cluster significance distribution (1–10)",
        "",
        "| score | count | share |",
        "|---|---|---|",
    ]
    for s in range(1, 11):
        c = score_hist.get(s, 0)
        lines.append(f"| {s} | {c} | {c / n:.1%} |" if n else f"| {s} | 0 | — |")
    lines += [
        "",
        f"Tier high (≥{TIER_HIGH}): {high} ({high / n:.1%}) · "
        f"notable (≥{TIER_NOTABLE}): {notable} ({notable / n:.1%})" if n else "no clusters",
        "",
        "## Article impact_score distribution (Haiku)",
        "",
        "| score | count |",
        "|---|---|",
    ]
    for s in sorted(impact_hist):
        lines.append(f"| {s} | {impact_hist[s]} |")
    lines += [
        f"| NULL | {impact_null} |",
        "",
        f"Score=5 rate: {neutral5}/{len(articles)} ({neutral5 / max(1, len(articles)):.1%}) — "
        "includes genuine 5s AND silent parse-failure fallbacks (indistinguishable today)",
        "",
        f"## False-merge suspects ({len(false_suspects)} clusters with max intra-distance > threshold)",
        "",
    ]
    for s in false_suspects[:25]:
        lines.append(f"- **{s['max_intra_dist']}** [{s['n']} arts, score {s['score']}] {s['headline']}")
        for t in s["titles"][:6]:
            lines.append(f"    - {t}")
    lines += [
        "",
        f"## Missed-merge suspects ({len(missed_suspects)} cross-cluster pairs under threshold, within window)",
        "",
    ]
    for s in missed_suspects[:25]:
        lines.append(f"- **{s['dist']}**")
        lines.append(f"    - {s['a']['title']}")
        lines.append(f"    - {s['b']['title']}")
    (OUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"clusters={n} articles={len(articles)}")
    print(f"false-merge suspects={len(false_suspects)} missed-merge suspects={len(missed_suspects)}")
    print(f"wrote {OUT_DIR}/snapshot.json, report.md, label_sheet.csv")


if __name__ == "__main__":
    main()
