import logging
import time

import psycopg
from pgvector.psycopg import register_vector
from .config import settings

logger = logging.getLogger(__name__)

# Cloud SQL (db-f1-micro) has 50 slots shared with the Vercel frontend, whose
# per-instance pools can transiently exhaust them during traffic bursts
# (2026-07-11 incident: "remaining connection slots are reserved"). The
# pipeline is a batch job that can afford to wait out a spike, so retry the
# initial connect instead of failing the whole run.
#
# Widened 4 -> 20 attempts on 2026-08-13: a crawler burst on /story/* pinned the
# DB at its 47-slot ceiling for six minutes, which outlasted the 90s retry
# budget and failed the 12:00 UTC run outright. Slots freed at 12:06, so the run
# only needed to keep waiting. 20 attempts covers ~9.5 min against a 60-min job
# timeout on a ~6.5-min run, which leaves ample headroom.
CONNECT_ATTEMPTS = 20
CONNECT_BACKOFF_S = 30


def get_connection() -> psycopg.Connection:
    last_err: psycopg.OperationalError | None = None
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            conn = psycopg.connect(
                host=settings.database_host,
                port=settings.database_port,
                dbname=settings.database_name,
                user=settings.database_user,
                password=settings.database_password,
                sslmode="require",
                connect_timeout=15,
            )
            register_vector(conn)
            return conn
        except psycopg.OperationalError as e:
            last_err = e
            if attempt < CONNECT_ATTEMPTS:
                logger.warning(
                    "db connect failed (attempt %d/%d), retrying in %ds: %s",
                    attempt, CONNECT_ATTEMPTS, CONNECT_BACKOFF_S, e,
                )
                time.sleep(CONNECT_BACKOFF_S)
    raise last_err  # type: ignore[misc]
