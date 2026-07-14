# Redraft Settings Architecture Audit (post-92, pre-G11)

**Date:** 2026-06-26
**Goal:** Verify the settings foundation is production-ready for standard NFL redraft
and reusable by future league concepts (Dynasty, Keeper, Best Ball, Guillotine,
Survivor, Big Brother, Devy, C2C, Zombie, Tournament, IDP) without redraft
assumptions leaking in. Bar: *a paying commissioner must not be able to configure
something that does not actually work.*

**Outcome:** The settings foundation is sound — a mature **resolver-per-domain**
architecture already backs most settings, and the previously-known scoring (R1) and
roster (G10) disconnects are fixed. The audit found **no new high-severity customer
blocker**, fixed one small contract-repair drift (the flagged `redraft-core-contract`
slot-count failure), and documented two **medium** disconnects (waiver type, redraft
trade-settings binding) as the next settings-hardening targets. **NFL stays at 92;
proceed to G11 Live Scoring.**

---

## 1. Settings architecture map

All league config lives in `League.settings` (JSON) plus a few promoted `League`
columns (e.g. `tradeReviewHours`, `tradeDeadlineWeek`, `draftPickTrading`,
`playoffTeams`). The codebase reads it through **per-domain resolvers**, not ad-hoc
`settings.x` lookups — this is the reusable base future formats extend.

| Domain | UI surface (live) | Storage path | Resolver / engine module |
|---|---|---|---|
| Scoring | `tabs/ScoringTab` → `NflScoringSettingsPanel` (+ MLB/NBA/NHL/NCAAF/Soccer) | `settings.nfl_scoring_config` (UI keys) → bridged to `settings.sportConfig.categoryPoints` (engine keys) | `scoringKeyBridge` → `calculateScoreFromSportConfig` (R1) |
| Roster | `tabs/RostersTab` / `RosterSettingsEditor` | `settings.starter_slots` + `settings.rosterTemplate` + `settings.roster.config.sections[].slots` | `rosterConfigResolver` → `validateRedraftLineup` (G10) |
| Roster (contract repair) | auto (self-heal) | `settings.starter_slots` | `buildRedraftContractRepairPlan` |
| Draft | `tabs/DraftTab` / `DraftSettingsCommissionerPanel` | `settings.draftSettings` + `DraftSession` | `DraftRoomConfigResolver`, `DraftUISettingsResolver`, live-draft-engine (`DraftOrderService`) |
| Waiver | `tabs/WaiversTab` | `settings.waiverSettings`, `RedraftRoster.faabBalance` | `processWaiverWindow` |
| Trade | `tabs/TradesTab` | `League.tradeReviewHours/tradeDeadlineWeek/draftPickTrading` + `settings.commissionerSettings` | `resolveLeagueTradeSettings` (`league-trade-engine`) |
| Playoff | `tabs/PlayoffsTab` | `League.playoffTeams`, `RedraftSeason.playoffStartWeek` | `seedPlayoffBracket` / `PlayoffConfigResolver` |
| Schedule | schedule defaults | `settings` (cadence/window) | `ScheduleConfigResolver` → `LeagueScheduleGenerationService`, `MatchupCadenceResolver` |
| Standings | (not commissioner-editable) | derived | `playoffEngine` standings sort (hardcoded) |
| AI commissioner | `tabs/AISettingsTab` / `CommissionerTab` | `settings.commissionerSettings` | `commissioner-assistant-engine`, `ai-commissioner/*` (advisory only) |
| Concept/type rules | `tabs/ConceptRulesTab` | `settings.conceptRules.extensions` | `conceptRosterRules`, format resolvers (future formats, gated) |

Two **legacy/secondary** settings UIs exist — `components/league-settings/pages/*`
(via `SettingsPageRouter`, several are `PlaceholderPages`) and `components/app/tabs/*`.
The **live** commissioner surface is `LeagueSettingsControlCenter` rendering
`components/league-settings/tabs/*`. The placeholder pages are not the customer path.

---

## 2. Gap table

Status legend: **working** (UI ↔ engine bound) · **disconnected** (UI saves, engine
ignores) · **partial** (bound on some paths) · **limitation** (hardcoded, no UI to
contradict) · **future-only** (not active for customers).

| # | Setting | UI location | Storage path | Engine consumer | Status | Severity |
|---|---|---|---|---|---|---|
| 1 | Scoring categories / preset / DST | ScoringTab → NflScoringSettingsPanel | `nfl_scoring_config` → `sportConfig.categoryPoints` (bridged) | `calculateScoreFromSportConfig` | working (R1) | — |
| 2 | Starter slots / bench / IR / FLEX / SF | RostersTab | `starter_slots` + `rosterTemplate` | `rosterConfigResolver` → `validateRedraftLineup` | working (G10) | — |
| 3 | Contract-repair slot completion | auto | `starter_slots` | `buildRedraftContractRepairPlan` | **fixed this pass** | low |
| 4 | Draft type / rounds / timer / auction budget | DraftTab | `draftSettings` + DraftSession | live-draft-engine | working | — |
| 5 | FAAB budget / min bid | WaiversTab | `waiverSettings` → `faabBalance` | `processWaiverWindow` (FAAB enforced) | working | — |
| 6 | **Waiver type (faab / rolling / reverse_standings)** | WaiversTab `<select>` | `settings.waiverType` | **none** — engine always runs FAAB-priority hybrid | **disconnected** | MEDIUM |
| 7 | Playoff teams / start week | PlayoffsTab | `League.playoffTeams`, season | `seedPlayoffBracket`, finalize | working | — |
| 8 | **Trade review hours / review type / deadline week** | TradesTab | `League.tradeReviewHours/tradeDeadlineWeek` | resolver exists (`resolveLeagueTradeSettings`/`isPastTradeDeadline`) but the **redraft proposal route** (`/api/redraft/trade-proposals`) reads vetoMode/expiresInHours/vetoThreshold from the **request body**, not the resolver | **disconnected (redraft path)** | MEDIUM |
| 9 | Draft-pick trading on/off | TradesTab | `League.draftPickTrading` | package-finder warns (`DRAFT_PICK_REFERENCE_ONLY`), commissioner-review reads it; redraft proposal route doesn't gate `draft_pick` assets | partial | LOW |
| 10 | Standings tiebreakers (H2H, divisions) | not exposed | — | hardcoded `wins → pointsFor` in `playoffEngine` | limitation (no UI to contradict) | LOW |
| 11 | Playoff seeding/tiebreaker rules | not exposed | `playoff-defaults` resolvers | resolvers consumed only within `playoff-defaults`, not the redraft playoff engine | future-only | LOW |
| 12 | Schedule cadence / scoring window | schedule defaults | `settings` | `ScheduleConfigResolver` → generation services | working | — |
| 13 | AI commissioner review/thresholds | AISettingsTab | `commissionerSettings` | advisory engines | working (advisory) | — |
| 14 | Concept-rule extensions | ConceptRulesTab | `conceptRules.extensions` | format resolvers | future-only (gated) | — |

---

## 3. Findings

### 3a. No new high-severity blocker
Core gameplay settings — scoring, roster/lineup, draft, FAAB waivers, playoff size —
are all UI ↔ engine bound. The two historically-cited disconnects (scoring R1, roster
G10) are resolved. Standard NFL redraft is internally consistent.

### 3b. Fixed this pass (small, safe): contract-repair slot drift
`buildRedraftContractRepairPlan` (the flagged `redraft-core-contract` test failure)
was back-filling default positions (a kicker) into **deliberately-customized,
non-legacy** starter-slot maps via `deepMergeMissing` — silently overwriting a
commissioner's roster shape and violating the base-engine rule that future formats
build on. Root cause analysis:
- **Test 1** expected an obsolete 5-slot default (`QB/RB/WR×2/TE/DEF`, RB:1, no
  FLEX/K). Production correctly normalizes the legacy standard map to the canonical
  9-starter contract (`QB/RB/RB/WR/WR/TE/FLX/K/DEF`; counts unchanged, only
  `FLEX→FLX`, `DST→DEF`) and uses 15 draft rounds (9 starters + 6 bench). The test
  expectations were stale → updated.
- **Test 2** ("does not overwrite customized roster slots") encoded the *intended*
  contract; production had drifted to back-fill `K`. **Fix:** a present, non-legacy
  slot map is now preserved **atomically** (no per-key back-fill). Legacy/missing maps
  still get the canonical default wholesale (unchanged). See
  `lib/redraft-core-contract/ensureRedraftLeagueContract.ts`.

Tests: `__tests__/redraft/redraft-core-contract.test.ts` (7 pass; added an explicit
"no kicker back-fill" lock). Full redraft suite **369 pass / 0 fail** (was 366 + 2
pre-existing fails). Typecheck clean (one unrelated pre-existing `tx` implicit-any).

### 3c. Documented (medium) — next settings-hardening targets, do NOT block G11
- **Gap #6 Waiver type.** `WaiversTab` lets a commissioner pick faab / rolling /
  reverse_standings, but `processWaiverWindow` always runs the FAAB-priority hybrid.
  Mitigant: the NFL default IS `faab` and the hybrid behaves faab-first, so the
  *default* matches; only a non-default selection silently no-ops. Honest fix =
  branch `processWaiverWindow` on the resolved waiver type (rolling = priority-only,
  reverse_standings = priority reset by inverse standings). Behavioral engine change
  → needs staging proof; not a no-risk inline fix.
- **Gap #8 Trade settings binding.** A full `resolveLeagueTradeSettings` /
  `isPastTradeDeadline` resolver exists and is used by `lib/league-trade-engine`, but
  the **redraft** proposal route bypasses it (review window/veto mode come from the
  proposer's request body; `tradeDeadlineWeek` is never enforced on creation). Honest
  fix = have `/api/redraft/trade-proposals` resolve review hours/mode/deadline from
  `resolveLeagueTradeSettings` and reject past-deadline proposals. Behavioral change
  → staging proof needed.

Neither breaks core gameplay (trades fully function; waivers process correctly under
the default), so both are **medium**, not high. They are the logical follow-on to R1
("bind every commissioner-facing setting to its engine") and can be scheduled
alongside or after G11.

### 3d. Limitations (low) — acceptable, not customer-visible misconfig
- Standings/playoff tiebreakers are hardcoded `wins → pointsFor` with **no UI** to
  configure H2H/divisions, so no commissioner can configure something that doesn't
  work. The `playoff-defaults` seeding/tiebreaker resolvers exist but aren't wired
  into the redraft playoff engine yet — future enhancement, not a disconnect.

---

## 4. Readiness decision

- **NFL stays at 92.** No new high-severity customer blocker surfaced; the settings
  foundation is cleaner (contract-repair customization bug fixed + mapped).
- **Proceed to G11 Live Scoring.** The two medium disconnects (waiver type, redraft
  trade-settings binding) are documented follow-ons and do not block G11.
- Recommended sequencing after G11: bind waiver type (#6) and redraft trade settings
  (#8) to their resolvers — each with a staging/engine-E2E proof, mirroring the R1
  pattern — to fully satisfy "no configurable-but-broken setting."
