"""Offline simulation of the new clustering rules on the last 14 days (read-only).

Replays cluster_pending's join logic in memory (per-source threshold, centroid
check, solo seed) against real articles, then reports before/after metrics:
false-merge suspects, known-correct clusters preserved, score distribution
under the new log normalization.

Usage: cd pipeline && python scripts/simulate_recluster.py
"""

import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.db import get_connection  # noqa: E402
from ainews.processing.clustering import (  # noqa: E402
    _coverage_multiplier,
    _weighted_base,
    effective_threshold,
    normalize_score,
)
from ainews.sources import get_organization  # noqa: E402

DAYS = 14
WINDOW_H = 48

# clusters hand-labeled CORRECT in the F1 audit — their members must stay together
CORRECT_CLUSTERS = ["fc4b823f", "46da480a", "260a25dc", "7fc78bb9", "fe0910f1", "193e648e", "c0e28de3"]
# known false merges — members must split
FALSE_CLUSTERS = ["68562c92", "2285c67e", "5af24d23"]  # US-China mix, 20-paper blob, 11-paper blob


def main(news_t: float | None = None):
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, source_name, published_at, significance_base,
                   impact_score, cluster_id, embedding
            FROM articles
            WHERE published_at >= %s AND embedding IS NOT NULL
            ORDER BY published_at ASC
            """,
            (since,),
        )
        rows = cur.fetchall()
    conn.close()

    arts = [
        {
            "id": str(r[0]), "title": r[1], "source": r[2], "ts": r[3],
            "base": float(r[4] or 0), "impact": r[5],
            "old_cluster": str(r[6]) if r[6] else None,
            "emb": np.asarray(r[7], dtype=np.float32),
        }
        for r in rows
    ]
    embs = np.stack([a["emb"] for a in arts])
    embs = embs / np.clip(np.linalg.norm(embs, axis=1, keepdims=True), 1e-9, None)
    times = np.array([a["ts"].timestamp() for a in arts])
    window_s = WINDOW_H * 3600

    # ── replay: oldest-first, join nearest cluster passing centroid check ──
    assign: list[int | None] = [None] * len(arts)
    clusters: dict[int, list[int]] = {}
    next_cid = 0

    for i in range(len(arts)):
        t = effective_threshold(arts[i]["source"] or "", news_t)
        d = 1.0 - embs @ embs[i]
        mask = (d < t) & (np.abs(times - times[i]) <= window_s)
        mask[i] = False
        neighbor_idx = np.where(mask)[0]
        neighbor_idx = neighbor_idx[np.argsort(d[neighbor_idx])][:10]

        joined = None
        tried = set()
        for j in neighbor_idx:
            cid = assign[j]
            if cid is None or cid in tried:
                continue
            tried.add(cid)
            centroid = embs[clusters[cid]].mean(axis=0)
            centroid /= max(np.linalg.norm(centroid), 1e-9)
            if 1.0 - float(np.dot(centroid, embs[i])) < t:
                joined = cid
                break

        if joined is None:
            joined = next_cid
            next_cid += 1
            clusters[joined] = []
        clusters[joined].append(i)
        assign[i] = joined

    # ── metrics ──
    multi = {cid: idx for cid, idx in clusters.items() if len(idx) > 1}
    print(f"articles={len(arts)}  clusters={len(clusters)}  multi-article={len(multi)} (was 145)")

    suspects = 0
    for cid, idx in multi.items():
        e = embs[idx]
        dmat = 1.0 - e @ e.T
        t = min(effective_threshold(arts[k]["source"] or "", news_t) for k in idx)
        if dmat.max() > max(t, 0.20):
            suspects += 1
    print(f"false-merge suspects (max intra-dist > threshold): {suspects} (was 54)")

    # arXiv contamination: multi clusters that are >=2 distinct arXiv papers
    arxiv_multi = sum(
        1 for idx in multi.values()
        if sum(1 for k in idx if (arts[k]["source"] or "").startswith("arXiv")) >= 2
    )
    print(f"multi clusters with 2+ arXiv members: {arxiv_multi} (was ~81 in sample)")

    # known-correct clusters: members should share a new cluster
    old_groups: dict[str, list[int]] = {}
    for k, a in enumerate(arts):
        if a["old_cluster"]:
            old_groups.setdefault(a["old_cluster"][:8], []).append(k)
    kept = 0
    for oc in CORRECT_CLUSTERS:
        idx = old_groups.get(oc, [])
        if len(idx) < 2:
            continue
        new_ids = {assign[k] for k in idx}
        status = "KEPT" if len(new_ids) == 1 else f"split into {len(new_ids)}"
        if len(new_ids) == 1:
            kept += 1
        print(f"  correct {oc}: {status}  ({arts[idx[0]]['title'][:55]})")
    print(f"known-correct clusters fully kept: {kept}")

    for oc in FALSE_CLUSTERS:
        idx = old_groups.get(oc, [])
        if not idx:
            continue
        new_ids = {assign[k] for k in idx}
        print(f"  false {oc}: was {len(idx)} arts in 1 cluster -> now {len(new_ids)} clusters")

    # ── score distribution under new normalization ──
    hist = Counter()
    high = []
    for cid, idx in clusters.items():
        org_base: dict[str, float] = {}
        impacts = []
        for k in idx:
            org = get_organization(arts[k]["source"] or "")
            org_base[org] = max(org_base.get(org, 0.0), arts[k]["base"])
            if arts[k]["impact"] is not None:
                impacts.append(float(arts[k]["impact"]))
        max_impact = max(impacts) if impacts else 5.0
        authorities = list(org_base.values())
        raw = _weighted_base(authorities) * (max_impact / 5.0) * _coverage_multiplier(authorities)
        s = normalize_score(raw)
        hist[int(s)] += 1
        if s >= 8.5:
            high.append((s, len(idx), arts[idx[0]]["title"][:70]))

    n = len(clusters)
    print("\nnew score distribution:")
    for s in range(1, 11):
        print(f"  {s}: {hist.get(s, 0)} ({hist.get(s, 0) / n:.1%})")
    print(f"high tier (>=8.5): {len(high)} ({len(high) / n:.1%}) (was 14, 1.6%)")
    for s, sz, title in sorted(high, reverse=True):
        print(f"  {s} n={sz}  {title}")


if __name__ == "__main__":
    arg = float(sys.argv[1]) if len(sys.argv) > 1 else None
    main(arg)
