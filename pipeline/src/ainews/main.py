import httpx
import structlog
import psycopg

from . import db
from .config import settings
from .models import NormalizedArticle
from .sources import RSS_SOURCES
from .ingestors.rss import ingest_rss
from .ingestors.hackernews import ingest_hn
from .ingestors.github import ingest_github
from .processing.embeddings import embed_pending
from .processing.scoring import score_pending
from .processing.clustering import cluster_pending
from .processing.summarize import summarize_pending
from .processing.model_registry import (
    sync_models,
    create_missing_models,
    sync_benchmarks,
    sync_pricing,
    sync_aa_benchmarks,
    link_model_coverage,
)

log = structlog.get_logger()


def ingest_all() -> list[NormalizedArticle]:
    all_articles: list[NormalizedArticle] = []

    for source in RSS_SOURCES:
        try:
            all_articles.extend(ingest_rss(source))
        except Exception as exc:
            log.warning("ingest.source_failed", source=source.name, error=str(exc))

    for fn, label in [(ingest_hn, "hackernews"), (ingest_github, "github")]:
        try:
            all_articles.extend(fn())
        except Exception as exc:
            log.warning("ingest.source_failed", source=label, error=str(exc))

    return all_articles


def dedup_by_url(articles: list[NormalizedArticle]) -> list[NormalizedArticle]:
    seen: dict[str, NormalizedArticle] = {}
    for article in articles:
        if article.source_url not in seen:
            seen[article.source_url] = article
    return list(seen.values())


def dedup_by_title(articles: list[NormalizedArticle]) -> list[NormalizedArticle]:
    """Drop same-article rows that differ only by URL.

    Google News hands out distinct redirect URLs for the same article across
    feeds and fetches, so URL-keyed dedup misses them (see tasks/f1-findings.md).
    """
    seen: set[tuple[str, str]] = set()
    result: list[NormalizedArticle] = []
    for article in articles:
        key = (article.source_name.lower(), article.title.lower())
        if key in seen:
            continue
        seen.add(key)
        result.append(article)
    return result


def filter_existing(conn: psycopg.Connection, articles: list[NormalizedArticle]) -> list[NormalizedArticle]:
    if not articles:
        return []

    urls = [a.source_url for a in articles]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_url FROM articles WHERE source_url = ANY(%s)",
            (urls,),
        )
        existing = {row[0] for row in cur.fetchall()}

    candidates = [a for a in articles if a.source_url not in existing]
    if not candidates:
        return []

    # Same article, different URL: match on (source_name, title) over the last 7
    # days. lower() on both sides — the pair check below is case-insensitive, so
    # an exact-case SQL match let case-differing duplicates through.
    titles = [a.title.lower() for a in candidates]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT lower(source_name), lower(title) FROM articles
            WHERE published_at >= now() - interval '7 days' AND lower(title) = ANY(%s)
            """,
            (titles,),
        )
        existing_pairs = {(row[0], row[1]) for row in cur.fetchall()}

    return [
        a for a in candidates
        if (a.source_name.lower(), a.title.lower()) not in existing_pairs
    ]


def cap_new_articles(
    articles: list[NormalizedArticle], limit: int
) -> tuple[list[NormalizedArticle], int]:
    """Keep the newest `limit` articles; defer the rest to a later run.

    Bounds per-run work so a large batch (the daily arXiv dump) can't push the
    pipeline past the Cloud Run timeout. Deferred articles aren't stored, so they
    reappear as "new" next run and drain newest-first across the day's runs.
    """
    if limit <= 0 or len(articles) <= limit:
        return articles, 0
    ordered = sorted(articles, key=lambda a: a.published_at, reverse=True)
    return ordered[:limit], len(articles) - limit


def upsert_articles(conn: psycopg.Connection, articles: list[NormalizedArticle]) -> None:
    if not articles:
        return

    rows = [
        (
            a.title, a.body_excerpt, a.source_name, a.source_url,
            a.author, a.published_at, a.raw_category, a.significance_base,
        )
        for a in articles
    ]

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO articles
                (title, body_excerpt, source_name, source_url, author,
                 published_at, raw_category, significance_base)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_url) DO NOTHING
            """,
            rows,
        )
    conn.commit()


def record_run(conn: psycopg.Connection, articles_ingested: int, clusters_updated: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO pipeline_runs (articles_ingested, clusters_updated) VALUES (%s, %s)",
            (articles_ingested, clusters_updated),
        )
        # trim to last 100 rows
        cur.execute(
            "DELETE FROM pipeline_runs WHERE id NOT IN (SELECT id FROM pipeline_runs ORDER BY ran_at DESC LIMIT 100)"
        )
    conn.commit()


def notify_revalidate() -> None:
    if not settings.revalidate_url:
        return
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                settings.revalidate_url,
                headers={"Authorization": f"Bearer {settings.cron_secret}"},
            )
            resp.raise_for_status()
        log.info("pipeline.revalidated")
    except Exception as exc:
        log.warning("pipeline.revalidate_failed", error=str(exc))


def main() -> None:
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ]
    )

    log.info("pipeline.start")

    conn = db.get_connection()
    try:
        log.info("pipeline.ingesting")
        raw = ingest_all()
        log.info("pipeline.ingested", total=len(raw))

        unique = dedup_by_title(dedup_by_url(raw))
        log.info("pipeline.deduped", unique=len(unique))

        new_articles = filter_existing(conn, unique)
        log.info("pipeline.new", new=len(new_articles), skipped=len(unique) - len(new_articles))

        new_articles, deferred = cap_new_articles(new_articles, settings.max_new_articles_per_run)
        if deferred:
            log.info("pipeline.capped", kept=len(new_articles), deferred=deferred)

        upsert_articles(conn, new_articles)
        log.info("pipeline.upserted", count=len(new_articles))

        embedded = embed_pending(conn)
        log.info("pipeline.embedded", count=embedded)

        scored = score_pending(conn)
        log.info("pipeline.scored", count=scored)

        clustered = cluster_pending(
            conn,
            distance_threshold=settings.cluster_distance_threshold,
            window_hours=settings.cluster_window_hours,
        )
        log.info("pipeline.clustered", count=clustered)

        summarized = summarize_pending(conn)
        log.info("pipeline.summarized", count=summarized)

        # Model registry (Phase K) — Epoch AI sync + news linkage. Fault-isolated:
        # an Epoch outage or schema change must not fail the run.
        synced = created = benched = priced = aa_benched = linked = 0
        try:
            synced = sync_models(conn)
            created = create_missing_models(conn)
            benched = sync_benchmarks(conn)
            priced = sync_pricing(conn)
            aa_benched = sync_aa_benchmarks(conn)
            linked = link_model_coverage(conn)
        except Exception as exc:
            # A DB error escaping a registry step leaves the shared connection in
            # an aborted transaction; without this rollback, record_run below
            # fails and the whole run is marked failed despite the content work
            # having succeeded (and notify_revalidate never fires).
            conn.rollback()
            log.warning("pipeline.model_registry_failed", error=str(exc))
        log.info(
            "pipeline.models",
            synced=synced, created=created, benched=benched,
            priced=priced, aa_benched=aa_benched, linked=linked,
        )

        log.info(
            "pipeline.done",
            ingested=len(new_articles),
            embedded=embedded,
            scored=scored,
            clustered=clustered,
            summarized=summarized,
            models_synced=synced,
            benchmarks=benched,
            priced=priced,
            model_links=linked,
        )
        record_run(conn, articles_ingested=len(new_articles), clusters_updated=clustered)
        notify_revalidate()
    except Exception as exc:
        log.error("pipeline.failed", error=str(exc))
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
