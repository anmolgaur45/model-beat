from datetime import datetime, timedelta, timezone

from ainews.main import cap_new_articles, dedup_by_title, dedup_by_url
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
