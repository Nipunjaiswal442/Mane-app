# Benchmarks

A short synthetic local-model smoke was measured on 2026-10-14. The representative 20-minute end-to-end acceptance benchmark remains unmeasured; the short run does not establish that target.

| Measurement | PRD target | Measured result |
| --- | --- | --- |
| 20-minute English meeting, upload through publication | <8 minutes, estimate | **Not measured** — requires a representative, consented 20-minute fixture; local models are now installed |
| Development resident memory | About 9GB | **Not measured** — collect total stack peak, including model processes and Docker |
| Feed server response, 10,000 posts | <300ms, estimate | **Not measured** |
| Socket.IO fan-out | 200 clients, estimate | **Not measured** |
| Backup/restore | Reproduces org/users/posts/published meeting | **Passed 2026-09-24**: real PostgreSQL dump/restore reproduced ten application tables and exact audio/Markdown/DOCX bytes from deliberately seeded fixtures. No duration target or model execution claimed. |

For each run record: git commit, macOS/Linux version, CPU/GPU model, RAM/VRAM, power mode, Node/Python versions, model file hashes, inference backend, model quantization, audio duration and language, queue wait, normalization/STT/draft/render timings, total upload-to-published wall time, peak RSS/VRAM, failures/retries, and resulting artifact IDs. Separate cold and warm model runs. Measure at least three runs before comparing a median to the estimate.

Use a recording with consent to process and retain it locally. The acceptance fixture must contain known decisions/actions with reference timestamps; scoring includes evidence accuracy, unsupported claims, owner matching, and review correction count. A fast inaccurate output does not pass.

The worker health endpoint provides operational timing counters; use an external wall-clock timer for end-to-end measurement. A human review interval should be recorded separately from machine processing time. Document how the eight-minute target excludes or includes review.


## Local adapter smoke — 2026-10-14

Input: a **26.18-second synthetic English recording** generated locally with macOS `say`, Samantha voice at 150 words/minute. The script names fictional participants and explicitly states that this is a synthetic meeting. It contains one pilot-launch decision and two assigned actions with spoken due dates. The audio and outputs remain in gitignored `data/benchmarks/`; no real meeting or customer information was used.

This calls the real normalization → MLX transcription → Ollama minutes generation → DOCX/Markdown renderer directly. It does **not** time browser upload, queue latency, review, approval, publication, or the full-stack memory footprint. No cloud inference or new model download occurred during either run. Model release is included in the STT/draft stage timings; `ollama ps` was empty afterward. `make doctor` passed all checks after provisioning.

| Stage | Initial run | Focused-fix rerun |
| --- | ---: | ---: |
| Normalize to mono 16 kHz PCM | 0.644 s | 0.088 s |
| MLX STT, including model load/release | 14.374 s | 6.289 s |
| Qwen extraction, including model load/release | 88.895 s | 35.731 s |
| DOCX + Markdown rendering | 0.132 s | 0.099 s |
| Total direct-adapter wall time | **104.105 s** | **42.260 s** |
| Python-process peak RSS | 873,529,344 bytes | 1,406,091,264 bytes |

These are two runs of different implementations, with different filesystem/cache history and output sizes. They are not a controlled cold/warm comparison, a throughput benchmark, or evidence of an expected performance improvement. RSS is the macOS process high-water value and excludes Ollama, GPU allocations, Docker, web, API, and other processes; it cannot validate the 9 GB whole-stack target.

The initial run completed operationally but **failed content review**: both action items cited the following transcript segment instead of their supporting sentence; task assignments were duplicated as decisions; the summary had seven sentences. Those artifacts are preserved in `data/benchmarks/local-smoke-initial/` with a separate quality review.

A focused correction now realigns an item's evidence only when its complete text uniquely quotes a transcript segment, allowing punctuation/case differences. It does not guess timestamps for paraphrases, fragments that remove context/negation, or repeated ambiguous quotations. Corrections are disclosed in `confidence_notes`. The extraction instructions also separate decisions from assignments and emphasize a three-to-six-sentence summary. Regression tests cover the observed shifted spans, negation, and repeated quotations.

The single rerun produced seven transcript segments, **one decision, two actions, and a three-sentence summary**. The decision cites 6.52–9.38 s. Priya's action now cites 9.80–14.90 s; Daniel's action cites 15.48–20.78 s. These spans contain their respective statements. Both due dates and owner names match the spoken script. Word and Markdown files rendered successfully.

**This is still not minutes-quality acceptance.** The rerun invented a 10:00 UTC time for the next meeting even though the recording only says “Friday”; its empty attendee list was accompanied by an inaccurate uncertainty note claiming names were not explicitly mentioned. These fields require human correction. The exact-quotation fix does not prove semantic support for all paraphrases or summary claims. Do not approve or publish this fixture's generated minutes without review.

Environment and model identity:

- macOS 27.0 on Apple Silicon, 16 GB unified memory; Python 3.12.4. Working tree before the initial repository release commit. Power mode and total-system peak memory were not measured.
- `mlx==0.32.2`, `mlx-whisper==0.4.3`, `torch==2.14.0`; local `mlx-community/whisper-large-v3-turbo` revision `a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb`.
- MLX `weights.safetensors`: 1,613,977,612 bytes, SHA-256 `951ed3fc1203e6a62467abb2144a96ce7eafca8fa77e3704fdb8635ff3e7f8a6`, verified against the completed download metadata.
- Ollama 0.34.4, `qwen2.5:3b-instruct`, 3.1B parameters, `Q4_K_M`, requested context 16,384 tokens; model digest `357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`.
- Final raw timing report, transcript, generated minutes, and exports: `data/benchmarks/local-smoke/`. These local artifacts are intentionally not committed.

No 20-minute run, representative accuracy score, production NVIDIA/CUDA smoke, multi-language quality evaluation, or eight-minute target acceptance is claimed.
