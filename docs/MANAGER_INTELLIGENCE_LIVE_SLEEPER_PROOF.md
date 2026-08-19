# Manager Intelligence Hub — Live Sleeper Proof Pass (Phase 5)

**Status:** Hub polished for demo; rendering + logic validated against real-world-shaped
data. **True end-to-end validation against a live imported Sleeper league is BLOCKED in
this environment — see [Blocker](#blocker-honest).** Documented honestly rather than faked,
per the phase's own instruction.

**Date:** 2026-07-07 · **Branch:** `g15-event-foundation` · **Commit:** Phase 5

---

## What this phase proves (and what it does not)

**Proves:**
- AllFantasy composes five deterministic, display-only observational modules into one unified
  Manager Intelligence Hub, grounded entirely in a league's own persisted data.
- Each module renders correctly for real-world-shaped payloads (populated / empty / null /
  error), stays observational (no recommendation language), and leaks no raw provider IDs.
- The hub is polished enough to demo (hero, consistent cards, skeletons, caveats, CTA).

**Does NOT prove (out of scope, deliberately):**
- That AllFantasy recommends moves. Every module is descriptive-only; the
  validation→recommendation boundary is intact. Recommendation is a later, separate initiative.

---

## Modules validated

| Module | Source (read-only) | Contract |
| --- | --- | --- |
| Historical Replay | `GET /api/leagues/[id]/replay-insights` (A1) | `ManagerReplayInsightSetV1` |
| League Context | `GET /api/app/leagues/[id]/standings` | standings payload |
| Team Health | `GET /api/app/leagues/[id]/team-health` (A1) | `ManagerTeamHealthV1` |
| Weekly Outlook | `GET /api/app/leagues/[id]/weekly-outlook` (A1) | `ManagerWeeklyOutlookV1` |
| Transaction Readiness | `GET /api/app/leagues/[id]/transaction-readiness` (A1) | `ManagerTransactionReadinessV1` |

Per-module validation results (via the deterministic aggregator tests + the live-like hub
render tests in `__tests__/dashboard/manager-intelligence-hub.test.tsx` and the Phase 2–4
aggregator/route suites):

| Check | Replay | League Ctx | Team Health | Weekly Outlook | Txn Readiness |
| --- | --- | --- | --- | --- | --- |
| Data-present renders | ✅ | ✅ | ✅ | ✅ | ✅ |
| Empty state | ✅ | ✅ | ✅ | ✅ | ✅ |
| Null / missing-field behavior | ✅ (empty) | ✅ | ✅ (null→empty) | ✅ (null→`unknown`/caveat) | ✅ (no config→caveat) |
| Rendering correctness | ✅ | ✅ | ✅ | ✅ | ✅ |
| No recommendation language | ✅ | ✅ | ✅ | ✅ | ✅ |
| No raw provider IDs | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Validation method (what was actually run)

Because a live DB pass is blocked in this environment (below), validation was done at the
layers that are safely runnable here and that carry the real risk:

1. **Deterministic aggregators** — pure unit tests over real-world-shaped roster/matchup
   fixtures (mixed-case slot types, null injuries, missing projections, over-size rosters,
   default vs commissioner roster config). Phases 2–4.
2. **Route contracts** — gate (default-off) / 401 / 403 / data / empty / 500 with auth mocked.
   Phases 3–4.
3. **Hub render, live-like** — the hub rendered with Sleeper-import-shaped payloads for all
   five modules with every flag on, asserting: all five modules render, no placeholder remains,
   **no recommendation/advice language anywhere in the hub**, **no 10+ digit raw ID runs**,
   the Back-to-league CTA, and the responsive grid. (`Phase 5` block in the hub test.)

This exercises the exact code paths a real imported league hits — everything except the live
DB read itself, which is the documented blocker.

---

## Feature flags (non-prod / demo only)

The modules ship dark. To light up the hub in a **local/demo** environment only (do NOT set
these as production defaults):

```bash
# client (inlined) — the hub shell + the replay card
NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED=true
NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true

# server — each module's internal A1 route (independent gates)
MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true
MANAGER_TEAM_HEALTH_ENABLED=true
MANAGER_WEEKLY_OUTLOOK_ENABLED=true
MANAGER_TRANSACTION_READINESS_ENABLED=true
```

Route: `/league/<leagueId>/manager-hub`. Both the hub's client flag AND each module's server
flag must be on for that module to show data.

---

## Blocker (honest)

A true end-to-end pass against the real imported Sleeper league (`theciege24` /
"KBI Smoke Black", previously seeded to **staging** per the Decision OS F.0 work) was **not
run from this environment**, because:

1. **No local database.** `DATABASE_URL` in `.env` / `.env.local` points to remote **Neon**
   cloud Postgres (`*.neon.tech`), not a local instance. There is no local DB holding the
   imported Sleeper data to read.
2. **DB-access safety rule.** This project's standing rule is: never touch prod, and access
   staging only with explicit per-turn approval. Phase 5's prompt did not grant DB access, and
   the target instance is not confirmed non-prod, so **no connection was made** (read or write).
3. **Auth session required.** The A1 routes require an authenticated session that is a member
   of the league (`getServerSession` + `getLeagueRole`); they return 401/403 before any DB read
   otherwise. A headless agent cannot produce that session here.

Nothing was faked to work around this. Zero DB writes were performed (and the routes/providers
are read-only by construction).

---

## How to run the real live pass (in a proper non-prod env)

Follow the step-by-step **[Non-Prod Validation Runbook](./MANAGER_INTELLIGENCE_NONPROD_VALIDATION_RUNBOOK.md)**
(environment requirements, approved test league, module + API checklists, and the demo script).
In short:

1. Point a **local or explicitly-approved non-prod** `DATABASE_URL` at a database that contains
   the imported Sleeper league (re-run the Decision OS F.0 non-prod import runner if needed to
   seed `theciege24` / "KBI Smoke Black").
2. Export the six flags above in that environment.
3. (Optional, safe) run the read-only readiness probe — it refuses on prod-like targets:
   `NONPROD_VALIDATION_ACK=true MANAGER_VALIDATION_LEAGUE_ID=<id> npx tsx scripts/manager-intelligence/validate-nonprod-readonly.ts`
4. `npm run dev`, sign in as a member of the imported league, open
   `/league/<leagueId>/manager-hub`.
5. Walk each module and record results in the runbook: data present? empty state? null/bad-data
   behavior? rendering correct? observational (no rec language)? no raw IDs? Capture screenshots.

---

## Remaining demo blockers

- **Live DB + auth session** (above) — the one true blocker to a screenshotted real-league pass.
- **Projections coverage (Weekly Outlook):** `RedraftMatchup.homeProjected/awayProjected` are
  nullable; leagues without projections show `projectedMargin: unknown` + a caveat (by design).
- **Roster-config fidelity (Transaction Readiness):** open-slot counts fall back to the format
  default when a league has no commissioner roster config, and say so via a caveat.

None of these cross the recommendation boundary or require new contracts.

---

## Next milestone

Per the roadmap: **Commissioner Intelligence proof pass or a full demo flow** — not more
Manager Intelligence contracts. The five Manager modules are complete and validated to the
limit this environment allows.
