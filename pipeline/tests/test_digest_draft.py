import importlib.util
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

_path =Path(__file__).resolve().parents[1] / "scripts" / "digest_draft.py"
_spec = importlib.util.spec_from_file_location("digest_draft", _path)
digest_draft = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(digest_draft)

SINCE = date(2026, 10, 29)
DAY = date(2026, 11, 1)


def event(slug="m", etype="price", scope=None, summary="s", day=DAY, floor=(None,) * 6):
    return (slug, slug.upper(), etype, scope, summary, f"https://src/{slug}", day, *floor)


def under(lines, title):
    """The lines in the section whose bold title starts with `title`."""
    start = next(i for i, line in enumerate(lines) if line.startswith(f"**{title}"))
    return lines[start + 1 : lines.index("", start)]


def test_vendor_events_keep_their_own_section():
    lines = digest_draft.moves_lines(
        [event(scope="vendor", summary="M: vendor list price cut (-50%)")], [], SINCE
    )
    assert len(under(lines, "Vendor list price")) == 1
    assert "M: vendor list price cut" in under(lines, "Vendor list price")[0]


def test_floor_events_collapse_to_one_line_per_model_biggest_first():
    current = (0.07, 1.4, "Wafer", "fp4", 1.4, 4.4)
    moves = [
        event("small", scope="floor", summary="now $0.078 (was $0.086, -9%)", floor=current),
        event("glm", scope="floor", summary="now $0.226 (was $0.7, -62%)", floor=current),
        event("glm", scope="floor", summary="now $2.208 (was $2, +10%)", floor=current),
    ]
    rows = under(digest_draft.moves_lines(moves, [], SINCE), "Cheapest third-party host")
    assert len(rows) == 2
    assert rows[0].startswith("- GLM: 2 moves, largest -62%. Now $0.07/$1.4 via Wafer (fp4)")
    assert "list $1.4/$4.4" in rows[0]
    assert rows[1].startswith("- SMALL: 1 move, largest -9%")


def test_floor_line_skipped_when_the_lab_itself_is_cheapest():
    lab = (0.7, 2.1, "Mistral", "unknown", 0.7, 2.1)
    moves = [event("mistral", scope="floor", summary="now $0.7 (was $1.36, -49%)", floor=lab)]
    assert digest_draft.moves_lines(moves, [], SINCE)[0].startswith("*(quiet week")


def test_five_models_on_one_date_collapse_to_one_revision_line():
    moves = [event(f"m{i}", etype="benchmark", summary=f"M{i} rose") for i in range(5)]
    rows = under(digest_draft.moves_lines(moves, [], SINCE), "Benchmarks")
    assert len(rows) == 1
    assert "5 models moved" in rows[0]


def test_four_models_on_one_date_stay_separate():
    moves = [event(f"m{i}", etype="benchmark", summary=f"M{i} rose") for i in range(4)]
    assert len(under(digest_draft.moves_lines(moves, [], SINCE), "Benchmarks")) == 4


def test_new_models_split_on_release_date():
    new = [
        ("hy4", "Hy4", "Tencent", date(2026, 11, 4), 0.417, 1.25, 1048576),
        ("old", "Old", "OpenAI", date(2025, 12, 16), None, None, None),
        ("undated", "Undated", None, None, None, None, None),
    ]
    lines = digest_draft.moves_lines([], new, SINCE)
    fresh = under(lines, "New this week")
    older = under(lines, "Added to the tracker")
    assert [row.split(" (")[0] for row in fresh] == ["- Hy4", "- Undated"]
    assert "no vendor listed" in fresh[1]
    assert [row.split(" (")[0] for row in older] == ["- Old"]


def test_quiet_week_says_so():
    assert "quiet week" in digest_draft.moves_lines([], [], SINCE)[0]


def test_existing_draft_is_never_overwritten(tmp_path, monkeypatch):
    digest_dir = tmp_path / "digest"
    digest_dir.mkdir()
    existing = digest_dir / f"draft-{datetime.now(timezone.utc):%Y-%m-%d}.md"
    existing.write_text("curated issue", encoding="utf-8")
    monkeypatch.setattr(digest_draft, "__file__", str(tmp_path / "scripts" / "digest_draft.py"))
    monkeypatch.setattr(digest_draft.sys, "argv", ["digest_draft.py"])
    monkeypatch.setattr(digest_draft, "get_connection", lambda: pytest.fail("queried the database"))

    with pytest.raises(SystemExit):
        digest_draft.main()

    assert existing.read_text(encoding="utf-8") == "curated issue"
