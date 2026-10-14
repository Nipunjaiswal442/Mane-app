# Mane Doc Worker

Python 3.12 service for appliance-local transcription, evidence-grounded draft minutes, and reviewed Word/Markdown exports. It consumes the API's Postgres job queue; it never exposes a public model endpoint.

## Setup

From the repository root, run `make setup` and use `make dev`. For an isolated worker environment:

```sh
cd services/doc-worker
uv sync --extra test --extra mlx
# Linux + NVIDIA: uv sync --extra test --extra cuda
# Optional production speaker labels: add --extra diarization
PYTHONPATH=src .venv/bin/python -m uvicorn mane_worker.app:app --host 127.0.0.1 --port 5000
```

Install `ffmpeg` and provision model weights before disconnecting the appliance. Package installation and model provisioning need network access; meeting processing does not download models.

| Variable | Default / meaning |
| --- | --- |
| `DATABASE_URL` | `postgresql://mane:mane@127.0.0.1:5432/mane` |
| `API_URL` | `http://127.0.0.1:4000` |
| `WORKER_TOKEN` | At least 32 characters, shared with the API's internal routes |
| `STORAGE_BACKEND` | `local` or `s3`; defaults to `local` |
| `STORAGE_PATH` | Repository `data/`; `DATA_DIR` is a fallback |
| `STT_BACKEND` | `mlx` or `faster_whisper`; defaults to `mlx` |
| `STT_MODEL_PATH` | Required path to already downloaded compatible model weights |
| `LLM_BACKEND` | `ollama` or `vllm`; defaults to `ollama` |
| `LLM_CONTEXT_TOKENS` | `16384`; must equal the vLLM server context setting |
| `LLM_MODEL` | Ollama: `qwen2.5:3b-instruct`; vLLM: `Qwen/Qwen2.5-7B-Instruct` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `VLLM_URL` | `http://127.0.0.1:8000/v1` |
| `DIARIZE` | `off` or `pyannote`; defaults to `off` |
| `DIARIZATION_MODEL_PATH` | Local pyannote pipeline YAML, required when enabled |
| `APPLIANCE_HOSTS` | Explicit comma-separated internal service hostname allowlist for Docker; empty by default |
| `WORKER_LEASE_SECONDS` | `300`; heartbeat interval is one third of the lease |
| `WORKER_POLL_SECONDS` | `2` |
| `MINUTES_SCHEMA_PATH` | `packages/shared/minutes.schema.json` |
| `MINUTES_TEMPLATE_PATH` | `services/doc-worker/templates/minutes.docx` |

S3 requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY`; optional `S3_REGION` defaults to `us-east-1`. Use an appliance MinIO endpoint. Explicit credentials avoid SDK metadata-service requests. HTTP clients reject redirects and ignore environment proxies. Only loopback URLs are permitted unless an operator explicitly sets `APPLIANCE_HOSTS`; that allowlist is a trust boundary, not a DNS firewall. Production should also deny external egress at its network boundary.

## Provisioning offline models

- **Mac:** download the complete `mlx-community/whisper-large-v3-turbo` snapshot during installation, copy it into `models/whisper-mlx`, and set `STT_MODEL_PATH` to the absolute directory. The runtime requires a filesystem path, never a Hugging Face repository name.
- **NVIDIA:** provision a converted CTranslate2 `large-v3` snapshot into a local directory. The `faster_whisper` adapter uses CUDA and float16 with `local_files_only=True`. Install the CUDA/cuDNN libraries compatible with the locked CTranslate2 build on the appliance; verify driver compatibility on the actual GPU.
- **Ollama:** install/pull `qwen2.5:3b-instruct` once and keep the Ollama service on the appliance. There is no runtime pull operation. The worker unloads Ollama after a draft job; MLX/STT and diarization models are released after transcription. Production vLLM owns its model lifecycle and remains resident.
- **Pyannote 3.x:** separately accept the model publishers' terms and manually download the pipeline configuration plus segmentation and embedding weights on an installation machine. Update the pipeline YAML to reference absolute local model paths and transfer all files to the appliance. No access token belongs in this repository or the worker runtime. Speaker labels such as `SPEAKER_00` do not establish real user identity.

The generated `uv.lock` pins package resolution. GPU libraries and actual model revisions still need to be pinned by the appliance release manifest. Record model hashes and test their quality before shipping a customer image.

## Processing and recovery

1. Claim a queued job using `FOR UPDATE SKIP LOCKED`, or reclaim an expired running job. Each attempt gets a new fencing token in `locked_by`; attempts are capped at three.
2. Send that token on API completion/failure callbacks. The API verifies the token within its transaction, rejects stale attempts, and makes already completed callbacks idempotent. Publication is performed by the API exactly once. A worker crash leaves the running job eligible for recovery after lease expiry.
3. Normalize uploads through `ffmpeg` to mono 16 kHz PCM WAV. Transcribe with the selected adapter, optionally add speaker labels, and post the transcript to the API. The API queues drafting.
4. Extract approximately 2,500-token chunks with approximately 10% segment overlap, then reduce pairs of drafts into final minutes. The token budget is a conservative character estimate, not the model's exact tokenizer. Input, JSON Schema, output and a 1,024-token margin share the configured context budget; oversized reductions fail explicitly instead of silently truncating minutes. Match vLLM's `--max-model-len` to `LLM_CONTEXT_TOKENS` and validate memory on the target GPU. Very long individual segments are split without inventing word timestamps.
5. Validate against the shared JSON Schema and retry once with validation errors. Remove decisions/actions whose evidence does not lie within actual transcript speech; list removals in `confidence_notes`. For a unique complete transcript quotation, repair shifted model timestamps to the matching segment and disclose the correction. This does not infer semantic support for paraphrases or ambiguous repeated quotations. Reject impossible due dates. Resolve attendees to org users only when name matching is unambiguous. The API resolves action owners again after human review.
6. After approval, recheck evidence, render the checked-in `.docx` template and its Markdown twin, write attempt-specific artifact paths, and return their sizes and SHA-256 digests. The API verifies them before publication. A stale attempt cannot overwrite the current attempt's files.

`GET /health` reports database availability, queue counts, the active job, and the most recent job duration. Logs are JSON and omit transcript text. Missing models are explicit job failures, never simulated transcription. Unused files from a crash between upload and callback may need orphan cleanup; retention applies to registered media. Transcript retention must preserve source evidence until final rendering has completed.

## Verification

```sh
cd services/doc-worker
.venv/bin/python -m pytest
.venv/bin/ruff check .
# Adds isolated-schema Postgres lease/recovery integration coverage:
TEST_DATABASE_URL=postgresql://mane:mane@127.0.0.1:5432/mane .venv/bin/python -m pytest
```

Tests use generated WAV silence, transcript/LLM fixtures, mock HTTP transports, and real `.docx` ZIP parsing. The suite blocks external socket connections. No test result measures transcription accuracy, NVIDIA performance, or the 20-minute production pipeline target. The Postgres integration test is explicitly skipped without `TEST_DATABASE_URL` (or `DATABASE_TEST_URL`). `templates/create_template.py` reproducibly rebuilds the template using `python-docx`.

The 20-minute English recording benchmark remains unmeasured until a representative consented recording is provided. Local models are now provisioned; the short synthetic smoke and its remaining content-quality defects are recorded in `../../docs/benchmarks.md`. A timestamp existing in speech proves traceability, not semantic correctness; the reviewer must verify the claims and assignments against the recording. Live model tests, CUDA memory measurements, pyannote local-weight compatibility, and a killed-worker-to-published-post test must pass on the target appliance before production acceptance.

Adapter references used during implementation: [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), [Ollama chat API](https://docs.ollama.com/api/chat), and [vLLM structured outputs](https://docs.vllm.ai/en/stable/features/structured_outputs/). NVIDIA skill discovery and deployment guidance are documented at the repository level; the worker does not call hosted NVIDIA inference endpoints.
