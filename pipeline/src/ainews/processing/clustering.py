import math
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg
import structlog

from ..config import settings
from ..sources import get_organization

log = structlog.get_logger()


def _coverage_multiplier(distinct_orgs: int) -> float:
    return 1.0 + 0.25 * (distinct_orgs - 1)


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

    base_score = sum(org_base.values())
    distinct_orgs = len(org_base)
    raw = base_score * (max_impact / 5.0) * _coverage_multiplier(distinct_orgs)

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
            affected_clusters.add(joined)
        else:
            cluster_id = _create_cluster(conn, title, category or "uncategorized", published_at)
            _assign_articles(conn, [str(article_id)], cluster_id)
            affected_clusters.add(cluster_id)

        conn.commit()
        total += 1

    # Recompute significance scores for every touched cluster
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
