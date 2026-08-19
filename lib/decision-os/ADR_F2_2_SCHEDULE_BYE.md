# ADR-DOS-F2.2 — Canonical Enrichment: Schedule / Bye Weeks

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.2** — additive only. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`ADR_F2_1_PLAYER_METADATA.md`), Phase 1 freeze.

---

## 1. Goal

Expose deterministic schedule / bye context as a **read-only derived enrichment layer**:

- player team schedule context
- team bye week
- current game week context when available
- opponent / home-away / status when available
- provenance / freshness / completeness / uncertainty

This layer must remain origin-blind, provider-agnostic in decision-facing facts, and must degrade honestly
when persisted schedule data is incomplete.

## 2. Freeze compliance — why this is ADDITIVE

The frozen `CanonicalWorld` still carries ids only. F2.1 already established the approved Phase-2 pattern:
derive richer facts beside the pure world instead of mutating it. F2.2 follows that same pattern:

- no writes
- no change to the pure assembler
- no provider-specific rule logic
- no new storage for Canonical World
- no live API calls
- no cache warming

Per `ARCHITECTURE_FREEZE.md`, new read-only persisted-data seams and new deterministic derived facts are
explicitly allowed.

## 3. Decision

Add a second derived view on top of F2.1:

- `lib/decision-os/world/scheduleBye.ts`
  - pure `projectScheduleContext(rows, input)`
  - read-only `resolveScheduleContext(...)`
  - pure `projectScheduleEnrichedWorld(enrichedWorld, scheduleContext)`
  - read-only `resolveScheduleEnrichedCanonicalWorld(leagueId, deps?)`
- `loadScheduleGameRows(...)` in `world/port.ts`

The data source order is:

1. `FantasyScheduleGame` (preferred; carries source + fetchedAt + expiresAt)
2. `GameSchedule` (fallback; carries updatedAt)

Both are already-persisted caches. The first normalized matchup row wins, so the richer fantasy cache shadows
the generic schedule cache when both exist.

## 4. Field scope & honest degradation

| Field | Source | Degradation |
|---|---|---|
| team | F2.1 metadata-enriched player team | null + `team_unavailable` when metadata has no team |
| current game week context | season schedule rows for `world.league.currentWeek` | null + `current_week_schedule_unavailable` / `current_week_out_of_schedule_range` |
| opponent | matching home/away row | null when no matching game row |
| homeAway | matching home/away row | null when no matching game row |
| game status | schedule row status if persisted | null + `game_status_unavailable` when absent |
| bye week | derived from a **single unique** in-window schedule gap | null + `bye_week_unresolved` or `bye_week_ambiguous` |
| freshness | `expiresAt` / `fetchedAt` from `FantasyScheduleGame`, `updatedAt` from `GameSchedule` | unknown + `schedule_freshness_unavailable` when not carried |
| provenance | source model + source string | null when unresolved |

Important rule: a missing current-week game becomes `isByeWeek=true` **only when** the season cache already
contains that week and the team has other season rows. No guessed byes.

## 5. Rejected alternative

Rejected: put schedule/bye fields directly into `CanonicalWorld` / `RosterFacts`.

Why rejected:

- that would mutate a frozen fact contract
- it would push persisted IO-derived facts into the pure layer
- it would collapse the Phase-2 derived-view boundary already established by F2.1

## 6. Deliverables

1. This ADR.
2. Additive schedule/bye derived view + read-only port.
3. Tests for:
   - current-week schedule resolution
   - bye inference
   - ambiguity / missing-data degradation
   - provenance / freshness
   - no mutation
   - no prisma / no writes in the derived module
4. Re-run conformance scripts to prove frozen Phase-1 invariants still hold.
5. Document real-data gaps.

## 7. Real-data coverage gaps to surface honestly

Known gaps the implementation must report instead of hiding:

- **Metadata dependency:** F2.2 depends on F2.1 team resolution. If player team metadata is absent, schedule
  context must stay unresolved.
- **Partial schedule caches:** if the persisted season rows do not yet contain the current week, the layer
  must report `current_week_out_of_schedule_range`, not guess.
- **Ambiguous bye gaps:** if a team has multiple in-window missing weeks (common with partial or irregular
  college schedules), `byeWeek` stays null with `bye_week_ambiguous`.
- **Fallback freshness:** `GameSchedule` fallback may lack fetched/expires timestamps; freshness must then be
  marked unknown rather than invented.
- **Source inconsistency:** if cached team strings do not normalize to the metadata team, the layer must
  degrade to unresolved schedule context instead of alias-guessing beyond the existing team normalization.

## 8. Success

Deterministic schedule / bye facts are available where persisted data supports them, every missing field
degrades honestly, and all Phase-1 frozen invariants remain intact.

## 9. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.

## 10. Real-run results (non-prod `ep-winter-salad`, 2026-06-30)

All five conformance scripts GREEN on both leagues (imported Sleeper `50d5c56d…` + native manual
`dfa9d61d…`): `WORLD_CONFORMANCE_OK`, `LINEUP_CONFORMANCE_OK`, `WAIVER_CONFORMANCE_OK`,
`COMMISSIONER_CONFORMANCE_OK`, `TRADE_CONFORMANCE_OK`. Tests: 11 green
(`canonical-world-schedule-enrichment.test.ts`); full decision-os suite 352 passed / 2 failed (same
pre-existing `lineup-shadow-route` failures — unrelated).

Schedule/bye coverage on non-prod (`resolveScheduleEnrichedCanonicalWorld`):

| League | provider | sport | season | currentWeek | teams req. | resolved | completeness |
|---|---|---|---|---|---|---|---|
| KBI Smoke Black (`50d5c56d…`) | sleeper | NFL | 2024 | 18 | 32 | 0 | **0%** |
| `dfa9d61d…` | manual | NFL | 2026 | null | 0 | 0 | **0% (no player teams)** |

**Coverage gap (honest degrade — same class as F2.1 `tc-nfl-league` 0/40):** The
`FantasyScheduleGame` / `GameSchedule` schedule cache tables are empty in this staging DB — no
schedule rows for NFL 2024 or 2026 have been imported. The enrichment logic degrades correctly:
`schedule_cache_missing_for_requested_team` per team, completeness=0, no fabrication. Coverage depends
on the cron import path populating those tables; it is NOT an enrichment-logic change. The `dfa9d61d`
native league has no resolved player teams (0/0) so `schedule_teams_unavailable` fires before any
schedule lookup — also honest.

The two critical design properties held empirically:
- All five Phase-1 shadow parity checks still GREEN → F2.2 is genuinely additive (no regressions).
- Honest degrade is confirmed on real data — no fabricated schedule facts emitted when the cache is empty.
