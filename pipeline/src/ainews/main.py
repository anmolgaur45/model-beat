from datetime import datetime, timedelta, timezone

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
from .processing.embeddings import EMBEDDING_RETENTION_DAYS, embed_pending, prune_old_embeddings
from .processing.scoring import score_pending
from .processing.clustering import cluster_pending
from .processing.summarize import summarize_pending
from .processing.model_registry import (
    sync_models,
    create_missing_models,
    sync_benchmarks,
    sync_pricing,
    sync_endpoint_prices,
    sync_aa_benchmarks,
    link_model_coverage,
)

log = structlog.get_logger()


def ingest_all() -> list[NormalizedArticle]:
    all_articles: list[NormalizedArticle] = []

    # Google News throttles Cloud Run now and then: in the 12:00 UTC run on
    # 2026-10-16 all 14 search feeds timed out within a minute, while the day's
    # other runs were clean. After one fails, the rest wait for the next run
    # instead of each burning its timeout; their ~100-item backlog arrives then.
    google_down = False
    skipped = 0
    for source in RSS_SOURCES:
        google = "news.google.com" in source.feed_url
        if google and google_down:
            skipped += 1
            continue
        try:
            articles = ingest_rss(source)
        except Exception as exc:
            log.warning("ingest.source_failed", source=source.name, error=str(exc))
            continue
        if articles is None:
            google_down = google_down or google
            continue
        all_articles.extend(articles)
    if skipped:
        log.warning("ingest.google_news_skipped", feeds=skipped)

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


def drop_backdated(
    articles: list[NormalizedArticle], days: int
) -> tuple[list[NormalizedArticle], int]:
    """Drop articles published more than `days` ago.

    Feeds re-list old posts (Anthropic's and OpenAI's back catalogues), and an
    article older than the embedding floor is never embedded or clustered: 487
    such rows had piled up, published up to four years before they were
    ingested (2026-10-16 health check).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept = [a for a in articles if datetime.fromisoformat(a.published_at) >= cutoff]
    return kept, len(articles) - len(kept)


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


def add_severity(_logger, method_name: str, event_dict: dict) -> dict:
    """Cloud Logging reads `severity`, not structlog's `level`: without it 1,358 of
    a day's 1,394 entries landed as DEFAULT, so a severity filter or log-based
    alert never saw a warning (2026-10-16 health check)."""
    event_dict["severity"] = str(event_dict.get("level") or method_name).upper()
    return event_dict


def main() -> None:
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            add_severity,
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

        unique, backdated = drop_backdated(unique, EMBEDDING_RETENTION_DAYS)
        if backdated:
            log.info("pipeline.backdated_skipped", count=backdated)

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

        # Runs AFTER clustering so this run's articles are already placed.
        pruned = prune_old_embeddings(conn)
        log.info("pipeline.embeddings_pruned", count=pruned)

        # Model registry (Phase K) — Epoch AI sync + news linkage. Fault-isolated:
        # an Epoch outage or schema change must not fail the run.
        synced = created = benched = priced = swept = aa_benched = linked = 0
        try:
            synced = sync_models(conn)
            created = create_missing_models(conn)
            benched = sync_benchmarks(conn)
            priced = sync_pricing(conn)
            swept = sync_endpoint_prices(conn)
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
            priced=priced, swept=swept, aa_benched=aa_benched, linked=linked,
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
        # The connection has been open for the whole run (link_model_coverage
        # alone holds it 5-8 min) and Cloud SQL occasionally drops it before
        # this last write: an SSL EOF here failed the 2026-09-10 21:00 run
        # outright, and skipped the revalidate below, even though every content
        # step had already succeeded. The row only feeds the staleness banner's
        # MAX(ran_at) and the next run is 3h behind it, so losing one costs far
        # less than leaving 17 fresh clusters unpublished.
        try:
            record_run(conn, articles_ingested=len(new_articles), clusters_updated=clustered)
        except Exception as exc:
            log.warning("pipeline.record_run_failed", error=str(exc))
        notify_revalidate()
    except Exception as exc:
        log.error("pipeline.failed", error=str(exc))
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
