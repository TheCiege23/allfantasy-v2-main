# EFL — TRUE Max PF, durable freeze, and execution

**Date:** 2026-09-10
**Scope:** true optimal-lineup Max PF; durable freeze + audited corrections; `PromotionEngine`
optional settled-plan application; EFL template v1.2.0.
**Status:** all built and tested. **The migration is written and PARKED, not applied.**

Read `PHASE_C0.5_C5_HANDOFF.md` then `EFL_IMPLEMENTATION_HANDOFF.md` first.

---

## 1. Max PF reuse audit — what exists, and why a new optimizer was still needed

| Need | Canonical candidate | Verdict |
|---|---|---|
| Optimal-lineup solver | `lib/bestball/optimizerCore.ts` (`runGreedyOptimizer`) | **Not safe for Max PF — measured.** See below. |
| Sport-specific optimizers | `lib/idp/IdpBestBallOptimizer`, `lib/devy/bestball/…`, `lib/merged-devy-c2c/bestball/…`, `soccerFormationOptimizer` | All wrap the same greedy core or are sport-specific; same defect. |
| Roster-slot eligibility | `getEffectiveLeagueRosterTemplate` → `RosterTemplateDto.slots` (`allowedPositions`, `starterCount`, `slotOrder`) | **Canonical. Reused.** Handles IDP via `idpEnabled`. |
| Scoring | `LeaguePlayerWeeklyScore.points` | **Canonical. Consumed, never recomputed.** |
| Historical roster membership | `LeaguePlayerWeeklyScore.rosterId` + `isStarter`, per week | **Canonical, and it is real fact.** |
| Positions | `SportsPlayer.sleeperId` → `composePlayerIdentities` | **Canonical. Reused** (`sleeperId` is not unique and the duplicates are not copies). |

### 🛑 The Best Ball optimizer is greedy, and the counterexample is not exotic

`runGreedyOptimizer` fills every slot that is not literally named `FLEX` or `UTIL` in a first pass,
**in array order**, taking the highest-scoring eligible player each time. `SUPER_FLEX` is not named
`FLEX`. So:

```
slots   [SUPER_FLEX(QB/RB/WR/TE), QB]
players QB_A 30, RB_B 25, QB_C 5
greedy  SUPER_FLEX <- QB_A(30), QB <- QB_C(5)   = 35
exact   QB <- QB_A(30), SUPER_FLEX <- RB_B(25)  = 55
```

A twenty-point miss on the one number that is supposed to be unmanipulable. **Both answers are
pinned in a test** (`trueMaxPf.test.ts` § 17) so this is a measurement, not a claim.

⚠ **Best Ball itself was NOT changed.** A test asserts `runGreedyOptimizer` still returns what it
always did and still stamps `bestball-greedy-v1`. Repointing Best Ball is a separate, user-visible
decision.

---

## 2. Historical-data sufficiency verdict — ✅ SUFFICIENT, with one honest gap

**✅ Roster membership per week is persisted fact, not inference.** `ingestSleeperPlayerScores`
iterates Sleeper's `players_points`, which is the **whole roster for that matchup week, bench
included**, and writes one row per `(league, season, week, player)` carrying `rosterId` and
`isStarter`. That single property is what makes anti-tanking Max PF computable at all — you need the
bench scores, and they are there.

**✅ Scoring is persisted** as the source platform scored it, under that league's own settings.

**🛑 HISTORICAL LINEUP-SLOT CONFIGURATION IS NOT STORED.** `getEffectiveLeagueRosterTemplate`
resolves the league's **current** seats; nothing versions them by week.

- For **EFL** this is harmless and is stated rather than assumed: a dynasty ladder does not change
  its lineup mid-season, so the current template truthfully describes every regular-season week.
- For **Survivor All-Stars** it would NOT be — that format opens a WRT flex in week 7 and a SUPERFLEX
  in week 9.

So `computeSeasonMaxPf` takes **`slotsForWeek(week)`**, a function. The EFL reader returns the same
seats for every week and reports `provenance.slotsAssumedStatic: true`. The day per-week
configuration is stored, only the reader changes.

**No STOP condition was hit.**

---

## 3. 🛑 A bug shipped in the previous phase, found by this audit

`maxPfFreezeReads.ts` queried `prisma.weeklyMatchup.findMany({ where: { leagueId: input.leagueId } })`
with the AllFantasy `League.id`. **`WeeklyMatchup.leagueId` is the PLATFORM (Sleeper) league id** —
every existing reader passes `league.platformLeagueId` (`leagueStandings.ts`, `leagueSync.ts`,
`matchup.ts`). The query matched **zero rows**, the status resolved to `missing`, and the freeze
would have been permanently unavailable.

⚠ **It failed in the safe direction — no number was fabricated — which is exactly why it could have
survived.** "Not ready yet" is a plausible thing for a league to report. It was found by auditing the
writer, not by any test.

The file is kept as a **deprecated shim** rather than deleted, because published template
`efl_promotion_relegation_dynasty@1.1.0` names it in `composedEngines` and a published version must
not be edited. The path stays truthful and now resolves to the corrected reader.

### Three id spaces meet in `maxPfReads.ts`

```
League.id                          AllFantasy cuid          what callers hold
League.platformLeagueId            Sleeper league id        what the weekly tables key on
LeagueTeam.externalId              Sleeper roster id, TEXT
LeaguePlayerWeeklyScore.rosterId   Sleeper roster id, INT   same concept, different column type
LeaguePlayerWeeklyScore.playerId   Sleeper player id        resolved via SportsPlayer.sleeperId
```

🛑 **An id-space miss does not degrade this metric, it INVERTS it.** An unmatched roster sums to
**zero**, and in a *reverse* Max PF order zero is the **first pick**. Unmatched ids are therefore
reported (`provenance.unmatchedRosterIds`, `unresolvedPlayerIds`), never swallowed.

---

## 4. TRUE Max PF architecture

```
lib/lineup-optimizer/optimalLineup.ts     WHICH players sit in which seats. Exact. League-agnostic.
lib/commissioner-os/efl/maxPfEngine.ts    one week -> one value per team; then the season aggregate
lib/commissioner-os/efl/maxPfReads.ts     DB-first: rosters, positions, seats, provenance
lib/commissioner-os/efl/maxPfFreeze.ts    the week ceiling, the fingerprint, the state machine
lib/commissioner-os/efl/freezeStore.ts    durable write-once + append-only corrections
```

### The algorithm, and why it is provably optimal

A player's value **does not depend on which slot he fills** — a 20-point RB is worth 20 in RB and 20
in FLEX. That makes the legally-seatable sets a **transversal matroid**, and for a matroid the greedy
algorithm (descending weight, keep whenever the set stays independent) yields a maximum-weight basis.

So: sort players descending, and seat each via an **augmenting path** (Kuhn's bipartite matching)
that may **re-seat** players already placed. That cascade is what a per-slot greedy cannot do.

⚠ **Because every player is tried, the result is also a maximum-CARDINALITY matching.** That matters
with negative scores (IDP, a three-interception QB): a required seat still gets filled, and the
negative player is seated last, only when no positive player could take it.

**Determinism:** ties break on `playerId`; seats are ordered by `slotOrder` then name. The total does
not depend on slot array order (asserted).

### Metric names were changed so they cannot be confused

| Old | New | Meaning |
|---|---|---|
| `regular_season_points_for` | `actual_points_for` | Points the submitted lineup scored. **Not Max PF.** |
| `regular_season_optimal_lineup` | `optimal_lineup_max_pf` | The maximum legally possible. **THE metric.** |

Every snapshot also carries `computationVersion`
(`maxpf-optimal-v1+exact-transversal-matroid-v1`), which is part of the fingerprint **and** of the
freeze's uniqueness key. Two engines that both call their output "Max PF" can never occupy the same
row and be silently compared.

---

## 5. Data provenance

`MaxPfDataProvenance` is returned with every read:

- `scoringSource` — `LeaguePlayerWeeklyScore.points` (as the source platform scored it)
- `lineupEligibilitySource` — `getEffectiveLeagueRosterTemplate` (**current** configuration)
- `rosterMembershipSource` — `LeaguePlayerWeeklyScore.rosterId` per week
- `computationVersion`, `platformLeagueId`, `idpEnabled`
- `slotsAssumedStatic: true` — always, today
- `unmatchedRosterIds`, `unresolvedPlayerIds`, `weeksWithNoData`

🛑 **A player with no resolvable position gets NO SEAT.** Defaulting him to a flex position would let
an unidentified player inflate the one number nobody is supposed to be able to move.

---

## 6. Migration — written, PARKED, not applied

`prisma/migrations-pending/20260910120000_league_max_pf_freeze/migration.sql`

**Two tables, not three, and the reason is immutability rather than brevity.** Normalised per-team
value rows were considered and rejected: a correction would then either **mutate** the row —
destroying the original computed value the brief requires to stay recoverable — or need a second
"original" column, which is a JSON blob with extra steps. Per-team SQL querying was the other
argument and does not apply: a freeze is always read as a whole, because ranking 32 teams needs all
32 values.

- `LeagueMaxPfFreeze` — `values` written **once, never updated**;
  `@@unique([leagueId, season, metric, computationVersion])`.
- `LeagueMaxPfFreezeCorrection` — append-only, with `previousValue`, reason, actor, timestamp.

Effective value = computed + latest correction per team, **derived on read**.

**Risk: low.** Two new tables. No column added, altered or dropped anywhere. No backfill. Nothing
destructive. `prisma db push` was **not** used. `prisma generate` was run (no DB contact) so the
client types exist.

🛑 **Parked because `prisma migrate deploy` reads the DIRECTORY.** A migration in
`prisma/migrations/` is live whether or not anyone meant to apply it — this repo's own
`migrations-pending/README.md` records the incident that established the convention.

**Until it is applied**, `freezeMaxPf` returns `not_persistable` naming that path, and the status
reads `ready`, never `frozen`. The catch is **narrow** — only P2021/P2022 — so a connection failure
still throws rather than becoming a permanent quiet "not frozen yet".

---

## 7. Correction model

- `recordMaxPfCorrection` reads `previousValue` **from the stored record, never from the caller**. An
  audit trail whose before-value was asserted by the person making the change is not an audit trail.
- Rejects: unknown team, empty reason, no freeze to correct.
- Only the **latest** correction per team is effective; earlier ones stay on the record.
- The corrected row is marked `source: 'commissioner_correction'`, so a draft-slot explanation can
  say why it moved.

**Lifecycle is now truthful:** `missing` → `ready` → `frozen` → `corrected`.
`ready` and `frozen` are never collapsed — a commissioner shown a `ready` order as settled will watch
it move next week and stop trusting the ladder.

---

## 8. Promotion applier (Option A, as decided)

`runPromotionRelegation` gained one optional parameter: `transitions?: readonly SeasonEndTransition[]`.

- **Omitted → byte-for-byte the old behaviour.** The supplied path returns before the standings-zone
  code is reached. Asserted: same queries, same output, and it still applies via the original
  per-row updates rather than the new transaction.
- **Supplied → validated before the first write:** every team and division must belong to the league;
  no duplicates; no move to the same division; and **direction is checked against real tier levels**,
  so an inverted resolver cannot relegate the champions. One bad entry refuses the whole plan.
- Applied in a `$transaction` — a resolved ladder is all-or-nothing. **The existing path was
  deliberately left untransacted**, because wrapping it would be a behaviour change.
- `source: 'standings_zones' | 'supplied'` is reported so an audit can say who decided.

🛑 **No EFL rule moved into the engine.** A test greps the source (comments stripped) and fails if
`playoff`, `rookie`, `maxPf` or `efl` ever appears in it.

`lib/commissioner-os/efl/applyEflSeasonTransitions.ts` is the only place the halves meet, and it
**refuses to apply anything that is not settled** — naming which playoff is outstanding rather than
saying "not ready".

---

## 9. EFL template v1.2.0 — and why `executionEnabled` is finally true

1.0.0 and 1.1.0 are untouched. A test asserts 1.1.0 still declares
`reverseMaxPfMetric: 'regular_season_points_for'` — the **wrong** metric — because a league pinned to
it must keep the contract it was pinned to.

| Effect | v1.1.0 | v1.2.0 | Why |
|---|---|---|---|
| `efl.freeze_reverse_max_pf` | `planned` | **`engine`** | computed + durable |
| `efl.apply_relegations` / `_promotions` | `planned` | **`engine`** | an applier now exists |
| `efl.publish_rookie_order` | `planned` | `planned` | **Sleeper is read-only** |
| `efl.relegation_playoff_setup` | `planned` | `planned` | playing games is not software |
| `efl.announce_final_tiers` | `none` | `none` | unchanged |

🛑 **Flipping `executionEnabled` did not make the rookie order executable**, because `executable`
requires template permission **AND** a real engine **AND** platform authority. That is exactly why
flipping it is safe.

⚠ **Every EFL effect is `internal` scope, so EFL needs no Sleeper write at all** — tiers exist only
in AllFantasy; the source league is one flat 32-team Sleeper league. Promotion/relegation therefore
execute for real even on a SHADOW league. The rookie order is computed exactly and **presented**; a
human types it into Sleeper, and the template must never say otherwise.

---

## 10. Caller audit of the FALSE Max PF code — documented, NOT changed

| Module | Callers | Live? |
|---|---|---|
| `lib/league/maxPF.ts` → `computeReverseMaxPfOrder` | `app/api/league/settings/max-pf/route.ts` only | Commissioner-gated preview |
| `lib/league/rookieDraftOrder.ts` | `app/api/commissioner/.../rookie-draft-order/route.ts`, **`lib/draft/resolveRookieDraftSlotOrderForLeague.ts`** | 🛑 **The second one sets a REAL draft slot order** |

🛑 **This is a live, user-facing defect in a feature nobody asked me to touch.** Any league that
selects the `reverse_max_pf` rookie-order mode today is ordered by `LeagueTeam.pointsFor` — points
*actually scored*, from a **running total that keeps accumulating through the playoffs**. It is
neither Max PF nor frozen.

**Not changed in this phase, deliberately.** The brief says not to alter unrelated league behaviour
without caller/regression analysis, and changing it would silently re-order live drafts.

**Proposed safest migration path:**

1. Leave `worst_to_first` alone entirely.
2. Add a THIRD mode (`reverse_true_max_pf`) backed by this engine rather than repointing
   `reverse_max_pf`. Existing leagues keep the order they have had.
3. Surface the difference in the commissioner UI — "points scored" vs "maximum possible" — and let
   commissioners opt in.
4. Only after opt-in data exists, consider deprecating the old mode.
5. Independently: correct the misleading comment and variable name in both modules, which cost this
   project real time to discover.

New Commissioner OS work is already routed to the true engine and never touches these modules.

---

## 11. Test results

| Suite | Result |
|---|---|
| `__tests__/commissioner-os/efl/` (7 files) | **195 passing** |
| `trueMaxPf.test.ts` alone | 25 passing (matrix items 1–18) |
| `freezeStore.test.ts` | 14 passing |
| `promotion-relegation-supplied-transitions.test.ts` (new) | 15 passing |
| `promotion-relegation-routes-contract.test.ts` (existing) | 5 passing, **unchanged** |
| `rookie-draft-slot-order-wiring.test.ts` (existing) | 6 passing in isolation |
| Full batch (50 files) | **1075 passing, 4 failing — all pre-existing (see §13)** |

**Stale assertions updated (3), all of them "there is only one version" tests:**

- `templateContract.test.ts` — `latestVersionOf` → 1.2.0; and `"neither fixture may execute"` became
  a per-version allowlist, because EFL 1.2.0 is the first template that legitimately executes.
- `eflTemplate.test.ts` — `latestVersionOf` → 1.2.0; the "unknown version" case moved from `1.2.0`
  (which now exists) to `9.9.9`.
- Metric renames propagated through the EFL fixtures.

---

## 12. Positive controls — three mutations, each verified applied then restored

| # | Mutation | Result |
|---|---|---|
| A | Optimizer sees only **submitted starters** | **8 RED** — including all three anti-tanking tests (benched star, tanked lineup, empty lineup) |
| B | Augmenting path removed (no re-seating) | **10 RED** — including the SUPER_FLEX measurement and global optimisation |
| B2 | A player seated in **every** eligible seat | **12 RED** — including item 4 (*"a player cannot fill two slots"*) and item 9 |
| (prior phase) | Playoff week ceiling removed | **2 RED** — including *"PLAYOFF WEEKS CANNOT CHANGE IT"* |

Each was confirmed present with `diff -q` against a backup **before** running, and byte-identical
after restore. `grep -c MUTANT` and a NUL-byte scan were run over all five touched sources afterwards.

### ⚠ A process error worth recording

I started a large background test batch and then applied a mutation **while it was running**, so its
output described the mutant, not the code. Caught because the failures were implausible for the
change. **Mutation testing and background batch runs must not overlap in a shared tree** — the batch
was re-run clean afterwards, and §11's numbers come from that run.

---

## 13. Pre-existing failures (4), none caused by this phase

| Failure | Evidence it is pre-existing |
|---|---|
| `eslintBoundary.test.ts` | Flags four `lib/commissioner-ui/` restricted-import violations from a peer's uncommitted work. That test scans `lib/commissioner-ui` and `app/commissioner-os` — not `lib/commissioner-os`. Documented in the prior phase too. |
| `commissionerOsRecommendations.test.ts` | Mocked context assembler. Failing before this phase, documented in the C0.5/C5 handoff. |
| `rookie-draft-slot-order-wiring.test.ts` (2 tests) | **Passes in isolation. Passes batched with every one of my new suites. FAILS when batched with pre-existing `commissioner-os` suites that this phase never touched.** Cross-suite mock bleed. `git status` confirms neither that test nor the modules it exercises were modified. |

---

## 14. Deferred gaps

- **Applying the migration** — the only thing between `ready` and `frozen`. A deploy decision.
- **Per-week historical lineup configuration** — blocks a truthful Survivor All-Stars Max PF; harmless
  for EFL. §2.
- **Repointing `lib/league/rookieDraftOrder.ts`'s `reverse_max_pf` mode** — live defect, migration
  path proposed in §10, not taken.
- **Best Ball adopting the exact primitive** — possible now, deliberately not done.
- Governance, dues, conditional asset obligations — schema seams only.
- Everything the brief listed out of scope: Survivor privacy, Survivor All-Stars runtime, Calendar,
  Communications, League Network, Hub redesign, natural-language Chimmy, automation policy.

---

## 15. Next recommended phase

1. **Apply the parked migration** (user decision), then confirm the status flips `ready` → `frozen`
   on a real league and that a rerun does not mutate it.
2. **Wire a Commissioner OS surface** to `readMaxPfFreezeStatus` + `resolveEflRookieDraftOrder` so a
   commissioner can see the order, its provenance, and its freeze state — with a copy button and a
   Sleeper deep link, and no claim that AllFantasy set anything.
3. **Then** Survivor runtime privacy hardening, then the Survivor All-Stars template — which needs
   per-week lineup configuration first.

---

## 16. Traps for the next session

- **`WeeklyMatchup.leagueId` and `LeaguePlayerWeeklyScore.leagueId` are the SLEEPER league id.** Pass
  `platformLeagueId`, never `League.id`. This already cost one shipped bug.
- **A missing roster/position must never default to zero or to a flex.** Reverse order: zero is pick 1.
- **`lib/league/maxPF.ts` and `lib/league/rookieDraftOrder.ts` are still not Max PF.** Do not wire new
  work to them, and do not "unify" them without the §10 migration path.
- **Do not repoint Best Ball at the exact optimizer** without deciding that its scores may change.
- **Never edit a published template version.** 1.1.0 deliberately still declares the wrong metric.
- **Bump `MAX_PF_COMPUTATION_VERSION`** whenever the number could move; it is in the freeze's
  uniqueness key, so a bump produces a new row rather than a silent redefinition.
- **`prisma generate` regenerates the SHARED client.** Check no peer typecheck is running first.
- Tests are excluded from the repo TypeScript compile — run them explicitly.
