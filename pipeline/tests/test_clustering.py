from datetime import datetime, timezone

import numpy as np

from ainews.processing.clustering import (
    _adjudicate_same_event,
    _coverage_multiplier,
    _weighted_base,
    ambiguous_pairs,
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


# ── source-quality-weighted scoring ─────────────────────────────────────────

def test_weighted_base_diminishing_returns():
    # a pile of authority-3 affiliates converges instead of summing linearly
    base = _weighted_base([3.0] * 16)
    assert base < 8.0  # would be 48 under the old linear sum
    # one Bloomberg-7 plus a few mid-tier outlets beats 16 weak ones
    assert _weighted_base([7.0, 7.0, 5.0, 5.0, 3.0, 3.0, 3.0, 3.0]) > base


def test_coverage_multiplier_authority_weighted():
    # 16 authority-3 orgs count as far fewer effective corroborators
    assert _coverage_multiplier([3.0] * 16) < 1.0 + 0.25 * 15  # below old linear growth
    # at equal breadth, higher-authority sources lift the multiplier more
    assert _coverage_multiplier([7.0] * 4) > _coverage_multiplier([3.0] * 4)
    # a single org gives no coverage boost
    assert _coverage_multiplier([7.0]) == 1.0


def test_syndication_does_not_outrank_authoritative_coverage():
    """17 local-TV affiliates must not outrank Bloomberg-led coverage of a deal."""
    def raw(authorities, max_impact):
        return _weighted_base(authorities) * (max_impact / 5.0) * _coverage_multiplier(authorities)

    syndicated = raw([3.0] * 17, max_impact=5.0)          # wire story on 17 local stations
    authoritative = raw([7.0, 7.0, 5.0, 5.0, 3.0, 3.0, 3.0, 3.0], max_impact=6.0)  # Bloomberg-led deal
    assert authoritative > syndicated
    assert normalize_score(authoritative) > normalize_score(syndicated)


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


def test_extra_edges_union_a_non_threshold_pair():
    # A and FAR are 0.40 apart — no threshold merge; the adjudicated edge forces it
    assert compute_merge_groups([VA, VFAR], [0, 0], [False, False], 0.30, WINDOW_S) == []
    groups = compute_merge_groups(
        [VA, VFAR], [0, 0], [False, False], 0.30, WINDOW_S, extra_edges=[(0, 1)]
    )
    assert groups == [[0, 1]]


def test_extra_edges_bridge_into_threshold_group():
    # A-B merge by threshold (0.20); an adjudicated B-orth edge pulls orth (0.40
    # from B, 1.0 from A — neither a threshold merge) into the same group.
    v_orth = np.array([0.0, 1.0], dtype=np.float32)
    assert compute_merge_groups([VA, VB, v_orth], [0, 0, 0], [False] * 3, 0.30, WINDOW_S) == [[0, 1]]
    groups = compute_merge_groups(
        [VA, VB, v_orth], [0, 0, 0], [False] * 3, 0.30, WINDOW_S, extra_edges=[(1, 2)]
    )
    assert len(groups) == 1
    assert sorted(groups[0]) == [0, 1, 2]


# ── ambiguous_pairs ─────────────────────────────────────────────────────────

def test_ambiguous_pairs_returns_only_the_band():
    # A-FAR is 0.40 (in [0.30, 0.45)); A-B is 0.20 and B-FAR is 0.04 (both below low)
    pairs = ambiguous_pairs([VA, VB, VFAR], [0, 0, 0], [False] * 3, 0.30, 0.45, WINDOW_S)
    assert pairs == [(0, 2)]


def test_ambiguous_pairs_excludes_confident_and_far():
    # VNEAR ~0.05 from A (below low) — nothing in the band
    assert ambiguous_pairs([VA, VNEAR], [0, 0], [False, False], 0.30, 0.45, WINDOW_S) == []
    # VC 0.72 from A (at/above high) — nothing in the band
    assert ambiguous_pairs([VA, VC], [0, 0], [False, False], 0.30, 0.45, WINDOW_S) == []


def test_ambiguous_pairs_skips_arxiv_and_out_of_window():
    assert ambiguous_pairs([VA, VFAR], [0, 0], [True, False], 0.30, 0.45, WINDOW_S) == []
    assert ambiguous_pairs([VA, VFAR], [0, 100 * 3600], [False, False], 0.30, 0.45, WINDOW_S) == []


# ── _adjudicate_same_event (fails closed) ────────────────────────────────────

def test_adjudicate_empty_returns_empty():
    assert _adjudicate_same_event([]) == []


def test_adjudicate_fails_closed_without_key(monkeypatch):
    from ainews.processing import clustering

    monkeypatch.setattr(clustering.settings, "anthropic_api_key", "")
    assert _adjudicate_same_event([("a", "b"), ("c", "d")]) == [False, False]
