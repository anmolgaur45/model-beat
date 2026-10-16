from datetime import datetime, timedelta, timezone

import psycopg

import ainews.main as m
from ainews.main import cap_new_articles, dedup_by_title, dedup_by_url, drop_backdated
from ainews.models import NormalizedArticle


def _make(
    url: str,
    title: str = "Test Article",
    source: str = "test-source",
    published_at: str | None = None,
) -> NormalizedArticle:
    return NormalizedArticle(
        title=title,
        body_excerpt=None,
        source_name=source,
        source_url=url,
        author=None,
        published_at=published_at or datetime.now(tz=timezone.utc).isoformat(),
        raw_category="uncategorized",
        significance_base=1.0,
    )


def test_dedup_removes_duplicate_urls():
    articles = [_make("https://a.com/1"), _make("https://a.com/1"), _make("https://a.com/2")]
    result = dedup_by_url(articles)
    assert len(result) == 2


def test_dedup_keeps_first_occurrence():
    a1 = _make("https://a.com/x")
    a2 = _make("https://a.com/x")
    result = dedup_by_url([a1, a2])
    assert result[0] is a1


def test_dedup_preserves_order():
    urls = ["https://a.com/1", "https://a.com/2", "https://a.com/3"]
    articles = [_make(u) for u in urls]
    result = dedup_by_url(articles)
    assert [a.source_url for a in result] == urls


def test_dedup_empty_list():
    assert dedup_by_url([]) == []


def test_dedup_all_unique():
    articles = [_make(f"https://a.com/{i}") for i in range(5)]
    result = dedup_by_url(articles)
    assert len(result) == 5


def test_dedup_by_title_same_article_different_url():
    a1 = _make("https://news.google.com/rss/articles/abc", title="Big Launch", source="Reuters")
    a2 = _make("https://news.google.com/rss/articles/xyz", title="Big Launch", source="Reuters")
    assert dedup_by_title([a1, a2]) == [a1]


def test_dedup_by_title_case_insensitive():
    a1 = _make("https://a.com/1", title="Big Launch", source="Reuters")
    a2 = _make("https://a.com/2", title="BIG LAUNCH", source="reuters")
    assert len(dedup_by_title([a1, a2])) == 1


def test_dedup_by_title_keeps_same_title_across_sources():
    a1 = _make("https://a.com/1", title="Big Launch", source="Reuters")
    a2 = _make("https://b.com/1", title="Big Launch", source="The Verge")
    assert len(dedup_by_title([a1, a2])) == 2


def _ts(days_ago: int) -> str:
    return (datetime.now(tz=timezone.utc) - timedelta(days=days_ago)).isoformat()


def test_cap_under_limit_returns_all():
    articles = [_make(f"https://a.com/{i}") for i in range(5)]
    kept, deferred = cap_new_articles(articles, 10)
    assert kept == articles
    assert deferred == 0


def test_cap_keeps_newest_and_reports_deferred():
    # oldest -> newest
    articles = [_make(f"https://a.com/{i}", published_at=_ts(days_ago=5 - i)) for i in range(5)]
    kept, deferred = cap_new_articles(articles, 2)
    assert deferred == 3
    # the two newest survive (i == 4 then i == 3)
    assert [a.source_url for a in kept] == ["https://a.com/4", "https://a.com/3"]


def test_cap_zero_limit_is_noop():
    articles = [_make("https://a.com/1")]
    kept, deferred = cap_new_articles(articles, 0)
    assert kept == articles
    assert deferred == 0


def test_google_news_feeds_wait_after_one_fails(monkeypatch):
    # 2026-10-16 12:00 UTC: all 14 Google News feeds timed out, ~5 s each
    from ainews.sources import Source
    gn = [Source(f"GN {i}", "X", f"https://news.google.com/rss/search?q={i}", "rss", 7, "company-news")
          for i in range(3)]
    other = Source("Lab blog", "Lab", "https://lab.example/feed", "rss", 10, "model-releases")
    monkeypatch.setattr(m, "RSS_SOURCES", [gn[0], other, gn[1], gn[2]])
    monkeypatch.setattr(m, "ingest_hn", lambda: [])
    monkeypatch.setattr(m, "ingest_github", lambda: [])
    fetched = []

    def fake_ingest(source):
        fetched.append(source.name)
        return None if source.name == "GN 0" else [_make(f"https://a.com/{source.name}")]

    monkeypatch.setattr(m, "ingest_rss", fake_ingest)
    assert [a.source_url for a in m.ingest_all()] == ["https://a.com/Lab blog"]
    assert fetched == ["GN 0", "Lab blog"]


def test_log_lines_carry_a_cloud_logging_severity():
    assert m.add_severity(None, "warning", {"event": "x", "level": "warning"})["severity"] == "WARNING"
    assert m.add_severity(None, "info", {"event": "x", "level": "info"})["severity"] == "INFO"
    assert m.add_severity(None, "error", {"event": "x"})["severity"] == "ERROR"


def test_backdated_articles_are_dropped():
    # Past the embedding floor an article is never embedded or clustered (487
    # such rows by 2026-10-16, re-listed by feeds up to four years late).
    articles = [_make("https://a.com/new", published_at=_ts(days_ago=29)),
                _make("https://a.com/old", published_at=_ts(days_ago=31)),
                _make("https://a.com/ancient", published_at="2022-11-09T10:00:00+00:00")]
    kept, dropped = drop_backdated(articles, 30)
    assert [a.source_url for a in kept] == ["https://a.com/new"]
    assert dropped == 2


# ── record_run must never fail an otherwise-successful run ────────────────────
# Regression guard for 2026-09-10 21:00 UTC: every content step succeeded, then
# the long-held connection dropped on the final pipeline_runs write, the job
# exited 1, and notify_revalidate() never fired, so 17 fresh clusters stayed
# unpublished for 3h.


class _FakeConn:
    def __init__(self) -> None:
        self.closed = False

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


def _neuter_pipeline(monkeypatch, record_run):
    """Stub every side-effecting step so only main()'s tail is under test."""
    conn = _FakeConn()
    monkeypatch.setattr(m.db, "get_connection", lambda: conn)
    monkeypatch.setattr(m, "ingest_all", lambda: [])
    monkeypatch.setattr(m, "filter_existing", lambda *a, **k: [])
    monkeypatch.setattr(m, "upsert_articles", lambda *a, **k: None)
    for name in (
        "embed_pending", "score_pending", "cluster_pending", "summarize_pending",
        "prune_old_embeddings", "sync_models", "create_missing_models",
        "sync_benchmarks", "sync_pricing", "sync_endpoint_prices",
        "sync_aa_benchmarks", "link_model_coverage",
    ):
        monkeypatch.setattr(m, name, lambda *a, **k: 0)
    monkeypatch.setattr(m, "record_run", record_run)
    revalidated: list[str] = []
    monkeypatch.setattr(m, "notify_revalidate", lambda: revalidated.append("yes"))
    return conn, revalidated


def _dropped_connection(*a, **k):
    raise psycopg.OperationalError(
        "consuming input failed: SSL error: unexpected eof while reading"
    )


def test_record_run_failure_does_not_fail_the_run(monkeypatch):
    conn, _ = _neuter_pipeline(monkeypatch, _dropped_connection)
    m.main()  # must not raise: a nonzero exit here pages the owner for nothing
    assert conn.closed


def test_revalidate_still_fires_when_record_run_dies(monkeypatch):
    _, revalidated = _neuter_pipeline(monkeypatch, _dropped_connection)
    m.main()
    assert revalidated == ["yes"]


def test_healthy_run_still_records_and_revalidates(monkeypatch):
    recorded: list[str] = []
    _, revalidated = _neuter_pipeline(monkeypatch, lambda *a, **k: recorded.append("yes"))
    m.main()
    assert recorded == ["yes"]
    assert revalidated == ["yes"]
