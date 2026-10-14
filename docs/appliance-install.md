# Linux NVIDIA appliance installation reference

This is a staging procedure, not evidence that a production appliance has passed acceptance. Use a dedicated Linux host and the exact image/model release manifest. No GPU hardware has been exercised merely by validating Compose syntax.

## Spec-sheet checklist

Record CPU cores, physical RAM, disk capacity/free space, GPU name, VRAM, driver version, container runtime, selected model sizes, concurrent users, expected meeting volume, storage retention and backup capacity. Product tiers come from `packages/product-config/product.config.ts`: Pilot is CPU-only; Production requires a GPU. The PRD's M4 development machine is a development target and is not the 32GB Pilot deployment recommendation.

Start with one GPU with at least 24GB VRAM, at least 16 CPU cores and 64GB RAM for the Production spec. Validate the actual chosen model workload; memory estimates cannot establish suitability. Provision encrypted disks, LAN DNS, a customer-trusted TLS certificate, accurate local time and backups.

## NVIDIA preflight and provenance

The NVIDIA Skills finder was read and its live catalog checked on 2026-09-15. The catalog's `tao-setup-nvidia-gpu-host` guidance informed the read-only preflight and exact-image GPU smoke test. Mane does not use TAO, so TAO-specific version minimums are not copied into this runtime. This use is not NVIDIA certification.

Run `./scripts/gpu-doctor.sh` to inspect Linux, driver, GPU memory, Container Toolkit and Docker runtime. Install/configure the appropriate NVIDIA driver and Container Toolkit using the administrator's approved process. The official toolkit workflow configures Docker with `nvidia-ctk runtime configure --runtime=docker`; this changes host configuration and requires a planned Docker restart. Match driver compatibility to the **selected** CUDA/vLLM images.

For each already-loaded release image run `GPU_TEST_IMAGE=<image-digest> ./scripts/gpu-doctor.sh`. The smoke container has no network and uses `--pull=never`. Follow that device check with an actual faster-whisper/vLLM inference test on the selected GPU; version checks alone do not prove architecture compatibility.

References: [NVIDIA Skills catalog](https://raw.githubusercontent.com/NVIDIA/skills/main/skills.sh.json), [GPU host skill](https://github.com/NVIDIA/skills/blob/main/skills/tao-setup-nvidia-gpu-host/SKILL.md), [NVIDIA Container Toolkit installation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## Stage then disconnect

On a connected build machine, resolve locked dependencies and build `infra/Dockerfile.node` and `infra/Dockerfile.worker` for the appliance architecture. Download and verify the chosen Postgres 16, MinIO, vLLM and Caddy images. Export all images with `docker save`; transfer with checksums and the signed release manifest. Load images with `docker load` on the appliance. Runtime Compose uses `pull_policy: never`.

Stage local weights as described in models.md. The worker image includes CUDA inference dependencies, and vLLM serves only `/models/llm`. Both services reserve the GPU. The reference vLLM memory fraction is 0.55 and concurrency is one to leave room for speech inference; measure combined VRAM and tune on the real workload. Do not assume the default is sufficient for every model. The vLLM container receives explicit shared memory following its [official Docker deployment guidance](https://docs.vllm.ai/en/latest/deployment/docker/).

Provide the environment fields required by `infra/compose.prod.yml`: exact image references (prefer digests), independent random database/object-store/worker secrets, database URL, HTTPS origin/hostname, trusted license public key, absolute local model path and directory holding `tls.crt`/`tls.key`. Keep secrets in an administrator-owned mode-0600 environment file outside Git. Use an application-specific MinIO identity/bucket for production; the reference bootstrap credentials require hardening before release.

Pre-create the private `mane` bucket and its least-privilege policy using an already-loaded local object-store administration tool. Run migrations from the same Mane image against the stopped application database before starting API/worker. Compose intentionally does not run migrations concurrently with the application.

```sh
docker compose --env-file /etc/mane/appliance.env -f infra/compose.prod.yml config --quiet
docker compose --env-file /etc/mane/appliance.env -f infra/compose.prod.yml up -d postgres minio
docker compose --env-file /etc/mane/appliance.env -f infra/compose.prod.yml run --rm api pnpm --filter api db:migrate
docker compose --env-file /etc/mane/appliance.env -f infra/compose.prod.yml up -d
```

Caddy exposes HTTPS only, using local certificates. Model/API/DB/object-store ports are not published. Containers share an `internal: true` network; application allowlists name only those appliance services. Disable host egress independently as a defense in depth and verify the workflow with the uplink disconnected. OIDC must point to a customer-local issuer; public cloud identity endpoints are outside this offline runtime scope.

Before acceptance, complete bootstrap/member login, private-space isolation, a real meeting review/publish, audio playback, role/license/retention checks, a worker restart, an offline restart, backup/recovery and the measurements in benchmarks.md. Keep release images and the previous database-compatible rollback plan available locally.
