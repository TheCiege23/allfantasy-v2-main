# Observability Baseline (Phase 39, Part 1)

## Environment

| Field | Value |
|---|---|
| Branch | `g15-event-foundation` (working tree also referenced as `feat/fantasy-os-enterprise-workspace` in stash metadata from a prior phase — see Phase 38 incident report) |
| HEAD commit | `00808c07d` — "Annotate validation-cohort Sleeper calls as db-first-exception" |
| Uncommitted tracked paths | ~442 (established baseline for this branch across Phases 35-38; not a Phase 39 regression — see `g15-branch-dirty-state` project context) |
| Method used to determine pre-existing vs. new failures | **Read-only only**: `git status`, `git diff`, `git log`, direct file reads. No `git stash`, `reset`, `checkout --`, or `clean` used anywhere in this phase, per the explicit constraint added after the Phase 38 incident. |

## Fresh TypeScript baseline

A clean, isolated `tsc --noEmit -p tsconfig.json` run (not concurrent with any other heavy process, per this session's established measurement-noise pattern from Phases 32/34) produced **215 errors**, matching the count reported at the start of this phase's brief (up slightly from Phase 38's 212 — pre-existing ambient drift on this ~442-uncommitted-path branch, not a Phase 39 regression). Grepping the full error list for this phase's three touched/new files (`app/global-error.tsx`, `__tests__/vercel-cron-route-drift.test.ts`, `__tests__/global-error-capture-exception-wiring.test.ts`) returns zero matches — this phase's changes introduce no new TypeScript errors.

## Monitoring dependency inventory

| Dependency | Where | Status |
|---|---|---|
| `@sentry/nextjs` | `package.json` | Installed, real init code exists (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `lib/error-tracking/sentry.ts`) — **but gated behind an env var confirmed absent from production** (see Error Tracking Audit) |
| Any other observability vendor (Datadog, LogRocket, New Relic, Honeycomb, etc.) | — | **None found.** `@sentry/nextjs` is the sole third-party monitoring dependency in this codebase. |
| Google Analytics (`NEXT_PUBLIC_GA_MEASUREMENT_ID`) | `WebVitalsTracker.tsx` and site-wide GA snippet | **Confirmed present in real production env vars** via direct `vercel env ls production` query (256 real vars total) — a real, active destination for Core Web Vitals and pageview data |

## Real production access used this phase

Genuine, authenticated, read-only Vercel CLI access was available and used (`vercel whoami` → `allfantasysportsapp-3424`, linked to `cafeconchimmy/allfantasy-v2-main` at `https://www.allfantasy.ai`). This is a capability not available or used in earlier phases, and materially changed this phase's evidence quality from code-only inference to real, live production verification — see the Deployment Reality Audit for what was found using it.

## Scope reminder honored

Per this phase's explicit instruction, no changes were made to provider normalization, Draft OS, Manager OS, Commissioner OS, Matchup Center, or any other completed subsystem's behavior. The two corrective changes made this phase (see Part 9) are additive observability wiring and a new regression-guard test — neither alters any existing subsystem's runtime behavior for a real user.
