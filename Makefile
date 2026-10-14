SHELL := /bin/bash
.PHONY: dev doctor setup test test-operations check landing db\:migrate db\:reset stop

dev:
	node scripts/dev.mjs

doctor:
	node scripts/doctor.mjs

setup:
	node scripts/prepare-env.mjs
	pnpm install --frozen-lockfile
	uv sync --project services/doc-worker --frozen --extra mlx --extra test

test:
	NODE_OPTIONS="--import=\"$(CURDIR)/scripts/offline-guard.mjs\" $${NODE_OPTIONS:-}" pnpm test
	cd services/doc-worker && .venv/bin/python -m pytest
	node --test scripts/tests/*.test.mjs
	python3.12 -m unittest discover -s scripts/tests -p 'test_*.py'

test-operations:
	python3.12 scripts/test-backup-roundtrip.py

check:
	pnpm typecheck
	pnpm lint

landing:
	pnpm --filter web export:landing

db\:migrate:
	node scripts/with-env.mjs pnpm --filter api db:migrate

db\:reset:
	@test "$(CONFIRM)" = "delete-local-data" || (echo 'Requires CONFIRM=delete-local-data; deletes the local development database.'; exit 1)
	docker compose -f infra/compose.dev.yml down --volumes
	docker compose -f infra/compose.dev.yml up -d --wait
	node scripts/with-env.mjs pnpm --filter api db:migrate

stop:
	docker compose -f infra/compose.dev.yml stop
