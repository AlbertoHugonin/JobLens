# Operations: deployment, configuration & backup

## Security model

JobLens has **no application login**. Treat every deployment as private: put the
stack behind a VPN, a private network, or an authenticated reverse proxy, and do
not expose the API, worker, or PostgreSQL ports to the public internet.

## Configuration

All deployment settings are environment variables (see `.env.example` for the
full list with defaults). Copy it to `.env` and adjust as needed.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | PostgreSQL credentials and host port. |
| `DATABASE_URL` | Connection string used by the API and worker. |
| `API_PORT`, `API_CORS_ORIGIN`, `API_RUN_MIGRATIONS` | API port, allowed CORS origin, and whether migrations run on startup. |
| `FRONTEND_PORT`, `VITE_API_BASE_URL` | Frontend host port and the API URL baked into the build. |
| `WORKER_PORT`, `WORKER_RUN_LOOP`, `WORKER_POLL_MS`, `WORKER_HEARTBEAT_MS`, `WORKER_LEASE_SECONDS` | Worker port and loop tuning. |
| `WORKER_LINKEDIN_PAGE_DELAY_MS` | LinkedIn collection-page pacing in ms (default `1200`; `0` disables pacing). |
| `WORKER_LINKEDIN_DESCRIPTION_COOLDOWN_MS`, `WORKER_LINKEDIN_AVAILABILITY_COOLDOWN_MS` | LinkedIn live-fetch pacing in ms: cooldown between job-description fetches and availability checks (default `5000`; `0` disables pacing). |
| `WORKER_LINKEDIN_AVAILABILITY_RECHECK_MS` | Debounce window before a job that already completed a successful LinkedIn availability check can be queued for another one (default `86400000`, 24 hours; `0` disables the debounce). |
| `WORKER_AI_COOLDOWN_SECONDS`, `WORKER_AI_MAX_REVIEW_ATTEMPTS` | AI review backoff: how long ai_review claiming pauses after an endpoint failure (default `60`), and how many attempts a non-connectivity failure gets before it is marked failed with a diagnostic review (default `3`). An unreachable endpoint is retried indefinitely until it returns. |
| `RUST_LOG` | Worker log level. |
| `AI_ENDPOINT_URL` | Legacy/no-op in the current app; leave it empty. AI endpoints are configured from the UI and stored in PostgreSQL. |

Ports are not hard-coded: each service binds to the port from its environment,
and the Compose health checks read the same value, so changing a port at deploy
time keeps everything working.

The example `.env` is tuned for Docker Compose, where `DATABASE_URL` points at
the `postgres` service hostname. For commands run directly on the host against
the Compose database, override it:

```bash
DATABASE_URL=postgresql://joblens:joblens@localhost:5432/joblens
```

AI servers such as Ollama are not configured through environment variables in
the current application. Add them from **Impostazioni**; the API stores endpoint,
model, runtime, retry and pause settings in the database.

## Running migrations

The API runs migrations automatically on startup when `API_RUN_MIGRATIONS=true`.

## Persistence

Job data lives in the `postgres-data` Docker volume. All Compose services use
`restart: unless-stopped`.

## Backup

Use a PostgreSQL dump for disaster recovery or full environment migration.

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "backups/joblens-$(date +%Y%m%d-%H%M%S).sql"
```

When UI debug mode is enabled, **Impostazioni -> Debug** also exposes selective
JSON import/export. It is useful for moving only part of the app data between
instances, but it is not a substitute for a full database dump.

Selectable sections are searches, jobs, job-search links, job descriptions, AI
reviews, provider sessions, AI settings, and AI endpoints/models. The UI includes
presets for only searches, jobs + searches, jobs + searches + AI reviews,
operational migration, AI configuration, and a complete restorable app backup.

Import can run in two modes:

- `merge` updates or inserts the selected data while keeping unrelated existing
  records.
- `replace` deletes only the selected sections first, then imports them.

Selective backup intentionally excludes activity history, activity logs and raw
provider payloads. If `providerSessions` is selected, the JSON file contains the
stored provider secrets needed to reuse those sessions. Treat that file like a
credential export.

## Restore

```bash
docker compose stop api worker frontend
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  < backups/joblens-YYYYMMDD-HHMMSS.sql
docker compose start api worker frontend
```

For a fresh restore, recreate the PostgreSQL volume intentionally, then restore
the dump before starting the API and worker.

Selective JSON backups are restored from **Impostazioni -> Debug** with the same
section selection and import mode controls used for export.

## Debug reset

When UI debug mode is enabled, **Impostazioni -> Debug** exposes a destructive
reset action. It clears application data from PostgreSQL (jobs, searches,
sessions, activities, raw payloads, AI endpoints/models/reviews and custom
settings) and restores only the minimal seed records. It keeps the schema and
`schema_migrations`, so it is faster than deleting the Docker volume but has the
same practical effect for app data. Take a PostgreSQL dump or a selective JSON
backup first if anything should be kept.

## Sensitive local files

Any `*.har` file (and anything under `docs/har_*`) is sensitive: HAR captures
contain cookies, CSRF tokens, and other session headers. They are ignored by git
and excluded from the Docker build context. Never print, export, or commit real
HAR content, and never commit `li_at` / `JSESSIONID` values. Persisted provider
sessions store only the minimal secrets needed (see [PROVIDERS.md](PROVIDERS.md)).
JobLens selective backup files are also sensitive when they include provider
sessions, and may include private candidate profile/rules when AI settings are
selected.
