import os
from dataclasses import replace

import pytest

from mane_worker.config import Settings
from mane_worker.queue import JobQueue, Lease, LeaseLost


class FakeQueue:
    settings = Settings(lease_seconds=30)

    def __init__(self, owned=True):
        self.owned = owned

    def heartbeat(self, job):
        return self.owned


def test_fencing_rejects_lost_lease():
    queue = FakeQueue()
    with Lease(queue, {"id": "job", "locked_by": "first"}) as lease:
        lease.assert_owned()
        queue.owned = False
        with pytest.raises(LeaseLost):
            lease.assert_owned()


def test_heartbeat_thread_stops_cleanly():
    lease = Lease(FakeQueue(), {})
    with lease:
        assert lease.thread.is_alive()
    assert not lease.thread.is_alive()


@pytest.mark.skipif(
    not (os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_TEST_URL")),
    reason="TEST_DATABASE_URL needed for isolated Postgres integration",
)
def test_postgres_skip_locked_reclaims_with_new_fencing_token():
    """Use an isolated schema, never mutate the application's real job tables."""
    import uuid

    import psycopg
    from psycopg import sql

    dsn = os.getenv("TEST_DATABASE_URL") or os.environ["DATABASE_TEST_URL"]
    namespace = "worker_test_" + uuid.uuid4().hex
    with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(namespace)))
        try:
            connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(namespace)))
            connection.execute("""CREATE TABLE meetings(id uuid primary key,
                status text,updated_at timestamptz);
                CREATE TABLE doc_jobs(id uuid primary key,meeting_id uuid,kind text,status text,
                attempts int default 0,error text,locked_at timestamptz,locked_by text,
                created_at timestamptz default now(),updated_at timestamptz default now())""")
            meeting, job_id = uuid.uuid4(), uuid.uuid4()
            connection.execute("INSERT INTO meetings VALUES (%s,'uploaded',now())", (meeting,))
            connection.execute(
                "INSERT INTO doc_jobs(id,meeting_id,kind,status) "
                "VALUES (%s,%s,'transcribe','queued')",
                (job_id, meeting),
            )
            scoped_dsn = psycopg.conninfo.make_conninfo(dsn, options=f"-csearch_path={namespace}")
            queue = JobQueue(replace(Settings(), database_url=scoped_dsn))
            first = queue.claim()
            assert first and first["attempts"] == 1
            assert queue.claim() is None
            connection.execute(
                "UPDATE doc_jobs SET locked_at=now()-interval '10 minutes' WHERE id=%s", (job_id,)
            )
            second = queue.claim()
            assert second["locked_by"] != first["locked_by"]
            assert second["attempts"] == 2
            assert queue.heartbeat(first) is False
            assert queue.heartbeat(second) is True
        finally:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(namespace)))
