# Local operations

`make dev` performs a read-only prerequisite check, exports the config-driven landing, starts the cached PostgreSQL image, migrates the database, and runs web/API/worker. Ctrl-C stops child process groups and PostgreSQL while preserving its volume. Default ports are 3000, 4000, 5000 and local-only 5432. Runtime preparation failures stop with a clear message.

| Command | Purpose |
| --- | --- |
| `make doctor` | Inspect prerequisites, engine, Ollama service/model, local speech weights, worker environment and shared secret |
| `make setup` | Deliberate online dependency preparation; install pnpm workspace and Mac worker extras |
| `make dev` | Full local runtime; no implicit network downloads |
| `make landing` | Export the static landing from product config |
| `make check` | Typecheck and formatting checks |
| `make test` | Workspace, worker, signed-update, backup safety tests |
| `make test-operations` | Real PostgreSQL recovery drill in a unique temporary networkless container; requires cached image and running Docker |
| `make db:migrate` | Apply API-owned database migrations |
| `make db:reset CONFIRM=delete-local-data` | Explicit destructive reset of the dev PostgreSQL volume |
| `make stop` | Stop dev PostgreSQL when it was started outside the runner |

## Consistent backup and fresh restore

The local backup includes a PostgreSQL custom-format `pg_dump`, a copy of storage, and a SHA-256 manifest. Secrets, licenses keys outside the database, model weights and deployment config need a separately protected administrator backup. Backup files contain private organizational data; put them on encrypted, access-controlled storage.

Stop API and worker writes first. Keep/start PostgreSQL alone with `docker compose -f infra/compose.dev.yml up -d --wait`. Then:

```sh
./scripts/backup.sh /absolute/backup/mane-2026-09-15 --quiesced --storage ./data
docker compose -f infra/compose.dev.yml exec -T postgres createdb -U mane mane_restore
./scripts/restore.sh /absolute/backup/mane-2026-09-15 --quiesced --database mane_restore --storage ./data-restored
```

`--quiesced` is an operator assertion that all writers are stopped. The script refuses existing backup destinations, symlinks/special files, unlisted or modified files, nonempty target databases, and nonempty target storage. `pg_restore` runs a single transaction. The original database and storage remain untouched. If storage promotion fails after a successful database restore, leave the original runtime stopped and retry with a new empty database/directory; do not point production at a partial recovery.

To verify recovery, start a separate runtime using `DATABASE_URL` for `mane_restore` and `DATA_DIR` for the absolute `data-restored` path. Check organization name, users, post counts, one published meeting, DOCX/Markdown downloads and audio evidence. Record those results in acceptance.md. Backups are not proven until this drill passes.

The scripts intentionally support the development local-storage adapter. Production S3/MinIO backup requires a quiesced database dump plus a version-consistent object-store snapshot/export, bucket policy backup and a recovery drill using the customer's storage system. Do not apply these local copy scripts directly to MinIO's internal data layout.

## Retention

Organization settings independently control audio, transcripts and minutes retention days. A nightly API task should delete expired objects/rows for each configured category, record the deletion in the audit log, and preserve categories whose windows have not expired. Active jobs and draft/review records must not lose inputs mid-processing. Audio deletion makes evidence playback unavailable; the published minutes remain searchable until their own retention window expires. The UI should state that distinction.

Use a disposable fixture with expired audio and current published minutes to test category isolation. Audit every scheduled run and failure; retry safely after storage failures. A backup may still contain expired records until its separate backup retention period ends. Set backup retention and legal-hold procedures with the appliance owner; a database delete alone does not purge old backups.
