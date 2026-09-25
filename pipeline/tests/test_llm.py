"""Shared Vertex Gemini call.

An empty response is not an exception, so until 2026-09-25 it returned None with
nothing logged: 58 of 65 failed scoring batches in one week had no recorded cause.
"""
from types import SimpleNamespace

import structlog

from ainews.processing import llm


def _client(response):
    return SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kw: response))


def test_a_blocked_prompt_is_logged_with_its_reason(monkeypatch):
    monkeypatch.setattr(llm.settings, "vertex_project", "test-project")
    blocked = SimpleNamespace(
        text=None, candidates=None,
        prompt_feedback=SimpleNamespace(block_reason="BLOCKLIST"),
    )
    monkeypatch.setattr(llm, "_client", _client(blocked))
    with structlog.testing.capture_logs() as logs:
        assert llm.gemini_text("prompt") is None
    empty = [e for e in logs if e["event"] == "llm.empty_response"]
    assert len(empty) == 1
    assert empty[0]["block_reason"] == "BLOCKLIST"


def test_a_normal_response_passes_through_unlogged(monkeypatch):
    monkeypatch.setattr(llm.settings, "vertex_project", "test-project")
    ok = SimpleNamespace(text="[]", candidates=[], prompt_feedback=None)
    monkeypatch.setattr(llm, "_client", _client(ok))
    with structlog.testing.capture_logs() as logs:
        assert llm.gemini_text("prompt") == "[]"
    assert logs == []
