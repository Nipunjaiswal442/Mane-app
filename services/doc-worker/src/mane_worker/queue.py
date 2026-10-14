import threading
import uuid
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from mane_worker.config import Settings


class LeaseLost(RuntimeError):
    pass


class JobQueue:
    def __init__(self, settings: Settings):
        self.settings = settings

    @contextmanager
    def connection(self):
        with psycopg.connect(
            self.settings.database_url, row_factory=dict_row, connect_timeout=5
        ) as connection:
            yield connection

    def claim(self) -> dict | None:
        token = str(uuid.uuid4())
        with self.connection() as connection:
            # A token is unique to an attempt, not just a worker process. The API fences
            # callbacks against it; an old attempt cannot finish a reclaimed job.
            row = connection.execute(
                """
                WITH candidate AS (
                    SELECT id FROM doc_jobs
                    WHERE attempts < %s AND (
                        status = 'queued' OR (status = 'running' AND
                        locked_at < NOW() - make_interval(secs => %s)))
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
                )
                UPDATE doc_jobs j SET status='running', attempts=j.attempts+1,
                    locked_at=NOW(), locked_by=%s, updated_at=NOW(), error=NULL
                FROM candidate c WHERE j.id=c.id RETURNING j.*
                """,
                (self.settings.max_attempts, self.settings.lease_seconds, token),
            ).fetchone()
            if row:
                next_status = {"transcribe": "transcribing", "draft": "drafting"}.get(row["kind"])
                if next_status:
                    connection.execute(
                        "UPDATE meetings SET status=%s, updated_at=NOW() WHERE id=%s",
                        (next_status, row["meeting_id"]),
                    )
            return row

    def heartbeat(self, job: dict) -> bool:
        with self.connection() as connection:
            result = connection.execute(
                """UPDATE doc_jobs SET locked_at=NOW(),updated_at=NOW()
                WHERE id=%s AND status='running' AND locked_by=%s""",
                (job["id"], job["locked_by"]),
            )
            return result.rowcount == 1

    def fail_expired(self) -> None:
        with self.connection() as connection:
            rows = connection.execute(
                """UPDATE doc_jobs SET status='failed',
                error='Worker lease expired after maximum attempts', updated_at=NOW()
                WHERE status='running' AND attempts >= %s
                AND locked_at < NOW() - make_interval(secs => %s) RETURNING meeting_id""",
                (self.settings.max_attempts, self.settings.lease_seconds),
            ).fetchall()
            for row in rows:
                connection.execute(
                    "UPDATE meetings SET status='failed', updated_at=NOW() WHERE id=%s",
                    (row["meeting_id"],),
                )

    def stats(self) -> dict:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT status,COUNT(*) AS count FROM doc_jobs GROUP BY status"
            ).fetchall()
            return {row["status"]: row["count"] for row in rows}


class Lease:
    def __init__(self, queue: JobQueue, job: dict):
        self.queue, self.job = queue, job
        self.stop = threading.Event()
        self.lost = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop.wait(self.queue.settings.lease_seconds / 3):
            try:
                if not self.queue.heartbeat(self.job):
                    self.lost.set()
                    return
            except Exception:
                # Failing closed prevents publication while ownership is uncertain.
                self.lost.set()
                return

    def assert_owned(self):
        if self.lost.is_set() or not self.queue.heartbeat(self.job):
            raise LeaseLost("Job lease was lost; this attempt cannot publish")

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=6)
