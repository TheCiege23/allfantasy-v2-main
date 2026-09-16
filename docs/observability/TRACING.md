# Tracing and performance telemetry

How requests, database work and scheduled jobs are traced in Sentry, what every trace is tagged
with, and how to read performance by screen and device. Code: `lib/observability/`.

## Where the configuration actually lives

| Runtime | Initialised by | Options |
|---|---|---|
| Server (web + worker) | `instrumentation.ts` → `initSentryServer()` in `lib/error-tracking/sentry.ts` | `lib/observability/serverSentryOptions.ts` |
| Browser | `sentry.client.config.ts` (injected by `withSentryConfig`) | `lib/observability/clientTelemetry.ts` |
| Edge / middleware | nothing — `sentry.edge.config.ts` is not loaded | — |

⚠ **`sentry.server.config.ts` was deleted because it never ran.** @sentry/nextjs 10 injects only the
client config file. The server file's `prismaIntegration()` and 5% rate had no effect; the server
ran a flat 10% with no integrations. Do not recreate it — change the options module instead.

## Dimensions on every trace

Stamped on the root span (queryable in the spans dataset) and as tags:

| Attribute | Values | Set by |
|---|---|---|
| `af.surface` | `core`, `league`, `players`, `landing`, `auth`, `admin`, `page`, `api`, `job`, `health`, `asset` | server + browser |
| `af.screen` | the `/core/<screen>` segment (`home` for `/core`), `other` if not a safe name | server + browser |
| `af.device` | `mobile`, `tablet`, `desktop`, `bot`, `unknown` | server (user-agent) + browser (UA-CH, touch points) |
| `af.nav` | `document`, `rsc`, `prefetch`, `api` | server |
| `af.league_scoped` | `yes` / `no` — whether `?league=` was requested | server |
| `af.job` | the scheduled job, from its path | server |
| `af.net` | `4g`, `3g`, `2g`, `slow-2g`, `unknown` | browser |
| `af.viewport` | `narrow` (<768px), `medium`, `wide` | browser |
| `af.db.count` / `af.db.ms` / `af.db.max_ms` / `af.db.slowest` / `af.db.errors` | per-request database totals | server, from `lib/prisma.ts` |
| `af.sync_job` | the `withSyncJobRun` job name | server |
| `af.shell_ms` | ms from the session read until the `/core` shell had everything it renders | server, `/core` only |
| `af.card` | on `core.card` spans: the read feeding a `/core` card (`dash34`, `career`, `trades`, `urgency-badges`, …) — see `CoreCardRead` in `lib/observability/cardTelemetry.ts` | server, `/core` home + tab badges |

⚠ **On `/core`, `span.duration` is no longer what the user waited for before the app appeared.** The
shell renders first and the screen streams in behind it, so the request lasts as long as the slowest
screen read. `af.shell_ms` is the time to the shell; the difference is the time the screen skeleton
was on display.

Values are closed vocabularies on purpose — an unbounded value (league id, player slug) would make
the dimension useless and the bill larger.

⚠ `af.db.ms` is **database time**, not wall time: queries inside a `Promise.all` are summed.

## Sampling

**Server** (`lib/observability/sampling.ts`) — a token bucket per route, in traces per hour, with a
per-category ceiling. Budgets are per process (one replica each for web and worker).

| Category | Per route / hour | Category ceiling / hour | Why |
|---|---|---|---|
| `/core` renders | 120 | 300 | every real render — the surface budgets are about |
| other pages | 4 | 40 | first path segment only, so a crawl of slugs shares one budget |
| API | 1 | 30 | |
| scheduled jobs | 0.5 | 30 | ~12 traces/day per job; stops minute-cadence ticks dominating |
| bots | 1 | 2 | |
| prefetch, health checks, assets | never | never | not user-visible; pollute every budget |

A sampled browser parent still spends from the server budget, so client sampling and polling loops
cannot drive the server bill.

**Browser** — `/core` 50%, auth pages and league pages 25%, everything else 5%, automation never.
`resource.*` spans (one per fetched file) are dropped; web vitals are unaffected.

**Database** — every operation updates the root span's totals; only operations ≥
`AF_TRACE_SLOW_QUERY_MS` (default 100) become child spans, at most 20 per request.

**Incident switch** — `AF_TRACE_SAMPLE_ALL=1` traces everything except health checks, assets and
prefetches. ⚠ Setting a Railway variable redeploys the service, and the crons run on the worker.

Measured before this landed (7 days to 2026-09-15): ~72% of all spans came from crons
(`draft-tick` 194k extrapolated, the `/api/af-debug/sha` poll 18k), and a 1,836ms `/core` render
trace held 9 spans, all inside its first 18ms, with zero database spans project-wide in the week.

## Reading budgets in Sentry

Spans dataset (Explore → Traces). Server render time by screen and device:

```
is_transaction:true transaction:"GET /core/[[...screen]]" af.nav:document
group by af.screen, af.device   →   p75(span.duration), p95(span.duration), count()
```

Time to the `/core` shell, and to the whole screen:

```
is_transaction:true transaction:"GET /core/[[...screen]]" af.nav:document
group by af.screen, af.device   →   p75(af.shell_ms), p75(span.duration)
```

Which card the home is waiting for — each card's read is a `core.card` span, and the slow database
spans it issues take it as their parent:

```
span.op:core.card   group by af.card   →   p75(span.duration), p95(span.duration), count()
```

A read that waits for another (`trades` for the current week, `since-last-visit` for `trades`) is
traced from the start of its chain, so its duration is how long that card waited, not just its own
query.

🛑 **SO THESE SPANS OVERLAP, AND SUMMING THEM IS MEANINGLESS.** They are siblings under the root, not
nested, but each one covers the whole chain it waited on: `since-last-visit` covers `trade-week` →
`trades` → its own query, and `trades` covers `trade-week` → its own, and all three start within a
tick of each other. Add the `core.card` durations of one render and you get several times the wall
time that render took, because the same waits are counted once per card that waited on them.
`sum()` and `avg()` across cards are wrong for the same reason. Rank cards with
`p75(span.duration)` — the question this data answers is *which card is the home waiting for*, and
the longest span is the answer. To attribute the wait itself, read the chain: a `since-last-visit`
that is slow while `trades` is fast is slow on its own query; one that tracks `trades` is waiting,
not working.

⚠ **`urgency-badges` is CHROME, not one of the cards.** It carries an `af.card` value and lands in
the same `span.op:core.card` grouping, but it feeds the tab counts in the shell, not the grid: no
card waits for it, and it is outside `af.shell_ms` too. On the home it also waits for the trade
scan's pending-offers write, so it is routinely the longest span in the group while holding nothing
up. Exclude it (`!af.card:urgency-badges`) when ranking what the page is blocked on.

⚠ The home streams each card on its own, so its `span.duration` is its SLOWEST card, not what the user
saw first. A render failure inside a card is reported as an error tagged `af.boundary:core-card` and
`af.card:<card>` (the card, not the read — `issues`, `career`, …).

Database load per screen (catches N+1 growth before it is slow):

```
is_transaction:true af.surface:core
group by af.screen   →   p95(af.db.ms), p95(af.db.count)
```

Slowest operations behind a screen:

```
span.op:db.prisma   group by span.description   →   p95(span.duration), count()
```

Browser load and interaction by screen and device: `span.op:pageload af.surface:core`, grouped by
`af.screen, af.device` → `p75(measurements.lcp)`, `p75(measurements.ttfb)`; interactions are
`span.op:ui.interaction.*` → `p75(span.duration)`.

Jobs: `sync_job_runs.duration_ms` is the complete record (every run). A row whose
`metadata.traceSampled` is `true` has a trace at `metadata.traceId`; `false` means the run was
deliberately not sampled and there is no trace to open.

## Redaction

Nothing credential-shaped leaves the process (`lib/observability/redaction.ts`, built on
`lib/security/redactSecrets.ts`):

- `requestDataIntegration` no longer sends cookies or request bodies (both default ON in
  @sentry/core 10.50).
- Credential headers (`authorization`, `cookie`, `x-cron-secret`, …) keep their name, lose their value.
- URLs, span attributes, breadcrumbs, error messages and extras lose provider tokens (`RSC_token`,
  the TheSportsDB path key), OAuth `code`/`state`, and invite codes.

`__tests__/observability/` pins all of it, including a real-SDK suite that serialises what Sentry
would receive. Each guarantee was checked by mutation — the suite goes red when the guard is removed.

⚠ **Every string attribute is scrubbed, whatever its key.** A first version scrubbed only keys that
sounded like URLs; a real `next dev` trace then carried a planted invite code and token under
`next.span_name`, which Next's own tracing fills with the raw request line. The unit suites were green.

## Verifying locally

Unit tests cannot see what Next and the browser add on their own, so check the real stack before
trusting a redaction change:

1. Run a stand-in ingest that appends each POST body to a file, e.g. on `127.0.0.1:3108`.
2. Start `next dev` with `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` set to `http://key@127.0.0.1:3108/1`
   **and `AF_ENABLE_DEV_INSTRUMENTATION=1`** — `next.config.js` turns the instrumentation hook off in
   development otherwise, and the server never initialises Sentry. Use a non-production database
   (`.env.test`); confirm the host before starting.
3. Request pages whose URL and headers carry planted, fake credentials, then search the captured file
   for the planted values. The count must be zero, and the planted values must appear in the dev
   server's own log — otherwise the zero proves nothing.

## Not covered yet

- **Browser ↔ server trace linking.** Automatic propagation needs Next ≥ 14.3
  (`experimental.clientTraceMetadata`); this app is on 14.2, so page-load and render traces are
  separate. Both carry `af.screen`/`af.device`, so per-screen budgets do not depend on the link.
- **Import and notification delivery timing.** `import_runs` and `notification_outbox` hold the
  timestamps; nothing turns them into budgets yet.
- **Per-card spans outside the home.** The home's cards stream independently and each read has a
  `core.card` span; every other `/core` screen still streams as one unit behind the shell.
- **Edge/middleware errors** are not captured at all.
