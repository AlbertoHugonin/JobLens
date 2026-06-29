# Provider architecture & sessions

JobLens collects jobs from pluggable **providers**. LinkedIn is the first one;
the design keeps everything provider-agnostic so adding Indeed (or others) is a
matter of writing one plugin.

## Minimal session credentials

A provider session stores **only the minimal secrets** required to talk to the
provider, never a full browser capture.

For **LinkedIn**, that is exactly two values (verified empirically against the
live Voyager API by stripping a real request down to what still returns `200`):

| Secret       | Role                                                              |
| ------------ | ---------------------------------------------------------------- |
| `li_at`      | Authentication cookie.                                           |
| `JSESSIONID` | Session id, format `ajax:<digits>`. Used as a cookie **and** CSRF. |

At request time the worker reconstructs:

```
cookie:      li_at=<li_at>; JSESSIONID="<jsessionid>"     # JSESSIONID quoted
csrf-token:  <jsessionid>                                 # quotes stripped (quoted -> 403)
accept:      application/vnd.linkedin.normalized+json+2.1
x-restli-protocol-version: 2.0.0
```

Findings: `li_at` alone → `403 CSRF check failed`; `JSESSIONID` alone → `401`;
no `csrf-token` header → `403`; `csrf-token` with quotes → `403`; user-agent is
optional (kept as a non-secret hint for realism). All other cookies (`lidc`,
`bcookie`, ad/tracking cookies, …) are unnecessary.

## Persisted session envelope

`provider_sessions.session_data` (JSONB) holds a provider-agnostic envelope:

```jsonc
{
  "providerKey": "linkedin",
  "version": 2,
  "source": "manual",            // or "har"
  "importedAt": "2026-06-26T…",
  "secrets":     { "li_at": "…", "jsessionid": "ajax:…" },   // the only secrets
  "fingerprint": { "userAgent": "…", "acceptLanguage": "…", "xLiLang": "…",
                   "xLiTrack": "…", "decorationId": "…" },   // non-secret hints
  "debug": { … }                 // optional, secret-free HAR stats
}
```

The DB schema is unchanged — only the JSON shape inside `session_data` changed.
A legacy envelope (`cookie` + `csrfToken` at the top level) is still accepted as
a fallback by both the API summary and the worker.

## Two ways to create a session

1. **Manual (preferred)** — `POST /api/v1/providers/:providerKey/credentials`
   with `{ "credentials": { "li_at": "…", "jsessionid": "…" }, "label": "…" }`.
   The UI renders this form dynamically from the provider's credential
   descriptor.
2. **HAR import (convenience)** — `POST /api/v1/providers/:providerKey/sessions/har`.
   The full HAR is parsed in memory, reduced to the same minimal secrets, and
   discarded. It is never persisted.

`POST /api/v1/providers/:providerKey/sessions/:sessionId/verify` does a cheap
live call (`/voyager/api/me` for LinkedIn) and marks the session `active` or
`expired` without exposing secrets.

## Adding a new provider

1. **API** — create `apps/api/src/providers/<key>.ts` exporting a
   `ProviderPlugin` (see `apps/api/src/providers/types.ts`): declare
   `credentialFields`, implement `buildSessionFromCredentials`,
   `summarizeSession`, and optionally `buildSessionFromHar` / `debugHar` /
   `verifySession`. Register it in `apps/api/src/providers/registry.ts`.
   The generic routes and the dynamic credential form pick it up automatically.
   `apps/api/src/providers/indeed.ts` is a working skeleton example.
2. **DB** — add a seed row in `providers` (`provider_key`, `name`, `enabled`).
3. **Worker** — add a collector under `apps/worker/src/providers/<key>/` and a
   handler/dispatch entry, reusing the same `session_data` envelope shape.

## Secrets handling

- Only minimal secrets are persisted; summaries and API responses expose
  booleans (`hasLiAt`, `hasJsessionid`) and non-secret hints, never the values.
- `*.har`, `docs/har_*`, `secrets/` and `*.secret.json` are git-ignored.
- Sessions are stored in plaintext in the local DB (single-user, self-hosted).
  Encryption at rest can be layered on later without changing the envelope.
