# Phase 4.5 Open Finding — Production Active League Resolution Diagnostic

Investigates why Commissioner OS Preview pages showed "Unavailable" against
real production data even after the Vercel Deployment Protection bypass fix
confirmed the Decision OS Intelligence API itself returns real 200 responses.
Read-only throughout; no production data, env vars, or code behavior for
real users were changed.

## Root Cause (found)

**Commissioner OS's per-module `isLiveReady` feature flags were never set in
the production database.** They exist only on the isolated Neon validation
branch used in Phases 4.2–4.4. `resolveActiveLeagueId()` is not the problem
— it correctly resolves a real active league for the account. Every
module's `live.ts` gates on `isLiveReady(moduleId)` *before* ever calling
Decision OS; with no rows present, that check defaults to `false`
(`getBoolean()`'s documented fallback), so every module short-circuits to
its honest "not yet integrated" / "Unavailable" response without ever
attempting the call — which is exactly why no `/api/v1/intelligence/*`
request appeared in server logs for those page loads, while my direct
external `curl` calls (which don't go through `isLiveReady`) succeeded.

This is the live-readiness system working exactly as designed — a
deliberate, staged rollout gate (per `liveReadiness.ts`'s own doc comment:
"every namespace defaults to `false`... today, with zero real `live.ts`
implementations written yet, this changes nothing"), not a defect.

## 1–2. Code Path Audit

`resolveActiveLeagueId()` (`lib/commissioner-os/resolveActiveLeagueId.ts`):
```ts
const session = await getServerSession(authOptions)
const userId = session?.user?.id                                    // NextAuth session
const rosters = await prisma.roster.findMany({
  where: { platformUserId: userId }, include: { league: true },
  orderBy: { createdAt: 'desc' },
})
const activeLeague = rosters.map(r => r.league).find(league => {
  const status = String(league.status ?? '').trim().toUpperCase()
  return !status || !['ARCHIVED','COMPLETE','COMPLETED','CLOSED'].includes(status)
})
```
Depends on: NextAuth session (`session.user.id`), `rosters` table
(`platformUserId` column), `leagues` table (`status` column, joined via
`Roster.leagueId`).

Every module's `live.ts` (e.g. `lib/commissioner-os/analytics/decision-os-client/live.ts`)
gates with:
```ts
if (!(await isLiveReady('analytics'))) {
  return { data: null, error: notYetIntegrated(), source: 'live', ... }
}
```
`isLiveReady()` (`lib/commissioner-os/liveReadiness.ts`) reads
`getBoolean('commissioner_os_live_ready_<moduleId>')`
(`lib/feature-toggle/FeatureToggleService.ts`), backed by the
`platform_config` table (`key`/`value` columns).

## 3–4. Read-Only Queries Used (both explicitly approved before running)

**Query 1** — session identity check (no DB access; read via the
authenticated browser's own `/api/auth/session`, confirming
`session.user.id = 9791bae0-e47f-418a-ae40-285f6a2e7887`, matching the real
account used throughout this whole engagement).

**Query 2** — rosters/leagues for that user id, production branch
(`icy-field-51189449` / `br-withered-shadow-adur64u9`):
```sql
SELECT l.id, l.name, l.status, l.platform, r."createdAt"
FROM rosters r JOIN leagues l ON r."leagueId" = l.id
WHERE r."platformUserId" = '9791bae0-e47f-418a-ae40-285f6a2e7887'
ORDER BY r."createdAt" DESC;
```
Result: 8 real leagues, all with `status` either `null` (2 real Sleeper
leagues) or `"setup"` (6 manual leagues) — **every one of these passes
`resolveActiveLeagueId()`'s filter** (only `ARCHIVED`/`COMPLETE`/
`COMPLETED`/`CLOSED` are excluded). The most recent roster
(`e4bb3f31-2ac2-4f24-b67a-1654d1ad5893`, "Not 4 the Weak!") is what the
function resolves to — confirmed directly by calling
`/api/v1/intelligence/league?leagueId=e4bb3f31-2ac2-4f24-b67a-1654d1ad5893`
externally with the Deployment Protection bypass header, which returned a
real, valid `200` with honest zero-engagement data (matching the
pre-Phase-4.3-backfill baseline, since that backfill only ever touched the
validation branch).

**Query 3** — feature flag check, same production branch:
```sql
SELECT key, value FROM platform_config WHERE key LIKE 'commissioner_os_live_ready_%';
```
Result: **zero rows.**

## 5. Determination

| Candidate cause | Ruled in/out |
|---|---|
| Missing active league row | Ruled out — 8 real rosters/leagues exist |
| User id mismatch | Ruled out — session id matches exactly |
| Sleeper username mismatch | Not applicable — resolution doesn't depend on Sleeper identity, only native `Roster`/`League` rows |
| League source mismatch | Ruled out — both `manual` and `sleeper` platform leagues pass the filter identically |
| Production data not backfilled | True but not the blocker here — explains why engagement *values* are honest zeros, not why pages short-circuit to "Unavailable" before even reaching Decision OS |
| Schema difference from validation branch | Ruled out — identical schema, identical filter behavior confirmed |
| Auth/session mismatch | Ruled out |
| **`isLiveReady` flags never set in production** | **Confirmed root cause** |

## Affected Modules

All 13 namespaces gated by `isLiveReady()` — every Commissioner OS module:
Mission Control, League Health, Manager Intelligence, Recommendations,
League Analytics, Workspace, Automations, Reports, Settings, Activity
Stream, Help, Search, Notifications. This is a platform-wide gate, not
module-specific.

## Recommended Fix

Set `commissioner_os_live_ready_<moduleId>` to `true` in production's
`platform_config` table for whichever modules are intended to go live —
via the same `setLiveReady()` function the code already provides, as a
**deliberate, explicit go-live action** (ideally reviewed per-module, not
all 13 at once), separate from any Preview-deployment work. This is
precisely Phase 4.4's own recommended fix #1 ("provision real Decision OS
credentials... before broader use") extended to include this flag —
should happen alongside a decision about the pending Phase 4.3 gaps
(historical backfill is validation-branch-only; production leagues will
show honest low/zero engagement until/unless a similar backfill is run
against production data, which is itself a separate, deliberate decision).

## Does This Block Preview Validation?

**No.** Preview validation's job was to prove the deployed code and
infrastructure work correctly when properly configured — and it does:
build succeeds, auth works, the Deployment Protection bypass works, and
the Intelligence API itself returns real, correct, honest data when called
under the same conditions production code would use (confirmed by direct
external call). The "Unavailable" UI state observed is the *correct,
honest* rendering of a deliberately-still-off feature flag, not a broken
Preview environment.

## Does This Block Production Deployment?

**No, not for shipping the code.** The code deploying to Production would
behave identically to what's proven here: safe, honest degradation,
zero fabricated data, zero crashes. It **does** mean that simply deploying
to Production will not, by itself, turn on live Commissioner OS
intelligence for real users — that requires the separate, deliberate
`isLiveReady` flag decision above. Recommend treating "flip production
live-readiness flags" as its own explicit, reviewed go-live step, not
something that happens implicitly as a side effect of deployment.
