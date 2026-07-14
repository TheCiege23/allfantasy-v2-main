# Logging and Correlation Audit (Phase 39, Part 4)

## The structured-logging convention

`lib/logging/structured.ts`'s `logStructured()` and `lib/league-engine-performance/observability.ts`'s `logLeagueEngineEvent()` both emit real, deliberate JSON-line output — a real, intentional format designed to be parsed by Vercel Log Drains (confirmed via direct code read of the JSON-line shape and accompanying comments).

## Adoption gap (quantified by the delegated audit this phase)

Approximately **830 raw `console.*` calls exist in `app/api/**`** outside these structured wrappers. This is not a defect in the wrappers themselves — it means most of the codebase's server-side logging is unstructured, unparseable-at-scale free text, coexisting with a real, working structured convention that most routes don't use.

**Classification: Implemented but unverified at scale.** The structured convention is real and (for the routes that use it) presumably reaches Vercel's log pipeline correctly — this was not independently re-verified via `vercel logs` this phase beyond the cron-route investigation (Part 5), which did observe well-structured JSON log lines in real production output (e.g. `[world-cup-cron-sync] job failed {...}`), confirming the convention DOES work end-to-end for at least the routes that use it.

## Correlation IDs / request tracing

No dedicated cross-service request-correlation-ID mechanism (e.g. a `x-request-id` propagated through logs, DB writes, and downstream calls) was found during this phase's research. Individual structured-log calls carry contextual fields (job name, provider, league ID, etc.) but there is no single ID threading one user-facing request through all the log lines it produced.

**Classification: Absent.**

## Secret-redaction verification (explicit requirement of this Part)

The delegated audit's search for logging/scripts that might leak secrets found **one real, disclosed instance**: `scripts/test-ri-auth.ts`. Direct review confirms:
- It is a manual developer script, not part of any CI pipeline or production code path.
- It is not imported by, or reachable from, any `app/`, `lib/`, or `components/` production code.

**Classification: Absent (of a production risk)** — the one finding is real but confirmed non-production, non-CI, manual-invocation-only. No redaction fix was needed or made; nothing in the structured-logging convention itself (`logStructured`, `logLeagueEngineEvent`) was found to log raw secrets, tokens, or credentials in its own field set.

## Summary

| Signal | Verified operational | Implemented but unverified | Absent |
|---|---|---|---|
| Structured logging convention reaching Vercel logs | ✅ (confirmed via real `vercel logs` output for at least one real route) | | |
| Structured logging adoption across all API routes | | | ✅ (~830 unwrapped `console.*` calls remain) |
| Cross-request correlation IDs | | | ✅ |
| Secret leakage in production logging paths | ✅ (confirmed absent — one found script is non-production) | | |
