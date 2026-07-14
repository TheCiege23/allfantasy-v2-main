# Rankings Provider Dependency Inventory

Date: 2026-07-12. Part 6 of the Yahoo Commissioner Import Certification
phase, per the explicit instruction: **do not rewrite Rankings — measure
exactly what blocks it, so a future rewrite has a real foundation.** Every
item below is a direct source citation from `lib/rankings-engine/league-rankings-v2.ts`
and its imports, not an inference.

## Finding: the coupling is deeper than "wrong table" — it's a live-API bypass

`lib/rankings-engine/league-rankings-v2.ts` imports directly from
`lib/sleeper-client.ts` (the raw Sleeper API client) for:

```ts
import {
  getPlayoffBracket,
  getLeagueDrafts,
  getDraftPicks,
  ...
} from '../sleeper-client'
```

and from a Sleeper-branded cache module:

```ts
import { getWeekStatsFromCache } from './sleeper-matchup-cache'
```

`sleeper-matchup-cache.ts` itself directly calls `getLeagueMatchups` from
`lib/sleeper-client.ts`. This means Rankings does not read a
provider-normalized "matchups" concept at all — it reads Sleeper's live API
response shape directly, for weekly scores, draft results, and playoff
brackets. This exactly matches a previously-identified, unrelated
architectural bug in this codebase
(`docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md`: *"`league-context-assembler.ts`
bypasses the adapter layer entirely and imports `lib/sleeper-client.ts`
directly"*) — Rankings has the identical bypass pattern, independently
confirmed here.

## Dependency inventory

| Dependency | Where | Coupling type | Blast radius if genericized |
|---|---|---|---|
| Sleeper numeric `roster_id` as the primary key | Throughout `league-rankings-v2.ts` (`Map<number, RosterRecord>`, `weeklyPointsByRoster`, `rosterRecords`, `dbRosterRecords`, ~15+ call sites) | **Structural** — every downstream computation (expected wins, strength of schedule, trade efficiency, draft-gain percentile) is keyed by this number | Would require re-typing the entire roster-record model and every function signature that consumes it |
| Live Sleeper matchup fetch (`getLeagueMatchups`) | `sleeper-matchup-cache.ts` → `getWeekStatsFromCache` | **Data source** — not a cache of canonical data, a cache of Sleeper's own API response | Weekly scoring for a non-Sleeper league has no equivalent source today |
| Live Sleeper draft fetch (`getLeagueDrafts`, `getDraftPicks`) | `league-rankings-v2.ts` ~line 2830, 2849 | **Data source** | Draft-gain percentile computation has no non-Sleeper equivalent |
| Live Sleeper playoff bracket fetch (`getPlayoffBracket`) | `league-rankings-v2.ts` ~line 2828 | **Data source** | Playoff-finish bonus computation has no non-Sleeper equivalent |
| `legacyLeague`/`legacyRoster` tables | `fetchLeagueSettings`/`fetchRosterRecords`, keyed by `sleeperLeagueId` | **Cache/fallback**, not primary | Genuinely swappable — this part alone *was* the "shallow fix" the prior phase considered and correctly rejected as insufficient on its own |
| `lib/leagues/leagueListFilter.ts`-style "unified League" cross-reference | `fetchUnifiedLeagueTeamMeta` (prior phase's finding, re-confirmed present) | **Secondary, already provider-agnostic in shape** | Already reads canonical `League`/`LeagueTeam` — the one piece already pointed the right direction |
| Trade efficiency computation | Reads real Sleeper transaction history via the same live-API pattern | **Data source** | No canonical, provider-agnostic trade-history read path is wired to Rankings today |

## What would NOT need to change

`snapshots.ts` (`getPreviousWeekSnapshots`, `getLeagueSparklines`) has no
direct Sleeper or legacy-table coupling found — it appears to operate on
already-computed ranking output, not raw provider data, so it is likely
reusable as-is once the upstream data becomes provider-agnostic.

## Why this confirms the prior phase's decision

The prior phase found "Rankings reads legacy tables" and, on deeper
investigation this phase, that was actually the *smaller* half of the real
problem. The full picture: Rankings has **three independent live-Sleeper-API
call sites** (matchups, drafts, playoff brackets) plus a **structural
`roster_id`-keyed data model** that assumes Sleeper's numbering scheme
everywhere downstream. A real fix requires:

1. A provider-agnostic "weekly team score" read path (does not exist today
   — the canonical `TeamPerformance`/`RedraftMatchup` models this program's
   other work already populates may be the right foundation, but were not
   evaluated for Rankings' specific needs this phase).
2. A provider-agnostic draft-results read path for draft-gain percentile.
3. A provider-agnostic playoff-finish read path.
4. Re-keying the entire roster-record model away from Sleeper's `roster_id`
   to canonical `Roster`/`RedraftRoster` ids.

This is a genuine, multi-week rewrite with real regression risk to a
user-facing, real-traffic feature — correctly out of scope for a "minimum
safe migration," and correctly deferred to its own dedicated phase using
this inventory as the starting brief.
