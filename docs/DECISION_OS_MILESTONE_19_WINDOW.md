# Decision OS — Milestone 19 build result (competitive-window resolver)

Continuation of the Codex build recorded in `DECISION_OS_V2_BUILD_STATUS.md` (34%, 17/50).
This implements the audit's **P0 repair #4** and checklist **milestone 19**: one
competitive-window resolver built from roster strength, record, schedule luck, injuries,
future picks and playoff probability, with hysteresis.

**Status: milestone 19 is still NOT complete, and the reason is specific.** The resolver,
the Prisma-backed fact port, the decision layer and the consumer seam are implemented and
tested. Two things are missing, and neither is cosmetic:

1. **No production path populates the window yet.** `TradeValueContext.teamWindowV2`
   exists and `buildValueV2Shadow` consumes it, but nothing in a live request path calls
   `resolveWindowDecision` to supply one. The seam is proven by test, not by traffic.
2. **The Prisma port has never executed against a real database.** Its tests drive a
   repository-shaped fake that applies the same `where` clauses; that catches a forgotten
   filter, but it is not the test-database verification this checklist required for
   milestones 14 and 35.

**Progress therefore remains 34%.** Partial implementations earn no points.

## Files added

| File | Role |
| --- | --- |
| `lib/decision-os/value-v2/window.ts` | Deterministic resolver, versioned coefficients, hysteresis state machine |
| `lib/decision-os/value-v2/windowFacts.ts` | Fact assembler and refusal gates, behind a port |
| `lib/decision-os/value-v2/windowFactsPrismaPort.ts` | Prisma implementation over existing models |
| `lib/decision-os/value-v2/windowDecision.ts` | Three decision states, hysteresis reconstruction, team-fit weighting |
| `__tests__/decision-os/value-v2-window.test.ts` | 32 tests |
| `__tests__/decision-os/value-v2-window-facts.test.ts` | 16 tests |
| `__tests__/decision-os/value-v2-window-prisma-port.test.ts` | 27 tests, including the fixtures-to-decision integration test |
| `__tests__/decision-os/value-v2-window-consumer.test.ts` | 16 tests |

Changed: `lib/decision-os/value-v2/shadow.ts` (consumes the window), `lib/trade-value/types.ts`
(`teamWindowV2` on the context).

## Prisma models and fields read

Read-only. No writes, no provider calls, no migration.

| Model | Fields |
| --- | --- |
| `WeeklyMatchup` | `leagueId`, `seasonYear`, `rosterId`, `week`, `pointsFor`, `pointsAgainst`, `win` |
| `LeagueTeam` | `leagueId`, `externalId`, `teamName`, `ownerName` |
| `SeasonForecastSnapshot` | `leagueId`, `season`, `week`, `teamForecasts`, `generatedAt` |
| `DynastyProjectionSnapshot` | `leagueId`, `teamId`, `season`, `projectedStrength3Years`, `projectedStrengthNextYear`, `windowStartYear`, `windowEndYear`, `confidenceScore`, `generatedAt` |
| `SportsPlayer` | via F2.3 `loadInjuryContextRows` — injected, not queried here |

⚠ `WeeklyMatchup.leagueId` holds the **platform** league id, not `League.id`. It is a
separate required input to the port rather than something inferred, because passing the
AllFantasy id returns zero rows and a team that looks like it has never played.

## Injury source, and why

**`SportsPlayer`, reached through Decision OS F2.3** (`world/injuryEnrichedWorld.ts`,
`loadInjuryContextRows` in `world/port.ts`).

It is authoritative because it is the only injury feed keyed on the **same player ids as
canonical rosters**. `InjuryReportRecord` and `InjuryReport` are keyed on API-Sports ids —
a different namespace — and F2.3's own header plus `ADR_F2_3_INJURY_STATUS.md` §2 record
that practice status, game status and body part are therefore unavailable and are held
null rather than invented. **The three feeds are not merged**; doing so would mis-join
silently.

What that source can support is an availability **category**, not a player value. The
share is therefore a count over the covered roster and is named for what it is —
`unavailableShare`, basis
`sportsplayer-availability-category:unavailable-share-of-covered-roster` — rather than a
value-weighted starter figure the source cannot produce. Coverage below 50% refuses
(`injury_coverage_below_floor`): a share of a fifth of a roster is not a roster's share.
No roster resolving at all refuses too, and is never read as healthy.

`treatment` is `'excluded'`, because the AF projection path applies injury designation to
*confidence* and not to the projected points the forecast simulates (audit §5.2), so the
stored playoff probability has not already priced it. The resolver's `injuryTreatment`
discriminator exists precisely so this cannot be double-counted.

## How weekly hysteresis history is obtained

**Reconstructed from dated weekly artifacts. No new table, no migration.**

`WeeklyMatchup` carries a week, so the all-play record as of week W-2 is real history —
`allPlayAsOfWeek` recomputes it under the same week gate the live board uses (a week
nobody scored has not been played). `SeasonForecastSnapshot` is keyed
`(leagueId, season, week)`, so the playoff probability believed at each week is a real
dated artifact.

The existing `TeamWindowProfile` model was considered and rejected: it is unique on
`(leagueId, teamId, season)` with **no week column**, so it cannot hold weekly history.

⚠ **Two inputs do not vary by week, and the gap says so.**
`DynastyProjectionSnapshot` is keyed per season and the injury load is current-only, so
both historical observations carry today's figures. Every decision carries
`hysteresis_history_reconstructed_not_stored`. The effect is bounded — the future half is
constant across the window either way, and the injury term scales only the playoff half —
but a reconstruction is not the same artifact a stored weekly classification would be.

## Three states, kept distinct

| State | Meaning |
| --- | --- |
| `evidenced` | This week's evidence resolved and agrees with the settled window |
| `held` | This week's evidence resolved and **disagrees**, but has not persisted for three weeks. The held window applies |
| `refused` | Required evidence missing or stale. `status: null`, neutral weighting, gaps named |

`refused` never becomes `'competitive'`. That is the exact defect this replaces:
`WindowDetectionEngine.classifyWindowStatus` returns `'Competitive'` from its final
branch, so a team with no evidence and a genuinely middling team are the same output.

## Team fit never touches market value

`teamFitFor` returns multipliers on **team fit only**: contender 1.15 win-now / 0.90
long-term, rebuilding the inverse, rising a mild long-term lean, and **neutral for
`competitive`, `declining` and every unresolved case**. `declining` is deliberately
neutral — a closing window argues both for buying now and for retooling, and picking one
would be a preference asserted as a finding.

A regression proves the separation directly: the same assets priced under a contender and
under a rebuilder produce **byte-identical `assets` payloads**, while `teamFit` differs.

## Validation — all judged by exit code

| Check | Command exit | Result |
| --- | --- | --- |
| Four window suites | 0 | **91 passed** (32 + 16 + 27 + 16) |
| Committed subset alone | 0 | **75 passed** in 3 suites |
| Decision OS regression | 0 | **238 files passed, 4 skipped; 4,155 tests passed, 87 skipped, 0 failed** |
| Focused typecheck | 0 | **120 files** |

⚠ `grep "error TS"` is NOT the typecheck gate. `check-decision-os-v2.mjs` formats with
`formatDiagnosticsWithColorAndContext`, so ANSI escapes sit between `error` and `TS` and
the grep returns 0 on a run that reported real errors. Exit code, or strip escapes first.

**Nine mutations were used to prove the checks can fail**, each confirmed applied, run,
then restored and verified byte-identical with `diff -q`:

| Mutation | Failures |
| --- | --- |
| `WINDOW_PERSISTENCE_WEEKS` 3 → 1 | 3 |
| Earned record ignores `luckWins` | 2 |
| Reinstate the `'competitive'` fall-through in the resolver | 5 |
| Drop the percentage → unit conversion | 2 |
| Drop the forecast staleness gate | 2 |
| Refusal path returns `'competitive'` | 3 |
| Drop the as-of-week filter in the port | 2 |
| Consumer stops surfacing window gaps | 2 |
| Neutral team fit becomes directional | 1 |

A planted type error was reported at `window.ts:259`, proving the typecheck compiles the
new files rather than passing vacuously.

⚠ Running the four suites **together** exposed 11 failures that four individual green runs
had hidden: the older facts suite predated the extended port contract. Per-suite green is
not a suite-set green.

## Migration and backfill

**None required.** No schema change, no backfill. Every model read already exists, and the
hysteresis history is reconstructed rather than stored.

## Remaining gaps

- **No production caller resolves a window.** The highest-value next step, and what would
  actually close this milestone.
- **No database execution.** The port is proven against a repository-shaped fake only.
- **Coefficients are uncalibrated**, labelled `window-structural-1` /
  `uncalibrated-structural`. Calibration is milestone 43.
- **Historical observations carry current dynasty strength and current injuries**, as
  disclosed above.
- **`rosterPlayerIds` and `platformLeagueId` are caller-supplied.** The port does not
  resolve them, so a caller that supplies the wrong one gets a refusal, not a wrong answer
  — but it is still the caller's job.

## Concurrency and commit boundary

Codex's entire V2 foundation is **uncommitted** in this shared checkout: 18 untracked
`value-v2` modules, 77 other untracked files and 142 modified tracked files. On the user's
instruction the commit contains **only the four self-contained new modules and the three
test suites whose imports close over them**. The consumer wiring — `shadow.ts`,
`lib/trade-value/types.ts` and `value-v2-window-consumer.test.ts` — is implemented, passing
and left **uncommitted in the working tree**, to be landed with Codex's foundation.

The shared milestone and status documents were not modified.


---

# Continuation — real database verification, query cost, and the observation model

## Isolated commit, now on a remote

`990606405` was local only. Cherry-picked onto `origin/main` as **`9abefa708`** and pushed
to **`feat/decision-os-milestone-19-window`**. `patch-id` is identical on both
(`d4e5dd862d30abefb01ea8cd9304ed50db0e3cfc`), the branch adds exactly **one** commit beyond
`origin/main`, and `origin/main` is unchanged at `1a43ebbd8`. 88 other local commits — all
Codex's — were deliberately excluded by picking onto `origin/main` rather than pushing the
local branch.

## Codex is still active, so the integration boundary stays closed

Two `codex.exe` processes spawned during this pass and twelve `lib/league-import/*` files
were written three minutes before the check. Every candidate production caller is
modified-uncommitted by that session — `lib/trade-value/snapshot.ts`,
`lib/decision-os/trade/tradeWorld.ts`, `canonicalMemo.ts`,
`runTradeConsoleAnalysis.ts` — and so is `prisma/schema.prisma`. Under the stated rule
(*if Codex is active, do not modify or commit its files*) the production caller, the schema
change and the consumer reconciliation are **blocked, not skipped**.

## A real environment finding: the test database is behind production

`WeeklyMatchup.rosterId` is `integer` on the test database and `String` in
`prisma/schema.prisma`. The generated client therefore **cannot read the table at all** —
a raw insert succeeds and `prisma.weeklyMatchup.findMany` fails with Postgres `08P01
insufficient data left in message`.

This is test-database drift, not a repo defect:
`prisma/migrations-pending/20260903222531_weekly_matchup_roster_id_text`'s README records
it as **"APPLIED TO PRODUCTION 2026-09-03"**. The test database has not had it applied.

Consequence for this milestone: the five assertions that depend on reading real matchup
rows **skip** on this database, gated on a probe. The port's honest degradation under that
failure is asserted instead — it refuses with `all_play_record_missing` rather than
throwing, which is the correct behaviour for a shadow path.

⚠ **The first version of that probe was a check that could not fail.** It queried a
league id with no rows, so Prisma never decoded the integer column and the probe reported
the client as able to read the table. It now probes a row that exists.

## Database verification performed

Endpoint **`ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech`**, named explicitly
from `.env.test`. Distinct from production (`ep-curly-block-ad0dlt9o`) and staging
(`ep-winter-salad-ad34lce8`); the suite asserts the production endpoint is not the target
and logs the host it used. No production credential was read and no production connection
was opened.

`vitest.setup.db-guard.ts` governs the gate: with nothing exported the suite **skips 9/9**
and the production host appears **zero** times in its output. Fixtures are prefixed per run
and removed in `afterAll`; the `AppUser` fixture uses a reserved `.invalid` TLD so a leaked
row can never be deliverable.

**Result: 5 passed, 5 skipped, exit 0.** Passing: endpoint identity; `League.id` passed
where a platform league id is required **refuses** rather than reporting a team with no
history; an unauthorised team id refuses; honest degradation under the drift; injury
coverage below the floor refuses.

## Query cost

Bounded by weeks, never by assets: **15 reads per team per decision** — 3 weeks x
(identity, matchups, forecast, dynasty, injuries). Two teams cost exactly twice that, and
the count is byte-identical for a two-asset and a twenty-asset trade because the resolver
runs per team, not per asset. Pinned by three tests.

## Observation model

Proposed, not implemented — see
[`DECISION_OS_M19_OBSERVATION_MODEL_PROPOSAL.md`](DECISION_OS_M19_OBSERVATION_MODEL_PROPOSAL.md).
`TeamWindowProfile`, `CanonicalDecision`, `DecisionLog`, `SeasonForecastSnapshot` and
`DecisionStrategyState` were each evaluated and each rejected with a stated reason. No
schema file was edited and no migration was created or applied.
