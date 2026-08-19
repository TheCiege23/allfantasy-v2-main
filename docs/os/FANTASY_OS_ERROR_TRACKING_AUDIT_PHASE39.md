# Error Tracking Audit (Phase 39, Part 2)

Classification tiers used: **Verified operational** (real evidence of an error reaching an external system or durable store in production) / **Implemented but unverified** (real code exists, wiring looks correct, but no captured evidence it fires in production) / **Declared-only** (a dependency or config reference exists with no real init code) / **Absent** / **Intentionally not applicable**.

## Sentry (`@sentry/nextjs`)

| Layer | Real code found | Production status |
|---|---|---|
| `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` | Yes — real, non-trivial init (`Sentry.init({dsn, environment, tracesSampleRate, replaysOnErrorSampleRate})`) | **Absent in production** |
| `lib/error-tracking/sentry.ts`'s `initSentryClient`/`initSentryServer` | Yes — real, gated behind `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN`, dynamically imports `@sentry/nextjs` only if a DSN is present | Gate never opens in production |
| `next.config.js`'s `withSentryConfig` (source-map upload) | Yes — but only wraps the config when `hasSentryDsn` is true at build time | Not active in production builds |

**Direct verification**: `vercel env ls production` (authenticated, real Vercel CLI session) returned 256 real environment variables for the production environment. Zero contain `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`. This is a direct, positive confirmation of absence, not an inference from missing documentation.

**Classification: Declared-only.** A real, complete, correctly-gated integration exists in code, but the gate (`NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN`) is confirmed absent from real production environment variables. No Sentry event has ever been sent from production. Per this phase's explicit instruction ("do not treat an installed SDK or initialization component as operational evidence"), this is NOT classified as Verified operational or even Implemented-but-unverified — the DSN's confirmed absence means the gate is provably closed, not merely unconfirmed.

## React error-boundary chain

| Component | Behavior | Status |
|---|---|---|
| `components/error-handling/ErrorBoundary.tsx` (segment-level, class component) | `componentDidCatch` → `captureException(error, {context:'ErrorBoundary', componentStack})` | Real, correct wiring into the shared capture sink |
| `app/global-error.tsx` (root-level) | **Before this phase**: `console.error` only, no `captureException` call | **Real gap, found and fixed this phase** (see Part 9 / Final Report) |
| Segment-level `error.tsx` files | Exist for several routes | Not individually re-audited this phase (out of narrow scope) |

## The capture sink itself: `lib/error-tracking/capture.ts`'s `captureException`

Calls two things unconditionally:
1. `logError(error, context)` — routes to `lib/error-handling/logger.ts`.
2. `sentryCapture?.(error, ctx)` if a reporter was registered (only happens if Sentry's DSN gate opened, which it does not in production today).

## `logError`'s real production behavior — the most important finding of this Part

`lib/error-handling/logger.ts`'s `logError` only performs its `console.error` output when `NODE_ENV === 'development'`. **In production, with no Sentry DSN configured, `logError` is a complete no-op.** This means: any error routed through `captureException` in production today — including every `ErrorBoundary.tsx` catch, and after this phase's fix, every `global-error.tsx` catch — currently logs nowhere and reports nowhere. It is fully swallowed.

This is distinct from, and more severe than, the already-known "Sentry has no DSN" gap: even without Sentry, a reasonable expectation would be that production errors at minimum hit `console.error` (which Vercel captures into function logs) via this shared pipeline. They do not. The only reason client-observed crashes are visible in Vercel logs at all today is components like `global-error.tsx` that ALSO call `console.error` directly, independent of the shared `captureException`/`logError` pipeline.

**Classification: Absent** (production error visibility via the app's own dedicated error-tracking pipeline). **Intentionally not applicable** was considered and rejected — nothing in the codebase suggests this no-op-in-production behavior was a deliberate design choice; it reads as an unfinished migration (the `development`-only branch looks like a placeholder pending real Sentry activation).

## What this Part did NOT change

Per guardrails, this audit did not rewrite `logError`'s production behavior, did not add a new logging destination, and did not introduce a new vendor. The one corrective action taken this phase (wiring `global-error.tsx` into the existing `captureException` sink — see Part 9) does not change `logError`'s no-op-in-production characteristic; it only ensures root-level crashes flow through the same (currently limited) pipeline segment-level crashes already use, so the moment Sentry's DSN gate is opened, root-level crashes are covered too without further code changes.

## Summary table

| Signal | Verified operational | Implemented but unverified | Declared-only | Absent |
|---|---|---|---|---|
| Sentry event delivery | | | ✅ | |
| Sentry source-map upload | | | | ✅ (never active in prod build) |
| Segment-level `ErrorBoundary` → `captureException` wiring | ✅ (code path is real and correct) | | | |
| Root-level `global-error` → `captureException` wiring | ✅ (fixed this phase) | | | |
| `logError` producing visible output in production | | | | ✅ |
| GA4 Core Web Vitals delivery | ✅ (DSN-equivalent var confirmed present in production) | | | |
