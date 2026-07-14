# Updated Matchup State Contract (Phase 34)

## `MatchupContextResult` (`server/services/matchupSources/types.ts`) — unchanged shape, corrected semantics

```ts
type MatchupContextResult =
  | { kind: 'matchup'; selected: MatchupSideContext; opponent: MatchupSideContext }
  | { kind: 'bye'; selected: MatchupSideContext }
  | { kind: 'none'; reason: string }
```

| `kind` | Contract (as of Phase 34) |
|---|---|
| `matchup` | Both sides resolved from real data. |
| `bye` | **Requires positive evidence.** A real scheduling row exists (`TeamWeekResult` for the generic source, `RedraftMatchup` for the redraft source) that explicitly names no opponent for this roster/week. Never returned merely because a row is absent. |
| `none` | The engine could not find the scheduling data needed to determine a matchup at all (no row exists). Always carries a machine-readable `reason` string. Never silently rendered as `bye` or any other confident state. |

Both real sources (`resolveRedraftMatchupContext`, `resolveGenericMatchupContext`) now implement this contract identically — Phase 34 brought the generic source in line with the redraft source's pre-existing, correct behavior; it did not change the contract itself.

## `GameDayMatchupState` (`lib/shared-services/game-day/types.ts`) — unchanged enum, corrected detection

| State | Detected via | Change this phase |
|---|---|---|
| `unavailable` | `unavailableReason` set (top-level error) **OR** `matchup === null` **OR** (new) `matchup.left.rosterId === 'none-left'` | Added the third detection branch |
| `bye` | `matchup.right.rosterId === 'bye'` | Unchanged (now only reachable with positive evidence, per the upstream fix) |
| `upcoming` / `live` / `final` | `matchup.matchupStatus` | Unchanged |
| `stale` | age-based override, 15-minute threshold | Unchanged |
| `unsupported` | any other status string | Unchanged |

## Reason string vocabulary (new, minimal)

- `no_team_week_result_for_week_${week}` — generic source, no `TeamWeekResult` row.
- `no_redraft_roster_for_viewer` — redraft source, pre-existing.
- `no_redraft_matchup_for_week_${week}` — redraft source, pre-existing.

No new top-level state was added to either enum — the fix is a detection correction within the existing contract, not a contract redesign, per this phase's guardrail ("preserve public APIs").
