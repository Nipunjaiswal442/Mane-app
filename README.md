# Mane-app

Mane is a private collaboration appliance with two modules: **Mane-Chat** for spaces, conversations and shared files, and **Mane-Doc** for turning meeting recordings into evidence-linked minutes that a person reviews before publication. The interface follows the supplied brutalist reference: monochrome surfaces, strong type, square controls and visible grid lines. Fonts and artwork are served locally.

This repository is the first v0 implementation. Treat it as a development build until every check in [the acceptance ledger](docs/acceptance.md) has passed. A working UI and fixture tests do not establish the real-audio processing target, NVIDIA production readiness or the full PRD definition of done. [The implementation plan](docs/plan.md) explains the delivery gates.

## Development setup

The PRD targets an Apple M4 MacBook Air with 16GB unified memory and macOS 15+. Install these prerequisites once:

| Prerequisite | Preparation |
| --- | --- |
| Homebrew | Install using the official Homebrew instructions if absent. |
| Node.js 22 LTS | Use your Node version manager; Node 22 is the target. Newer versions are reported by doctor. |
| pnpm 9 | `corepack enable`; this repository pins pnpm 9.15.9. |
| Python 3.12 and uv | `brew install python@3.12 uv` |
| ffmpeg | `brew install ffmpeg` |
| Container engine | Prefer **OrbStack** for the smaller Mac footprint; Docker Desktop also works. Start it before doctor. |
| Ollama | `brew install ollama`; start with `ollama serve` or the Ollama app. |

No Homebrew PostgreSQL, Redis, MinIO or LiveKit is needed in development. PostgreSQL is the only dev container. Dependencies and model weights are downloaded only during deliberate preparation; runtime uses the local installation.

```sh
git clone https://github.com/Nipunjaiswal442/Mane-app.git
cd Mane-app
make setup
docker pull postgres:16-alpine
ollama pull qwen2.5:3b-instruct
uv run --project services/doc-worker --with huggingface_hub python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/whisper-large-v3-turbo", local_dir="./models/whisper-mlx")'
make doctor
make dev
```

`make setup` creates a private `.env` with a random worker token only if the file does not exist, installs the pnpm workspace, and prepares the Mac Python environment. It preserves an existing `.env`. Review `.env.example`, especially `STT_MODEL_PATH`. The default relative model path is normalized to an absolute path by the dev runner. Download size and network speed determine first setup time; no thirty-minute completion time is claimed.

If downloading a model through `uv run` changes installed extras, rerun `uv sync --project services/doc-worker --extra mlx --extra test` before doctor. More preparation details and the optional diarization weights are in [models.md](docs/models.md).

Open **[http://localhost:3000](http://localhost:3000)**. The first-run setup creates the organization and first administrator. There is no public signup. Keep using `localhost` consistently in the browser, matching the configured web origin. API health is [localhost:4000/health](http://localhost:4000/health); worker health is [localhost:5000/health](http://localhost:5000/health).

`make dev` checks the engine, local model files and model service, refreshes the static landing, starts PostgreSQL, migrates the database and starts all three services. Ctrl-C terminates their process groups and stops PostgreSQL without deleting its volume. It does not download missing images or models. After setup, test this with Wi-Fi disconnected.

## Repository and commands

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js 15 app, landing at `/`, product at `/app` |
| `apps/api` | Fastify 5, Socket.IO, auth/roles, PostgreSQL, media and job queue |
| `services/doc-worker` | FastAPI health, speech/LLM adapters, grounded minutes, DOCX/Markdown |
| `packages/product-config` | Names, module descriptions, pricing, hardware tiers and flags |
| `packages/shared` | Shared validation/types and the mirrored minutes JSON Schema |
| `packages/license` | Ed25519 license verification and development issuer |
| `infra`, `scripts`, `docs` | Local/production operations, recovery, checks and acceptance evidence |
| `data`, `models` | Local private files and weights; never commit these directories |

| Command | Result |
| --- | --- |
| `make doctor` | Red/green prerequisite table; exits nonzero on missing requirements |
| `make dev` | Full local stack on ports 3000/4000/5000 |
| `make landing` | Static export at `apps/web/out/landing/index.html` |
| `make check` | Typecheck and formatting verification |
| `make test` | Workspace, worker, update-signature, offline-network and backup safety tests |
| `make test-operations` | Isolated real PostgreSQL backup/restore drill; uses a cached image and removes its own temporary container |
| `pnpm test:e2e` | Playwright browser checks; install Chromium with `pnpm exec playwright install chromium` first |
| `make db:migrate` | Apply database migrations |
| `make db:reset CONFIRM=delete-local-data` | Explicitly delete and recreate the development database volume |
| `pnpm license:issue` | Issue a development license; see the CLI's flags/output for keys and destination |

The Node test preloader fails outbound network socket attempts before a request can leave loopback. Worker pytest similarly guards sockets. These checks catch regressions; production additionally needs network isolation and an offline acceptance run. API integration tests need a separate disposable database: create `mane_test` in the dev Postgres container and set `DATABASE_TEST_URL` for the test command. Never point test configuration at a database containing real data.

## Appliance operation and known limits

Production uses Linux NVIDIA inference adapters, local vLLM, a private S3-compatible store, and Caddy with customer-provided TLS. [appliance-install.md](docs/appliance-install.md) describes image/model staging, explicit local endpoints, GPU preflight and offline Compose startup. The NVIDIA Skills finder and its live catalog informed the GPU host checks; this is not a certification or a guarantee of model compatibility.

[operations.md](docs/operations.md) covers consistent local backup/fresh restore and retention. [updates.md](docs/updates.md) defines the signed offline update bundle. Signature verification is implemented; applying an update is intentionally a v0 stub. OIDC must use an organization-local issuer to satisfy the offline requirement.

The required twenty-minute real recording, peak memory, throughput and NVIDIA image tests remain unmeasured until recorded in [benchmarks.md](docs/benchmarks.md). The acceptance ledger identifies outstanding verification and any implementation gaps. Do not use development keys, example credentials or an untested reference Compose file as a production release.

This is a separate repository. It does not import from or operate on Swiftie.
