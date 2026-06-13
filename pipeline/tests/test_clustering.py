from datetime import datetime, timezone

import numpy as np

from ainews.processing.clustering import (
    compute_merge_groups,
    effective_threshold,
    normalize_score,
    pick_category,
    pick_headline,
)

WINDOW_S = 48 * 3600
# unit vectors at increasing angles from A: dist(A,B)=0.2, dist(B,C)=0.2, dist(A,C)=0.72
VA = np.array([1.0, 0.0], dtype=np.float32)
VB = np.array([0.8, 0.6], dtype=np.float32)        # 0.20 from A
VC = np.array([0.2806, 0.9598], dtype=np.float32)  # 0.20 from B, 0.72 from A
VFAR = np.array([0.6, 0.8], dtype=np.float32)       # 0.40 from A
VNEAR = np.array([0.95, 0.312], dtype=np.float32)   # ~0.05 from A


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


# ── compute_merge_groups ────────────────────────────────────────────────────

def test_merge_close_news_clusters():
    groups = compute_merge_groups([VA, VB], [0, 0], [False, False], 0.30, WINDOW_S)
    assert groups == [[0, 1]]


def test_no_merge_far_clusters():
    groups = compute_merge_groups([VA, VFAR], [0, 0], [False, False], 0.30, WINDOW_S)
    assert groups == []


def test_no_merge_two_arxiv_clusters_above_tight_threshold():
    # both arXiv-dominant, distance 0.20 > arxiv threshold (0.10) -> stay split
    groups = compute_merge_groups([VA, VB], [0, 0], [True, True], 0.30, WINDOW_S)
    assert groups == []


def test_merge_arxiv_paper_with_news_coverage():
    # one arXiv, one news -> news threshold applies, so they merge
    groups = compute_merge_groups([VA, VB], [0, 0], [True, False], 0.30, WINDOW_S)
    assert groups == [[0, 1]]


def test_no_merge_outside_time_window():
    groups = compute_merge_groups([VA, VB], [0, 100 * 3600], [False, False], 0.30, WINDOW_S)
    assert groups == []


def test_merge_transitive_chain():
    # A-B and B-C are each 0.20; A-C is 0.72. Transitivity still groups all three.
    groups = compute_merge_groups([VA, VB, VC], [0, 0, 0], [False] * 3, 0.30, WINDOW_S)
    assert len(groups) == 1
    assert sorted(groups[0]) == [0, 1, 2]


def test_no_groups_when_all_distinct():
    # three mutually orthogonal/opposite unit vectors — all pairwise distances >= 1.0
    v_orth = np.array([0.0, 1.0], dtype=np.float32)
    v_opp = np.array([-1.0, 0.0], dtype=np.float32)
    groups = compute_merge_groups([VA, v_orth, v_opp], [0, 0, 0], [False] * 3, 0.30, WINDOW_S)
    assert groups == []
