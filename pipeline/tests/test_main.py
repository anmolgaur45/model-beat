from datetime import datetime, timezone

from ainews.main import dedup_by_url
from ainews.models import NormalizedArticle


def _make(url: str) -> NormalizedArticle:
    return NormalizedArticle(
        title="Test Article",
        body_excerpt=None,
        source_name="test-source",
        source_url=url,
        author=None,
        published_at=datetime.now(tz=timezone.utc).isoformat(),
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
