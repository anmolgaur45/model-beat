from datetime import datetime, timedelta, timezone

from ainews.processing import embeddings


class FakeCursor:
    """Records executed SQL and serves canned results."""

    def __init__(self, store):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.store["calls"].append((" ".join(sql.split()), params))
        self.rowcount = self.store.get("rowcount", 0)

    def fetchone(self):
        return (self.store.get("count", 0),)

    def fetchall(self):
        return self.store.get("rows", [])


class FakeConn:
    def __init__(self, store):
        self.store = store

    def cursor(self):
        return FakeCursor(self.store)

    def commit(self):
        self.store["commits"] = self.store.get("commits", 0) + 1


def test_embed_pending_never_reaches_past_the_retention_window():
    """Without a floor this re-encodes every pruned article, forever."""
    store = {"calls": [], "count": 0, "rows": []}
    embeddings.embed_pending(FakeConn(store))

    select = [c for c in store["calls"] if c[0].startswith("SELECT id, title")]
    assert len(select) == 1
    sql, params = select[0]
    assert "published_at >= %s" in sql, "the SELECT lost its retention floor"

    floor = params[0]
    expected = datetime.now(timezone.utc) - timedelta(
        days=embeddings.EMBEDDING_RETENTION_DAYS
    )
    assert abs((floor - expected).total_seconds()) < 60


def test_embed_floor_matches_prune_cutoff():
    """The two must move together or the pipeline fights itself."""
    store = {"calls": [], "count": 0, "rows": []}
    embeddings.embed_pending(FakeConn(store))
    embed_floor = [c for c in store["calls"] if c[0].startswith("SELECT id, title")][0][1][0]

    store2 = {"calls": [], "rowcount": 0}
    embeddings.prune_old_embeddings(FakeConn(store2))
    prune_floor = store2["calls"][0][1][0]

    assert abs((embed_floor - prune_floor).total_seconds()) < 60


def test_prune_only_touches_clustered_articles():
    """An unclustered old article would become permanently unclusterable."""
    store = {"calls": [], "rowcount": 7}
    cleared = embeddings.prune_old_embeddings(FakeConn(store))

    sql, params = store["calls"][0]
    assert sql.startswith("UPDATE articles SET embedding = NULL")
    assert "cluster_id IS NOT NULL" in sql
    assert "embedding IS NOT NULL" in sql
    assert cleared == 7


def test_prune_clears_only_the_vector():
    """Everything the site renders must survive the prune untouched."""
    store = {"calls": [], "rowcount": 0}
    embeddings.prune_old_embeddings(FakeConn(store))
    sql = store["calls"][0][0]

    assert "DELETE" not in sql.upper()
    for column in ("title", "cluster_id =", "source_url", "published_at ="):
        assert column not in sql
