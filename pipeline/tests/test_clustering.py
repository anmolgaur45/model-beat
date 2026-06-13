from datetime import datetime, timezone

from ainews.processing.clustering import (
    effective_threshold,
    normalize_score,
    pick_category,
    pick_headline,
)


def _dt(day: int) -> datetime:
    return datetime(2026, 6, day, tzinfo=timezone.utc)


# ── normalize_score ─────────────────────────────────────────────────────────

def test_normalize_score_anchors():
    # single top-lab article, neutral impact (raw 10) stays a 5
    assert normalize_score(10.0) == 5.0
    # old formula saturated raw>=19 to 10; log keeps headroom
    assert normalize_score(20.0) < 8.0
    assert normalize_score(33.0) == 8.0
    assert normalize_score(90.0) == 10.0


def test_normalize_score_bounds():
    assert normalize_score(0.0) == 1.0
    assert normalize_score(-5.0) == 1.0
    assert normalize_score(0.5) == 1.0
    assert normalize_score(10_000.0) == 10.0


def test_normalize_score_monotonic():
    values = [normalize_score(r) for r in (1, 3, 6, 10, 18, 30, 50, 90, 200)]
    assert values == sorted(values)


# ── effective_threshold ─────────────────────────────────────────────────────

def test_arxiv_gets_near_dupe_threshold():
    assert effective_threshold("arXiv CS.AI") < effective_threshold("TechCrunch AI")


def test_news_threshold_passthrough():
    assert effective_threshold("The Verge", 0.22) == 0.22


def test_arxiv_ignores_news_threshold():
    assert effective_threshold("arXiv CS.AI", 0.22) == effective_threshold("arXiv CS.AI")


# ── pick_headline ───────────────────────────────────────────────────────────

def test_pick_headline_prefers_authority():
    members = [
        ("Snarky take on the launch - Some Blog", 3.0, _dt(1)),
        ("Official launch announcement", 10.0, _dt(2)),
    ]
    assert pick_headline(members) == "Official launch announcement"


def test_pick_headline_tie_breaks_earliest():
    members = [
        ("Later coverage", 5.0, _dt(2)),
        ("First coverage", 5.0, _dt(1)),
    ]
    assert pick_headline(members) == "First coverage"


# ── pick_category ───────────────────────────────────────────────────────────

def test_pick_category_majority_vote():
    cats = ["company-news", "model-releases", "company-news"]
    assert pick_category(cats, "uncategorized") == "company-news"


def test_pick_category_ignores_uncategorized():
    cats = ["uncategorized", "uncategorized", "regulation-policy"]
    assert pick_category(cats, "uncategorized") == "regulation-policy"


def test_pick_category_falls_back_to_current():
    assert pick_category(["uncategorized", None], "model-releases") == "model-releases"
