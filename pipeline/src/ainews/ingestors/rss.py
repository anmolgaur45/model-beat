from calendar import timegm
from datetime import datetime, timezone

import feedparser
import structlog

from ..models import NormalizedArticle
from ..processing.normalize import build_normalized_article, is_financial_noise, is_english, is_ai_relevant
from ..sources import Source

log = structlog.get_logger()

# Third-party articles arriving via Google News search feeds carry the
# aggregator tier, not the feed's configured authority
_AGGREGATOR_AUTHORITY = 3.0


def extract_publisher(entry) -> str | None:
    """Real publisher of a Google News RSS item (<source> tag), if present."""
    src = entry.get("source")
    if src and src.get("title"):
        return str(src["title"]).strip() or None
    return None


def strip_publisher_suffix(title: str, publisher: str) -> str:
    """Google News titles end with ' - Publisher'; drop it so the headline is clean."""
    suffix = f" - {publisher}"
    if title.endswith(suffix):
        return title[: -len(suffix)].rstrip()
    return title


def publisher_matches_org(publisher: str, organization: str) -> bool:
    p, o = publisher.lower(), organization.lower()
    return o in p or p in o


def ingest_rss(source: Source) -> list[NormalizedArticle]:
    try:
        feed = feedparser.parse(
            source.feed_url,
            request_headers={"User-Agent": "AI-News-Calendar/1.0 (news aggregator)"},
        )
    except Exception as exc:
        log.warning("rss.fetch_failed", source=source.name, error=str(exc))
        return []

    results: list[NormalizedArticle] = []

    for entry in feed.entries:
        url = entry.get("link") or entry.get("id")
        if not url:
            continue

        excerpt = (
            entry.get("summary")
            or entry.get("content", [{}])[0].get("value")
            or None
        )
        author = entry.get("author") or entry.get("dc_creator") or None
        # Use parsed struct_time (always UTC) — raw strings are RFC 2822 which
        # fromisoformat() cannot handle.
        parsed_time = entry.get("published_parsed") or entry.get("updated_parsed")
        published_at = (
            datetime.fromtimestamp(timegm(parsed_time), tz=timezone.utc)
            if parsed_time else None
        )

        title = entry.get("title", "")
        publisher = extract_publisher(entry)
        if publisher:
            title = strip_publisher_suffix(title, publisher)

        article = build_normalized_article(
            title=title,
            url=url,
            excerpt=excerpt,
            author=author,
            published_at=published_at,
            source=source,
        )
        if not article:
            continue

        # Google News search feeds deliver third-party articles: attribute the real
        # publisher (citation correctness) and only keep the feed's authority when
        # the publisher IS the org the feed tracks (e.g. anthropic.com site: feeds)
        if publisher:
            article.source_name = publisher
            if not publisher_matches_org(publisher, source.organization):
                article.significance_base = min(article.significance_base, _AGGREGATOR_AUTHORITY)
        if is_financial_noise(article.title):
            continue
        if not is_english(article.title):
            continue
        if source.ai_filter and not is_ai_relevant(article.title, article.body_excerpt):
            continue

        results.append(article)

    log.info("rss.ingested", source=source.name, count=len(results))
    return results
