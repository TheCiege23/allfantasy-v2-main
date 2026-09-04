# League Health Live Integration Report — Phase 3.5

Second production-grade live Commissioner OS module, following Mission
Control's exact established pattern
([`MISSION_CONTROL_COMPLETION_REPORT.md`](MISSION_CONTROL_COMPLETION_REPORT.md)).
Scope held to League Health only. No adapter contract, UI file, or public
interface changed.

## Why this completion is more partial than Mission Control's

Before writing any code, each of League Health's 4 methods was checked
field-by-field against what Decision OS's real output (including every
Phase 3.3 addition) can actually back — the same rigor Phase 3.2 applied
to Mission Control. Only one of the four has no field with a missing
real-data analog:

| Method | Verdict | Why |
|---|---|---|
| `getHealthDetail()` | **Stays placeholder** | `baseline`/`deductions` imply a baseline-minus-deductions scoring model; the real score is one computed number with no such decomposition — inventing one would present a false causal story. `subScores.retention`/`.competitiveBalance` have no analog: `retentionRisk` is a category, not a number, and no competitive-balance/standings signal exists anywhere in behavioral intelligence. |
| `getRisks()` | **Stays placeholder** | `ageInDays`/`status: 'new'|'ongoing'|'resolving'` imply persisted risk-lifecycle tracking. Decision OS's recommendations are recomputed fresh from the current event window every request — there is no "first identified" timestamp or status machine anywhere. |
| `getEvidence()` | **✅ Fully wired** | `{ label, detail }[]` has no rigid schema beyond free text — Phase 3.3's `healthNarrative` (`engagementSummary`/`topConcern`/`standoutSignal`) maps onto it directly and completely. |
| `getRecommendations()` | **Stays placeholder** | `confidence`/`expectedImpact`/`primaryActionLabel`/`status` have no per-recommendation analog. `completeness` exists but is a *league-wide data-quality* score, not a *per-recommendation confidence* signal — presenting one as the other would conflate two different concepts under an inference dressed up as real data. |

This is not a shortfall in the implementation — it's the honest, correct
outcome given what's real today, and it's exactly what this phase's own
"Graceful Degradation" instructions anticipated ("never fabricate
metrics"). Inventing the missing fields would have required new backend
capabilities, which this phase explicitly forbids.

## Backend Endpoints Consumed

| Method | Endpoint |
|---|---|
| `getEvidence()` | `GET /api/v1/intelligence/league?leagueId=` (reads only the `healthNarrative` field) |
| `getHealthDetail()`, `getRisks()`, `getRecommendations()` | None — unchanged placeholder |

## Adapter Verification

`lib/commissioner-os/adapter/index.ts`, `adapter/types.ts`,
`league-health/decision-os-client/types.ts` — untouched, confirmed via
file modification timestamps (git diff remains uninformative here; see
the Repository Hygiene section of
[`DECISION_OS_PRODUCTION_READINESS_REPORT.md`](DECISION_OS_PRODUCTION_READINESS_REPORT.md)).
The adapter's `buildLeagueHealthAdapter` still calls
`client.getHealthDetail()`/`.getRisks()`/`.getEvidence()`/`.getRecommendations()`
exactly as before; `wrapMethod`'s pipeline applies identically. Zero UI
files under `components/commissioner-os/league-health/` or
`app/commissioner-os/league-health/page.tsx` touched.

## Live Metrics Verification

`getEvidence()`'s real path was verified against 3 scenarios: only
`engagementSummary` present (1 evidence point), all 3 narrative fields
present (3 evidence points, in a fixed, stable order — Engagement
Summary, Top Concern, Standout Signal), and a real transport failure
(passed straight through, unmodified). No fabricated evidence point is
ever produced — the list length is always exactly the number of
non-null narrative fields.

## Files Modified

| File | Change |
|---|---|
| `lib/commissioner-os/league-health/decision-os-client/live.ts` | `getEvidence()` wired to real `/league` data; `resolveActiveLeagueId()` duplicated from Mission Control's `live.ts` (following the established pattern exactly, not extracting a shared helper yet — see note below); other 3 methods unchanged |
| `__tests__/commissioner-os-league-health-live-integration.test.ts` | New — 10 tests |

Nothing else. `adapter/**`, `league-health/decision-os-client/types.ts`,
`stub.ts`, `demo.ts`, and every UI file remain byte-identical to before
this phase.

**Note on duplication**: `resolveActiveLeagueId()` now exists verbatim in
both Mission Control's and League Health's `live.ts`. This phase's
instructions were to follow Mission Control's pattern exactly, not to
refactor it — a second small, self-contained copy is a smaller, safer
change than introducing a new shared module would be. Worth extracting
into a shared helper once a third module needs the same resolution
(Manager Intelligence, most likely, given the roadmap) — flagged here,
not acted on.

## Regression Results

| Suite | Result |
|---|---|
| `commissioner-os-league-health-live-integration.test.ts` | 10/10 passing |
| Full Commissioner OS suite (24 files) | **329/329 passing** |
| Decision OS behavioral suite (port worktree, unaffected — confirmed) | 696/696 passing |
| Full-repo typecheck | **3156 — exact established baseline**, zero new errors |

## Remaining Placeholders

- `getHealthDetail()`, `getRisks()`, `getRecommendations()` — all 3 stay
  on the honest placeholder indefinitely, not because of a missing
  `isLiveReady` flag or missing league resolution, but because the
  backend genuinely does not compute the specific fields their contracts
  require. Closing this gap would require Decision OS to add: a
  transparent score-breakdown model (baseline + deductions), numeric
  retention/competitive-balance sub-scores, persisted risk-lifecycle
  tracking, and richer per-recommendation confidence/impact/action
  metadata — all of which are new backend capabilities, explicitly out of
  this phase's scope.
- `getEvidence()` itself still requires `isLiveReady('league-health')` to
  be explicitly turned on (off in every environment today, same as every
  other module's flag).
- No live Postgres exists in this sandbox — consistent with every prior
  phase's disclosed condition.

## Readiness for Manager Intelligence

The pattern continues to hold: check `isLiveReady`, resolve any needed
context, call `callDecisionOS` with locally-declared minimal wire-shape
types, construct a real result only when the target contract's fields
have genuine backend analogs, and leave every field without one on the
honest placeholder rather than invent a mapping. Before starting Manager
Intelligence, the single most useful next step is the same kind of
field-by-field mapping done here and in Phase 3.2 — `ManagerBehavioralIntelligence`
and the new `/league/managers` endpoint likely cover more of Manager
Intelligence's contract than League Health's richer, score-breakdown-style
contract could ever cover, but that should be verified against Manager
Intelligence's actual `types.ts`, not assumed from this phase's outcome.
