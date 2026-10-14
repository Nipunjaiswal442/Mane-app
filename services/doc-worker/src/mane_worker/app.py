import asyncio
import json
import logging
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from mane_worker.adapters.llm import create_llm
from mane_worker.adapters.speech import create_diarization, create_stt
from mane_worker.adapters.storage import create_storage
from mane_worker.config import Settings
from mane_worker.models import Transcript
from mane_worker.pipeline import draft_minutes, load_schema, normalize_audio
from mane_worker.queue import JobQueue, Lease, LeaseLost
from mane_worker.rendering import render_minutes

logger = logging.getLogger("mane.worker")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def log(event: str, **fields):
    logger.info(json.dumps({"event": event, **fields}, default=str))


class Worker:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.queue = JobQueue(settings)
        self.storage = create_storage(settings)
        self.stopping = threading.Event()
        self.active_job: str | None = None
        self.last_job: dict | None = None
        self.last_error: str | None = None
        self.thread = threading.Thread(target=self.run, name="mane-job-loop", daemon=True)

    def process(self, job: dict, client: httpx.Client) -> None:
        job_id = str(job["id"])
        with Lease(self.queue, job) as lease:
            response = client.get(f"/internal/jobs/{job_id}/context")
            response.raise_for_status()
            context = response.json()["data"]
            meeting = context["meeting"]
            payload = {"lockToken": job["locked_by"]}
            with tempfile.TemporaryDirectory(prefix="mane-doc-") as work:
                directory = Path(work)
                if job["kind"] == "transcribe":
                    source, wav = directory / "input.audio", directory / "normalized.wav"
                    self.storage.download(context["audio"]["storageKey"], str(source))
                    duration = normalize_audio(str(source), str(wav))
                    stt, diarizer = create_stt(), create_diarization()
                    try:
                        transcript = stt.transcribe(str(wav), meeting.get("languageHint"))
                        # Release STT before diarization to avoid overlapping model residency.
                        stt.close()
                        transcript = diarizer.apply(str(wav), transcript)
                    finally:
                        stt.close()
                        diarizer.close()
                    payload.update(transcript=transcript.model_dump(), durationS=duration)
                elif job["kind"] == "draft":
                    transcript = transcript_from_context(context)
                    llm = create_llm()
                    try:
                        content = draft_minutes(
                            llm,
                            transcript,
                            meeting,
                            context["users"],
                            load_schema(self.settings.schema_path),
                        )
                    finally:
                        try:
                            llm.close()
                        except Exception as error:
                            log("model_release_failed", error=str(error)[:300])
                    payload.update(content=content)
                elif job["kind"] == "render":
                    minutes = context["minutes"]
                    transcript = transcript_from_context(context)
                    docx, markdown = render_minutes(
                        minutes["content"],
                        transcript,
                        self.settings.template_path,
                        directory,
                        load_schema(self.settings.schema_path),
                        str(meeting["id"]),
                    )
                    lease.assert_owned()
                    # Attempt-specific paths prevent a stale attempt from replacing current bytes.
                    prefix = f"generated/{meeting['id']}/v{minutes['version']}/{job['locked_by']}"
                    payload["docx"] = self.storage.upload(
                        f"{prefix}/minutes.docx",
                        str(docx),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                    payload["markdown"] = self.storage.upload(
                        f"{prefix}/minutes.md", str(markdown), "text/markdown"
                    )
                else:
                    raise ValueError(f"Unknown job kind {job['kind']!r}")
                lease.assert_owned()
                result = client.post(f"/internal/jobs/{job_id}/complete", json=payload)
                result.raise_for_status()

    def run(self):
        if len(self.settings.worker_token) < 32:
            self.last_error = (
                "WORKER_TOKEN must contain at least 32 characters; queue processing disabled"
            )
            log("worker_configuration_error", error=self.last_error)
            return
        with httpx.Client(
            base_url=self.settings.api_url,
            timeout=30,
            trust_env=False,
            follow_redirects=False,
            headers={"x-worker-token": self.settings.worker_token},
        ) as client:
            while not self.stopping.is_set():
                job = None
                started = time.monotonic()
                try:
                    self.queue.fail_expired()
                    job = self.queue.claim()
                    if job:
                        self.active_job = str(job["id"])
                        log(
                            "job_started",
                            job_id=self.active_job,
                            kind=job["kind"],
                            attempt=job["attempts"],
                        )
                        self.process(job, client)
                        self.last_error = None
                        self.last_job = {
                            "id": str(job["id"]),
                            "kind": job["kind"],
                            "status": "done",
                            "durationS": round(time.monotonic() - started, 3),
                        }
                        log("job_completed", **self.last_job)
                except LeaseLost as error:
                    log("job_lease_lost", job_id=self.active_job, error=str(error))
                except Exception as error:
                    self.last_error = str(error)[:2000]
                    log("worker_error", job_id=self.active_job, error=self.last_error)
                    if job:
                        self.last_job = {
                            "id": str(job["id"]),
                            "kind": job["kind"],
                            "status": "failed",
                            "durationS": round(time.monotonic() - started, 3),
                        }
                        try:
                            response = client.post(
                                f"/internal/jobs/{job['id']}/fail",
                                json={"lockToken": job["locked_by"], "error": self.last_error},
                            )
                            response.raise_for_status()
                        except Exception as callback_error:
                            # Leave lease intact: stale-job recovery reclaims when API returns.
                            log(
                                "failure_callback_unavailable",
                                job_id=str(job["id"]),
                                error=str(callback_error)[:300],
                            )
                finally:
                    self.active_job = None
                if not job:
                    self.stopping.wait(self.settings.poll_seconds)

    def health(self) -> tuple[dict, int]:
        body = {
            "service": "doc-worker",
            "status": "ok",
            "activeJob": self.active_job,
            "lastJob": self.last_job,
            "lastError": self.last_error,
        }
        try:
            body["queue"] = self.queue.stats()
        except Exception:
            body.update(status="degraded", queue=None, database="unavailable")
        if len(self.settings.worker_token) < 32:
            body["status"] = "degraded"
        return body, 200 if body["status"] == "ok" else 503


def transcript_from_context(context: dict) -> Transcript:
    value = context["transcript"]
    return Transcript(language=value["language"], segments=value["segments"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = Worker(Settings())
    app.state.worker = worker
    worker.thread.start()
    yield
    worker.stopping.set()
    # On shutdown a current model may still be busy. Its daemon thread exits with this
    # process; the heartbeat stops, and a subsequent worker reclaims its expired lease.
    await asyncio.to_thread(worker.thread.join, 5)


app = FastAPI(
    title="Mane Doc Worker", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None
)


@app.get("/health")
def health():
    body, status = app.state.worker.health()
    return JSONResponse(body, status_code=status)


def main():
    import uvicorn

    uvicorn.run("mane_worker.app:app", host="127.0.0.1", port=Settings().port)


if __name__ == "__main__":
    main()
