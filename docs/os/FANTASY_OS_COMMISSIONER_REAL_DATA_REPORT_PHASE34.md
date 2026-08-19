# Commissioner Real Data Report (Phase 34, Track B)

## Scope note (important, honest mapping)

Part B3 asks to measure "commissioner accounts, commissioner actions, league health, trade review, integrity, automation, notifications." Per the Architecture Audit's disambiguation: **trade review, integrity, automation, and notifications are handled by separate, unrelated systems** (`app/api/commissioner/**`, `app/api/leagues/[leagueId]/ai-commissioner/**`, `app/commissioner-os/*`), not by the audited `lib/shared-services/commissioner/` module, which only touches league health / commissioner role / power rankings. Reporting real data for the categories the audited module actually uses; noting the others exist but are out of this module's scope.

## Real data found (direct SQL, `.env.test`)

| Metric | Real count |
|---|---|
| Total leagues | 65 |
| Distinct real commissioner accounts (`League.userId`) | 19 |
| `FantasyStanding` rows for the real active manual-platform league (`4a1853d7-...`) | **0** |
| `FantasyStanding` rows for a real Sleeper league (`a6f74157-...`) | **0** |
| Real `decision_os_imported_activity`, `decision_os_behavioral_snapshot`, `decision_os_league_context` tables | **Do not exist in this database's schema at all** (confirmed via real Prisma execution errors, not just an empty-count query) |

## Real execution results (Part B4 — not SQL-only)

Executed `evaluateCommissionerShadow()` (the module's full real orchestrator) against two real leagues:

| | Real active league (`4a1853d7-...`, 84 real RedraftMatchup rows) | Real Sleeper league (`a6f74157-...`) |
|---|---|---|
| Executed without crashing | **Yes** | **Yes** |
| `requestingUserRole` | `commissioner` (real, correct — used the league's real `userId`) | `commissioner` |
| `missionControl.leagueHealth.available` | `true` | `true` |
| `health.category` | `healthy` | `healthy` |
| `pulse.compositeScore` | 65 | 65 |
| `attentionItems.length` | 2 | 3 |
| `ranking` (power rankings) | `null` | `null` |
| `formatAwareness.powerRankingSupport` | `supported` (not a stub format) | `supported` |
| `brief` sections | 6 | (not separately measured) |
| `divergence.length` | 0 | (not separately measured) |

### Real finding: power rankings unavailable for both real leagues despite "supported" format

Root cause confirmed: `FantasyStanding` has **0 rows** for both real leagues tested. `computePowerRankings()` (the real, external engine this module wraps) needs real standings/record data to compute anything, and correctly returns `null` when it has none — `CommissionerRankingService.ts` passes that `null` through honestly rather than fabricating a ranking. This is a real, disclosed data gap in the underlying `lib/league-power-rankings` engine's real-data prerequisites, not a defect introduced by the Commissioner OS shadow module.

### Real finding: Decision OS's own backing tables don't exist in this schema

Real execution surfaced (via genuine Prisma runtime errors, caught non-fatally by the code) that `decision_os_imported_activity`, `decision_os_behavioral_snapshot`, and `decision_os_league_context` — tables that `lib/decision-os/*` (which `resolveMissionControlSnapshot`/`resolveLeagueAnalyticsSnapshot` depend on) tries to query — **do not exist in `.env.test`'s database schema at all**. Every real execution logged multiple caught Prisma errors for these missing tables. The module's "fails safe" design held (both executions completed and returned usable results despite this), but it means Mission Control/League Analytics' real output in this environment is itself running in a significantly degraded mode — worth flagging for whoever owns `lib/decision-os/*`'s schema migrations, independent of Commissioner OS.

### Observation, not a confirmed bug: identical `pulse.compositeScore` (65) across two different real leagues

Plausible explanation given the above: with `decision_os_*` tables absent and `FantasyStanding` empty for both, several of `LeaguePulseService.ts`'s 7 pulse dimensions likely land on the same default/unavailable bucket for both leagues, producing a coincidentally identical composite. Not independently confirmed dimension-by-dimension this phase — flagged for Track B's Truthfulness Audit and as a candidate for a future phase's deeper investigation, not asserted as a proven bug.
