# Truthfulness Audit (Phase 33)

Per this phase's explicit mandate: for every customer-facing recommendation, verify it correctly communicates last-updated time, confidence, missing data, stale data, fallback mode, unavailable providers, and approximation vs. real data. Identify any UI or API that could unintentionally overstate certainty.

## Finding 1 (HIGH SEVERITY, disclosed not fixed): the real matchup-center service mislabels "no data" as "bye"

**Location:** `server/services/matchupCenterService.ts:207-209`, `resolveGenericMatchupContext()`.

```ts
const oppRosterId = myResult?.opponentRosterId ?? null
if (!oppRosterId) return { kind: 'bye', selected }
```

`myResult` comes from `prisma.teamWeekResult.findUnique(...)`. **`TeamWeekResult` has zero rows in the entire `.env.test` database** (confirmed via direct count). This means: for any real league that reaches this code path, `myResult` is always `null`, `oppRosterId` is always `null`, and the function unconditionally returns `kind: 'bye'` — **regardless of whether the team actually has a bye that week or the platform simply has no matchup data for that league/week.**

**Why this overstates certainty:** "Bye" is a specific, confident claim — it tells the user "you have no game this week, that's expected." The true state in this case is "we don't have your matchup data" — a data-availability gap, not a real schedule fact. A real user viewing a real Sleeper league's Matchup Center today would see a bye-week UI state when the honest state is "unavailable." This directly matches Part 4's ask: "Identify any UI or API that could unintentionally overstate certainty."

**Verified real-world impact:** confirmed via real (unmocked) execution of `buildLeagueGameDayContext` against a real Sleeper league — returned `{matchupState: "bye", unavailableReason: null, hasMatchup: true}`, with `MatchupStateNormalizer.ts` (correctly, per its own logic) passing the mislabeled "bye" straight through as a confident state rather than "unavailable," since the mislabeling happens upstream, before the normalizer ever sees it.

**Disclosed, not fixed this phase:** `matchupCenterService.ts` is a live, real, high-traffic production file (backs the real Matchup Center API route and UI used by real players) — a fix here has real production blast radius, unlike a fix inside Game Day OS's own unused shadow module. Per this project's established practice for high-blast-radius findings surfaced during an audit phase, this is reported prominently rather than patched in the same pass as the audit. **Recommended as the top priority for a dedicated follow-up phase** (see Phase 34 prompt).

## Finding 2 (MEDIUM, fixed this phase): cross-league exposure silently undercounted real players

Covered fully in the Real Data Validation Report. From a truthfulness lens: before the fix, `UserPlayerExposureService` would report a real user's cross-league exposure as "1 player, 0 shared across leagues" when the true count was 53 players / 4 shared — a real, severe understatement of a user's actual fantasy footprint, with no accompanying "this data may be incomplete" signal. Fixed this phase (see Real Data Validation Report).

## Finding 3 (LOW, disclosed, matches existing self-disclosure): injury data has two disconnected real sources

`SportsInjury` (1,025 real rows, 458 NFL, real player names/statuses) is a real, populated, apparently-unused-by-Matchup-Center table. The matchup-center path instead reads injury status from `statLine` JSON, backed by the empty `FantasyStatLine` table. **Practical effect:** even though real injury data genuinely exists in the database, Matchup Center's injury display would show nothing for it today, because it's reading from the wrong (empty) source. This wasn't investigated further this phase (would require confirming which UI actually consumes `SportsInjury` directly, if any) — flagged for a future phase.

## What already correctly communicates uncertainty (verified, not assumed)

- `GameDayContextAssembler.ts` — returns an honest `unavailableReason` and `matchupState: 'unavailable'` when a league genuinely isn't found (verified: this specific path IS honest; the "bye" mislabeling above is a separate upstream issue it inherits, not one it introduces).
- `MatchupStateNormalizer.ts` — has a real 15-minute staleness threshold that forces a `stale` state override; deliberately does NOT infer `final`/`postponed`/`cancelled` from clock time alone, trusting only upstream provider-derived status (a real, disclosed, conservative design choice that avoids fabricating certainty).
- `GameDayDivergenceAnalyzer.ts` — explicitly discloses (in its own comments, independently verified true by reading the function) that 7 of its 10 declared divergence categories are never produced, rather than silently claiming full coverage.
- `computeGameWindows` — returns an honest empty array when `FantasyScheduleGame` has no rows, confirmed via real execution; does not fabricate windows.
- `README.md`'s "Historical replay" section explicitly states lineup/roster state is NOT replayable for past weeks and that calling the module for a past week reflects the CURRENT roster, not the historical one — a real, upfront disclosure preventing a plausible overstatement-of-certainty mistake.

## Summary

Of the surfaces audited, one real, high-impact truthfulness issue was found in live production code (Finding 1), one real data-completeness issue was found and fixed in Game Day OS's own code (Finding 2), and one disconnected-data-source issue was flagged for further investigation (Finding 3). Game Day OS's own shadow-mode code otherwise already practices good truthfulness discipline — multiple deliberate design choices exist specifically to avoid overstating certainty, and are honest about their own coverage gaps in their own comments.
