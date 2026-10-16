from calendar import timegm
from datetime import datetime, timezone

import socket

import feedparser
import structlog

from ..models import NormalizedArticle
from ..processing.normalize import build_normalized_article, is_financial_noise, is_english, is_ai_relevant
from ..sources import Source

log = structlog.get_logger()

# Third-party articles arriving via Google News search feeds carry the
# aggregator tier, not the feed's configured authority
_AGGREGATOR_AUTHORITY = 3.0

_USER_AGENT = "AI-News-Calendar/1.0 (news aggregator)"
# Fetches used to run with no timeout and no status check, so a blocked feed
# parsed an error page into zero entries and logged an info-level count=0.
# Google News search feeds came back empty from Cloud Run in 12 of 16 runs
# (2026-10-16 health check), each costing 6-10 s, about 90 s a run.
_TIMEOUT_S = 20.0
_GOOGLE_NEWS_TIMEOUT_S = 5.0


def feed_timeout(url: str) -> float:
    return _GOOGLE_NEWS_TIMEOUT_S if "news.google.com" in url else _TIMEOUT_S


def fetch_feed(url: str, timeout: float):
    """feedparser does the HTTP itself; the timeout goes on the socket default.

    Cloudflare-fronted feeds (MarkTechPost) answer httpx with 403 even when its
    headers match feedparser's, so the fetch stays in feedparser. Ingest runs
    feeds one at a time, so swapping the process default is safe.
    """
    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    try:
        return feedparser.parse(url, request_headers={"User-Agent": _USER_AGENT})
    finally:
        socket.setdefaulttimeout(previous)


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
        feed = fetch_feed(source.feed_url, feed_timeout(source.feed_url))
    except Exception as exc:
        log.warning("rss.fetch_failed", source=source.name, error=str(exc))
        return []

    status = feed.get("status")
    if (status is not None and status >= 400) or (feed.bozo and not feed.entries):
        log.warning(
            "rss.feed_failed",
            source=source.name,
            status=status,
            error=repr(feed.get("bozo_exception")) if feed.bozo else None,
        )
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
