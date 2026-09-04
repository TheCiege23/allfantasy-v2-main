# Phase 4.6 — Production Deployment Readiness & Controlled Rollout

Determines whether Commissioner OS + Decision OS is ready for Production
deployment, and defines the controlled rollout plan for live-readiness
flags. **This report makes a recommendation only — no deployment, no
production data change, and no flag flip was performed in this phase.**

## Readiness Summary

The integration itself is sound and thoroughly validated (Phases 4.2–4.5):
real Sleeper data, real historical backfill proof, real Preview deployment
with real production data, real Decision OS API calls confirmed working
end-to-end. However, this review surfaced **two new blockers** that must
be resolved before a real Production deployment — neither is a Commissioner
OS or Decision OS code defect; both are operational/deployment-state gaps.

## Blockers (must resolve before deploying)

1. **Uncommitted fixes.** Both Phase 4.5 fixes —
   `scripts/win-exfat-readlink-shim.cjs` (restores the file the `build`
   script requires; without it, `npm run build` fails at Node startup on
   any platform) and the Deployment Protection bypass header in
   `lib/commissioner-os/adapter/transport/client.ts` — exist only as
   **uncommitted local changes in this worktree**. They were included in
   every Preview deployment because `vercel deploy` uploads directly from
   the local filesystem, bypassing git. The current Production deployment
   (`allfantasy-v2-main-2gr8ymuzu...`, 2h old) almost certainly does
   **not** include them, since Vercel's Production deployments follow git,
   not this worktree. **A real Production deployment today would very
   likely hit the exact same missing-shim build failure Phase 4.5 found
   and fixed locally.** These changes need to be committed and pushed to
   whatever branch Production deploys from before attempting `--prod`.
2. **`NEXTAUTH_URL` has no Production-scoped value in the project's
   environment variables right now** — confirmed via `vercel env ls`
   this phase, showing only a Preview-scoped entry. The Phase 4.5 restore
   (after the accidental deletion) either didn't persist as a
   project-level variable or was applied as a one-off deployment
   override that won't carry into a fresh deployment. **This must be
   fixed by you directly in the Vercel dashboard before any Production
   deployment** — I have not touched it and won't without your explicit
   go-ahead, given the earlier incident.

A **real type error was found and fixed** during this phase's final
verification (§7): the bypass-header change introduced a `HeadersInit`
type mismatch in `client.ts`, caught by `tsc --noEmit`, fixed with an
explicit `Record<string, string>` annotation, and re-verified clean. This
is now folded into the same uncommitted change described in blocker #1.

## Report Review (Phases 4.2–4.5)

All five prior reports were reviewed. Nothing in this review contradicts
their conclusions; this phase's job was to re-verify against *current*
state, not to re-litigate them:
- `REAL_SLEEPER_VALIDATION_REPORT.md` — real Sleeper leagues, real
  integration, honest degradation confirmed. Still holds.
- `HISTORICAL_INTELLIGENCE_BACKFILL_REPORT.md` — real backfill proof
  exists **only on the isolated validation branch**, not production.
  Production leagues will show honest low/zero engagement until a
  similar backfill is deliberately run there (out of scope here).
- `INTELLIGENCE_VALIDATION_REPORT.md` — "conditionally production-ready"
  verdict; the conditions (env vars, a recurring snapshot job, copy
  softening on permanent placeholders) are still open, tracked below.
- `VERCEL_PREVIEW_DEPLOYMENT_REPORT.md` — Preview build/deploy/transport
  all confirmed working. Re-verified still working this phase (fresh
  `curl` against the stable Preview alias, still `200`).
- `PRODUCTION_ACTIVE_LEAGUE_RESOLUTION_FINDING.md` — root cause was
  production's empty `isLiveReady` flags, not a data/schema/auth issue.
  Re-confirmed this phase (see below) — still zero rows.

## Current Production State (verified this phase, read-only)

| Item | State |
|---|---|
| Latest Production deployment | `allfantasy-v2-main-2gr8ymuzu-cafeconchimmy.vercel.app`, ~2h old (triggered by the `NEXTAUTH_URL` restore + redeploy from Phase 4.5) |
| `DATABASE_URL` / `DIRECT_URL` | Present, Preview+Production, unchanged (33d old) |
| `NEXTAUTH_URL` | **Missing for Production** (blocker #2 above) |
| `DECISION_OS_BASE_URL` / `DECISION_OS_API_KEY` | Preview-only (as designed this phase — Production needs its own real values, not yet provisioned) |
| `DECISION_OS_INTELLIGENCE_API_ENABLED` / `_PROVIDER` / `INTELLIGENCE_API_TEST_KEYS` | Preview-only, real values. Production's copies of these three variables no longer exist at all (removed during the Phase 4.5 incident, never restored — same category of gap as `NEXTAUTH_URL`, lower severity since Decision OS live mode isn't live in Production yet regardless) |
| `DECISION_OS_COMMISSIONER_HEALTH_LIVE` | Present, Preview+Production, untouched (unrelated to this work, purpose not investigated) |
| Deployment Protection | "Standard Protection" (Vercel Authentication) still enabled; "Protection Bypass for Automation" secret still configured at the project level (applies to all deployments, not Preview-specific) |
| `commissioner_os_live_ready_*` flags (`platform_config`) | **Re-confirmed zero rows** — every module defaults to `false` |

## Preview Validation Still Holds

Re-ran a live check against the stable Preview alias
(`https://allfantasy-v2-main-preview-decisionos.vercel.app`) with the
Deployment Protection bypass header: `/api/v1/intelligence/league` still
returns a clean `200` with real, honest data. No drift since Phase 4.5.

## Production Rollout Decision

**Recommendation: a sequenced version of Option B**, gated behind
resolving the two blockers first — not a plain "Option A" (which would
waste the validated real integration by shipping it fully dark) and not a
full "Option C delay" (extensive additional testing isn't what's missing;
two concrete, fast-to-fix gaps are).

Concretely:
1. Fix blocker #1 (commit + push the two Phase 4.5 fixes) and blocker #2
   (restore `NEXTAUTH_URL` for Production as a real project-level
   variable) — both prerequisites, neither is a deployment itself.
2. Deploy the code to Production.
3. Enable only the safest live-readiness flags first (staged order
   below), not all 13 at once.

## Staged Live-Readiness Flag Order

Confirming and refining the proposed order using each module's actual
validated behavior from Phases 4.3–4.4:

| Order | Module | Why this position |
|---|---|---|
| 1 | `analytics` | Fully real integration confirmed (KPIs, trend delta, waiver-activity tier) — the single most validated, highest-value module |
| 2 | `mission-control` | Fully real summary cards confirmed (League Health/Recommendations/Manager-highlight all reflect real data) |
| 3 | `recommendations` | Mission Control's recommendation *count* is real; the dedicated queue page is a permanent, honest placeholder regardless of this flag (missing `title`/`confidence`/`status` fields in the ported API) — safe, low incremental risk |
| 4 | `notifications` | Composed correctly from real (possibly empty) upstream data; honest empty states proven in both local and Preview validation |
| 5 | `activity` | Honest empty states proven; no backfilled roster-move data exists yet in production regardless, so this will show "no activity" until that's addressed separately |
| 6 | `search` | Composed correctly; degrades independently and honestly when managers/recommendations are empty |
| 7 | `league-health` | Mission Control's card is real; the *dedicated* League Health page is a permanent hardcoded placeholder for 3 of its 4 methods regardless of this flag — lower incremental value than 1–6, but no harm |
| 8 | `manager-intelligence` | Same situation as League Health — Mission Control's highlight is real, but the dedicated directory page requires the unported Phase 6.2 DNA classifier and will stay a placeholder regardless |

**Explicitly not included**, per your instruction and because their own
reports confirm permanent, by-design placeholders unrelated to this
flag: `reports`, `help`, `workspace`, `automations`. None of their
integration reports justify enabling them — all four have hardcoded
`notYetIntegrated()` responses regardless of `isLiveReady`'s value.

Recommend enabling one at a time (or in small batches, e.g. 1–2 together)
with a short observation window between each, watching the rollback
triggers below — not all 8 simultaneously.

## Rollback Plan

**Disabling flags** (fastest, lowest-risk rollback — no redeploy needed):
```sql
UPDATE platform_config SET value = 'false'
WHERE key = 'commissioner_os_live_ready_<moduleId>';
```
Takes effect immediately on the next request (no caching layer exists per
Phase 4.4's own finding) — this is the first lever to pull if a specific
module misbehaves after going live.

**Reverting the deployment**: `vercel rollback <previous-production-url>
--scope cafeconchimmy` (or promote a specific prior deployment via the
dashboard's "..." → "Promote to Production"). Keep the current
`2gr8ymuzu` deployment's URL noted as the immediate rollback target if the
*new* deployment itself (not just a flag) needs to be undone.

**Restoring env vars**: re-run `vercel env add <NAME> production` for
whichever variable regresses, using the values documented in this report
and Phase 4.5's report. Always verify with `vercel env ls` immediately
after any change — the exact discipline that caught the `NEXTAUTH_URL`
incident.

**Logs to watch after each flag flip**:
- `vercel logs <production-url> --scope cafeconchimmy --level error` — any
  new error-level entries correlated with the flip time.
- Structured `commissioner-os-transport` logs for `decision_os_call_failed`
  events, specifically for the just-enabled `moduleId`.
- Vercel's function error rate / duration graphs in the dashboard for the
  affected routes, watching for latency regressions (Phase 4.4 measured
  560ms–1.8s warm; a sustained jump would indicate the no-caching design
  is now under real load).

## Final Build/Test Verification (this phase)

- `npx vitest run commissioner-os decision-os`: **1070/1078 passing**,
  43 files. The 8 failures are explained, not a regression: they assert
  the intelligence API's *disabled* state, but this worktree's own local
  `.env` (left over from Phase 4.2's local validation) sets
  `DECISION_OS_INTELLIGENCE_API_ENABLED=true` globally, which leaks into
  the test run and makes the "disabled" scenario not actually disabled.
  Confirmed by direct inspection of `.env`. A clean CI/production
  environment without this local file would not hit this.
- `tsc --noEmit` surfaced one real, new type error from this session's own
  transport-client change (`HeadersInit` mismatch) — found and fixed
  during this phase, re-verified clean on the changed file. (Full-repo
  typecheck still carries the pre-existing ~3,000-error baseline noted in
  earlier session memory, unrelated to this work and out of scope to
  chase here.)

## Known Limitations (carried forward, unchanged)

- Manager-level intelligence is structurally scoped to real `AppUser`
  accounts — placeholder league members can never get individual
  intelligence (Phase 4.4).
- No snapshot-capture scheduler exists yet — trend history won't
  continue accumulating in production without one (Phase 4.3/4.4).
- No draft-history backfill was performed (Phase 4.3).
- No intelligence caching layer — acceptable at current scale (Phase 4.4).
- Node.js 20.x deprecation deadline 2026-10-01, `engines.node` not yet
  bumped (Phase 4.5) — not a launch blocker today, but a real, dated item.
- Reports / Help / Workspace / Automations remain permanent, honest
  placeholders pending unported Decision OS capabilities.

## Go / No-Go Recommendation

**Conditional GO** — contingent on resolving the two blockers first
(commit+push the Phase 4.5 fixes; restore `NEXTAUTH_URL` for Production
as a real project variable). Once both are done:
1. Deploy the code to Production (this alone is safe — it's the same
   code already proven on Preview against real production data, with
   `commissioner_os_live_ready_*` still all `false`, i.e. Option A's
   safety net, as the immediate landing state).
2. Then work through the staged flag order above deliberately, one or two
   modules at a time, watching the rollback triggers between each step.

**I have not deployed anything and will not until you explicitly approve
this recommendation**, per your instruction.
