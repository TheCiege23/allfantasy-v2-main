# AF Player Trade Value + Projected Scoring — Audit & Implementation Plan

**Written:** 2026-09-01
**Branch at audit time:** `commish-os/phase-0-1b`
**Scope:** (1) the Player Trade Value engine, (2) the AF projected-scoring calculator, their
connection to each other, and their connection to Chimmy.

> **How to read this.** §1–§6 are the AUDIT — what is built, what works, what is broken, measured
> against the code rather than against the docs. §7 is the QUESTION SET (34 questions) — answer
> these and the plan's open branches close. §8 is the IMPLEMENTATION PLAN in ordered, resumable
> steps. §9 is the verification protocol each step must pass.
>
> Every claim in §1–§6 was verified by reading the file cited. Where I could not verify something
> without a production database read, it is marked **UNVERIFIED** and says so.

---

## DECISIONS TAKEN (2026-09-01, user)

These four are settled. The rest of §7 is still open.

| # | Decision | Consequence |
|---|---|---|
| **P-Q1** | **Store both units.** `afProjection` stays per-game; add `rosProjection`. | No existing reader of `afProjection` changes meaning — `/core` NCAAF and `playerProjections` are untouched. Value reads `rosProjection`. Phase 1.2 becomes a schema-additive change, not a conversion at the seam. |
| **V1** | **`CanonicalValue` + adapters is the source of truth.** Both engines become producers. | `lib/decision-os/value/contract.ts` is the spine. Phase 5 is no longer "pick a winner" — it is "make both emit the contract". The `unit` field and `sumCanonicalValues`' refusal to mix devy points with market units are load-bearing, not optional. |
| **V5** | **Need / injury / format are a SEPARATE "fit" number.** | Base value stays market-objective and cross-league comparable. Every adjustment must carry a stated reason string. Nothing is folded in silently. This also means Phase 4 modules return `{multiplier, reason}`, never a mutated value. |
| **Order** | **Phase 1 first.** | Connect the calculator to the value engine before anything else. Do NOT start Phase 5 first — unifying two engines that both read the wrong projection table just produces one engine reading the wrong table. |

⚠ **P-Q1 note for whoever implements it.** "Store both" means the per-game → ROS conversion happens
**at write time in `writeAfProjectionSnapshots.ts`**, where `weeksRemaining` is knowable from the
season/week anchor — not at read time in the enrichment port. A read-time conversion would have to
re-derive weeks remaining in every consumer, and the first one to get it wrong produces a plausible
number. One conversion, one place, one test.

---

## 0. Executive summary — the four findings that matter

1. **The AF projected-scoring calculator is genuinely good, and it is not connected to trade
   value.** `lib/af-projections/` computes `AFProjectionSnapshot` rows. The trade-value enrichment
   port reads `prisma.fantasyProjection` — **a different table**
   ([`lib/decision-os/world/port.ts:900`](../lib/decision-os/world/port.ts)). Nothing in the
   valuation chain reads `AFProjectionSnapshot`. The calculator you built is, today, invisible to
   the value engine.

2. **The canonical write path hardcodes three of its five value sources to `null`.**
   [`lib/trade-value/captureSnapshot.ts:96-104`](../lib/trade-value/captureSnapshot.ts) writes
   `rankingValue: null`, `fantasyCalcValue: null`, `idpValue: null` on every persisted snapshot.
   The engine that consumes them is correct; it is being starved at the seam.

3. **There are 12 rival valuation implementations.** The one the tests pin
   (`lib/trade-value/valueEngine.ts`, 213 lines) is NOT the one the user-facing trade console runs
   (`lib/hybrid-valuation.ts`, 1,038 lines). Two different engines answer "what is this player
   worth" depending on which screen you are on.

4. **Chimmy cannot answer a value question with a tool.** It has 7 tools; none is a value or
   projection tool. Trade context reaches it only as a pre-composed prose block, and only when a
   native redraft proposal exists.

**Rough completion:** the *computation* is ~75% built and high quality. The *wiring* is ~25%. The
*user-facing surface* is ~15%. The gap is almost entirely integration, not math.

---

## 1. What is built — Player Trade Value

### 1.1 The canonical deterministic engine — BUILT, WORKS, NARROW

`lib/trade-value/` (937 lines across 6 files). Pure, no I/O, fully unit-tested.

| File | Lines | Does |
|---|---|---|
| `valueEngine.ts` | 213 | `normalizedPlayerValue` / `normalizedPickValue` / `normalizedFaabValue`, 0–10000 scale |
| `snapshot.ts` | 110 | assembles a two-sided snapshot, calls the grader |
| `grader.ts` | 140 | fairness → letter grade, templated bullets, `insufficientData` refusal |
| `teamProfile.ts` | 107 | contender/rebuilder/middle stance, weak/strong positions |
| `types.ts` | 115 | the contract |
| `captureSnapshot.ts` | 152 | the only impure file — persists `RedraftTradeValueSnapshot` |

The value formula:

```
idpValue present        → return idpValue                      (short-circuits, deliberately)
no projection + market  → return marketValue                   (fallback only)
otherwise               → projection × 26 × scarcity + adpPremium, clamped 0..10000
scarcity = POSITION_SCARCITY[pos] × scoringScarcityMultiplier(pos, scoring)
```

**What genuinely works today, verified:**

- **Scoring-aware scarcity.** Superflex ×1.6, 2QB ×1.8, TE-premium ×(1 + prem×0.18) capped 1.5,
  PPR lift WR +8% / TE +10% / RB +4%. `valueEngine.ts:56-100`.
- **IDP outranks projection.** The asymmetry is correct and documented: a defender's incoming
  "projection" is the vendor's offensive-only PPR line (~0.3), which is the *absence* of a
  projection wearing a number. `valueEngine.ts:160-176`.
- **Market value as fallback, never multiplied by scarcity** (FantasyCalc already embeds
  positional demand — multiplying would double-count). `valueEngine.ts:120-144`.
- **The honesty refusal.** When nothing resolves, `grade: null` + `insufficientData: true` +
  `reviewRecommended: true`, instead of the old `fairness 100 → "A+"`. `grader.ts:74-97`. This is
  the single best piece of defensive design in the system.
- **League-aware starter needs.** `starterNeedsFromSlots` reads the league's real
  `roster_positions`; superflex forces `QB ≥ 2`. `teamProfile.ts:76-92`.

### 1.2 Decision OS canonical layer — BUILT, BEHIND AN OFF-BY-DEFAULT FLAG

`lib/decision-os/trade/` rehosts the same pure engine onto a provider-agnostic `CanonicalWorld`,
so it works for imported leagues with no `RedraftSeason` rows. `canonicalMemo.ts` (~420 lines)
adapts and calls `buildTradeValueSnapshot` verbatim.

`enrichmentPort.ts` (~345 lines) is the **best-built part of the whole value stack** and resolves
five sources with per-source failure isolation: ADP, position, projection, market value +
liquidity + 30d trend, and league IDP value.

🛑 **It is gated off.** `DECISION_OS_TRADE_LIVE` and `DECISION_OS_TRADE_SHADOW` both default to
false (`lib/decision-os/trade/shadow.ts:21-36`). So the one path that actually fills
`fantasyCalcValue` and `idpValue` does not run in production unless those env vars are set.

**UNVERIFIED:** whether either flag is set in the Vercel production environment. Check with
`vercel env ls` — I did not have the CLI available.

### 1.3 The user-facing engine — A DIFFERENT ENGINE

`lib/trade-value-console/runTradeConsoleAnalysis.ts` (1,154 lines) is what the trade console
screens actually run. It uses `lib/hybrid-valuation.ts` (1,038 lines): `pricePlayer`, `pricePick`,
`compositeScore` over market + impact + VORP + volatility, plus a GPT narrative layer.

This engine is **more feature-complete than the canonical one** (it has VORP, league IDP/kicker
values by name, analytics, negotiation toolkits) and **completely unpinned by the canonical
tests**. The two disagree and nothing measures by how much.

### 1.4 The full rival census

| Module | Lines | Scale/unit | Reached from |
|---|---|---|---|
| `lib/trade-value/valueEngine.ts` | 213 | 0–10000 | canonical snapshot, Chimmy described-trade, trade-discovery |
| `lib/hybrid-valuation.ts` | 1038 | composite | trade console (user-facing) |
| `lib/pick-valuation.ts` | 478 | picks | hybrid |
| `lib/devy/devyValueBoard.ts` | 386 | **devy_points** | devy board |
| `lib/trade-intel/devyTradeValue.ts` | 320 | devy | devy trades |
| `lib/vorp-engine.ts` | 206 | VORP | hybrid |
| `lib/idp-projections/idpTradeValues.ts` | 202 | 0–10000 | IDP |
| `lib/kicker-values/leagueKickerValue.ts` | 201 | flat/league | kickers |
| `lib/league-values/leagueTradeValues.ts` | 189 | league | console |
| `lib/player-values/playerValuesLoader.ts` | 117 | CSV | legacy |
| `lib/redraft-war-room/playerValue.ts` | 43 | ad hoc | war room |
| `lib/guillotine/ai/playerValueModel.ts` | 28 | ad hoc | guillotine |

`lib/decision-os/value/contract.ts` is the **correct** answer to this — a `CanonicalValue` with a
required `unit` and a `sumCanonicalValues` that *refuses* to add devy points to market units
without an explicit league bridge. It has 3 adapters written (market, devy, idp+kicker) and a
`value-os` feed. **It is not yet the thing anything reads.**

---

## 2. What is built — AF Projected Scoring Calculator

`lib/af-projections/` (2,015 lines across 7 files). This is high-quality work.

| File | Lines | Does |
|---|---|---|
| `writeAfProjectionSnapshots.ts` | 581 | the only impure file; writes `AFProjectionSnapshot` |
| `buildAfProjection.ts` | 411 | the basis ladder — projection or typed refusal |
| `idpScoring.ts` | 274 | IDP component extraction + league-rule scoring |
| `core.ts` | 271 | aggregate extraction, recency weighting, snap share, confidence |
| `categoryScoring.ts` | 195 | MLB / NBA / NHL / NCAAB DraftKings rules |
| `types.ts` | 182 | contract incl. `ProjectionRefusal` as a first-class outcome |
| `rescoreForLeague.ts` | 91 | rescore stored IDP components under a league's own rules |

### 2.1 The basis ladder (`buildAfProjection.ts:280-330`), in precedence order

1. `sleeper_weekly_idp_projection` — forward-looking IDP components, league-scored
2. `sleeper_weekly_projection` — forward `pts_{format}`
3. `weekly_actuals_recency` — recency-weighted actuals (`0.5^(age/4)`), **guarded on `> 0`**
4. `weekly_idp_components` — per-week IDP, scored then weighted
5. `weekly_actuals_recency` (true zero) — a real 0 is honoured, just after IDP gets its chance
6. `season_dk_fppg_proxy` — prior-season DK PPG, labelled as a PPR-shaped proxy
7. `season_idp_components` — season IDP, per-game
8. `season_category_components` — MLB/NBA/NHL/NCAAB, **last on purpose**
9. → `no_scoring_basis` refusal

**This ladder is correct and the ordering rationale is sound.** The `recency.value > 0` guard at
step 3 is load-bearing and easy to break.

### 2.2 What works, verified

- **IDP scoring is measured, not assumed.** Tackle split 53.64/46.36 from 5,186 real weekly rows,
  not the 2:1 the preset values would tempt you into. `idpScoring.ts:22-38`.
- **Additive tackle scoring.** `idp_tkl` base + `idp_tkl_solo` bonus. Measured against two of your
  own leagues: tackle-only league 17.17 vs Sleeper 17.17 ✓; combined league was 17.17 vs Sleeper
  26.31 ✗ before the fix. `idpScoring.ts:228-243`.
- **Position gate on IDP.** Without it, 29 offensive players got IDP projections including two QBs
  off post-turnover tackles. `idpScoring.ts:40-60`.
- **Per-game unit discipline.** The Kamren Curl bug — 6.34/game stored, 211.44 on rescore, ~17×
  — is fixed and documented in two places. `buildAfProjection.ts:213-228`.
- **MLB group prefixing.** `batting.H` (a hit) vs `pitching.H` (a hit allowed) never merge.
- **Confidence is derived from real coverage**, never a constant. `core.ts:205-260`.
- **Refusal is a first-class return type.** No midpoints, no league-average stand-ins.
- **The cron is scheduled and fails loudly.** `cron-schedule.json` `"50 7 * * *"`; zero rows ⇒
  HTTP 500; >40% refusal rate ⇒ failure, with one narrow offseason carve-out.

---

## 3. The gaps — Player Trade Value

### G1 🛑 The projection input is a different table from the one you compute

`enrichmentPort.loadProjections` → `loadProjectionRows` → `prisma.fantasyProjection`
(`lib/decision-os/world/port.ts:900`). Your calculator writes `AFProjectionSnapshot`.

**Consequence:** every quality improvement you make to the AF calculator has zero effect on trade
value. This is the single highest-leverage fix in this document.

### G2 🛑 `captureSnapshot.ts` writes three nulls

```ts
rankingValue:     null,  // "deferred"
fantasyCalcValue: null,  // "live external API excluded from the write path"
idpValue:         null,  // "this write path carries no league scoring or slots"
```

Both stated reasons are **now obsolete**: `getFantasyCalcValuesDbFirst` is DB-first (no live
fetch), and `resolveLeagueIdpScoring` can supply the slots. Every persisted redraft snapshot is
priced on projection+ADP alone.

### G3 🛑 Two engines, no parity measurement

`hybrid-valuation` (console) vs `valueEngine` (canonical). `consoleShadowCompare.ts` exists to
compare them — **UNVERIFIED whether it is wired to anything or has ever run.**

### G4 The 0–10000 clamp saturates the top of the board

`projection × 26 × scarcity`: an RB at 330 pts × 26 × 1.15 = **9,867**; at ~390 pts it clamps.
In superflex, a QB at 380 × 26 × 0.85 × 1.6 = **13,436 → clamps to 10000**. Elite QBs in superflex
are therefore **indistinguishable from each other**, which is precisely the format where QB
separation matters most. `PROJ_TO_VALUE = 26` was tuned for season-long PPR points and is wrong for
a per-game input by a factor of ~17.

⚠ **This interacts with G1**: `AFProjectionSnapshot.afProjection` is **per game**, and
`normalizedPlayerValue` expects **rest-of-season**. Wiring G1 without a unit conversion would price
every player at ~1/17th and it would look like a working number.

### G5 Team context is computed and barely used

`TeamProfile` has `stance`, `weakPositions`, `strongPositions`, `depthIssues`. The grader uses
`weakPositions` for **one templated bullet per side** and nothing else. Stance never moves a price.
A rebuilder and a contender are quoted the same number for the same player.

### G6 No league-type differentiation in the value formula

`leagueType` is carried in `TradeValueContext` and **never read by the math**. Redraft, dynasty,
keeper, best-ball, zombie, guillotine, survivor all price identically. There is no age curve, no
contention window, no rookie-pick premium.

### G7 Injuries do not reach the value

`grep injur lib/trade-value/` → **zero hits**. Injuries are imported every 30 min, are consumed by
`buildAfProjection` for *confidence only*, and never move a price or flag a trade.

### G8 Playoff probability does not reach the value

`playoffSeed` feeds the stance heuristic. No playoff-odds model, no strength-of-schedule for the
fantasy playoff weeks, no "this trade only helps if you make the playoffs" framing.

### G9 Roster-need adjustment does not exist

The engine prices assets in isolation. A WR4 to a WR-rich team and a WR-starved team is the same
number. `weakPositions` is known and unused for pricing.

### G10 College/devy is a separate currency with no bridge

Correctly refused rather than faked (`sumCanonicalValues`), but the practical effect is that a
devy-for-NFL trade **cannot be graded at all**. `DevyBridge` is a league setting nobody sets.

### G11 Kickers are a flat constant

`kicker-flat`: every kicker in a league carries the same number. Defensible (kicker rank does not
persist) but it means kicker trades are ungradeable in any meaningful sense.

### G12 No trade-market comparables

You asked for "what the player is being traded for in other leagues". `PlayerValueSnapshot`
carries `tradeFrequency` and `trend30d`, and `canonicalMemo.ts:190-205` **reports them in prose
but explicitly never applies them**. There is no cross-league comparable-trade lookup.

---

## 4. The gaps — AF Projected Scoring Calculator

### P1 🛑 No kicker scoring path at all

`grep -i kick lib/af-projections/` returns only the IDP *exclusion* comment. A kicker reaches the
ladder and can only match `pts_{format}` or the DK proxy. **No FG-by-distance, no XP, no misses,
no FG-length rules.** Every league that scores `fg_50+` differently from `fg_0_39` is mispriced.

### P2 🛑 Offense is stored in ONE format and cannot be rescored

`rescoreForLeague.ts` rescores **IDP only** — it reads `factors.idp.componentAmounts`. The writer
stores canonical **PPR** (`writeAfProjectionSnapshots.ts:98`). A standard or half-PPR league reads
a PPR number. The IDP fix (persist component amounts, rescore at read) was the right pattern and
was **never applied to offense**: offensive component amounts (rec, rec_yd, rush_td…) are not
persisted, so the rescore is impossible without a schema or writer change.

### P3 NCAAF has no dedicated scoring path

College football is not in `CategorySport` (`MLB | NBA | NHL | NCAAB`) and has no football
component scoring. NCAAF rows reach the DK-PPG proxy or refuse. **UNVERIFIED:** the note in
`lib/core-app/ncaafProjections.ts:41` says every NCAAF `AFProjectionSnapshot` row has `week = null`
and mentions "a manual backfill" — so college projections may not be freshly computed at all.

### P4 Confidence is computed and thrown away downstream

`ConfidenceResult` is rich (score, level, reasons). `AFProjectionSnapshot.confidenceLevel` stores
only the level string. The reasons — the honest part — are not persisted in a queryable form and
never reach a user.

### P5 Only one adjustment layer is wired

`adjustmentsApplied` supports many; only `opponent_history` is implemented. No weather (despite
`weatherAdjustment` / `isOutdoorGame` / `weatherCacheId` columns **existing in the schema**), no
injury adjustment, no depth-chart-change adjustment, no bye handling, no snap-share trend
(`snapShare()` is computed in `core.ts` and **never called** by the builder).

### P6 No user-facing surface

`app/projections/` does not read `AFProjectionSnapshot` (grep: zero hits). The engine's output is
invisible to users. There is no "why is this number what it is" view, despite the engine producing
exactly the data such a view needs.

### P7 No accuracy backtest loop

`lib/projections/projectionAccuracy.ts` exists. **UNVERIFIED** whether it runs on a schedule or
feeds anything back. Nothing tunes `PROJ_TO_VALUE`, the half-life, or the scarcity table against
outcomes.

### P8 Soccer has no path, and that is correct

The vendor serves no player season stats. Recorded, not a bug.

---

## 5. The gaps — Chimmy connection

### C1 🛑 No value tool and no projection tool

Chimmy's 7 tools: `find_league_by_name`, `get_my_roster`, `get_available_players`,
`get_league_standings`, `get_head_to_head`, `get_upcoming_games`, `get_stat_leaders`.

**There is no `get_player_value` and no `get_player_projection`.** A user asking "what is Chase
worth in my league" cannot be answered by a tool call.

### C2 Trade grounding is prose-only and narrowly gated

`buildTradeContextForChimmy` returns `null` unless there is a native redraft trade block,
proposal, or player-value context. Imported leagues — most of them — get nothing.

### C3 The described-trade evaluator is the best thing here and is ADP-only

`lib/chimmy-trade/describedTradeEvaluator.ts` answers "is Chase for Gibbs fair?" from prose. It is
well-built and honest. But it prices from `adp_data` **only** (94,089 rows / 3,152 names, because
that source is name-keyed), sets `projectionValue: null` deliberately so confidence is not
inflated, and cannot price defenders at all.

### C4 Chimmy cannot explain a value

There is no path from a number back to its inputs. `deriveConfidence().reasons` and
`IdpScoringBreakdown.approximations` exist and are exactly what an explanation needs — they reach
no chat surface.

---

## 6. Scorecard

| Area | Built | Wired | User-facing | Chimmy |
|---|---|---|---|---|
| Value: core formula | 95% | 70% | 40% | 20% |
| Value: scoring settings (SF/TEP/PPR) | 90% | 50% | 30% | 10% |
| Value: IDP | 85% | 30% | 20% | 0% |
| Value: kickers | 40% | 30% | 20% | 0% |
| Value: college/devy | 70% | 20% | 20% | 10% |
| Value: roster need | 25% | 5% | 0% | 0% |
| Value: league type (dyn/keeper/BB) | 10% | 0% | 0% | 0% |
| Value: injuries | 0% | 0% | 0% | 0% |
| Value: playoff odds | 5% | 0% | 0% | 0% |
| Value: cross-league comparables | 15% | 5% | 5% | 0% |
| Projections: NFL offense | 90% | 80% | 10% | 0% |
| Projections: IDP | 95% | 70% | 10% | 0% |
| Projections: kickers | 5% | 5% | 0% | 0% |
| Projections: college | 40% | 30% | 20% | 0% |
| Projections: MLB/NBA/NHL/NCAAB | 80% | 60% | 10% | 0% |
| Projections → Value link | **0%** | **0%** | 0% | 0% |

---

## 7. Questions — answer these and the plan's branches close

Answer by number (e.g. `V1: b`). Anything left blank, I take the plan's stated default.

### 7A. Trade Value — 18 questions

**V1. Which engine is the single source of truth?** ✅ **ANSWERED: (c)**
(a) `lib/trade-value/valueEngine.ts` — migrate the console onto it
(b) `lib/hybrid-valuation.ts` — retire the canonical one
(c) **`CanonicalValue` + adapters — both become producers** ← chosen

**V2. Value scale.** Keep 0–10000 FantasyCalc convention, or move to a league-points scale where
"1000" means something to a user? *(default: keep 0–10000, add a points-equivalent display)*

**V3. Should the value be per-league by default, or global with a league lens?**
A per-league value is correct but uncacheable app-wide. *(default: global base + league modifiers
computed at read)*

**V4. Roster-need adjustment — how strong?** A WR4 to a WR-starved team: worth (a) the same,
(b) +10–15%, (c) +25%+, (d) configurable? *(default: b, and reported separately from base value so
the user sees both)*

**V5. Should need adjustment change the GRADE or only the commentary?** ✅ **ANSWERED: separate
"fit" number.** Base fairness stays market-objective and cross-league comparable; every adjustment
carries a stated reason. Applies to need, injury AND league format.

**V6. Dynasty vs redraft — do you want a real age curve?** If yes, what ages are the cliffs by
position? Or should I derive them from FantasyCalc's dynasty-vs-redraft spread?

**V7. Keeper leagues — what drives value?** Keeper cost/round, years of control, or both?

**V8. Best-ball — does value change?** (No trades in most best-ball, but AF may differ.)

**V9. Zombie / guillotine / survivor / king-of-the-hill — do these need distinct value models,
or is "redraft + a survival modifier" enough?** *(default: redraft base + per-format modifier)*

**V10. Injuries — how should an injury move value?** (a) not at all, flag only, (b) discount by
expected games missed, (c) discount by severity tier, (d) discount ROS projection and let value
follow *(default: d — it is the only one that cannot double-count)*

**V11. Should a receiving team's injury at a position raise what they should pay?** *(default: yes,
surfaced as "need", not folded into base value)*

**V12. Playoff odds — do you want a real playoff-probability model,** or is
contender/rebuilder/middle enough? A real one needs a Monte Carlo over remaining schedule.

**V13. Do you want "win-now vs future" as an explicit second axis** on every value (two numbers
per player)? *(default: yes for dynasty/keeper, single number for redraft)*

**V14. Cross-league comparables — what is the source?** (a) our own settled trades across AF
leagues, (b) FantasyCalc `tradeFrequency`/`trend30d`, (c) both *(default: c, ours weighted higher
once we have volume)*

**V15. Minimum sample before showing a comparable?** *(default: 5 trades, and say the count)*

**V16. Devy↔NFL bridge — do you want to set a default exchange rate,** or keep refusing until a
commissioner sets one? *(default: keep refusing, but add a commissioner UI to set it)*

**V17. Kickers — flat per league, or rank them** by projected points (needs P1 built first)?

**V18. IDP — is `balanced` the right canonical preset to store,** given both your live leagues are
IDP dynasty? Should the canonical store be tackle-heavy instead?

### 7B. Projected Scoring — 16 questions

**P-Q1. Per-game or rest-of-season?** ✅ **ANSWERED: store BOTH.** `afProjection` stays per-game;
add `rosProjection`, computed **at write time** where `weeksRemaining` is known. See DECISIONS.

**P-Q2. Should offense be rescorable per league like IDP is?** This needs persisting offensive
component amounts. *(default: yes — it is the same proven pattern and P2 is a real mispricing)*

**P-Q3. If yes to P-Q2, which components?** *(default: pass_yd, pass_td, pass_int, rush_yd,
rush_td, rec, rec_yd, rec_td, fumbles, 2pt, plus bonus thresholds)*

**P-Q4. Kicker scoring — which rule set is canonical?** *(default: Sleeper's `fgm_0_19` …
`fgm_50p`, `fgmiss`, `xpm`, `xpmiss`)*

**P-Q5. Do you want distance-bucketed kicker projections,** or total FG attempts × league average
make rate? *(default: bucketed — it is the only way TEP-style kicker settings work)*

**P-Q6. College — same engine or separate?** NCAAF has no NFL-style weekly logs.
*(default: same engine, new `ncaaf_component_scoring` basis off CFBD box scores)*

**P-Q7. College — project for the college season, or for devy "arrival value"?** These are
different products.

**P-Q8. Weather — wire it?** Schema columns exist and are unused. *(default: yes, outdoor games
only, and only for K and passing volume)*

**P-Q9. Snap-share trend — wire it?** `snapShare()` is written and never called.
*(default: yes, as a role-change adjustment capped at ±15%)*

**P-Q10. Injury adjustment inside the projection?** *(default: yes — expected games × per-game,
and it is where V10(d) gets its number)*

**P-Q11. Should a refusal be shown to users, or hidden?** *(default: shown — "we can't project X
because Y" is the whole honesty thesis)*

**P-Q12. Multi-format storage — migration or read-time rescore?** *(default: rescore, per P-Q2 —
no migration needed)*

**P-Q13. How far back should recency weighting look?** Half-life is 4 weeks. Keep?

**P-Q14. Do you want projections for every sport,** or NFL/NCAAF first? *(default: NFL + NCAAF
first, others already have a category path)*

**P-Q15. Accuracy backtest — do you want it,** and should it auto-tune constants or just report?
*(default: report first, never auto-tune without review)*

**P-Q16. Should projections be a paid/tier-gated feature?** Affects where they surface.

---

## 8. Implementation plan

Ordered so each phase is independently shippable and independently verifiable. **Phase 1 is the
unlock** — nothing else in the value stack is worth much until it lands.

### Phase 0 — Measure the baseline (½ day, no product change)

- **0.1** Record the typecheck baseline in a detached worktree at HEAD's parent, per CLAUDE.md.
- **0.2** Write `scripts/probe-value-parity.ts`: for N players, print `valueEngine` vs
  `hybrid-valuation` side by side. **This is the positive control for the whole migration** — it
  must show a real disagreement before any unification is trusted. Commit the fixture.
- **0.3** Verify in production whether `DECISION_OS_TRADE_LIVE` / `DECISION_OS_TRADE_SHADOW` /
  `DECISION_OS_CANONICAL_SHADOW_ENABLED` are set (`vercel env ls`). Closes an UNVERIFIED.
- **0.4** Count rows: `AFProjectionSnapshot` by sport/season/week-null, and `FantasyProjection`.
  Answers "is the AF calculator actually populated?" **Read-only. Use a named non-prod
  `DATABASE_URL` or accept the db-guard sentinel** — do not let `.env` supply production.

### Phase 1 — Connect the calculator to the value engine 🛑 THE UNLOCK

- **1.1** Add `loadAfProjectionRows(sport, playerIds, season, week)` to
  `lib/decision-os/world/port.ts`, reading `AFProjectionSnapshot` by `snapshotLookupKey`.
- **1.2** **Unit conversion, or the whole thing silently under-prices by ~17×.** Per the P-Q1
  decision: add a `rosProjection` column and compute it **in the writer**, via a named, tested
  `rosFromPerGame(perGame, weeksRemaining)` helper. Never inline it, and never re-derive
  `weeksRemaining` in a consumer. ⚠ This is the one step in Phase 1 that needs a **migration** —
  and per CLAUDE.md a migration is not pushable on an author's say-so, so land the code and raise
  the schema change separately with the user.
- **1.3** In `enrichmentPort.loadProjections`, prefer `AFProjectionSnapshot` and fall back to
  `FantasyProjection`. Record which fired in `valuationSource` (`af_projection_snapshot` vs
  `fantasy_projection`) so provenance stays auditable.
- **1.4** Apply `rescoreIdpForLeague` at this seam so a defender's number is the *league's*, not
  the stored `balanced` one.
- **1.5** Recalibrate `PROJ_TO_VALUE`. It is tuned for season points; confirm against the new
  input and fix the superflex-QB clamp saturation (G4) — likely a soft knee above ~8500 rather
  than a hard clamp.
- **1.6** Tests: a player with an AF snapshot prices from it; without one falls back; per-game
  input never produces the 17× error; **a superflex QB and an elite QB are distinguishable.**

### Phase 2 — Stop writing nulls (G2)

- **2.1** `captureSnapshot.ts`: fill `fantasyCalcValue` from `getFantasyCalcValuesDbFirst`
  (DB-first — the original "live API" objection is obsolete).
- **2.2** Fill `idpValue` via `buildIdpKickerValueMap` with the league's real slots.
  ⚠ Use `pickValue()` from `idpKickerAdapter.ts` — reading `.value` unconditionally yields **0 for
  every IDP/kicker in every redraft league**, and 0 passes `isCoherentValue`.
- **2.3** Fill `rankingValue` or delete the field. A permanently-null contract field is a lie.
- **2.4** Pass `ScoringContext` into the capture path (it currently never supplies `scoring`, so
  every persisted snapshot is priced as standard 1-QB redraft **even for superflex leagues**).
- **2.5** Test: a superflex league's persisted snapshot differs from a 1-QB league's.

### Phase 3 — Projected scoring completeness

- **3.1** **Kicker scoring** (P1). New `lib/af-projections/kickerScoring.ts` mirroring
  `idpScoring.ts`: component extraction, league rule keys, distance buckets, `componentAmounts`
  persisted for rescore. New basis `weekly_kicker_components` / `season_kicker_components`.
- **3.2** **Offensive component persistence + rescore** (P2). Extend `adjustmentFactors` with
  `offense.componentAmounts`; add `rescoreOffenseForLeague`. No migration — same pattern as IDP.
- **3.3** **College path** (P3). `ncaaf_component_scoring` basis from CFBD box scores.
  ⚠ CFBD is the sole NCAAF source and is DB-first compliant — go through
  `lib/devy/devyPlayerReads.ts`, never `lib/cfb-player-data.ts` from a request path.
- **3.4** Wire `snapShare()` (P5) as a capped role-change adjustment.
- **3.5** Wire weather using the existing schema columns; outdoor games only.
- **3.6** Injury adjustment (P-Q10) — expected games missed × per-game.
- **3.7** Persist `confidence.reasons` in `adjustmentFactors` so an explanation is reconstructable.

### Phase 4 — Context-aware valuation

- **4.1** `lib/trade-value/needAdjustment.ts` — pure. Takes `TeamProfile` + position, returns a
  multiplier and a *reason string*. Reported beside base value, never folded in silently (V5).
- **4.2** `lib/trade-value/leagueTypeModel.ts` — dynasty age curve, keeper cost/control, best-ball,
  and the concept formats. Multiplicative on base, each with a stated reason.
- **4.3** Injury → value via the ROS projection (V10 default d), so it cannot double-count.
- **4.4** Playoff-odds module (V12) — start with the existing stance, upgrade to Monte Carlo if V12
  says so.
- **4.5** Comparable trades (V14): index settled AF trades by player+format; return the count and
  refuse below the V15 threshold.

### Phase 5 — Unify onto `CanonicalValue`

- **5.1** Make `hybrid-valuation` and `valueEngine` both emit `CanonicalValue`.
- **5.2** Run `consoleShadowCompare` on real traffic; publish the disagreement distribution.
- **5.3** Migrate the console to the canonical engine **only after** the parity probe from 0.2
  shows the gap is understood — not before.
- **5.4** Retire the dead ones (`redraft-war-room/playerValue`, `guillotine/playerValueModel`,
  `player-values-csv`) after a four-form import census (`@/lib/x`, `./x`, `await import`, test
  mocks — the CLAUDE.md rule).

### Phase 6 — User-facing

- **6.1** `/projections` reads `AFProjectionSnapshot` (P6). Show basis, confidence, and reasons.
- **6.2** A "why is this number what it is" panel: basis → components → league rules → adjustments.
  The engine already produces every field this needs.
- **6.3** Trade console shows base value, need adjustment, and format modifier as **three numbers**,
  not one.
- **6.4** Refusals render as sentences, not blanks (P-Q11).

### Phase 7 — Chimmy

- **7.1** `get_player_value` tool → `CanonicalValue` + basis + confidence + refusal reason. Follows
  the existing rule: **no `leagueId` parameter**; league comes from the session.
- **7.2** `get_player_projection` tool → projection, basis, confidence reasons, approximations.
- **7.3** `explain_value` tool → the full derivation chain.
- **7.4** Extend `describedTradeEvaluator` to consult projections + IDP + market, not ADP alone
  (C3), keeping its honest split of which basis was used.
- **7.5** Answer-policy rules: never invent a value; always name the basis; state the refusal
  reason; never mix devy points with market units.

---

## 9. Verification protocol — every phase

Per CLAUDE.md, a check that has never gone red is not evidence.

1. **Positive control first.** Before trusting any probe, make it report a known failure. For
   Phase 1 specifically: assert the 17× unit error IS caught by the new test before fixing it.
2. **Typecheck in a detached worktree at the commit**, not in the shared checkout — `next dev`
   rewrites `tsconfig.json`. Read the unpiped exit status; confirm the file under test is in the
   compile set with `--listFiles | grep <file>`.
3. **Read the total against the parent's baseline**, then narrow. Never "zero in my files" alone.
4. **No production DB.** `vitest.setup.db-guard.ts` pins `127.0.0.1:1` when `DATABASE_URL` is
   unset. `127.0.0.1:1` in a trace means the guard fired — it is not a broken local Postgres.
5. **Attest on the commit**, not the working tree, and hand the SHA + base + suite counts to the
   designated pusher. Never push to `main` from this session.

---

## 10. Sequencing recommendation

If credits are limited, do them in this order — each is independently valuable:

1. **Phase 1** — connects work already done. Highest value per line changed.
2. **Phase 2** — three one-line-ish fills that unblock IDP and market pricing everywhere.
3. **Phase 3.1** — kickers are the largest total hole in the projection engine.
4. **Phase 7.1/7.2** — two Chimmy tools make the whole thing feel real to a user.
5. Everything else.

**Do not start Phase 5 (unification) before Phase 1.** Unifying two engines that both read the
wrong projection table just produces one engine reading the wrong table.
