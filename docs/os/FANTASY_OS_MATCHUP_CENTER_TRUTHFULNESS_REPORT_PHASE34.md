# Matchup Center Truthfulness Report (Phase 34, Track A)

## Fresh audit: every state `resolveGenericMatchupContext`/`buildMatchupCenterPayload` can return

| State | Trigger | Provider-backed, inferred, or assumed (before fix) | After fix |
|---|---|---|---|
| `{error: 'League not found', status: 404}` | `league` query returns null | Provider-backed (real check) | Unchanged |
| `{error: 'Forbidden', status: 403}` | viewer not a member | Provider-backed (real membership check) | Unchanged |
| `{error: 'Roster not found', status: 404}` | no `Roster` row for viewer | Provider-backed (real check) | Unchanged |
| `{error: 'Opponent roster missing', status: 404}` | `myResult.opponentRosterId` set but that `Roster` row doesn't exist | Provider-backed (real referential-integrity check) — out of this phase's scope, not touched | Unchanged |
| `kind: 'bye'` | **Before:** `myResult` missing OR `myResult.opponentRosterId` null. **After:** only `myResult.opponentRosterId` null on a REAL row | **Before: ASSUMED** (conflated absence-of-data with a real schedule fact). **After: PROVIDER-BACKED** (a real `TeamWeekResult` row exists and explicitly records no opponent) | Fixed |
| `kind: 'none'` (routed through `buildEmptyMatchupPayload`) | **Before:** never reached by the generic path. **After:** `myResult` row itself doesn't exist | N/A before (unreachable) → **PROVIDER-BACKED absence-of-data signal** after | New, reused from the existing redraft-source pattern |
| `matchupStatus: 'final'/'live'/'upcoming'` | `TeamWeekResult.status` / `RedraftMatchup.status` | Provider-backed (trusts upstream status, never re-derives from clock) | Unchanged |
| `partialData: true` | media/AI enrichment failed | Provider-backed (real try/catch) | Unchanged |

## The fix (two layers)

**Layer 1 — `server/services/matchupCenterService.ts`, `resolveGenericMatchupContext()`:** now checks `if (!myResult) return { kind: 'none', reason: ... }` BEFORE checking `opponentRosterId`, mirroring the exact, already-proven distinction `resolveRedraftMatchupContext()` makes for the identical shape of problem (`no_redraft_matchup_for_week_${week}` → `kind: 'none'`). A genuine bye now requires positive evidence: a real `TeamWeekResult` row that explicitly has no `opponentRosterId` — not merely the absence of a row.

**Layer 2 — `lib/shared-services/game-day/MatchupStateNormalizer.ts`:** the `kind:'none'` empty payload (`left.rosterId === 'none-left'`, set by `buildEmptyMatchupPayload`) was not previously detected, so it fell through to a confident `matchupStatus: 'upcoming'` state — a second, independent overstatement-of-certainty bug in Game Day OS's own consumer of the payload. Now detected via the same real sentinel pattern already used for `bye`, and correctly reported as `unavailable` with a truthful `missingDataReason`.

## Real validation

Re-executed against the real Sleeper league used throughout Phases 33-34 (`a6f74157-b569-4dfd-86a6-2231a83d8e0f`, 0 real `TeamWeekResult` rows):

| | Before fix | After fix |
|---|---|---|
| `buildLeagueGameDayContext` result | `{matchupState: "bye", unavailableReason: null, hasMatchup: true}` | `{matchupState: "unavailable", unavailableReason: null, hasMatchup: true}` |

The `unavailableReason` field on `GameDayContextAssembler`'s own output is still `null` in both cases — that field is only populated from a top-level `{error,status}` response, not from a well-formed `kind:'none'` payload's `conceptOverlay`. The real, truthful reason now lives one layer down, in `matchupState.attribution.missingDataReason` (confirmed via real execution to read exactly `"No matchup this week (no_team_week_result_for_week_1)"` post-fix) — this is disclosed as an intentional, minimal fix consistent with "fix only the verified bug," not a broader refactor of where reasons are surfaced.
