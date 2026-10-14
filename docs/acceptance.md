# Acceptance evidence

This ledger distinguishes implemented artifacts from executed acceptance checks. An unchecked box is not a pass. The initial build is not certified production-ready.

## Executed operations checks (2026-09-15)

- [x] Dev Compose validates with `docker compose -f infra/compose.dev.yml config --quiet`.
- [x] Production Compose validates with explicit sample environment values; no containers or GPUs were exercised by this check.
- [x] `node --test scripts/tests/*.test.mjs`: signed update verification passes; altered payload, altered manifest, and wrong trust key are rejected.
- [x] `python3.12 -m unittest discover -s scripts/tests -p 'test_*.py'`: valid backup, tampered file, unlisted file, symlink and traversal safety cases pass.
- [x] Shell scripts pass `bash -n`; runner and doctor pass Node syntax checks; escaped `make db:migrate` target resolves correctly.

## Resumed operations checks (2026-09-23)

- [x] `node --test scripts/tests/*.test.mjs`: four tests pass, including actual blocked HTTP/fetch/socket attempts to non-loopback endpoints, host-policy edge cases, and update signature/digest tampering.
- [x] `python3.12 -m unittest discover -s scripts/tests -p 'test_*.py'`: four backup safety tests pass.
- [x] Dev runner, doctor and shell script syntax checks repeated after environment/cleanup changes.
- [x] README and `.env.example` include explicit preparation, local model paths, token generation, runtime commands, limitations and appliance provenance.

## Recovery drill (2026-09-24)

- [x] `python3.12 scripts/test-backup-roundtrip.py` passed on Docker 29.7.2 using cached `postgres:16-alpine` (local image ID `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`). The unique test Compose project used no network, exposed no ports, and stored its database in tmpfs.
- [x] Real `pg_dump` and transactional `pg_restore` reproduced ten application tables, including the organization, administrator, space/membership, media, post, transcript, minutes and a deliberately seeded published meeting. Restored audio/Markdown/DOCX bytes matched exactly. This verifies recovery of a fixture, not a real STT/LLM run.
- [x] Restore rejected nonempty storage and, independently, a nonempty database. The script removed only its own temporary container/project; existing app services and database volumes were not stopped or changed.
- [x] Four Node operations tests, four Python backup safety tests, shell/Node syntax, and both Compose configurations passed again after integration changes.

## Integrated local verification (2026-10-14)

These checks exercise the initial implementation before its first commit on `main`; the committed code and this ledger travel together.

- [x] `make doctor`: all prerequisites passed on Apple M4, 10 CPU cores, 16GB RAM, macOS 27.0, Node 24.14.0, pnpm 9.15.9 and Python 3.12.4. Node differs from the PRD's Node 22 target; CI uses Node 22.
- [x] `make dev`: exported the landing, started the cached PostgreSQL image, applied migrations, started API/web/worker and reached its ready message. All three `/health` endpoints returned HTTP 200 with `status: ok`; API reported database connected. Fixed health polling to use fresh connections because macOS AirPlay can answer on port 5000 before the worker starts.
- [x] Ctrl-C stopped the worker and PostgreSQL and closed the web/API ports, preserving the database volume. The terminal `make` wrapper reports an interrupted exit status; service teardown completed.
- [x] Temporarily changed `license_usd` from 5000 to 5123, ran `pnpm landing`, and asserted `$5,123` in the exported HTML. Restored the original configuration, re-exported and asserted `$5,000`. The same exporter runs during `make dev`.
- [x] `pnpm typecheck`, `pnpm lint` and `pnpm build` passed. The production build includes `/`, `/app`, `/docs`, legacy app redirects and `/health`. Static export uses bundled local fonts and artwork.
- [x] `DATABASE_TEST_URL=postgres://mane:mane@127.0.0.1:5432/mane_test make test`: **83 passed, zero skipped** (4 license, 17 API including integration subtests, 54 worker, 4 Node operations and 4 Python backup checks). This includes the evidence-quotation regression tests and real PostgreSQL lease/reclaim integration.
- [x] `make test-operations` repeated successfully: ten application tables and audio/Markdown/DOCX bytes restored exactly into isolated fresh destinations; nonempty targets were rejected and the temporary container was removed.
- [x] `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`: **2 passed in 18.3 seconds**. Desktop/mobile landing, no browser requests outside loopback, persisted demo interactions, fresh organization setup, two-session realtime posts, real file upload, minutes editing/approval, downloadable DOCX, published feed post and logout/login. The isolated test worker uses deterministic STT/LLM fixtures and the actual document renderer/callback pipeline; this is not a real-model quality benchmark.
- [x] Actual hardware adapter reported `Pilot`, 10 cores, 16GB RAM and no NVIDIA GPU. The 16GB Mac is the development profile, below the 32GB Pilot appliance recommendation.
- [x] Private `.env`, downloaded models, generated documents and test outputs are excluded from Git.

## PRD acceptance ledger

| Phase | Acceptance | Observed status |
| --- | --- | --- |
| 0 | Doctor passes on M4 host | Passed 2026-10-14; version deviations recorded above. |
| 0 | Full `make dev`, health, Ctrl-C | Passed service readiness and teardown on 2026-10-14; see interruption status caveat above. |
| 0 | Pricing config updates static landing | Passed temporary pricing mutation/export/restoration. |
| 1 | Fresh-org/member login, OIDC mock, seats/license expiry | API integration and license tests passed; browser setup/login passed. |
| 2 | Realtime two-session post, private-space isolation, quota 413 | Browser realtime passed; API integration checks isolation, sockets, quota and media authorization. |
| 3 | 20-minute recording, evidence playback, review/publish | Review/publish browser flow passed with deterministic model fixtures. Real short-model smoke and quality limitations are recorded in benchmarks.md. Twenty-minute recording and evidence accuracy acceptance remain open. |
| 3 | Resume after kill without duplicates | PostgreSQL lease/reclaim and idempotent callback tests pass. Killing and restarting a worker during real inference remains unmeasured. |
| 3 | Zero actionable content succeeds | Worker pipeline fixture tests cover empty decisions/actions with a valid summary. |
| 4 | Retention removes old audio, preserves minutes | PostgreSQL integration fixture passed. |
| 4 | Backup restores org/users/posts/published meeting | Passed real PostgreSQL recovery drill on 2026-09-24 with deliberately seeded application fixtures. Customer-data recovery remains installation acceptance. |
| 4 | M4 hardware reports Pilot | Passed actual hardware adapter inspection on 2026-10-14. |
| 4 | Linux NVIDIA production parity | Adapters, preflight and reference deployment provided; exact-image GPU smoke and full workflow require a Linux NVIDIA appliance. |
| NFR | Tests green; runtime loopback only | Unit/integration guards and browser request checks passed. A physical Wi-Fi-disconnected full workflow has not been recorded. |
| NFR | Feed <300ms, fan-out 200 clients, ~9GB budget | Load and total-stack peak memory remain unmeasured. |

## Production acceptance still open

The twenty-minute recording, real-inference process-kill recovery, representative minutes/evidence quality review, measured load/memory, physical offline run and Linux NVIDIA image validation remain release gates. A short local model smoke and passing fixture tests do not satisfy these gates. See [benchmarks.md](benchmarks.md) for exact measurements and quality findings. No production certification or guaranteed completion time is claimed.
