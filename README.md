# JobLens

JobLens is a self-hosted app that helps you **find and triage job offers in one
place**. You save your job searches once, and JobLens regularly collects the
matching offers, keeps them organized, and lets you filter, read, and track them
without living inside the provider's website.

It can also (optionally) use a local AI model to score each offer against your
profile, so the most relevant ones float to the top — but JobLens works fine
with the AI turned off.

Today JobLens collects from **LinkedIn**. The provider layer is pluggable, so
other sources can be added later.

## What it does

- **Saved searches** — describe a search once (keywords, location, filters);
  JobLens rebuilds the provider query and collects the results for you, on demand
  or on a schedule.
- **One inbox for offers** — every collected offer is normalized into a single
  list you can search, filter (location, work mode, status…), sort, and open in a
  detail view.
- **Tracking** — mark offers as viewed, saved, or applied, and JobLens keeps
  their history (including when an offer disappears or is reposted).
- **Optional AI review** — point JobLens at a local AI server (e.g. Ollama) to
  get a fit score and a short explanation per offer. Your candidate profile and
  the scoring rules (output language and the verdict fields) each live in their
  own settings tab and can be exported/imported as JSON; AI never blocks the
  rest of the app.
- **Visible background work** — collections, AI reviews, and exports run as
  tracked "activities" with live progress, logs, and cancel/retry controls.
- **Portable debug/export data** — single-offer exports include provider/search
  metadata, the latest description, and full AI review details (`result`,
  `metrics`, `rawOutput`) without provider secrets.

## How it works

JobLens runs as four services, all started together with Docker Compose:

- a **frontend** (the web UI you use),
- an **API** (stores your searches, offers, and settings),
- a **worker** (does the slow work: collecting offers, AI reviews),
- a **PostgreSQL** database (where everything is stored).

You connect a provider session (for LinkedIn, two cookies: `li_at` +
`JSESSIONID`), save a search, and the worker collects the offers into your
database. For the collection pipeline details, see [docs/API.md](docs/API.md).

## Requirements

- [Docker](https://www.docker.com/) with Docker Compose.
- For development outside Docker: Node.js, npm, and the Rust toolchain.

## Run it

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web app — <http://localhost:5173>
- API health — <http://localhost:3000/api/v1/health>
- Worker health — <http://localhost:8090/health>
- PostgreSQL — `localhost:5432`

First steps in the UI:

1. Go to **Impostazioni → Sessioni**, click **+ Aggiungi sessione**, and paste
   your `li_at` + `JSESSIONID` (or import a HAR, which is reduced to those two
   secrets).
2. Go to **Ricerche**, create a search, and run it.
3. Watch progress in **Attività**, then browse results in **Offerte**.
4. (Optional) In **Impostazioni**, add a local AI server to enable scoring.

## Configuration

Settings are environment variables in `.env` (start from `.env.example`). Ports
can be changed freely — each service and its health check follow the configured
port. The full reference, plus backup/restore, lives in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

> **Security:** JobLens has no login. Keep deployments private (VPN, private
> network, or an authenticated reverse proxy) and never expose the ports
> publicly. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

- [docs/OPERATIONS.md](docs/OPERATIONS.md) — configuration, deployment, backup
  and restore, sensitive files.
- [docs/API.md](docs/API.md) — HTTP API reference and the collection pipeline.
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — how providers and sessions work.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — repo layout, running services,
  tests, and verification commands.
- [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) — product and
  architecture specification.
