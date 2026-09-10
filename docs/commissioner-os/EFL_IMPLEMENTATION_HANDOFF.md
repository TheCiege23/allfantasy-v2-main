# EFL Promotion/Relegation Dynasty — implementation handoff

**Date:** 2026-09-10
**Scope:** the three bounded pieces of the EFL phase — (A) season transition resolver,
(B) regular-season Max PF freeze, (C) 32-slot rookie draft order — plus template v1.1.0.
**Status:** all three resolvers built, deterministic and tested. **No schema migration was taken.**
**Execution is still off**, deliberately, and §6 says exactly what would turn it on.

Read `PHASE_C0.5_C5_HANDOFF.md` first for the profile/template foundation this sits on.

---

## 1. The three collisions found before writing anything

### 1.1 🛑 There is no real "Max PF" in this repo, and two modules say there is

| Module | What it calls it | What it actually reads |
|---|---|---|
| `lib/league/maxPF.ts` | `maxPF` | `SeasonResult.pointsFor` |
| `lib/league/rookieDraftOrder.ts` | `reverse_max_pf` mode | `LeagueTeam.pointsFor` |

Both are **points actually scored**, and `LeagueTeam.pointsFor` is a **running total that keeps
accumulating through the playoffs**. `rookieDraftOrder.ts` even carries the comment *"Non-playoff
teams by lowest Max PF (points for, last week of regular season)"* — describing a freeze it does not
perform.

**Reusing either would have shipped exactly the playoff-inclusive number the brief forbids, and it
would have read as correct**, because the variable is already named `maxPF`. That is why
`lib/commissioner-os/efl/maxPfFreeze.ts` computes from per-week rows instead, and why the EFL
draft-order resolver has no access to `LeagueTeam` at all.

⚠ **A second, separate honesty problem, recorded rather than silently decided.** In most leagues
"Max PF" means **optimal-lineup** points — the maximum you *could* have scored — which is what makes
it an anti-tanking metric: you cannot lower it by benching your best players. Ordering by points
*actually scored* rewards the very behaviour the EFL constitution says Reverse Max PF exists to
discourage. So the freeze does **not hardcode a metric**: it sums whatever per-week value it is
handed and records which metric that was (`regular_season_points_for` today). The day an
optimal-lineup producer exists, only the producer changes. `LeaguePlayerWeeklyScore` already carries
`isStarter` and per-player `points`; the missing piece is slot eligibility, and it is listed as
deferred.

### 1.2 ✅ `WeeklyMatchup` makes an honest freeze derivable

`WeeklyMatchup` is keyed `[leagueId, seasonYear, week, rosterId]` with `pointsFor` per week. So
regular-season-only totals are a `week <= finalWeek` filter — **immune to playoff inflation by
construction rather than by remembering to snapshot at the right moment.** Run the computation in
week 17 and it still returns the week-14 number.

⚠ **The join is an id-space hazard.** `WeeklyMatchup.rosterId` is a *provider-space* id;
`LeagueTeam.id` is a cuid. The mapping goes through `LeagueTeam.externalId`, and when it misses the
affected team sums to **zero** — which in a *reverse* order is the **first pick**. An id-space miss
does not degrade the order, it inverts it for that team. `readMaxPfFreezeStatus` therefore returns
`unmatchedRosterIds` rather than swallowing them.

### 1.3 `__tests__/promotion-relegation-routes-contract.test.ts` mocks the barrel wholesale

It does `vi.mock('@/lib/promotion-relegation', ...)` with four named exports. **Adding anything to
that barrel would leave the mock incomplete** — the "test double stopped doubling" failure. So every
EFL module lives under `lib/commissioner-os/efl/` and imports only the `SeasonEndTransition` **type**
from `lib/promotion-relegation/types`. That suite is untouched and still passes.

---

## 2. Files added and changed

**Added**

```
lib/commissioner-os/efl/
  types.ts                       domain vocabulary; re-exports the canonical SeasonEndTransition
  seasonTransitionResolver.ts    (A) roles, automatic movement, pending playoffs, settled plan
  maxPfFreeze.ts                 (B) pure freeze compute, fingerprint, state machine, corrections
  maxPfFreezeReads.ts            (B) DB-first read from WeeklyMatchup — STOPS before persisting
  rookieDraftOrder.ts            (C) composable slot-rule resolver + EFL_ROOKIE_DRAFT_ORDER_V1
  index.ts

lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_1.ts   NEW VERSION

__tests__/commissioner-os/efl/{fixtures.ts, seasonTransition.test.ts,
                               maxPfFreeze.test.ts, rookieDraftOrder.test.ts,
                               eflTemplate.test.ts}
docs/commissioner-os/EFL_IMPLEMENTATION_HANDOFF.md
```

**Changed** (four files, all additive)

| File | Change |
|---|---|
| `lib/commissioner-os/template/types.ts` | added optional `ScheduledRuleEffect.backedBy` |
| `lib/commissioner-os/template/planTemplateActions.ts` | planner honours `backedBy` over the global executor status |
| `lib/commissioner-os/template/registry.ts` | registered EFL 1.1.0 beside 1.0.0 |
| `__tests__/commissioner-os/templateContract.test.ts` | one stale assertion updated + one added (see §7) |

**`eflPromotionRelegationDynasty.ts` (v1.0.0) was NOT touched.** A test asserts its capability set,
its `deferredModules` and its absence of `backedBy` are unchanged.

---

## 3. EFL rule mapping

| Constitution rule | Where it lives | Note |
|---|---|---|
| Four tiers, 1 = Premier (highest) | `EflTierStanding.tierLevel` | matches `LeagueDivision.tierLevel`, which ascends downward |
| Bottom team auto-relegates | `config.autoRelegateCount` | sliced from the END of rank order |
| Next two play off, loser drops | `config.relegationPlayoffCount` + `EflPlayoffOutcome.loserTeamId` | |
| Tier winner auto-promotes | `config.autoPromoteCount` | |
| 2nd/3rd play off, winner rises | `config.promotionPlayoffCount` + `EflPlayoffOutcome.winnerTeamId` | |
| No relegation from League 2 | `noRelegationFromTierLevels: [4]` | **plus** an independent adjacency guard — see §7 |
| No promotion from Premier | `noPromotionFromTierLevels: [1]` | |
| Premier championship playoff | `EflTierPlacement` | feeds rookie slots 32→28, not promotion |
| Reverse Max PF freezes at regular-season completion | `regularSeasonFinalWeek` | **never defaulted to 14 in the engine** |
| Playoff points must not move a non-playoff slot | the `week <= finalWeek` filter | the single most important assertion in the phase |
| 32-slot custom order | `EFL_ROOKIE_DRAFT_ORDER_V1` | data, not code |
| Commissioner-configurable | `EflTransitionConfig` + `orderSpec` | nothing is a literal in a resolver |

**The one derivation that makes the order work:** the Reverse Max PF pool is **derived from the teams
no structural role claimed**, never listed by rank. League 2 has three promotion-contenders spoken
for, so five remain → slots 1–5. League 1 and the Championship have six spoken for, so two remain →
slots 12–13 and 20–21. A commissioner who changes `promotionPlayoffCount` therefore cannot silently
leave the order the wrong length; the spec and the pool disagree loudly instead.

---

## 4. 🛑 SCHEMA DECISION — no migration taken, and here is exactly what is needed

### Candidate models audited

| Model | Verdict |
|---|---|
| `LeagueSeason.teamRecords` (Json, unique `leagueId+season`) | **Closest shape, and rejected.** Already written by `lib/league/syncLeagueHistory.ts` from full-season Sleeper roster totals — playoff-inclusive by definition. Two writers with opposite semantics on one column; the sync would overwrite the freeze on its next run with no error. |
| `SeasonResult` | Has `pointsFor` but **no week scoping and no provenance**, so a freeze stored there is indistinguishable from a season total — the exact confusion this module exists to end. |
| `League.settings` JSON | Works mechanically (the template pin lives there) but a 32-row record with an audited correction path does not belong in an opaque blob. Nothing can query it and a correction leaves no row to point at. The brief forbids this explicitly, and is right. |
| `LeagueTeam` | No `maxPointsFor` column; `pointsFor` is the running total that caused the problem. |
| Any existing `*Snapshot` model | None is league-season scoped for standings inputs; all are domain-specific (rankings, rosters, brackets, projections). |

**Conclusion: none fits. Stopping before migration, as instructed.**

### Exact missing durability requirement

One immutable, queryable record per `(leagueId, season)` holding: the final week, the metric, the
per-team values, a fingerprint for idempotency, and an auditable correction trail.

### Smallest additive migration (proposed, NOT applied)

```prisma
model LeagueMaxPfFreeze {
  id                     String   @id @default(cuid())
  leagueId               String   @db.VarChar(64)
  season                 Int
  regularSeasonFinalWeek Int
  /// 'regular_season_points_for' | 'regular_season_optimal_lineup'
  metric                 String   @db.VarChar(48)
  /// MaxPfFreezeRow[] — [{ teamId, value, weeksCounted, source }]
  rows                   Json
  /// FNV-1a of (league, season, finalWeek, metric, sorted rows). Idempotency key.
  fingerprint            String   @db.VarChar(32)
  hasCorrection          Boolean  @default(false)
  frozenByUserId         String?
  frozenAt               DateTime @default(now())
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@unique([leagueId, season])
  @@index([leagueId])
  @@map("league_max_pf_freezes")
}

model LeagueMaxPfFreezeCorrection {
  id                String   @id @default(cuid())
  freezeId          String   @db.VarChar(64)
  teamId            String   @db.VarChar(64)
  previousValue     Float
  value             Float
  reason            String
  correctedByUserId String   @db.VarChar(64)
  correctedAt       DateTime @default(now())

  @@index([freezeId])
  @@map("league_max_pf_freeze_corrections")
}
```

**Migration risk: low, and it does NOT block this batch.**
Two new tables. No column added, altered or dropped on any existing model. No backfill. No
destructive operation. Nothing reads them until `maxPfFreezeReads.ts`'s single `stored: null` line
changes — that line is left explicit rather than hidden behind a helper so the stop is visible.

🛑 **Applying it is a separate decision that belongs to the user.** Per this repo's rules a migration
is not pushable work, and `prisma db push` must not be used.

### What the code does in the meantime, honestly

`readMaxPfFreezeStatus` computes the exact value from `WeeklyMatchup` and reports **`ready`** —
"computable now, and it can still move". It never reports `frozen`. That distinction is asserted in
the tests, because a commissioner shown a `ready` order as though it were settled will watch it move
next week and stop trusting the ladder.

---

## 5. Reuse map

| Behaviour | Canonical module | Relationship |
|---|---|---|
| Standings-zone promotion/relegation | `lib/promotion-relegation/PromotionEngine.ts` | **Untouched.** EFL resolves playoff-decided movement *before* it. |
| Division/tier lookup | `lib/promotion-relegation/DivisionResolver.ts` | Untouched; EFL takes `divisionId` as input. |
| Standings within a division | `lib/promotion-relegation/StandingsEvaluator.ts` | Untouched. |
| The transition shape | `lib/promotion-relegation/types.ts` → `SeasonEndTransition` | **Type imported and emitted**, so output is drop-in compatible. |
| Weekly scores | `WeeklyMatchup` | Read directly, filtered by week. |
| League profile, capabilities, authority | `lib/commissioner-os/` (C0.5/C5) | Unchanged; EFL plugs into the existing planner. |
| Action type strings | `lib/specialty-automation/actionPlans.ts` | Still reused via `ruleEffects.ts`. |

**Nothing was rewritten.** `PromotionEngine`, `StandingsEvaluator`, `DivisionResolver`,
`PromotionRule` and `LeagueDivision` are byte-identical.

---

## 6. Authority behaviour, and why execution is still OFF

**Per effect, in v1.1.0, via the new `backedBy`:**

| Effect | Global status | EFL status | Direction |
|---|---|---|---|
| `PROMOTE_TEAM` | `engine` | `planned` | **narrowed** |
| `RELEGATE_TEAM` | `engine` | `planned` | **narrowed** |
| `ASSIGN_DRAFT_SLOT` | `none` | `planned` | **widened** |
| `CREATE_COMMISSIONER_TASK` ×2 | `planned` | `planned` | backing named |
| `GENERATE_ANNOUNCEMENT` | `none` | `none` | unchanged |

🛑 **The narrowing is the half that matters.** `PromotionEngine` genuinely applies movement — for the
*standings-zone* competition. EFL's is playoff-decided and nothing applies it. Inheriting the global
`engine` claim would have asserted an execution path that exists for a different game.

**Sleeper (SHADOW) behaviour.** Every EFL effect is `internal` scope, so `authority.canExecute` is
`true` even on an imported league — and `executable` is still `false`, because the template forbids
execution and no effect has an engine. Those are two different verdicts and both are asserted.

⚠ **The honest finding: EFL needs no Sleeper write at all.** Tiers, divisions and rookie order are
AllFantasy constructs; the source Sleeper league is one flat 32-team league that has never heard of
the Premier League. A test asserts *every* EFL action is internal-scope, so nothing in the plan could
claim a Sleeper write even by accident. The rookie order does have to be typed into Sleeper by a
human — AllFantasy computes it exactly, presents it, and **must never say it applied it**.

**`executionEnabled` stays `false`.** Two things are missing and both are named in
`deferredModules`: durable storage for the freeze (§4) and an applier that consumes a settled
`SeasonEndTransition[]`. Flipping the flag is a deliberate act for the version that ships
persistence, not a reward for the resolvers existing.

⚠ **The applier is a real, small, unresolved decision.** `runPromotionRelegation` computes its own
transitions from standings zones and cannot accept an injected list. Making it do so is one optional
parameter — additive and non-breaking, and its route-contract test mocks the whole module so the
mock would not rot. **But the user's ruling was "do NOT rewrite PromotionEngine", so it was not
touched.** The choice is: (a) add an optional `transitions?: SeasonEndTransition[]` to
`runPromotionRelegation`, or (b) write a thin EFL applier that performs the same
`prisma.leagueTeam.update({ divisionId })`. (a) keeps one mutation path; (b) keeps
`PromotionEngine` literally untouched.

---

## 7. Positive controls — three mutations, each verified applied and then restored

Green-only validation is not proof. Every mutation was confirmed present with `diff -q` against a
backup **before** running, and confirmed byte-identical after restore.

| # | Mutation | Result |
|---|---|---|
| 1 | Removed the `week > finalWeek` ceiling in `computeRegularSeasonMaxPf` | **2 RED** — including *"PLAYOFF WEEKS CANNOT CHANGE IT"*, the central assertion of the phase |
| 2 | Inverted the reverse-Max-PF sort to descending | **6 RED** — slots 1–5, 12–13, 20–21, the full-order match and the provenance assertion |
| 3 | Deleted the `noRelegationFromTierLevels` config exemption | **1 RED** — and that number is the finding below |

### 🛑 Mutation 3 exposed a test that was passing for the wrong reason

`"League 2 never relegates"` stayed **GREEN** with the config exemption entirely deleted. In a
four-tier ladder League 2 is *also* the bottom tier, so the **adjacency guard alone** protected it —
the two guards were indistinguishable from the outside, and the test could not tell which one was
doing the work.

**Fixed by adding a case with a fifth tier below League 2**, where adjacency permits relegation and
only the config exemption can refuse it. Re-running the same mutation against the strengthened suite
now produces **2 RED** instead of 1. That is the whole value of the control: the test that mattered
most was the one that could not fail.

---

## 8. Test results

| Suite | Result |
|---|---|
| `__tests__/commissioner-os/efl/` (4 files, new) | **93 passing** |
| `__tests__/commissioner-os/` + `promotion-relegation-routes-contract` (48 files) | **1034 passing, 1 failing** |
| The 1 failure | `eslintBoundary.test.ts`, **pre-existing** — four `lib/commissioner-ui/` restricted-import violations from a peer's uncommitted work in the shared tree. That test scans `lib/commissioner-ui` and `app/commissioner-os`; it does not scan `lib/commissioner-os`. Documented in the prior phase's handoff too. |
| `promotion-relegation-routes-contract.test.ts` | **5 passing, unchanged** |

**One prior assertion was updated, and it was stale rather than broken.**
`templateContract.test.ts` asserted `latestVersionOf('efl_promotion_relegation_dynasty') === '1.0.0'`
back when 1.0.0 was the only published version — so it was testing *"there is one version"*, not the
comparison it was named for. With 1.1.0 published it correctly returns 1.1.0. The assertion was
re-pointed **and strengthened** with a second test pinning the string-sort hazard the registry
documents (`'1.10.0' < '1.9.0'` lexically would hand a new league the older ruleset).

**Typecheck:** see the session report. Tests are excluded from the repo's TypeScript compile
(`tsconfig.json` excludes every test pattern), so the four new test files were **not** typechecked —
repo-wide behaviour, not specific to them.

---

## 9. Deferred, explicitly

- **Durable storage for the freeze** — §4. The single largest blocker to execution.
- **An applier for a settled `SeasonEndTransition[]`** — §6, with the two options stated.
- **Optimal-lineup Max PF** — the metric the anti-tanking rule actually implies. §1.1.
- Governance, financial obligations, conditional asset obligations — schema seams only.
- Everything the brief listed as out of scope: Survivor privacy, Survivor All-Stars runtime,
  Calendar, Communications Center, automation policy system, dues, conditional trades, League
  Network refactor, Commissioner Hub redesign, natural-language Chimmy execution.

---

## 10. Next recommended phase

1. **Take the §4 migration and wire persistence.** It is two additive tables and one `stored: null`
   line. It converts `ready` → `frozen`, which is what makes the whole order trustworthy, and it is
   the prerequisite for any execution.
2. **Decide the applier question** (§6, option a or b) and land it. With 1 and 2 done, EFL v1.2.0 can
   set `executionEnabled: true` honestly for the internal effects.
3. **Then** Survivor runtime privacy hardening, then the Survivor All-Stars template.

Do not flip `executionEnabled` before 1 and 2. A template that computes a perfect ladder and claims
to have applied it is worse than one that admits it only prepared it.

---

## 11. Traps for the next session

- **`lib/league/maxPF.ts` and `lib/league/rookieDraftOrder.ts` are NOT Max PF.** Do not wire EFL to
  either, and be careful before "unifying" them with this module — they serve existing non-EFL
  surfaces (`/api/league/settings/max-pf`, the rookie-order config) and changing them is a separate,
  user-visible decision.
- **Tier 1 is the highest.** A relegation must *increase* `toTierLevel`.
- **Do not add exports to `lib/promotion-relegation/index.ts`** — its route-contract test mocks the
  barrel wholesale.
- **A missing frozen value must never default to 0.** This is a *reverse* order; zero is pick 1.
- **Do not reuse or renumber a `ScheduledRuleEffect.id` inside a published version.** Across versions
  is fine and correct — the idempotency key already carries the version.
- **Never add a "latest version" fallback to `resolveTemplate`.** `latestVersionOf` is for new
  leagues only.
- Tests are excluded from the repo TypeScript compile — run them explicitly.
