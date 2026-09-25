"""Impact scoring.

On 2026-09-25 one article from 2026-07-24 was found to have emptied the final
scoring batch of every run for two months. Gemini refuses a whole prompt when any
one headline trips its blocklist, and scoring re-selected the refused article
forever because its SELECT had no age floor.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from ainews.processing import scoring


class FakeCursor:
    def __init__(self, store):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.store["calls"].append((" ".join(sql.split()), params))

    def fetchall(self):
        return self.store.get("rows", [])


class FakeConn:
    def __init__(self, store):
        self.store = store

    def cursor(self):
        return FakeCursor(self.store)

    def commit(self):
        pass


def _rows(n):
    return [(f"a{i}", f"headline {i}", "excerpt", "src") for i in range(n)]


def _fake_gemini(refused=(), down=False, calls=None):
    """Refuse any prompt that contains a refused article, like the real blocklist."""
    def fake(prompt):
        if calls is not None:
            calls.append(prompt)
        ids = re.findall(r"\[id=([^,]+),", prompt)
        if down or any(i in refused for i in ids):
            return None
        return json.dumps([{"id": i, "score": 6} for i in ids])
    return fake


def _scored(store):
    return {p[1] for sql, p in store["calls"] if sql.startswith("UPDATE articles SET impact_score")}


def _run(monkeypatch, rows, **fake):
    monkeypatch.setattr(scoring.settings, "vertex_project", "test-project")
    calls = []
    monkeypatch.setattr(scoring, "gemini_text", _fake_gemini(calls=calls, **fake))
    store = {"calls": [], "rows": rows}
    scoring.score_pending(FakeConn(store))
    return store, calls


def test_select_is_bounded_to_the_backfill_window(monkeypatch):
    store, _ = _run(monkeypatch, [])
    sql, params = next(c for c in store["calls"] if c[0].startswith("SELECT id, title"))
    assert "published_at >= LEAST(%s," in sql, "the SELECT lost its age floor"
    assert "OFFSET %s LIMIT 1" in sql
    floor, offset = params
    assert offset == scoring._BACKFILL_MIN - 1
    expected = datetime.now(timezone.utc) - timedelta(days=scoring._BACKFILL_DAYS)
    assert abs((floor - expected).total_seconds()) < 60


def test_a_healthy_batch_is_one_call(monkeypatch):
    store, calls = _run(monkeypatch, _rows(10))
    assert len(calls) == 1
    assert _scored(store) == {f"a{i}" for i in range(10)}


def test_one_refused_article_no_longer_sinks_its_batch(monkeypatch):
    store, _ = _run(monkeypatch, _rows(10), refused={"a3"})
    assert _scored(store) == {f"a{i}" for i in range(10)} - {"a3"}


def test_refused_article_only_costs_its_own_batch(monkeypatch):
    # 20 rows: the first batch is clean, the second holds the refused article
    store, calls = _run(monkeypatch, _rows(20), refused={"a15"})
    assert _scored(store) == {f"a{i}" for i in range(20)} - {"a15"}
    assert len(calls) == 1 + 1 + 10  # clean batch, failed batch, ten singles


def test_isolation_stops_when_the_model_is_down(monkeypatch):
    # An outage must not turn one failed batch into ten more failed calls
    store, calls = _run(monkeypatch, _rows(10), down=True)
    assert _scored(store) == set()
    assert len(calls) == 1 + 2


def test_a_lone_failed_article_is_not_retried(monkeypatch):
    store, calls = _run(monkeypatch, _rows(1), refused={"a0"})
    assert _scored(store) == set()
    assert len(calls) == 1
