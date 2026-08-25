# Player Value Ledger — factor checklist

Live status of every factor. Updated as each lands. A factor is only ticked when
it is **wired and reachable**, not when the module exists — this repo has a
documented history of built-and-never-called modules.

Legend: ✅ done · 🔨 partial · ⬜ not started · 🛑 blocked, reason stated

---

## Layer 0 — Market baseline

| Factor | State | Where |
|---|---|---|
| FantasyCalc format-matched value | ✅ | `valueLedger.ts` |
| Market disagreement (std dev) | ✅ | `valueLedger.ts` → `classifyMicrostructure` |
| Liquidity / trade frequency | ✅ | same |
| 30-day momentum | ✅ | same |

⚠ Every stored price is a **12-team, ppr=1** price. See the header of
`valueLedger.ts`.

## Layer 1 — League fit

| Factor | State | Where |
|---|---|---|
| Scoring settings (PPR, TEP, pass TD, bonuses) | ✅ | `leagueFitRatio` |
| Superflex / QB format | ✅ | matched in the baseline, never re-applied |
| League size → pick conversion | ✅ | `leagueScale.ts` → `toBaselinePick` |
| League depth → replacement level | ✅ | `leagueScale.ts`, driven by rostered players |
| Unpriced positions (IDP/K/DEF) | ✅ | `rosterShape.ts` → `assessUnpriced` |

## Layer 2 — Trajectory

| Factor | State | Where |
|---|---|---|
| **Depth chart role** | ✅ | `depthChartRole.ts` — and the ingest that fills the table, `lib/depth-charts/ingestDepthCharts.ts` |
| Age | ⬜ | `Player.birthDate` / `SportsPlayer.age` exist, unused |
| Snap share | ⬜ | `normalizedStatMap.off_snp`, 77–89% coverage |
| Targets per game | ⬜ | `normalizedStatMap.rec_tgt`, ~58%. NOT target share — no team denominator stored |
| Experience / rookie year | ⬜ | `SportsDataCache years_exp` — cache only, no column |
| Recent form / streaks | 🔨 | data present, not surfaced as a trade note |
| Prior seasons | 🔨 | `PlayerSeasonStats` present, not surfaced |
| College production | 🛑 | devy/C2C — see the separate handoff. Needs a scale decision first |

⚠ **Age must not be applied naively.** FantasyCalc's dynasty price already prices
age; an age curve on top double-counts the single biggest dynasty factor.

## Layer 3 — Situation

| Factor | State | Where |
|---|---|---|
| Bye weeks | ✅ | `rosterNeed.ts` → `byeCollisionDelta` (counterparty layer) |
| Current injury designation | ✅ | `injuryStatus.ts`, used by need + scarcity |
| Weather | ✅ | deliberately excluded from trade value — moves a Sunday, not an asset |
| **Offensive line quality** | 🔨 | LT/LG/C/RG/RT now ingested by `ingestDepthCharts.ts`; no quality metric on top yet |
| Team pace / PROE | ⬜ | `TeamTendencySeason`, 320 team-seasons |
| Coaching / coordinator change | ⬜ | `CoachStint`, 18,041 stints |
| Defensive scheme faced | 🛑 | participation data deliberately excluded — cannot update in-season |
| Run-only / pass-only / third-down role | ⬜ | needs snap-type splits; not stored |
| Injury history / durability | 🛑 | `InjuryReportRecord` is history-shaped with **no writer** |
| NFL strength of schedule | ⬜ | derivable from the schedule; nothing derives it. Existing "SOS" is a fantasy opponent win% proxy |
| NCAAF strength of schedule | 🛑 | CFBD only — see devy/C2C handoff |
| NFL free agency | ⬜ | no source identified |

## Layer 4 — Market microstructure

✅ Complete — see Layer 0.

## Layer 5 — Counterparty

| Factor | State | Where |
|---|---|---|
| Roster need | ✅ | `rosterNeed.ts` |
| Positional scarcity (waiver wire) | ✅ | `positionScarcity.ts` |
| Injury-aware availability | ✅ | `computeRosterNeed` counts AVAILABLE bodies |
| Leverage (their need) | ✅ | `tradeContextNotes.ts` → `buildLeverageNotes` |
| Bye collision, both directions | ✅ | `byeCollisionDelta` |
| Roster crunch / forced drops | ✅ | `rosterShape.ts` |
| Concentration / fragility | ✅ | `rosterShape.ts` |
| **Manager positional premium** | ⬜ | needs per-manager trade history by position. `LeagueTradeHistory` is ingestion-progress, NOT trades |

## Layer 6 — Contention & horizon

| Factor | State | Where |
|---|---|---|
| Contention posture | ✅ | `contention.ts` |
| Cut-line distance, elimination math | ✅ | `contention.ts` |
| Pick slot projection | ✅ | `pickOutlook.ts` |
| Pick horizon decay | ✅ | `pickOutlook.ts` |
| Trade deadline runway | ✅ | `rosterShape.ts` |

## Format layer

✅ dynasty · redraft · keeper · guillotine · zombie · survivor ·
survivor-guillotine · tournament · pirate · king-of-the-hill · **salary cap**

⬜ devy · C2C — separate handoff, blocked on a scale decision.

---

## The three blockers worth naming

1. **College valuation has no market scale.** `devy-intel` produces a scouting
   composite; the trade model is denominated in FantasyCalc units. No mapping
   exists and inventing one would be the most confident wrong number in the
   product.
2. **Injury history has no writer.** `InjuryReportRecord` is shaped for history
   and nothing fills it. Current status is upserted in place, so durability is
   unanswerable until something records the past.
3. **Manager positional premium needs real trade history.**
   `LeagueTradeHistory` tracks ingestion progress rather than trades, and
   `transaction_facts` is empty. `LeagueTradeHistory` is the wrong table and the
   right one does not exist yet.
