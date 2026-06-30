# HTTP API reference

The API is served by the Fastify service under `/api/v1`. All successful
responses are wrapped as `{ "data": ... }` with an optional `{ "meta": ... }`
for pagination. Errors use
`{ "error": { "code", "message", "statusCode", "details" } }`.

## Health & bootstrap

- `GET /health` — bare API liveness endpoint for health checks.
- `GET /api/v1/health` — API liveness.
- `GET /api/v1/schema` — read-only schema bootstrap.
- `GET /api/v1/settings/base` — read-only base settings.
- `GET /api/v1/settings?prefix=app.&limit=50&offset=0` — list settings.
- `GET /api/v1/settings/:key` — read a single setting.

## Activities

Activities are the unit of background work; the worker claims and runs them.

- `POST /api/v1/activities` — create (e.g. a `dummy` diagnostic activity).
- `GET /api/v1/activities?status=queued&type=dummy&limit=25&offset=0`
- `GET /api/v1/activities/summary?activeLimit=5` — aggregate counts and active
  queued/running activities.
- `POST /api/v1/activities/cancel` — request cancellation for queued/running
  activities, optionally filtered by `{ "type": "...", "source": "..." }`.
- `GET /api/v1/activities/:id`
- `GET /api/v1/activities/:id/logs`
- `GET /api/v1/activities/:id/linkedin-debug` — sanitized raw-payload debug for
  LinkedIn-related activities.
- `POST /api/v1/activities/:id/cancel`
- `POST /api/v1/activities/:id/retry`
- `GET /api/v1/events` — server-sent activity event stream.

## Providers & sessions

Providers are pluggable (`:providerKey`, e.g. `linkedin`). See
[PROVIDERS.md](PROVIDERS.md).

- `GET /api/v1/providers` — providers and their credential fields.
- `GET /api/v1/providers/:providerKey/sessions`
- `POST /api/v1/providers/:providerKey/credentials` — preferred: paste the
  minimal secrets.
- `POST /api/v1/providers/:providerKey/har-debug`
- `POST /api/v1/providers/:providerKey/sessions/har` — convenience: extracts the
  minimal secrets from a HAR.
- `POST /api/v1/providers/:providerKey/sessions/:sessionId/verify`
- `DELETE /api/v1/providers/:providerKey/sessions/:sessionId` — remove a stored
  session (404 if it does not exist).
- `GET /api/v1/providers/linkedin/geo-typeahead?query=Italy`

## Searches

- `GET /api/v1/searches`
- `POST /api/v1/searches`
- `GET /api/v1/searches/:id`
- `PATCH /api/v1/searches/:id`
- `DELETE /api/v1/searches/:id`
- `POST /api/v1/searches/:id/run` — queue a collection run (requires an active
  provider session).
- `POST /api/v1/searches/run` — run several/all searches.
- `POST /api/v1/searches/preview-url`
- `POST /api/v1/searches/import-url`

## Jobs

- `GET /api/v1/jobs`
- `GET /api/v1/jobs/insights` — aggregate counts and top AI-ranked jobs.
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/reviews`
- `PATCH /api/v1/jobs/:id/state`
- `POST /api/v1/jobs/:id/reviews`
- `POST /api/v1/jobs/batch-reviews`
- `GET /api/v1/jobs/:id/export` — single-job export with provider/search
  metadata, latest description, latest review summary, and full AI review
  details (`result`, `metrics`, `rawOutput`).

## AI configuration

AI endpoints are external and optional; the app stays usable when they are
offline.

- `GET /api/v1/ai/settings`
- `PATCH /api/v1/ai/settings`
- `POST /api/v1/ai/settings/rules/reset`
- `GET /api/v1/ai/endpoints`
- `POST /api/v1/ai/endpoints`
- `PATCH /api/v1/ai/endpoints/:id`
- `POST /api/v1/ai/endpoints/:id/activate`
- `GET /api/v1/ai/endpoints/:id/health`
- `POST /api/v1/ai/endpoints/probe`
- `DELETE /api/v1/ai/endpoints/:id`
- `GET /api/v1/ai/models`
- `POST /api/v1/ai/models/sync` — refresh installed models from the selected
  endpoint.
- `POST /api/v1/ai/models/install`
- `DELETE /api/v1/ai/models/:id`

`GET /api/v1/ai/settings` returns the current AI behavior contract:
`candidateProfile`, `evaluationRules`, `outputLanguage`, `reviewFields`,
`runtime`, `pauses`, active endpoint information, and the default rules template.
`PATCH /api/v1/ai/settings` accepts partial updates for those same editable
settings. `outputLanguage` is one of `en`, `it`, `job_language`, or
`profile_language`; every `reviewFields` item defines a string-array evidence
field with `{ key, label, description, enabled, maxItems }`.

## AI review, benchmark & maintenance

- `GET /api/v1/ai/models/metrics`
- `POST /api/v1/ai/benchmark`
- `DELETE /api/v1/ai/reviews`
- `POST /api/v1/exports/jobs-reviews`
- `POST /api/v1/debug/bundle`

## Worker metrics

The Rust worker exposes its own endpoints (default port `8090`):

- `GET /health`
- `GET /api/v1/health`
- `GET /metrics`
- `GET /api/v1/metrics`

## LinkedIn collection pipeline

How a collection run behaves once queued as a `linkedin_collect` activity:

- The worker turns the saved public search settings into Voyager requests,
  fetches pages, stores raw payloads, and upserts normalized jobs / external
  jobs while recording each job's presence in the search.
- A successful **complete** collection then:
  - enqueues `linkedin_describe` activities for jobs without a description;
  - marks jobs missing from all searches as `missing_from_searches`;
  - enqueues `linkedin_availability` checks only for those outside-search jobs.
- Job descriptions are deduplicated per job by a stable hash of the normalized
  text. If the same provider external ID reappears in a later collection, the
  job is reactivated as `active` while keeping its existing descriptions and
  history.
- Model installs and exports/debug bundles run as `model_install` / `export`
  activities; generated artifacts are downloadable from the activity detail.
