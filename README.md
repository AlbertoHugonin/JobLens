# JobLens

JobLens is a self-hosted application for collecting, organizing, filtering and
reviewing job offers from provider adapters.

This repository is currently at **M14 - Refactor UI e QA Approfondita** from
`docs/IMPLEMENTATION_PLAN.md`.

## Current Contents

- Monorepo structure under `apps/` and `packages/`.
- React + Vite + TypeScript frontend with React Bootstrap.
- Fastify + TypeScript API with `/api/v1/health`.
- Rust + Tokio worker with `/health` and `/api/v1/health`.
- PostgreSQL service in Docker Compose.
- Base lint, format, typecheck and test commands.
- PostgreSQL migrations for the initial JobLens schema.
- Base seed data for LinkedIn provider and core settings.
- Versioned API responses use `{ "data": ... }` plus optional `{ "meta": ... }`.
- API errors use `{ "error": { "code", "message", "statusCode", "details" } }`.
- Read-only schema/settings bootstrap:
  - `GET /api/v1/schema`
  - `GET /api/v1/settings/base`
- Minimal settings endpoints:
  - `GET /api/v1/settings?prefix=app.&limit=50&offset=0`
  - `GET /api/v1/settings/:key`
- Activities endpoints:
  - `POST /api/v1/activities`
  - `GET /api/v1/activities?status=queued&type=dummy&limit=25&offset=0`
  - `GET /api/v1/activities/:id`
  - `GET /api/v1/activities/:id/logs`
  - `POST /api/v1/activities/:id/cancel`
  - `POST /api/v1/activities/:id/retry`
- Activity event stream:
  - `GET /api/v1/events`
- Provider setup (generic, `:providerKey` e.g. `linkedin`):
  - `GET /api/v1/providers` (lists providers and their credential fields)
  - `GET /api/v1/providers/:providerKey/sessions`
  - `POST /api/v1/providers/:providerKey/credentials` (preferred: paste minimal secrets)
  - `POST /api/v1/providers/:providerKey/har-debug`
  - `POST /api/v1/providers/:providerKey/sessions/har` (convenience: extracts minimal secrets)
  - `POST /api/v1/providers/:providerKey/sessions/:sessionId/verify`
  - `GET /api/v1/providers/linkedin/geo-typeahead?query=Italy`
- Searches endpoints:
  - `GET /api/v1/searches`
  - `POST /api/v1/searches`
  - `GET /api/v1/searches/:id`
  - `PATCH /api/v1/searches/:id`
  - `DELETE /api/v1/searches/:id`
  - `POST /api/v1/searches/:id/run`
  - `POST /api/v1/searches/preview-url`
  - `POST /api/v1/searches/import-url`
- Jobs endpoints:
  - `GET /api/v1/jobs`
  - `GET /api/v1/jobs/:id`
  - `PATCH /api/v1/jobs/:id/state`
  - `GET /api/v1/jobs/:id/export`
- AI configuration endpoints:
  - `GET /api/v1/ai/settings`
  - `PATCH /api/v1/ai/settings`
  - `POST /api/v1/ai/settings/rules/reset`
  - `GET /api/v1/ai/endpoints`
  - `POST /api/v1/ai/endpoints`
  - `PATCH /api/v1/ai/endpoints/:id`
  - `POST /api/v1/ai/endpoints/:id/activate`
  - `GET /api/v1/ai/models`
  - `POST /api/v1/ai/models/install`
- AI review, benchmark and maintenance endpoints:
  - `POST /api/v1/jobs/:id/reviews`
  - `POST /api/v1/jobs/batch-reviews`
  - `GET /api/v1/ai/models/metrics`
  - `POST /api/v1/ai/benchmark`
  - `DELETE /api/v1/ai/reviews`
  - `POST /api/v1/exports/jobs-reviews`
  - `POST /api/v1/debug/bundle`
- Rust worker loop with PostgreSQL claim, lease, heartbeat, logs and cooperative
  cancellation.
- Worker metrics endpoints:
  - `GET /metrics`
  - `GET /api/v1/metrics`
- Frontend shell with client-side routing and pages:
  - Dashboard
  - Offerte
  - Ricerche
  - Attivita
  - Impostazioni
- Activities page can create a dummy activity, show live progress, inspect logs,
  cancel queued/running activities and retry failed activities.
- Searches page configures a provider session by pasting the minimal secrets
  (LinkedIn: `li_at` + `JSESSIONID`) into a credential form generated from the
  provider descriptor. Importing a full HAR still works as a convenience and is
  reduced to the same minimal secrets. Sessions can be verified live against the
  provider. The page also builds LinkedIn search URLs, imports editable URLs and
  saves searches. See `docs/PROVIDERS.md`.
- LinkedIn collection runs are queued as `linkedin_collect` activities. The
  Rust worker converts saved public search settings into Voyager requests,
  fetches pages, stores raw payloads, upserts normalized jobs/external jobs and
  records search presence.
- Successful complete LinkedIn collections enqueue `linkedin_describe`
  activities for jobs without descriptions, mark jobs missing from all searches
  as `missing_from_searches`, and enqueue `linkedin_availability` checks only
  for those outside-search jobs.
- Job descriptions are deduplicated per job by a stable hash of normalized text.
  If the same provider external ID reappears in a later collection, the job is
  reactivated as `active` while keeping existing descriptions and history.
- The Searches page can start a run for a saved search and shows recent run
  progress and counts from the activity payload.
- Offerte page lists jobs with server-side pagination, filters, sorting, detail
  view, local state updates and single-job JSON export.
- Impostazioni page manages AI endpoints, active endpoint selection, model
  catalog/install activities, candidate profile, evaluation rules, runtime
  parameters, AI pause windows, benchmark/export/debug tools and review
  maintenance. AI endpoints are external and optional, so JobLens remains usable
  when they are offline.
- Job detail and jobs list expose append-only AI review actions. Manual reviews
  can be repeated, batch reviews skip jobs already reviewed by the automatic
  model, and priority-model review data drives filters and summaries.
- Model installation is queued as a `model_install` activity. The Rust worker
  updates persistent progress and marks the catalog model installed when the
  activity succeeds.
- Export and debug bundle requests are queued as worker activities. Generated
  artifacts are downloadable from the activity detail view.
- Destructive UI actions require confirmation before cancelling activities,
  deleting searches, resetting evaluation rules or deleting AI reviews.
- The frontend shell uses a desktop sidebar, mobile navbar, responsive content
  bounds and E2E smoke coverage for the main pages.
- Navbar activity status backed by the activities API.

## Local Startup

```bash
cp .env.example .env
npm install
docker compose up --build
```

Services:

- Frontend: <http://localhost:5173>
- API health: <http://localhost:3000/api/v1/health>
- Worker health: <http://localhost:8090/health>
- PostgreSQL: `localhost:5432`

The example `.env` is optimized for Docker Compose, where `DATABASE_URL` points
to the `postgres` service hostname. For commands that run directly on the host
against the Compose database, override it with:

```bash
DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens
```

## Deployment and Backup

JobLens currently has no application login. Treat production deployments as
private: put the stack behind a VPN, private network or authenticated reverse
proxy, and do not expose the API, worker or PostgreSQL ports publicly.

Configurable deployment variables are documented in `.env.example`:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
- `DATABASE_URL`
- `API_PORT`, `API_CORS_ORIGIN`, `API_RUN_MIGRATIONS`
- `FRONTEND_PORT`, `VITE_API_BASE_URL`
- `WORKER_PORT`, `WORKER_RUN_LOOP`, `WORKER_POLL_MS`,
  `WORKER_HEARTBEAT_MS`, `WORKER_LEASE_SECONDS`
- `RUST_LOG`
- optional `AI_ENDPOINT_URL`

The persistent PostgreSQL volume is `postgres-data`. All Compose services use
`restart: unless-stopped`.

Create a database backup:

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "backups/joblens-$(date +%Y%m%d-%H%M%S).sql"
```

Restore into the configured database:

```bash
docker compose stop api worker frontend
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  < backups/joblens-YYYYMMDD-HHMMSS.sql
docker compose start api worker frontend
```

For a fresh restore, recreate the PostgreSQL volume intentionally, then restore
the dump before starting API and worker.

## Local Development Commands

```bash
npm run dev --workspace @joblens/frontend
npm run dev --workspace @joblens/api
npm run worker:dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
cargo fmt --manifest-path apps/worker/Cargo.toml --check
cargo check --manifest-path apps/worker/Cargo.toml
docker compose config
```

`docker compose up --build` should start frontend, API, worker and PostgreSQL.
The API runs migrations automatically on startup when `API_RUN_MIGRATIONS=true`.

M13 critical-flow coverage is split across the API database integration tests,
worker database integration tests and frontend service normalization tests:

- search creation/import/run, activity creation/cancel/retry and frontend
  activity normalization;
- server-side job filters, job detail, local state update and sanitized export;
- AI configuration, model install queueing, single/batch/benchmark review
  queueing and priority-model filters;
- export/debug activities and guarded review deletion;
- worker claim/lease/concurrency/cancellation behavior.
- Playwright E2E smoke checks desktop/mobile navigation and guards against the
  previous runaway loading loop on the Searches page.

E2E tests expect a running stack and default to <http://localhost:5173>:

```bash
docker compose up -d --build
npm run test:e2e
```

Override the frontend URL with `E2E_BASE_URL` when needed.

Schema integration tests require PostgreSQL and create a temporary database:

```bash
DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens npm run test:db
```

Worker database integration tests also create a temporary database:

```bash
JOBLENS_WORKER_DB_TEST=1 DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens cargo test --manifest-path apps/worker/Cargo.toml worker_db_integration_claims_dummy_and_handles_concurrency -- --ignored --nocapture
```

To manually exercise the M5 dummy activity flow on a running stack:

```bash
/usr/bin/curl -sS -X POST http://localhost:3000/api/v1/activities \
  -H 'content-type: application/json' \
  -d '{"type":"dummy"}'
```

Then open <http://localhost:5173/activities> or read `GET /api/v1/activities`.

To preview a LinkedIn search URL without saving it:

```bash
/usr/bin/curl -sS -X POST http://localhost:3000/api/v1/searches/preview-url \
  -H 'content-type: application/json' \
  -d '{"providerKey":"linkedin","query":{"keywords":"React Developer","exactMatch":true,"location":"Italy","geoId":"103350119","distance":"25","experienceLevels":["1","2","3"]}}'
```

Then open <http://localhost:5173/searches> for the HAR session panel and search
wizard.

To start a saved LinkedIn search collection:

```bash
/usr/bin/curl -sS -X POST http://localhost:3000/api/v1/searches/<search-id>/run
```

The worker requires an active LinkedIn session. Configure it on the Searches
page by pasting `li_at` + `JSESSIONID` (or by importing a HAR, which is reduced
to those two secrets). Test fixtures use synthetic activity payloads and do not
require real LinkedIn session data.

To inspect collected jobs:

```bash
/usr/bin/curl -sS 'http://localhost:3000/api/v1/jobs?limit=25&offset=0'
```

Then open <http://localhost:5173/jobs>. The default jobs view only includes
active jobs that are present in at least one saved search.

To configure an offline AI endpoint and queue a model install activity:

```bash
ENDPOINT_ID=$(/usr/bin/curl -sS -X POST http://localhost:3000/api/v1/ai/endpoints \
  -H 'content-type: application/json' \
  -d '{"name":"Local Ollama","baseUrl":"http://127.0.0.1:11434","enabled":true}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).data.id))")

/usr/bin/curl -sS -X POST "http://localhost:3000/api/v1/ai/endpoints/${ENDPOINT_ID}/activate"

/usr/bin/curl -sS -X POST http://localhost:3000/api/v1/ai/models/install \
  -H 'content-type: application/json' \
  -d '{"modelName":"llama3.2"}'
```

Then open <http://localhost:5173/settings> or <http://localhost:5173/activities>
to follow the queued installation progress.

## Sensitive Local Files

Any `*.har` file (and everything under `docs/har_*`) is treated as sensitive
local input: HAR captures contain cookies, CSRF tokens and other session
headers. They are ignored by git and the Docker build context. Do not print,
export or commit real HAR content, and never commit `li_at` / `JSESSIONID`
values. Persisted provider sessions store only the minimal secrets needed
(see `docs/PROVIDERS.md`).
