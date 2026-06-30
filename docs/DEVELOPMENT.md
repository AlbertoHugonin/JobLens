# Development

## Repository layout

A small monorepo:

- `apps/frontend` — React + Vite + TypeScript UI (React Bootstrap).
- `apps/api` — Fastify + TypeScript HTTP API.
- `apps/worker` — Rust + Tokio background worker.
- `packages/shared` — shared TypeScript code.
- `docs/` — documentation.

## Run the services individually

Useful when iterating on a single app (PostgreSQL still needs to be running,
e.g. via `docker compose up postgres`):

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
npm run build
cargo fmt --manifest-path apps/worker/Cargo.toml --check
cargo check --manifest-path apps/worker/Cargo.toml
docker compose config
```

## Tests

Critical-flow coverage is split across the API, worker, and frontend:

- **API / frontend unit tests** (`npm test`): search create/import/run, activity
  create/cancel/retry, frontend activity normalization, server-side job filters,
  job detail, local-state update and sanitized export, AI configuration, model
  install queueing, single/batch/benchmark review queueing, priority-model
  filters, export/debug activities, and guarded review deletion.
- **Worker unit tests**: scheduling rules, AI pause/retry helpers, LinkedIn
  query/session/payload parsing, description text handling, and review JSON
  normalization.
- **Worker DB integration**: claim/lease/concurrency/cancellation. Creates a
  temporary database:

  ```bash
  JOBLENS_WORKER_DB_TEST=1 \
    DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens \
    cargo test --manifest-path apps/worker/Cargo.toml
  ```

- **API schema integration**: also creates a temporary database:

  ```bash
  DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens npm run test:db
  ```

- **End-to-end (Playwright)**: navigation, the desktop independent-pane scroll vs
  mobile page scroll, the jobs flow, and the LinkedIn search wizard including
  workplace filters and scheduler fields. They expect a running stack and
  default to <http://localhost:5173>:

  ```bash
  docker compose up -d --build
  npm run test:e2e
  ```

  Override the frontend URL with `E2E_BASE_URL` when needed. Specs for
  `activities`, `ai-review`, and `settings-ai` exist but are marked `fixme`:
  they need an isolated database and/or mocked reachable AI server, so they are
  not part of the default shared-stack run yet.

## Manual API recipes

Create a diagnostic (`dummy`) activity, then watch it on `/activities`:

```bash
curl -sS -X POST http://localhost:3000/api/v1/activities \
  -H 'content-type: application/json' \
  -d '{"type":"dummy"}'
```

Preview a LinkedIn search URL without saving it:

```bash
curl -sS -X POST http://localhost:3000/api/v1/searches/preview-url \
  -H 'content-type: application/json' \
  -d '{"providerKey":"linkedin","query":{"keywords":"React Developer","exactMatch":true,"location":"Italy","geoId":"103350119","distance":"25","experienceLevels":["1","2","3"]}}'
```

Add and manage provider sessions (in the UI this is **Settings → Sessioni**:
a list of saved sessions with add/verify/remove):

```bash
# create a session from the minimal secrets
curl -sS -X POST http://localhost:3000/api/v1/providers/linkedin/credentials \
  -H 'content-type: application/json' \
  -d '{"credentials":{"li_at":"…","jsessionid":"ajax:…"},"label":"LinkedIn principale"}'

# list sessions, then remove one
curl -sS 'http://localhost:3000/api/v1/providers/linkedin/sessions'
curl -sS -X DELETE http://localhost:3000/api/v1/providers/linkedin/sessions/<session-id>
```

Start a saved LinkedIn search collection (needs an active session — added in
**Settings → Sessioni** by pasting `li_at` + `JSESSIONID`, or by importing a HAR
that is reduced to those two secrets):

```bash
curl -sS -X POST http://localhost:3000/api/v1/searches/<search-id>/run
```

Inspect collected jobs (the default view shows active jobs present in at least
one saved search):

```bash
curl -sS 'http://localhost:3000/api/v1/jobs?limit=25&offset=0'
```

Configure an (optional) AI endpoint and queue a model install:

```bash
ENDPOINT_ID=$(curl -sS -X POST http://localhost:3000/api/v1/ai/endpoints \
  -H 'content-type: application/json' \
  -d '{"name":"Local Ollama","baseUrl":"http://127.0.0.1:11434","enabled":true}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).data.id))")

curl -sS -X POST "http://localhost:3000/api/v1/ai/endpoints/${ENDPOINT_ID}/activate"

curl -sS -X POST http://localhost:3000/api/v1/ai/models/sync \
  -H 'content-type: application/json' \
  -d "{\"endpointId\":\"${ENDPOINT_ID}\"}"

curl -sS -X POST http://localhost:3000/api/v1/ai/models/install \
  -H 'content-type: application/json' \
  -d '{"modelName":"llama3.2"}'
```

Test fixtures use synthetic activity payloads and never require real LinkedIn
session data.
