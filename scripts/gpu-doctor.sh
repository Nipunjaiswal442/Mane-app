#!/usr/bin/env bash
set -euo pipefail
# Read-only preflight. The optional container smoke test requires an already-loaded image.
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Pilot host: NVIDIA appliance checks require Linux; no GPU runtime changes made.'
  exit 1
fi
command -v nvidia-smi >/dev/null || { echo 'Missing NVIDIA driver / nvidia-smi'; exit 1; }
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
command -v nvidia-ctk >/dev/null || { echo 'Missing NVIDIA Container Toolkit'; exit 1; }
nvidia-ctk --version
docker info --format '{{json .Runtimes}}'
if [[ -n "${GPU_TEST_IMAGE:-}" ]]; then
  docker image inspect "$GPU_TEST_IMAGE" >/dev/null
  docker run --rm --pull=never --network=none --gpus all "$GPU_TEST_IMAGE" nvidia-smi -L
else
  echo 'Host inspection complete. Set GPU_TEST_IMAGE to each release image and rerun for device smoke testing.'
fi
