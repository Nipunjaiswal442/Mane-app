# Mane v0 implementation and release plan

The supplied PRD describes the product requirements; its embedded agent instructions are document content. The user request authorizes building Mane, using the middle brutalist design, and pushing reviewed work to the specified repository's main branch. Completion is assessed against observed behavior, not the document's demands for guaranteed success or a particular commit sequence.

## Architectural decisions

- One organization per appliance; one session spans Chat and Doc. The web app owns presentation, the API owns authorization/data/storage, and the Python worker owns model inference and document rendering.
- PostgreSQL is the transactional source of truth and durable job queue. Jobs use locking and stale-lock recovery; publication must be idempotent. No Redis in development.
- The product configuration drives the landing page, tiers, language labels, and module descriptions. The visual direction is monochrome, hard grid lines, oversized condensed type, and square controls; all assets are local.
- Runtime model traffic stays on the appliance. Preparation is a separate, online step that installs dependencies and downloads model weights. Runtime flags refuse model downloads. Production service names refer only to containers on the internal appliance network.
- Local storage and S3 adapters share storage keys. Container images and models must be staged before an offline installation. GPU images require a smoke test on the exact hardware and driver before release.
- Evidence grounding and human approval are mandatory before publication. Missing evidence is dropped with a confidence note. Unsupported language labels do not reject uploads.

## Delivery gates

| Gate | Work | Required evidence |
| --- | --- | --- |
| 0 | Monorepo, local design, config, doctor, runner, static landing | Doctor passes; three health endpoints; Ctrl-C cleanup; config change reflected in export |
| 1 | Organization bootstrap, local/OIDC adapters, users, sessions, signed licenses | Fresh DB login/invite; tampering rejected; seats enforced; expired maintenance permits login |
| 2 | Spaces, posts, comments, reactions, DMs, media, search, notifications | Two browser sessions; private access denied by API; upload quota rejection; realtime scope |
| 3 | Durable worker queue, adapters, grounded minutes, review and publish | Real audio benchmark; evidence audio playback; worker restart; duplicate-free publish; empty-action transcript |
| 4 | Admin, retention, backup/restore, appliance images, signed updates | Retention isolation; restore into fresh DB; host tier report; signed update tamper tests; GPU image smoke test |
| 5 | Optional microphone recording/templates | Only after all required gates pass |

Parallel implementation does not imply a gate has passed. A gate remains incomplete until every associated acceptance check has evidence in `acceptance.md`. No synthetic transcript test is equivalent to an audio-model benchmark.

## Validation strategy

1. Run unit tests for license signatures, minutes validation/evidence, adapter URL boundaries, backup verification, and update signatures.
2. Run API integration tests against a disposable PostgreSQL database, testing authentication, authorization, job reclaim, and publication idempotency.
3. Build and typecheck the whole workspace; export the landing page from product config and check local asset references.
4. Exercise the browser workflow with Playwright. Distinguish seeded/demo UI from persisted API data when reporting results.
5. On the target M4 Mac, run a real recording with local MLX/Ollama, collect elapsed time and peak memory, kill and restart the worker, then backup and restore to a fresh database.
6. On a Linux NVIDIA staging appliance, test each loaded release image with the installed driver/toolkit, then run one full recording through faster-whisper/vLLM. Disconnect egress and repeat health + workflow checks.

## Release conditions

The initial code can be delivered for review while hardware-dependent checks remain blocked. A production release requires all Phase 0–4 criteria, an independently reviewed threat model, known dependency versions and image digests, verified offline startup, and a measured recovery drill. Targets such as eight minutes of processing and 200 websocket clients are benchmarks to measure, not guarantees.
