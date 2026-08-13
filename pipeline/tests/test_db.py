import psycopg
import pytest

from ainews import db

# The exact FATAL Cloud SQL returns when the frontend's serverless pools have
# taken every non-reserved slot. This is what failed the 2026-08-13 12:00 run.
SLOTS_EXHAUSTED = psycopg.OperationalError(
    'connection failed: FATAL:  remaining connection slots are reserved for '
    'roles with privileges of the "pg_use_reserved_connections" role'
)


@pytest.fixture
def no_sleep(monkeypatch):
    slept = []
    monkeypatch.setattr(db.time, "sleep", slept.append)
    monkeypatch.setattr(db, "register_vector", lambda conn: None)
    return slept


def test_get_connection_waits_out_a_slot_exhaustion_spike(monkeypatch, no_sleep):
    """A spike that clears part-way through must not fail the whole run."""
    attempts = []

    def fake_connect(**kwargs):
        attempts.append(1)
        if len(attempts) < 12:
            raise SLOTS_EXHAUSTED
        return "conn"

    monkeypatch.setattr(db.psycopg, "connect", fake_connect)

    assert db.get_connection() == "conn"
    assert len(attempts) == 12
    assert no_sleep == [db.CONNECT_BACKOFF_S] * 11


def test_get_connection_retries_cover_a_multi_minute_outage(monkeypatch, no_sleep):
    """The 12:00 UTC failure had 6 minutes of saturation to ride out."""
    monkeypatch.setattr(
        db.psycopg, "connect", lambda **kwargs: (_ for _ in ()).throw(SLOTS_EXHAUSTED)
    )

    with pytest.raises(psycopg.OperationalError):
        db.get_connection()

    # Total patience, in seconds, before the run is allowed to give up.
    assert sum(no_sleep) >= 8 * 60


def test_get_connection_does_not_retry_forever(monkeypatch, no_sleep):
    """The job's 60-min timeout must still win over the retry loop."""
    monkeypatch.setattr(
        db.psycopg, "connect", lambda **kwargs: (_ for _ in ()).throw(SLOTS_EXHAUSTED)
    )

    with pytest.raises(psycopg.OperationalError):
        db.get_connection()

    assert sum(no_sleep) < 30 * 60
