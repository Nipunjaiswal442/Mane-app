# Prepare models for offline execution

Downloads happen during deliberate preparation. `make dev` does not fetch models, install packages, or pull images. Once preparation is complete, turn Wi-Fi off and rerun `make doctor`, then `make dev`.

1. Prepare package dependencies with `make setup` and cache PostgreSQL with `docker pull postgres:16-alpine`.
2. Start the installed Ollama app/service. Run `ollama pull qwen2.5:3b-instruct` once. The optional 7B model requires its own preparation and additional memory; select it with `LLM_MODEL`.
3. Download the MLX model to an explicit directory. This command uses the Hugging Face Hub only during preparation:

```sh
uv run --project services/doc-worker --with huggingface_hub python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/whisper-large-v3-turbo", local_dir="./models/whisper-mlx")'
```

Set `STT_MODEL_PATH` in `.env` to the absolute path of `models/whisper-mlx`. Model weights are not committed. The worker uses `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`; a missing file causes an actionable error rather than a download. `make doctor` validates the local MLX config/weights and the Ollama model list.

For a Linux NVIDIA appliance, stage the faster-whisper `large-v3` conversion and chosen vLLM-compatible instruct model in `MODEL_DIR/whisper-large-v3` and `MODEL_DIR/llm`. Record the original model identifier, version/revision, license, SHA-256 hashes, tokenizer, and quantization with the release. The composed LLM endpoint serves the local weights as `mane-local`.

Optional diarization requires separately accepting pyannote's model terms and downloading all required weights on a connected preparation machine. Place a **local** pipeline YAML at `MODEL_DIR/diarization/config.yaml` and replace every model reference in it with its local weight path. Test with network access disabled. Set `DIARIZE=pyannote` only after this succeeds; Pilot defaults to `off`. Do not store Hub tokens in an appliance image or production `.env`.

Model acquisition and redistribution rights are operational prerequisites. Inspect licenses for the exact selected release before distributing weights.
