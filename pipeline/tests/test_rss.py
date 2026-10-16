import socket
from urllib.error import URLError

import feedparser
import structlog

from ainews.ingestors import rss
from ainews.ingestors.rss import (
    extract_publisher,
    publisher_matches_org,
    strip_publisher_suffix,
)
from ainews.sources import Source

_FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title>
<item><title>OpenAI ships a new reasoning model</title><link>https://example.com/a</link>
<pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate><description>Details.</description></item>
</channel></rss>"""
_real_parse = feedparser.parse


def _source(url="https://example.com/feed"):
    return Source("Example", "Example", url, "rss", 5, "company-news")


def _failed(status=None, exc=None):
    return feedparser.FeedParserDict(entries=[], bozo=1, bozo_exception=exc, **({"status": status} if status else {}))


def test_a_healthy_feed_is_parsed(monkeypatch):
    monkeypatch.setattr(rss.feedparser, "parse", lambda url, **kw: _real_parse(_FEED))
    assert [a.source_url for a in rss.ingest_rss(_source())] == ["https://example.com/a"]


_GNEWS_FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Claude Opus 5.5 vs Qwen 4 Max: One Vendor Sells You Speed - OrcaRouter</title>
<link>https://news.google.com/rss/articles/1</link><pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate>
<source url="https://orcarouter.ai">OrcaRouter</source></item>
<item><title>AI in Chemicals Market Size, Share, Trends and Forecast to 2030 at 4% CAGR - GlobeNewswire</title>
<link>https://news.google.com/rss/articles/2</link><pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate>
<source url="https://www.globenewswire.com">GlobeNewswire</source></item>
<item><title>New Book 'AI Made Simple' Makes Artificial Intelligence Easier to Understand - EIN Presswire</title>
<link>https://news.google.com/rss/articles/4</link><pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate>
<source url="https://www.einpresswire.com">EIN Presswire</source></item>
<item><title>Anthropic ships Claude Opus 5.5 - Reuters</title>
<link>https://news.google.com/rss/articles/3</link><pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate>
<source url="https://www.reuters.com">Reuters</source></item>
</channel></rss>"""


def test_blocked_publisher_and_market_reports_are_dropped(monkeypatch):
    monkeypatch.setattr(rss.feedparser, "parse", lambda url, **kw: _real_parse(_GNEWS_FEED))
    kept = rss.ingest_rss(_source("https://news.google.com/rss/search?q=claude"))
    assert [(a.source_name, a.title) for a in kept] == [("Reuters", "Anthropic ships Claude Opus 5.5")]


def test_a_blocked_feed_is_a_warning_not_an_empty_success(monkeypatch):
    # A block page used to parse into zero entries and log an info-level count=0
    monkeypatch.setattr(rss.feedparser, "parse", lambda url, **kw: _failed(status=503))
    with structlog.testing.capture_logs() as logs:
        assert rss.ingest_rss(_source()) is None
    assert [(e["event"], e["log_level"], e["status"]) for e in logs] == [("rss.feed_failed", "warning", 503)]


def test_a_timeout_is_logged_and_skipped(monkeypatch):
    monkeypatch.setattr(rss.feedparser, "parse", lambda url, **kw: _failed(exc=URLError(socket.timeout("timed out"))))
    with structlog.testing.capture_logs() as logs:
        assert rss.ingest_rss(_source()) is None
    assert [e["event"] for e in logs] == ["rss.feed_failed"]
    assert "timed out" in logs[0]["error"]


def test_each_fetch_gets_a_timeout_and_restores_the_default(monkeypatch):
    seen = {}

    def parse(url, **kw):
        seen[url] = socket.getdefaulttimeout()
        return _failed(status=503)

    monkeypatch.setattr(rss.feedparser, "parse", parse)
    google = "https://news.google.com/rss/search?q=Sakana+AI"
    rss.ingest_rss(_source(google))
    rss.ingest_rss(_source())
    assert seen[google] == rss._GOOGLE_NEWS_TIMEOUT_S
    assert seen["https://example.com/feed"] == rss._TIMEOUT_S
    assert socket.getdefaulttimeout() is None


def test_extract_publisher_from_google_news_entry():
    entry = {"source": {"title": "Crypto Briefing", "href": "https://cryptobriefing.com"}}
    assert extract_publisher(entry) == "Crypto Briefing"


def test_extract_publisher_missing():
    assert extract_publisher({}) is None
    assert extract_publisher({"source": {"title": "  "}}) is None


def test_strip_publisher_suffix():
    assert (
        strip_publisher_suffix("Kimi 2.7 offers coding competition - Crypto Briefing", "Crypto Briefing")
        == "Kimi 2.7 offers coding competition"
    )


def test_strip_publisher_suffix_no_match_untouched():
    assert strip_publisher_suffix("Plain headline", "Reuters") == "Plain headline"


def test_strip_publisher_suffix_only_trailing():
    title = "Reuters report: things happened - Reuters"
    assert strip_publisher_suffix(title, "Reuters") == "Reuters report: things happened"


def test_publisher_matches_org():
    assert publisher_matches_org("Anthropic", "Anthropic")
    assert publisher_matches_org("Anthropic News", "Anthropic")
    assert not publisher_matches_org("Crypto Briefing", "Moonshot AI")
    assert not publisher_matches_org("Elets CIO", "Sarvam AI")
