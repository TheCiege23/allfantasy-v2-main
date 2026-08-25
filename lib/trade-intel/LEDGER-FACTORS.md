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
| **Age** | ✅ | `trajectory.ts` → `futureLean`. Read OUT of the market as the dynasty/redraft spread, so it cannot double-count |
| **Snap share** | ✅ | `trajectory.ts` → `loadUsage`. Null when absent — 77–89% coverage means a gap is common |
| **Targets per game** | ✅ | `loadUsage`. NOT target share — no team denominator is stored |
| **Run / pass role** | ✅ | `loadUsage` → `runShare`, from carries against targets |
| Third-down role | 🛑 | box scores carry totals, not down-and-distance splits. Would be a guess dressed as a role |
| Experience / rookie year | 🛑 | `years_exp` lives only in `SportsDataCache`. Inferring rookie status from a missing prior season would label every unmatched player a rookie |
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
| **Team pace / PROE** | ✅ | `situation.ts` → `loadTeamTendency`. Honours the per-field sample size; flags stale seasons |
| **Coordinator change** | ✅ | `situation.ts` → `loadCoordinatorChange`. The one situation signal that cannot double-count, because it is what the market has NOT seen |
| Defensive scheme faced | 🛑 | participation data deliberately excluded — cannot update in-season |

| Injury history / durability | 🛑 | `InjuryReportRecord` is history-shaped with **no writer** |
| **NFL strength of schedule** | ✅ | `situation.ts` → `loadStrengthOfSchedule`, from the real NFL schedule. The existing "SOS" measures the managers you play; this measures the defences your players face |
| NCAAF strength of schedule | 🛑 | CFBD only — see devy/C2C handoff |
| NFL free agency | 🛑 | no source. `PlayerContract` models salary-cap LEAGUE deals, not NFL ones — using it would report a fantasy cap sheet as an NFL one |

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

## Blockers worth naming

1. **College valuation has no market scale.** `devy-intel` produces a scouting
   composite; the trade model is denominated in FantasyCalc units. No mapping
   exists and inventing one would be the most confident wrong number in the
   product.
2. **Injury history has no writer.** `InjuryReportRecord` is shaped for history
   and nothing fills it. Current status is upserted in place, so durability is
   unanswerable until something records the past.
3. **Third-down role, experience and NFL free agency have no source.** Each is
   named in code at the point it would have been used, so the next person meets
   the reason rather than the absence.
4. **Manager positional premium needs real trade history.**
   `LeagueTradeHistory` tracks ingestion progress rather than trades, and
   `transaction_facts` is empty. `LeagueTradeHistory` is the wrong table and the
   right one does not exist yet.
