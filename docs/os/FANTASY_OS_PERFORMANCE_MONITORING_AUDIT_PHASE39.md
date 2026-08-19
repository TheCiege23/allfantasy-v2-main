# Performance Monitoring Audit (Phase 39, Part 3)

## Client-side: Core Web Vitals

`components/*/WebVitalsTracker.tsx` (real component) captures Core Web Vitals and forwards them to Google Analytics via `NEXT_PUBLIC_GA_MEASUREMENT_ID`.

**Classification: Verified operational.** Direct `vercel env ls production` confirmed `NEXT_PUBLIC_GA_MEASUREMENT_ID` is present in real production environment variables — resolving an uncertainty flagged during this phase's delegated audit. This is a real, active destination; GA4's own dashboards (not accessed this phase — outside the Vercel CLI's read scope) would be the place to confirm actual received data, which was not done.

## Server-side: request/route timing

| Mechanism | Real code | Adoption |
|---|---|---|
| `withApiUsage()` wrapper | Yes, real — records to `ApiUsageRollup`-backed telemetry | **79 of 1540 API routes** use it (~5%) — a real, quantified adoption gap found by the delegated audit |
| `withTimedRoute()` / `logStructured()` (`lib/logging/structured.ts`) | Yes, real — JSON-line structured output designed for Vercel Log Drains | Partial adoption, not separately quantified this phase |
| `logLeagueEngineEvent()` (`lib/league-engine-performance/observability.ts`) | Yes, real — league-engine-specific structured event logging | Scoped to league-engine code paths only |

**Classification: Implemented but unverified** for the ~5% of routes wrapped — the wrapper is real and the DB table it writes to (`ApiUsageRollup`) is real, but no query was run this phase confirming rows are actively accumulating in production (would require production DB read access beyond what this phase used). **Absent** for the ~95% of routes with no timing instrumentation at all — those routes have zero server-side performance visibility beyond Vercel's own platform-level function duration metrics (which exist independent of any app code, and were not queried this phase since `vercel logs` was used for error inspection, not aggregate timing).

## What this Part explicitly did not do

No new performance-monitoring vendor or dashboard was introduced. No attempt was made to raise `withApiUsage()` adoption — that is a large, cross-cutting change explicitly out of scope for "smallest justified corrections" (Part 9's guardrail against broad refactors).

## Summary

| Signal | Verified operational | Implemented but unverified | Absent |
|---|---|---|---|
| Core Web Vitals → GA4 | ✅ (destination confirmed present) | | |
| `withApiUsage()`-wrapped route timing | | ✅ | |
| Unwrapped route (~95%) timing | | | ✅ (platform-level Vercel function metrics only, not app-level) |
| League-engine structured events | | ✅ | |
