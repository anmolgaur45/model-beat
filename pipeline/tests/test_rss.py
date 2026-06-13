from ainews.ingestors.rss import (
    extract_publisher,
    publisher_matches_org,
    strip_publisher_suffix,
)


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
