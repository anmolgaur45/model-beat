import json
import math
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg
import structlog
from anthropic import Anthropic

from ..config import settings
from ..sources import get_organization

log = structlog.get_logger()


# Source-quality-weighted scoring. Authorities are the per-org significance_base
# values (≈3 local/aggregator, 5 mid-tier outlet, 7 wire/Bloomberg, 9 top lab).
# Without weighting, a wire story syndicated by ~17 authority-3 local-TV
# affiliates out-scored Bloomberg-led coverage of a major deal: the linear
# base-sum and linear distinct-org count both reward breadth-of-outlets, which
# low-authority syndication games. These two helpers fix that.
_AUTH_CAP = 7.0       # an org at/above this counts as one full corroborator
_BASE_DECAY = 0.6     # diminishing returns on each additional corroborating org
_COVERAGE_STEP = 0.25 # coverage-multiplier growth per effective extra org


def _weighted_base(authorities: list[float]) -> float:
    """Authoritative depth with diminishing returns.

    Sort authorities high→low and decay each additional org's contribution, so
    the best sources dominate and a long tail of weak outlets adds little. A
    pile of authority-3 affiliates converges to ~7.5 instead of summing to ~48.
    """
    auths = sorted(authorities, reverse=True)
    return sum(a * (_BASE_DECAY ** i) for i, a in enumerate(auths))


def _coverage_multiplier(authorities: list[float]) -> float:
    """Corroboration breadth, weighted by source quality.

    Each org contributes proportional to its authority (capped at _AUTH_CAP), so
    16 local stations count as far fewer 'effective' corroborators than 16
    independent high-authority newsrooms would.
    """
    effective = sum(min(1.0, a / _AUTH_CAP) for a in authorities)
    return 1.0 + _COVERAGE_STEP * max(0.0, effective - 1.0)


def normalize_score(raw: float) -> float:
    """Compress raw score to the 1-10 display scale with log compression.

    The old linear map (raw * 10 / 20, capped at 10) saturated: any cluster with
    raw >= 19 displayed 10, erasing ranking among top stories. Log anchors:
    raw 10 (single top-lab article, neutral impact) -> 5, raw 33 -> 8, raw 90 -> 10.
    """
    if raw <= 0:
        return 1.0
    return min(10.0, max(1.0, round(2.4 * math.log1p(raw / 1.43))))


def effective_threshold(source_name: str, news_threshold: float | None = None) -> float:
    if source_name.startswith("arXiv"):
        return settings.cluster_arxiv_threshold
    return news_threshold if news_threshold is not None else settings.cluster_distance_threshold


def pick_headline(members: list[tuple[str, float, datetime]]) -> str:
    """Pick cluster headline from the highest-authority member (earliest on tie).

    members: (title, significance_base, published_at)
    """
    best = max(members, key=lambda m: (m[1], -m[2].timestamp()))
    return best[0]


def pick_category(categories: list[str | None], current: str) -> str:
    """Majority vote over member categories, ignoring uncategorized."""
    votes = Counter(c for c in categories if c and c != "uncategorized")
    if not votes:
        return current
    return votes.most_common(1)[0][0]


def compute_cluster_score(conn: psycopg.Connection, cluster_id: str) -> float:
    """Compute and return the significance score for a cluster."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_name, significance_base, impact_score FROM articles WHERE cluster_id = %s",
            (cluster_id,),
        )
        articles = cur.fetchall()

    if not articles:
        return 0.0

    # Max significance_base per organization (so Google DM + Google AI = 1 org)
    org_base: dict[str, float] = {}
    impact_scores: list[float] = []

    for source_name, sig_base, impact_score in articles:
        org = get_organization(source_name)
        org_base[org] = max(org_base.get(org, 0.0), float(sig_base or 0.0))
        if impact_score is not None:
            impact_scores.append(float(impact_score))

    # Default to neutral 5 only when no articles have been scored yet
    max_impact = max(impact_scores) if impact_scores else 5.0

    authorities = list(org_base.values())
    base_score = _weighted_base(authorities)
    raw = base_score * (max_impact / 5.0) * _coverage_multiplier(authorities)

    return normalize_score(raw)


def _create_cluster(
    conn: psycopg.Connection,
    headline: str,
    category: str,
    published_at: datetime,
) -> str:
    cluster_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO clusters (id, headline, category, significance_score, first_published_at, article_count)
            VALUES (%s, %s, %s, 0, %s, 0)
            """,
            (cluster_id, headline, category, published_at),
        )
    return cluster_id


def refresh_cluster_meta(conn: psycopg.Connection, cluster_id: str) -> None:
    """Re-derive headline/category from members instead of trusting the seed article."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT title, significance_base, published_at, raw_category
            FROM articles WHERE cluster_id = %s
            """,
            (cluster_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return

    headline = pick_headline([(r[0], float(r[1] or 0.0), r[2]) for r in rows])
    with conn.cursor() as cur:
        cur.execute("SELECT category FROM clusters WHERE id = %s", (cluster_id,))
        current = (cur.fetchone() or ["uncategorized"])[0]
    category = pick_category([r[3] for r in rows], current or "uncategorized")

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE clusters SET headline = %s, category = %s WHERE id = %s",
            (headline, category, cluster_id),
        )


def _score_cluster(conn: psycopg.Connection, cluster_id: str) -> None:
    """Compute and persist a cluster's significance immediately.

    Scoring runs inline in the clustering loop (not only in the end-of-run batch)
    so an interrupted run — e.g. a large arXiv batch that times out — can never
    leave a cluster stranded at the placeholder score 0. The end-of-run pass still
    re-scores to absorb merge effects.
    """
    score = compute_cluster_score(conn, cluster_id)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE clusters SET significance_score = %s WHERE id = %s",
            (score, cluster_id),
        )


def _assign_articles(conn: psycopg.Connection, article_ids: list[str], cluster_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE articles SET cluster_id = %s WHERE id = ANY(%s)",
            (cluster_id, article_ids),
        )
        # Keep article_count and first_published_at in sync
        cur.execute(
            """
            UPDATE clusters c SET
                article_count     = (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id),
                first_published_at = (SELECT MIN(published_at) FROM articles a WHERE a.cluster_id = c.id)
            WHERE c.id = %s
            """,
            (cluster_id,),
        )
    refresh_cluster_meta(conn, cluster_id)


def _centroid_distance(
    conn: psycopg.Connection, cluster_id: str, embedding: np.ndarray
) -> float | None:
    """Cosine distance from an article to the mean embedding of a cluster's members."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT embedding FROM articles WHERE cluster_id = %s AND embedding IS NOT NULL",
            (cluster_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return None

    members = np.stack([np.asarray(r[0], dtype=np.float32) for r in rows])
    centroid = members.mean(axis=0)
    norm_c = np.linalg.norm(centroid)
    norm_e = np.linalg.norm(embedding)
    if norm_c < 1e-9 or norm_e < 1e-9:
        return None
    return float(1.0 - np.dot(centroid, embedding) / (norm_c * norm_e))


_BACKFILL_MIN = 300
_BACKFILL_DAYS = 4


def compute_merge_groups(
    centroids: list[np.ndarray],
    times: list[float],
    arxiv: list[bool],
    news_threshold: float,
    window_s: float,
    extra_edges: list[tuple[int, int]] | None = None,
) -> list[list[int]]:
    """Union-find over cluster centroids — groups clusters that are the same story.

    Two clusters merge when their centroid cosine distance is below threshold and
    they fall within the time window. Pairs where BOTH clusters are arXiv-dominant
    use the tight arXiv threshold, so distinct same-subfield papers are not
    re-blobbed; a paper + its news coverage still merge at the news threshold.
    `extra_edges` are additional (i, j) index pairs to union unconditionally —
    the same-event pairs an LLM confirmed in the ambiguous band (fragmentation
    fix); they are already window- and arXiv-filtered by `ambiguous_pairs`.
    Returns index groups of size >= 2 only.
    """
    k = len(centroids)
    if k < 2:
        return []
    mat = np.stack([c / max(float(np.linalg.norm(c)), 1e-9) for c in centroids])
    dist = 1.0 - mat @ mat.T

    parent = list(range(k))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(k):
        for j in range(i + 1, k):
            if abs(times[i] - times[j]) > window_s:
                continue
            thr = settings.cluster_arxiv_threshold if (arxiv[i] and arxiv[j]) else news_threshold
            if dist[i, j] < thr:
                union(i, j)

    for i, j in extra_edges or []:
        union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(k):
        groups.setdefault(find(i), []).append(i)
    return [g for g in groups.values() if len(g) >= 2]


def ambiguous_pairs(
    centroids: list[np.ndarray],
    times: list[float],
    arxiv: list[bool],
    low_threshold: float,
    high_threshold: float,
    window_s: float,
) -> list[tuple[int, int]]:
    """Cluster index pairs in the [low, high) centroid-distance band, in the time
    window — the fragmentation dead zone the LLM adjudicates.

    Pairs already below `low` merge automatically; pairs at/above `high` are too
    far apart to be the same event. arXiv-touching pairs are skipped (papers stay
    on the tight near-dupe threshold). Sorted closest-first so a per-run cap keeps
    the most likely duplicates.
    """
    k = len(centroids)
    if k < 2:
        return []
    mat = np.stack([c / max(float(np.linalg.norm(c)), 1e-9) for c in centroids])
    dist = 1.0 - mat @ mat.T

    cand: list[tuple[float, int, int]] = []
    for i in range(k):
        for j in range(i + 1, k):
            if abs(times[i] - times[j]) > window_s:
                continue
            if arxiv[i] or arxiv[j]:
                continue
            d = float(dist[i, j])
            if low_threshold <= d < high_threshold:
                cand.append((d, i, j))
    cand.sort()
    return [(i, j) for _, i, j in cand]


_ADJUDICATE_PROMPT = """\
You are deduplicating an AI-news feed. For each numbered pair of headlines, decide \
whether BOTH headlines report the SAME underlying news event — the same announcement or \
development — not merely the same topic, company, or model.

SAME event: two outlets covering one announcement, even with very different wording.
DIFFERENT event: the same company or model but distinct developments (a launch vs. a later \
price change vs. a benchmark result vs. a competitor's response vs. a regulatory action).
DIFFERENT event: two independent opinion, analysis, or think-pieces on the same broad theme \
that are not tied to one specific announcement — shared topic is not a shared event.

Pairs:
{pairs}

Respond with a JSON array only, no markdown, one object per pair in the same order:
[{{"pair": <number>, "same": true|false}}, ...]"""

_MAX_ADJUDICATE_PAIRS = 60


def _adjudicate_same_event(headline_pairs: list[tuple[str, str]]) -> list[bool]:
    """Ask Haiku which headline pairs describe the same news event.

    Returns one bool per input pair. Fails closed (all False) on a missing key or
    any error, so the adjudicator can only ever add merges the LLM affirmed — it
    never widens the false-merge surface the 0.30 threshold guards.
    """
    if not headline_pairs:
        return []
    if not settings.anthropic_api_key:
        return [False] * len(headline_pairs)

    lines = [f'{n}. A: "{a}"\n   B: "{b}"' for n, (a, b) in enumerate(headline_pairs, 1)]
    prompt = _ADJUDICATE_PROMPT.format(pairs="\n".join(lines))
    try:
        client = Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw
        verdict = {int(r["pair"]): bool(r["same"]) for r in json.loads(raw)}
    except Exception as exc:
        log.warning("clustering.adjudicate_failed", error=str(exc))
        return [False] * len(headline_pairs)

    return [verdict.get(n, False) for n in range(1, len(headline_pairs) + 1)]


def merge_close_clusters(
    conn: psycopg.Connection,
    news_threshold: float,
    window_hours: int,
) -> set[str]:
    """Reconcile same-story clusters that fragmented during assignment.

    The greedy article-by-article join can split one story into several clusters
    when its coverage is internally spread (see tasks/f1-findings.md). This pass
    merges clusters whose centroids are within threshold. Bounded to the backfill
    window. Returns the surviving cluster ids that absorbed others.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=_BACKFILL_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, first_published_at, headline FROM clusters WHERE first_published_at >= %s",
            (cutoff,),
        )
        cluster_rows = cur.fetchall()
    meta = {str(r[0]): r[1] for r in cluster_rows}
    headlines = {str(r[0]): (r[2] or "") for r in cluster_rows}
    if len(meta) < 2:
        return set()

    ids = list(meta.keys())
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cluster_id, embedding, source_name FROM articles
            WHERE cluster_id = ANY(%s::uuid[]) AND embedding IS NOT NULL
            """,
            (ids,),
        )
        rows = cur.fetchall()

    agg: dict[str, dict] = {}
    for cid, emb, src in rows:
        d = agg.setdefault(str(cid), {"embs": [], "arxiv": 0, "n": 0})
        d["embs"].append(np.asarray(emb, dtype=np.float32))
        d["n"] += 1
        if (src or "").startswith("arXiv"):
            d["arxiv"] += 1

    order = [cid for cid in ids if cid in agg and agg[cid]["embs"]]
    if len(order) < 2:
        return set()

    centroids = [np.stack(agg[cid]["embs"]).mean(axis=0) for cid in order]
    times = [meta[cid].timestamp() for cid in order]
    arxiv_dom = [agg[cid]["arxiv"] * 2 > agg[cid]["n"] for cid in order]
    sizes = {cid: agg[cid]["n"] for cid in order}
    window_s = window_hours * 3600

    # Stage 2 — LLM adjudicates same-event pairs the embeddings left just past the
    # 0.30 merge threshold (the fragmentation dead zone). Only borderline pairs in
    # the window reach Haiku, closest-first and capped, so cost stays trivial.
    amb = ambiguous_pairs(
        centroids, times, arxiv_dom,
        news_threshold, settings.cluster_merge_high_threshold, window_s,
    )[:_MAX_ADJUDICATE_PAIRS]
    verdicts = _adjudicate_same_event([(headlines[order[i]], headlines[order[j]]) for i, j in amb])
    extra_edges = [amb[k] for k, same in enumerate(verdicts) if same]
    if amb:
        log.info("clustering.adjudicated", candidates=len(amb), confirmed=len(extra_edges))

    groups = compute_merge_groups(
        centroids, times, arxiv_dom, news_threshold, window_s, extra_edges=extra_edges
    )
    if not groups:
        return set()

    survivors: set[str] = set()
    for grp in groups:
        members = [order[i] for i in grp]
        # canonical = largest cluster (earliest on tie) absorbs the rest
        canonical = max(members, key=lambda c: (sizes[c], -meta[c].timestamp()))
        others = [c for c in members if c != canonical]
        with conn.cursor() as cur:
            for o in others:
                cur.execute(
                    "UPDATE articles SET cluster_id = %s WHERE cluster_id = %s", (canonical, o)
                )
                cur.execute("DELETE FROM clusters WHERE id = %s", (o,))
            cur.execute(
                """
                UPDATE clusters c SET
                    article_count      = (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id),
                    first_published_at = (SELECT MIN(published_at) FROM articles a WHERE a.cluster_id = c.id)
                WHERE c.id = %s
                """,
                (canonical,),
            )
        survivors.add(canonical)
        log.info("clustering.merged", canonical=canonical[:8], absorbed=len(others))

    conn.commit()
    for cid in survivors:
        refresh_cluster_meta(conn, cid)
    return survivors


def cluster_pending(
    conn: psycopg.Connection,
    distance_threshold: float,
    window_hours: int,
) -> int:
    """Assign cluster_id to every article that has an embedding but no cluster yet.

    Only processes the latest 300 articles or the last 4 days, whichever is more.
    Uses article-relative windowing: each article searches for neighbors within
    ±window_hours of its own published_at.

    Join rules (see tasks/f1-findings.md for the audit that motivated them):
    - per-source threshold: arXiv articles only merge as near-duplicates
    - an article joins the nearest neighbor's cluster only if it is also within
      threshold of that cluster's centroid (stops transitive chaining)
    - new clusters are seeded with the article alone; neighbors join through
      their own distance checks, never by bulk assignment
    """
    four_days_ago = datetime.now(timezone.utc) - timedelta(days=_BACKFILL_DAYS)
    window_td = timedelta(hours=window_hours)
    affected_clusters: set[str] = set()
    total = 0

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM articles WHERE cluster_id IS NULL AND embedding IS NOT NULL AND published_at >= %s",
            (four_days_ago,),
        )
        count_4days = cur.fetchone()[0]
    limit = max(_BACKFILL_MIN, count_4days)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, raw_category, published_at, embedding, source_name
            FROM articles
            WHERE cluster_id IS NULL AND embedding IS NOT NULL
            ORDER BY published_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    # Process oldest-first so early articles become cluster seeds for later ones
    rows = list(reversed(rows))

    log.info("clustering.pending", count=len(rows))

    for article_id, title, category, published_at, embedding, source_name in rows:
        threshold = effective_threshold(source_name or "", distance_threshold)

        # Article-relative window: search for neighbors within ±window_hours of this
        # article's publication date. Using the article's own date (not NOW()) means:
        # - Late-ingested articles still find contemporaneous articles as neighbors
        # - Old articles (e.g. 2023) only find other articles from 2023 — naturally
        #   preventing cross-temporal contamination without a special guard
        article_window_start = published_at - window_td
        article_window_end = published_at + window_td

        # Find up to 10 nearest neighbors inside the article-relative time window
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM find_nearest_article(%s, %s, %s, %s, %s)",
                (embedding, str(article_id), article_window_start, threshold, article_window_end),
            )
            neighbors = cur.fetchall()
            # Columns: id, cluster_id, title, distance

        emb = np.asarray(embedding, dtype=np.float32)

        # Candidate clusters in nearest-neighbor order; join the first whose
        # centroid is also within threshold
        joined: str | None = None
        tried: set[str] = set()
        for n in neighbors:
            if n[1] is None or str(n[1]) in tried:
                continue
            candidate = str(n[1])
            tried.add(candidate)
            dist = _centroid_distance(conn, candidate, emb)
            if dist is not None and dist < threshold:
                joined = candidate
                break

        if joined:
            _assign_articles(conn, [str(article_id)], joined)
            _score_cluster(conn, joined)
            affected_clusters.add(joined)
        else:
            cluster_id = _create_cluster(conn, title, category or "uncategorized", published_at)
            _assign_articles(conn, [str(article_id)], cluster_id)
            _score_cluster(conn, cluster_id)
            affected_clusters.add(cluster_id)

        conn.commit()
        total += 1

    # Reconcile same-story clusters that fragmented during the greedy join
    merged = merge_close_clusters(conn, distance_threshold, window_hours)
    affected_clusters |= merged

    # Recompute significance scores for every surviving touched cluster
    # (merges may have deleted some — skip those)
    log.info("clustering.rescoring", clusters=len(affected_clusters))
    for cluster_id in affected_clusters:
        score = compute_cluster_score(conn, cluster_id)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE clusters SET significance_score = %s WHERE id = %s",
                (score, cluster_id),
            )
    conn.commit()

    return total
