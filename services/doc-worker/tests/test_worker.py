import hashlib
import json
from dataclasses import replace

import httpx

from mane_worker.app import Worker
from mane_worker.config import Settings


class OwnedQueue:
    settings = Settings(lease_seconds=30)

    def heartbeat(self, job):
        return True


def test_render_job_uses_api_context_and_fenced_callback(minutes, transcript, tmp_path):
    worker = Worker(replace(Settings(), storage_path=tmp_path, worker_token="a" * 64))
    worker.queue = OwnedQueue()
    context = {
        "meeting": {"id": "meeting-uuid", "title": minutes["title"], "heldAt": minutes["held_at"]},
        "minutes": {"version": 2, "content": minutes},
        "transcript": transcript.model_dump(),
        "users": [],
    }
    requests = []

    def respond(request):
        requests.append(request)
        if request.method == "GET":
            assert request.url.path == "/internal/jobs/job-uuid/context"
            return httpx.Response(200, json={"data": context})
        assert request.url.path == "/internal/jobs/job-uuid/complete"
        payload = json.loads(request.content)
        assert payload["lockToken"] == "attempt-uuid"
        for key in ("docx", "markdown"):
            artifact = payload[key]
            stored = tmp_path / artifact["storageKey"]
            assert stored.is_file()
            assert artifact["bytes"] == stored.stat().st_size
            assert artifact["sha256"] == hashlib.sha256(stored.read_bytes()).hexdigest()
            assert artifact["storageKey"].startswith("generated/meeting-uuid/v2/attempt-uuid/")
        return httpx.Response(200, json={"data": {"status": "published"}})

    with httpx.Client(
        base_url="http://127.0.0.1:4000", transport=httpx.MockTransport(respond)
    ) as client:
        worker.process({"id": "job-uuid", "kind": "render", "locked_by": "attempt-uuid"}, client)
    assert len(requests) == 2


def test_missing_worker_token_disables_queue_processing(tmp_path):
    worker = Worker(replace(Settings(), storage_path=tmp_path, worker_token="short"))
    worker.run()
    assert "at least 32 characters" in worker.last_error
