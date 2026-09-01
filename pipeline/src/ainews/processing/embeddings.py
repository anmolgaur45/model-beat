from datetime import datetime, timedelta, timezone

import psycopg
import structlog
from sentence_transformers import SentenceTransformer

log = structlog.get_logger()

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        log.info("embeddings.loading_model")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        log.info("embeddings.model_loaded")
    return _model


_BACKFILL_MIN = 300
_BACKFILL_DAYS = 4

# Embeddings are a ROLLING asset, not permanent storage. Clustering only ever
# compares an article against neighbours within +/-48h, and a cluster's centroid
# is only recomputed while that cluster is still taking new members, so a vector
# older than this window is never read again. Keeping them cost 62 MB of heap
# plus most of a 125 MB HNSW index on a 0.6 GB instance, which is what pushed
# `articles` past what the box can cache (2026-08-27 build incident).
#
# RETENTION AND THE EMBED FLOOR MUST MOVE TOGETHER. prune_old_embeddings() nulls
# vectors older than this; embed_pending() refuses to look further back than the
# same line. Widen one without the other and the pipeline re-embeds everything
# it just pruned, forever.
EMBEDDING_RETENTION_DAYS = 30


def embed_pending(conn: psycopg.Connection, batch_size: int = 64) -> int:
    """Encode articles with no embedding and write 384-dim vectors to DB.

    Only processes the latest 300 articles or the last 4 days, whichever is more,
    and never reaches past EMBEDDING_RETENTION_DAYS.
    """
    four_days_ago = datetime.now(timezone.utc) - timedelta(days=_BACKFILL_DAYS)
    retention_floor = datetime.now(timezone.utc) - timedelta(days=EMBEDDING_RETENTION_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM articles WHERE embedding IS NULL AND published_at >= %s",
            (four_days_ago,),
        )
        count_4days = cur.fetchone()[0]
    limit = max(_BACKFILL_MIN, count_4days)

    with conn.cursor() as cur:
        # The floor is load-bearing: without it this SELECT walks back through
        # every pruned article and re-encodes it, because the "latest 300 with a
        # NULL embedding" are the pruned ones as soon as the new-article backlog
        # is smaller than the limit (it usually is).
        cur.execute(
            "SELECT id, title, body_excerpt FROM articles "
            "WHERE embedding IS NULL AND published_at >= %s "
            "ORDER BY published_at DESC LIMIT %s",
            (retention_floor, limit),
        )
        rows = cur.fetchall()

    if not rows:
        log.info("embeddings.none_pending")
        return 0

    model = _get_model()
    ids = [r[0] for r in rows]
    texts = [f"{r[1]}. {r[2] or ''}" for r in rows]
    total = 0

    for i in range(0, len(texts), batch_size):
        batch_ids = ids[i : i + batch_size]
        batch_texts = texts[i : i + batch_size]

        vectors = model.encode(batch_texts, normalize_embeddings=True, show_progress_bar=False)

        with conn.cursor() as cur:
            for article_id, vec in zip(batch_ids, vectors):
                cur.execute(
                    "UPDATE articles SET embedding = %s WHERE id = %s",
                    (vec.tolist(), article_id),
                )
        conn.commit()
        total += len(batch_ids)
        log.info("embeddings.batch", done=total, total=len(ids))

    return total


def prune_old_embeddings(conn: psycopg.Connection) -> int:
    """Drop vectors past the retention window. Returns rows cleared.

    Runs every pipeline run so the table stays bounded instead of growing until
    it no longer fits in the instance's cache. Only the vector is cleared; the
    article row, its cluster membership and everything the site renders are
    untouched, so this is invisible to readers.
    """
    floor = datetime.now(timezone.utc) - timedelta(days=EMBEDDING_RETENTION_DAYS)
    with conn.cursor() as cur:
        # cluster_id IS NOT NULL guards the one case that would lose data: an
        # old article that was never clustered would become unclusterable, since
        # embed_pending will not look back this far to re-encode it.
        cur.execute(
            "UPDATE articles SET embedding = NULL "
            "WHERE embedding IS NOT NULL AND published_at < %s "
            "AND cluster_id IS NOT NULL",
            (floor,),
        )
        cleared = cur.rowcount
    conn.commit()
    if cleared:
        log.info("embeddings.pruned", cleared=cleared, older_than_days=EMBEDDING_RETENTION_DAYS)
    return cleared
