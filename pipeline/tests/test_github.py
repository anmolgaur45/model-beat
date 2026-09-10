"""GitHub release ingestion.

A renamed repo answers /repos/<owner>/<name> with a 301 to its /repositories/<id>
URL. httpx does not follow redirects by default, so before 2026-09-10 a rename
silently retired the source: QwenLM/Qwen2.5 became QwenLM/Qwen3 and logged
github.fetch_failed on every run without anyone noticing.
"""
import httpx

from ainews.ingestors import github


def test_client_follows_redirects(monkeypatch):
    captured: dict = {}

    class _Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, *a, **k):
            raise AssertionError("network call in unit test")

    monkeypatch.setattr(httpx, "Client", _Client)
    github.ingest_github()
    assert captured.get("follow_redirects") is True
