# Manager Intelligence Live Integration Report — Phase 3.6

Third live Commissioner OS module attempt, following Mission Control's and
League Health's established pattern
([`MISSION_CONTROL_COMPLETION_REPORT.md`](MISSION_CONTROL_COMPLETION_REPORT.md),
[`LEAGUE_HEALTH_LIVE_INTEGRATION_REPORT.md`](LEAGUE_HEALTH_LIVE_INTEGRATION_REPORT.md)).
Scope held to Manager Intelligence only. No adapter contract, UI file, or
public interface changed.

## Outcome, stated plainly

Manager Intelligence's single method, `getManagerDirectory()`, **cannot
honestly complete at all today.** This is the most conservative outcome of
the three modules attempted so far — not a shortfall in effort, but the
correct conclusion of the same field-by-field rigor applied in every prior
phase. Real, tested wiring was still built (league resolution, the batch
`/league/managers` call, batched display-name resolution) — it just always
degrades to a specific, honest capability-gap error today, exactly
mirroring Mission Control's own Phase 3.2 shape before Phase 3.3 closed
its gap.

## Field-by-Field Compatibility Audit

`ManagerDnaProfile`'s required fields: `id`, `managerName`, `archetype`,
`tenureSeasons`, `engagementTrend`, `reliabilityScore`. Optional:
`riskFlag`, `recognition`.

| Field | Verdict | Why |
|---|---|---|
| `id` | ✅ Real | `managerId` from `/league/managers` |
| `managerName` | ✅ Real | Resolved via batched `prisma.appUser.findMany`, same pattern as Mission Control's `getManagerHighlights` |
| `archetype` | ❌ No analog | See "The Phase 6.2 discovery" below |
| `tenureSeasons` | ❌ No analog | Not a Decision OS concept at all (a roster-history fact); no season-continuity query exists in any `live.ts` yet to reuse, and building one now would be new business logic beyond a wiring task |
| `engagementTrend` | ❌ No analog | Phase 3.3 built league-level trend (`intelligence_league_snapshot_history`); no per-manager equivalent exists, and building one would be a new backend capability, forbidden this phase |
| `reliabilityScore` | ❌ No analog | `overallEngagementScore` measures overall engagement, not reliability specifically; relabeling it would conflate two different concepts, the same mistake avoided for League Health's `confidence` in Phase 3.5 |
| `riskFlag` (optional) | ✅ Real, if achievable in isolation | `inactivityWarning` from `ManagerSummaryV1` maps directly — but see below, this doesn't rescue the method overall |
| `recognition` (optional) | ❌ No analog | No positive-framed signal exists in the currently-exposed shape; `retentionRiskReasons` is risk-only |

Because `archetype`/`tenureSeasons`/`engagementTrend`/`reliabilityScore`
are all **required**, the fact that `id`/`managerName`/`riskFlag` are
achievable doesn't rescue the method — a complete `ManagerDnaProfile`
still cannot be honestly constructed for even one manager.

### The Phase 6.2 discovery

`archetype` conceptually maps almost exactly onto Decision OS's own
**Phase 6.2 "Manager DNA / Identity" classifier**
(`lib/decision-os/phase6/dna/` on `g15-event-foundation`). Its own output
type is literally also named `ManagerDnaProfile`, with a
`primaryIdentity` enum (`serial_trader`, `committed_grinder`,
`ghost_manager`, `waiver_hawk`, etc.) that reads like the source material
for this module's demo archetypes ("Active Trader", "Steady Operator").
It even has `engagementReliability: 'reliable'|'inconsistent'|'unreliable'`
— directly relevant to `reliabilityScore`.

This capability **genuinely exists** — but it was deliberately excluded
from the Phase 3.1 port manifest (grouped with `phase6/` as "richer
classifiers layered above the base behavioral intelligence, confirmed not
imported by the approved Intelligence API path"), has no exposed route
today, and itself depends on Phase 6.1 Behavioral Pattern Detection
(also unported) as an input. Porting it now, plus adding a route for it,
would squarely be "introducing a new backend capability" — explicitly
forbidden by this phase's constraints, even though the capability isn't
truly *new*, just not yet brought over. This is flagged as the single
clearest, most valuable next capability-expansion candidate for a future
phase — a much more precisely-scoped one than an open-ended "add more
backend features" ask, since the exact source, shape, and dependency
chain are now known.

## Endpoints Consumed

`GET /league/managers?leagueId=` — called, and its result genuinely used
(for name resolution), even though the overall method still returns the
honest capability-gap error. The single-manager `GET /manager` endpoint
was considered but not used: looping it once per manager to build a
directory would be a needless N+1 call pattern when the batch endpoint
already provides everything currently extractable in one call.

## Adapter Verification

`lib/commissioner-os/adapter/index.ts`, `adapter/types.ts`,
`managers/decision-os-client/types.ts` — untouched, confirmed via file
modification timestamps. `buildManagerIntelligenceAdapter` still calls
`client.getManagerDirectory()` exactly as before. Zero UI files under
`components/commissioner-os/managers/` or
`app/commissioner-os/managers/page.tsx` touched.

## Files Modified

| File | Change |
|---|---|
| `lib/commissioner-os/managers/decision-os-client/live.ts` | Full rewrite — real league resolution + `/league/managers` call + batched name resolution, all genuinely executed; result still discarded per the field audit above |
| `__tests__/commissioner-os-manager-intelligence-live-integration.test.ts` | New — 9 tests |

Nothing else. `adapter/**`, `types.ts`, `stub.ts`, `demo.ts`, and every UI
file remain byte-identical to before this phase.

## Live Fields Wired

None are observable in the final output — but the underlying pipeline is
real and tested: active-league resolution genuinely runs, the real
`/league/managers` call genuinely fires with the correct URL, and manager
display names are genuinely batch-resolved via `prisma.appUser` for every
manager the backend returns. None of this is dead code — completing this
method once Phase 6.2's DNA classifier is ported becomes a small,
well-understood extension of what's already wired (add one more
`callDecisionOS` call once a DNA route exists, then assemble the result),
not a rewrite.

## Fields Intentionally Left as Fallback

All of `getManagerDirectory()`'s output — `archetype`, `tenureSeasons`,
`engagementTrend`, `reliabilityScore`, and (as a consequence, since the
whole record can't complete) `id`/`managerName`/`riskFlag`/`recognition`
too. The honest, specific error message names what's actually missing
("does not yet expose manager archetype, trend, or reliability
classification"), not a generic placeholder message.

## Test Results

| Suite | Result |
|---|---|
| `commissioner-os-manager-intelligence-live-integration.test.ts` | 9/9 passing |
| Full Commissioner OS suite (25 files) | **338/338 passing** |
| Decision OS behavioral suite (port worktree, unaffected — confirmed) | 696/696 passing |
| Full-repo typecheck | **3156 — exact established baseline**, zero new errors |

New tests prove: the placeholder path when the flag is off; active-league
resolution and correct URL encoding (including a league id containing a
space); that a *successful* `/league/managers` call with real manager
data still returns the specific capability-gap error, never a fabricated
directory; that name resolution genuinely executes via one batched query
(not N+1), even though its result is discarded; that an empty manager
list still degrades honestly without even attempting name resolution;
and that a real transport failure is passed straight through, not masked
by the capability-gap message.

## Remaining Backend Gaps

- Manager archetype/identity classification (Phase 6.2, unported, no
  route).
- Per-manager engagement trend (no per-manager history table exists;
  Phase 3.3 only built the league-level equivalent).
- A numeric reliability signal distinct from overall engagement.
- Season-tenure tracking (a roster-history fact, not a Decision OS
  concept at all — would need its own Commissioner-OS-side query,
  analogous to how `managerName` is resolved, but not attempted this
  phase since it wouldn't rescue the method without the other 3 fields
  also closing).

## Readiness for Recommendations Center

Before writing any code for Recommendations Center, repeat this exact
field-by-field audit against its own contract. Two things learned here
are worth carrying forward: first, check whether a module's contract
maps onto an **already-existing-but-unported** Decision OS capability
(like Phase 6.2 DNA) before concluding a gap requires genuinely new
backend work — the distinction changes what "closing the gap" would even
mean. Second, a module whose contract is built around a *scoring/
classification model* (sub-scores, archetypes, lifecycle status) rather
than *direct behavioral facts* (counts, tiers, risk categories) is
significantly more likely to need capabilities beyond the current
Intelligence API — Recommendations Center's contract should be read with
that distinction specifically in mind from the start.
