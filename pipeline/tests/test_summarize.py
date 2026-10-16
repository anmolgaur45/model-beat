from types import SimpleNamespace

import structlog

from ainews.processing import summarize
from ainews.processing.summarize import build_prompt, clean_summary


class FakeCursor:
    def __init__(self, store):
        self.store = store
        self.last = ""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.last = " ".join(sql.split())
        self.store["calls"].append((self.last, params))

    def fetchall(self):
        if self.last.startswith("SELECT id, headline"):
            return self.store["rows"]
        return [("Reuters", "An excerpt.")]


class FakeConn:
    def __init__(self, store):
        self.store = store

    def cursor(self):
        return FakeCursor(self.store)

    def commit(self):
        pass


def _run(monkeypatch, rows, budget=None):
    monkeypatch.setattr(summarize.settings, "vertex_project", "test-project")
    calls = []
    monkeypatch.setattr(
        summarize, "generate", lambda prompt: calls.append(prompt) or SimpleNamespace(text="A summary.")
    )
    if budget is not None:
        monkeypatch.setattr(summarize, "_TIME_BUDGET_S", budget)
    store = {"calls": [], "rows": rows}
    summarize.summarize_pending(FakeConn(store))
    return store, calls


def test_paper_only_clusters_are_not_summarized(monkeypatch):
    # 88.5% of summaries went to arXiv-only clusters nobody expands (2026-10-16)
    store, _ = _run(monkeypatch, [])
    sql = next(c[0] for c in store["calls"] if c[0].startswith("SELECT id, headline"))
    assert "a.source_name NOT LIKE 'arXiv%%'" in sql


def test_pending_clusters_are_summarized(monkeypatch):
    store, calls = _run(monkeypatch, [("c1", "Headline one", 6), ("c2", "Headline two", 5)])
    assert len(calls) == 2
    assert sum(1 for sql, _ in store["calls"] if sql.startswith("UPDATE clusters SET summary")) == 2


def test_the_time_budget_stops_new_calls(monkeypatch):
    # A Vertex slowdown on 2026-10-09 kept this step busy for 37 minutes
    with structlog.testing.capture_logs() as logs:
        _, calls = _run(monkeypatch, [("c1", "Headline", 6)], budget=-1)
    assert calls == []
    assert [e["event"] for e in logs] == ["summarize.budget_exhausted", "summarize.done"]


def test_build_prompt_includes_headline_and_excerpts():
    prompt = build_prompt(
        "OpenAI ships GPT-6",
        [("OpenAI Blog", "OpenAI announced GPT-6 today with longer context."),
         ("The Verge", "Coverage of the GPT-6 launch.")],
        8,
    )
    assert "OpenAI ships GPT-6" in prompt
    assert "[OpenAI Blog]" in prompt
    assert "[The Verge]" in prompt
    assert "max 90 words" in prompt
    assert "Significance: 8/10" in prompt


def test_build_prompt_caps_member_count():
    members = [(f"Source {i}", f"excerpt {i}") for i in range(6)]
    prompt = build_prompt("Headline", members, 5)
    # only the first 3 members are included
    assert "[Source 0]" in prompt and "[Source 2]" in prompt
    assert "[Source 3]" not in prompt


def test_build_prompt_handles_missing_excerpt():
    prompt = build_prompt("Headline", [("Reuters", None)], 4)
    assert "[Reuters]" in prompt


def test_build_prompt_no_members():
    prompt = build_prompt("Headline", [], 4)
    assert "(no excerpts available)" in prompt


def test_clean_summary_strips_and_collapses_whitespace():
    assert clean_summary("  Hello   world\n\n ") == "Hello world"


def test_clean_summary_empty_returns_empty():
    assert clean_summary("") == ""
    assert clean_summary("   ") == ""


def test_clean_summary_drops_leading_label():
    assert clean_summary("Summary: A new model launched.") == "A new model launched."
    assert clean_summary("TL;DR - chips got faster.") == "chips got faster."


def test_clean_summary_strips_markdown_fences():
    assert clean_summary("`A short summary.`") == "A short summary."


def test_clean_summary_caps_word_count():
    long_text = " ".join(["word"] * 120)
    out = clean_summary(long_text)
    assert out.endswith("…")
    assert len(out.split(" ")) == 90  # capped at 90 words; ellipsis attaches to the last
