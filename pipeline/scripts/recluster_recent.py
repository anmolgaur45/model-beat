"""One-time repair: re-cluster recent articles under the fixed join rules.

Un-assigns cluster_id for articles published in the last N days (default 4,
per the backfill limit), cleans up emptied clusters, re-runs cluster_pending,
and rescores clusters that lost members but survived. Clusters are derived
data — fully regenerable from articles.

Usage: cd pipeline && python scripts/recluster_recent.py [days]
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ainews.config import settings  # noqa: E402
from ainews.db import get_connection  # noqa: E402
from ainews.processing.clustering import (  # noqa: E402
    cluster_pending,
    compute_cluster_score,
    refresh_cluster_meta,
)


def main(days: int = 4):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT cluster_id FROM articles WHERE cluster_id IS NOT NULL AND published_at >= %s",
                (cutoff,),
            )
            touched = [str(r[0]) for r in cur.fetchall()]
            print(f"clusters touched: {len(touched)}")

            cur.execute(
                "UPDATE articles SET cluster_id = NULL WHERE published_at >= %s",
                (cutoff,),
            )
            print(f"articles unassigned: {cur.rowcount}")

            # resync counts for touched clusters, drop the now-empty ones
            cur.execute(
                """
                UPDATE clusters c SET
                    article_count      = (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id),
                    first_published_at = COALESCE(
                        (SELECT MIN(published_at) FROM articles a WHERE a.cluster_id = c.id),
                        c.first_published_at)
                WHERE c.id = ANY(%s::uuid[])
                """,
                (touched,),
            )
            cur.execute(
                "DELETE FROM clusters WHERE id = ANY(%s::uuid[]) AND article_count = 0",
                (touched,),
            )
            print(f"empty clusters deleted: {cur.rowcount}")
        conn.commit()

        # survivors that lost members need fresh meta + score
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM clusters WHERE id = ANY(%s::uuid[])", (touched,))
            survivors = [str(r[0]) for r in cur.fetchall()]
        for cid in survivors:
            refresh_cluster_meta(conn, cid)
            score = compute_cluster_score(conn, cid)
            with conn.cursor() as cur:
                cur.execute("UPDATE clusters SET significance_score = %s WHERE id = %s", (score, cid))
        conn.commit()
        print(f"surviving clusters rescored: {len(survivors)}")

        total = cluster_pending(
            conn,
            distance_threshold=settings.cluster_distance_threshold,
            window_hours=settings.cluster_window_hours,
        )
        print(f"articles re-clustered: {total}")
    finally:
        conn.close()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
