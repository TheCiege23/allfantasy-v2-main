# Admin Production Truth & Deployment Audit (2026-07-21)

## Root causes

1. **Old visual layout was never a deployment bug.** The rebuilt Operator Command
   Center (`app/admin/operator/**`) was deliberately built as a parallel shell, gated
   behind an authed visual review (`docs/OPERATOR_CONSOLE_AUTHED_REVIEW.md`) that had
   never been completed — not lost work, not a failed push. This PR completes that
   review and performs the cutover (`docs/OPERATOR_CONSOLE_CUTOVER.md`).
2. **Finding B (4 admin API routes excluded from the production build) was already
   fixed and live** before this PR started: commit `936fbc02e` (PR #312) is the
   current production deployment (`dpl_Ex8t9W3uWUgMzd5kuWTyMUU3EMeK`, confirmed via
   the Vercel API). If zeros are still visible in production after this PR ships,
   it is not this cause.
3. **A newer instance of the same class of bug**: `components/admin/ChimmyKPIReadout.tsx`
   (mounted by the operator console's Chimmy section) fetches `/api/ai/analytics/rollup`,
   which `scripts/vercel-next-build.cjs` excludes from the production build under a
   comment claiming it has no production page caller. That comment is now false — fixed
   by adding the route to `filesToKeep`.
4. **The drift-detection test itself had a blind spot.** `__tests__/route-budget.test.ts`
   deliberately excluded `components/admin/` from its "no active production fetch caller"
   scan, on the theory that admin UI never runs in production. `app/admin/**` is NOT
   build-excluded (only `app/api/admin/**` partially is), so that theory was wrong and
   the scan could never have caught either the #312 regression or the rollup-route bug.
5. **The 3 lists gating what actually ships (`scripts/vercel-next-build.cjs`,
   `scripts/route-budget-count.mjs`, `__tests__/route-budget.test.ts`) had drifted
   independently.** The test file's own copy was missing all 4 of #312's kept routes
   and incorrectly treated `app/admin` as excluded — its own route-count math had been
   wrong since #312 merged, independent of anything in this PR.

## Endpoint contract — findings and resolutions

| Finding | Resolution |
| --- | --- |
| `/api/admin/automation` linked from the Automation section — no route file exists | Corrected to `/api/admin/automation/health`, which exists and is kept |
| `/api/ai/analytics/rollup` excluded from prod build, but mounted by the operator console | Added to `filesToKeep`; stale exclusion comment left as historical record with a note |
| `/api/admin/{visitor-analytics,api-health,chimmy/health,monetization/checkout-link-mapping}` | Already fixed on `origin/main` (#312) — reconfirmed, not re-broken |
| `/api/admin/ai/metrics`, `/api/admin/ai/recommendations`, `/api/admin/usage`, `/api/admin/usage/summary`, `/api/admin/simulate-league` | Confirmed NOT called from `app/admin/page.tsx` (a prior audit's specific claim was wrong) — these five ARE real, broken fetches, but from components mounted on unrelated pages (Survivor gameplay, a per-league model-settings page) or mounted nowhere at all. Out of scope for the admin panel; left untouched and documented here so they aren't mistaken for fixed. |
| 6 admin-styled components built but mounted nowhere (`AdminAIOutcomeDashboard`, `AIRecommendationTable`, `VisitorAnalyticsPanel`, `VisitorGlobePanel`, `AiCostHealthPanel`, `SimulationReportModal`) | Left as-is — dead code with zero user-facing impact; a deletion decision is separate scope in a shared, heavily in-flight working tree |

## Fake-zero fallbacks removed

All in `lib/admin-dashboard/AdminCommandCenterService.ts`, each previously defaulted
a failed query to `0`/`[]` indistinguishable from a genuinely clean state:

- `providerTeamReconciliation` — added an explicit `unavailable` flag; UI now renders
  "Unavailable" instead of a fake `0` problem count, and the operator Attention Queue
  raises a distinct "status unknown" signal instead of silently looking clean.
- `topReferrers`, `multipleAccountsSameLocation` (high-repeat visitor locations),
  `syncJobsFailed24h`, `activeSessionsNow` (×2 call sites), `couponRedemptions` /
  `couponRedemptionsRedeemed` — each now renders "Unavailable"/"Query failed" via the
  existing `notTracked()` honesty helper instead of a confident zero.
- `syncJobsFailed24h`'s failure also silently suppressed a real attention-queue item and
  fed a false "Operational" verdict into the composite platform-health and per-service
  health rows in `lib/admin-dashboard/operatorAttention.ts` — all three sites fixed to
  read "Unknown" instead of assuming healthy.

## Vercel / database findings

- Vercel project `allfantasy-v2-main` (`prj_xMYOVacH6URCKx5ZDa8XbOFq4oHm`, team
  `cafeconchimmy`), domains `allfantasy.ai` / `www.allfantasy.ai`, is bound correctly —
  no wrong-project or wrong-branch binding found.
- Production deployment SHA at the start of this work: `936fbc02e` (already current).
- Local `.env`/`.env.local` currently resolve to the PRODUCTION Neon database
  (`ep-curly-block-ad0dlt9o`/`neondb`) — this contradicts an earlier session's note
  that they were safely pointed at a shadow database, and was re-verified directly
  with the repo's own `scripts/db-target-identity.cjs` guard. All local verification
  in this PR was done against `.env.test` (a fully separate Neon project), never
  against `.env`/`.env.local`, to avoid touching production.

## Deployment identity

Added `lib/admin-dashboard/deploymentIdentity.ts` — version, commit SHA (+ short SHA),
branch, environment, deployment URL, process-start time, and a one-way hash of the DB
connection host (never the host, credentials, or database name). Surfaced on the
Operator Overview page, in System Settings, and via `/api/admin/status`.
