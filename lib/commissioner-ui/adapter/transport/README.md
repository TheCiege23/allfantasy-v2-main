# Decision OS Transport

Phase 3.0 foundation infrastructure — not a real integration with
anything yet. No real Decision OS backend exists in this repository (see
the Repository Discovery section of
[`LIVE_INTEGRATION_FOUNDATION.md`](../../LIVE_INTEGRATION_FOUNDATION.md)),
so nothing here has a real endpoint to call. This is the reusable
transport a future real `live.ts` implementation calls through, built and
tested now so that work is pure "write the real HTTP call, not the
plumbing around it."

## What it is not

It is not a second retry/logging/HTTP system. Every piece reuses
something that already exists elsewhere in this app rather than
reinventing it:

- **Retry** — `fetchJsonWithRetry` (`lib/error-handling`), already used
  elsewhere in this codebase. Its existing `retryable` predicate (408,
  429, 500, 502, 503) is used as-is.
- **Timeout/cancellation** — `AbortSignal.timeout(ms)`, the same idiom
  already used elsewhere (e.g. `lib/workers/providers/espn.ts`).
  `fetchWithRetry` has no timeout of its own; this is the one genuinely
  new piece of plumbing this phase adds.
- **Telemetry/logging** — `logStructured`/`createTimer`
  (`lib/logging/structured.ts`), already flagged as reusable back in
  Phase 0.3's own discovery.
- **Environment configuration** — plain `process.env.X` reads, the
  established convention every other external integration in this app
  already uses (no shared env-schema-validation layer exists to plug
  into).
- **Auth** — the app's own existing NextAuth session
  (`getServerSession(authOptions)`, the identical call already used by
  several `app/api/**/route.ts` handlers) when no service API key is
  configured. Commissioner OS pages already run inside this session;
  there is no separate "Commissioner OS auth" to build.

## Files

- `config.ts` — `getDecisionOSTransportConfig()` /
  `isDecisionOSConfigured()`. Reads `DECISION_OS_BASE_URL`,
  `DECISION_OS_API_KEY`, `DECISION_OS_TIMEOUT_MS` (default 10s).
- `auth.ts` — `resolveDecisionOSAuthHeaders()`. API key (Bearer) takes
  precedence when configured; otherwise forwards the current session's
  user id; resolves to an empty header set (never throws) when neither
  applies.
- `client.ts` — `callDecisionOS<T>(moduleId, path, init?, config?)`, the
  one function every future real `live.ts` calls through. Every failure
  mode — not configured, timeout, network error, non-2xx, malformed JSON
  — normalizes into the exact `CommissionerErrorContract` shape the
  adapter already expects, mapped by status code
  (400→validation, 401→unauthorized, 403→forbidden, 404→not_found,
  409→conflict, 5xx/timeout/network→upstream_unavailable). A real
  `live.ts` only ever needs to call this once and pass the result
  straight through.

## How a future real `live.ts` uses this

```ts
import { callDecisionOS } from '@/lib/commissioner-os/adapter/transport'
import { isLiveReady } from '@/lib/commissioner-os/liveReadiness'

export const liveLeagueHealthClient: LeagueHealthClient = {
  async getHealthDetail() {
    if (!(await isLiveReady('league-health'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const { data, error } = await callDecisionOS<LeagueHealthDetail>('league-health', '/v1/league-health')
    return { data, error, source: 'live', timestamp: new Date().toISOString() }
  },
}
```

Nothing about `lib/commissioner-os/adapter/index.ts` changes to support
this — `wrapMethod` already normalizes whatever `live.ts` returns exactly
the same way it normalizes stub/demo today.

## Tests

`__tests__/commissioner-os-transport.test.ts` — config resolution (env
reads, default timeout), auth header resolution (API key precedence,
session fallback, graceful no-session/no-key/session-throws cases), and
`callDecisionOS` (not-configured honest placeholder with zero network
calls made, successful call, status-code-to-category mapping, well-formed
error contract shape on every failure).
