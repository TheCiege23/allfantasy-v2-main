# Commissioner Rule / Settings Intelligence — Data Audit (Phase 5)

**Purpose:** determine whether AllFantasy has clean **deterministic** data sources for a
Commissioner-facing Rule / Settings Intelligence display module — without AI advice,
recommendation endpoints, or speculative rule criticism. **Audit only:** no module, no contract,
no code changes, no DB access.

**Date:** 2026-07-07 · **Branch:** `g15-event-foundation`

## Verdict: **GO** (with a "summarize, never judge" guardrail)

Clean, typed, deterministic settings data exists in abundance. A display-safe Commissioner
Rule / Settings module is buildable. **BUT** it must SUMMARIZE / EXPLAIN configuration and surface
only *objective, deterministic* inconsistencies (framed as "worth a look") — it must **never**
judge the commissioner's rules or recommend changes.

**Bonus finding:** unlike every other Commissioner module, this one reads **stored configuration**
(not DomainEvent projections), so it **renders with data even on import-only Sleeper leagues** —
the one module that sidesteps the "imported leagues render empty" blocker.

---

## 1. Existing models / types (SAFE, deterministic)

| Source | Kind | Deterministic content | Classification |
| --- | --- | --- | --- |
| `League` dedicated columns | model | `sport`, `season`, `scoring`, `rosterSize`, `starters`, `scoringPresetId`, `waiverType`/`waiverBudget`/`waiverHours`/…, `tradeReviewHours`, `tradeDeadlineWeek`, `draftPickTrading`, `playoffStartWeek`/`playoffTeams`/`playoffWeeksPerRound`/`playoffSeedingRule`/`playoffLowerBracket` | **display-safe (configuration-only)** |
| `League.settings` → **`SettingsSnapshot`** (`lib/league-contract/types.ts`) | typed Json | `rosterSettings` (starterSlots/benchSlots/irSlots/taxiSlots/devyCollegeSlots), `scoringSettings` (format/scoringMode/categoryPresetId/rules), `draftSettings` (draftType/rounds/auctionBudget/thirdRoundReversal), `waiverSettings` (waiverType/faabBudget), `playoffSettings` (playoffTeams/playoffStartWeek/seedingRule), `commissionerSettings` (tradeReviewMode/tradeDeadlineWeek/illegal-roster gates), `conceptSetup`/`conceptRules` (dynasty/keeper/devy/c2c/idp/salary-cap) | **display-safe (configuration-only)** — parse via `parseSettingsSnapshot()` |
| `RedraftSeason` | model | `sport`, `season`, `totalWeeks`, `playoffStartWeek`, `currentWeek`, `status` | **display-safe** |
| `RedraftTradeProposal.vetoMode` / `vetoThreshold` | model | commissioner-vs-vote review policy | **display-safe** (also feeds Trade Review) |
| League team count (`League.teams`) | relation | league size (for playoff-size-vs-league-size checks) | **display-safe** |

**Concept flags are all derivable deterministically:** Superflex (starterSlots has `SF`/`SUPERFLEX`),
IDP (starterSlots `IDP_*` or `conceptRules`), TE premium (scoringSettings position multipliers),
Keeper/Devy/C2C/Salary-cap (concept id in `conceptSetup`/`conceptRules` / `League.leagueType`).

---

## 2. Existing services / resolvers (SAFE, deterministic — reuse these)

| Helper | What it gives | Classification |
| --- | --- | --- |
| `parseSettingsSnapshot(raw)` (`lib/league-contract/types.ts`) | typed `SettingsSnapshot` from raw `League.settings` | **display-safe** |
| `resolveRedraftRosterConfig(sport, League.settings)` (`lib/redraft/rosterConfigResolver.ts`) | normalized `{ starterCapacities, benchSlots, irSlots, taxiSlots, maxRosterSize, source: 'commissioner'\|'defaults' }` (already handles canonical + legacy shapes) | **display-safe** |
| `getRedraftSportConfig(sport)` (`lib/redraft/sportConfig.ts`) | per-sport **defaults** (starterSlots, benchSlots, irSlots, totalRosterSize, defaultScoringFormat, defaultTeamCount, defaultPlayoffTeams, defaultWaiverType, defaultTradeDeadlineWeek…) — the reference for **standard vs custom** | **display-safe** |
| `UnifiedLeagueSettingsService.validateLeagueSettings(...)` (`lib/league-settings-engine`) | **deterministic** validation result (used by `league-settings/validate` route) | **display-safe** (surface pass/fail + objective inconsistencies only) |
| `LeagueDefaultsOrchestrator` (`lib/league-defaults-orchestrator/`) | default resolution | **display-safe (configuration-only)** |

---

## 3. Existing routes (audit)

**Safe / deterministic (config CRUD + validation):**
`GET/PUT /api/commissioner/leagues/[id]/league-settings`, `.../league-settings/validate`
(deterministic), `.../playoff-settings`, `.../roster-settings`, `.../roster-settings/compare-template`
(deterministic template diff → "standard vs custom"), `.../division-settings`.

**UNSAFE (AI / advice):**
- `.../division-settings/ai-name` — AI name generation.
- `app/api/redraft/ai/commissioner/route.ts` + `lib/ai-commissioner/*` (TradeFairnessAnalyzer,
  CollusionSignalDetector, …) — AI commissioner advice.

> The Commissioner hub calls **none** of the settings/AI routes today (it consumes only the six
> documented intelligence/story/trade-review routes). Already regression-guarded by
> `__tests__/commissioner-intelligence/proof-surface.test.tsx` (route allowlist + no-AI-endpoint).

---

## 4. Key questions answered

**1. What deterministic settings data exists?** League size, sport, season, draft type, scoring
preset/mode, roster/bench/IR/taxi slots, playoff teams/start-week/seeding, waiver type + FAAB,
trade deadline + review mode/hours, veto mode, and concept flags (Superflex / IDP / TE-premium /
keeper / devy / c2c / salary-cap) — **all deterministic**, from the columns + typed
`SettingsSnapshot` + resolvers above.

**2. What rule-consistency checks are safe?** Deterministic, factual observations:
- SAFE (describe): "Uses FAAB waivers.", "Roster format includes Superflex.", "Reviewed trade
  process (48h).", "Scoring uses TE premium.", "12-team league, 6 playoff teams."
- SAFE if strictly factual (objective mismatch, framed as "worth a look", never criticism):
  "Playoff teams (8) exceed the league size (6).", "No trade deadline is configured.", "No IR
  slots are configured.", "Odd playoff bracket size (5)."
- UNSAFE (never): "Your rules are bad.", "You should switch to FAAB.", "This setting is unfair.",
  "This league is poorly configured.", "Managers will hate this."

**3. Does a display contract already exist?** **No.** There is a settings *engine* / *validator* /
*defaults orchestrator*, but no display-safe "commissioner rule/settings summary" contract.
→ propose `CommissionerRuleSettingsV1` (Phase 6). Do not reuse the AI-commissioner surfaces.

**4. What source should Phase 6 use?** **Normalized / resolved settings, never raw JSON**
(the raw blob carries legacy flat keys alongside the typed snapshot). Specifically: `League`
columns + `parseSettingsSnapshot(League.settings)` + `resolveRedraftRosterConfig()` +
`getRedraftSportConfig()` (defaults, for standard-vs-custom) + optionally
`validateLeagueSettings()` for the one deterministic inconsistency flag.

---

## 5. Recommended module shape (Phase 6, do NOT build yet)

The proposed `CommissionerRuleSettingsV1` is sound. Descriptive classifications of config SHAPE:

```ts
interface CommissionerRuleSettingsV1 {
  version: 'commissioner-rule-settings.v1'
  derivedAt: string
  leagueFormat: 'standard' | 'custom' | 'advanced' | 'unknown'        // vs sport defaults
  rosterComplexity: 'simple' | 'moderate' | 'complex' | 'unknown'     // slot count/variety
  scoringComplexity: 'simple' | 'moderate' | 'complex' | 'unknown'    // format/mode/rules
  transactionPolicy: 'open' | 'reviewed' | 'restricted' | 'unknown'   // waiver + veto mode
  playoffConfiguration: 'standard' | 'custom' | 'needs_review' | 'unknown'
  settingsHighlights: string[]  // neutral facts: "Uses FAAB waivers", "Includes Superflex", …
  caveats: string[]
  summary: string               // "This league uses a custom playoff format and FAAB waivers."
}
```

**Guardrail on `playoffConfiguration: 'needs_review'` (the only risky value):** emit it ONLY for an
**objective, deterministic inconsistency** (e.g. `playoffTeams > league team count`, or
`playoffStartWeek` beyond the season length), sourced from `validateLeagueSettings()` / a factual
comparison — framed as *"worth a look,"* never as criticism. Everything else is `standard`
(matches defaults) or `custom` (differs but consistent). If no clean inconsistency source is
wired, ship `standard`/`custom`/`unknown` only and defer `needs_review`.

Allowed copy: *"This league uses a custom playoff format and FAAB waivers."* /
*"The roster format includes Superflex and TE premium."*
Forbidden copy: *"You should change…"* / *"This setting is unfair."* / *"…is poorly configured."*

---

## 6. Known blockers

1. **Settings shape variance:** raw `League.settings` carries **legacy flat keys alongside** the
   typed `SettingsSnapshot` (see the `[key: string]: unknown` on each slice). Phase 6 MUST use
   `parseSettingsSnapshot()` + the `League` columns + the resolvers — never hand-parse raw JSON.
2. **Non-redraft leagues:** bracket/pool leagues have a different settings shape. Scope the module
   to redraft (or degrade to `unknown` honestly) — mirror the standings route's `RedraftSeason`
   detection.
3. **`needs_review` discipline:** the only place this module could drift into judgment — keep it
   objective-inconsistency-only (see the guardrail).

---

## 7. Recommended Phase 6 build plan (if approved)

**Commissioner Rule / Settings Display Contract** — same proven pattern:
`display-safe contract → deterministic aggregation → read-only resolver → default-off commissioner
route → hub module`.

1. `lib/decision-os/commissioner-intelligence/rule-settings/` — `types.ts`
   (`CommissionerRuleSettingsV1`), pure `ruleSettingsAggregator.ts` (classify format/roster/
   scoring/transaction/playoff complexity vs `getRedraftSportConfig` defaults; build neutral
   `settingsHighlights`; documented thresholds), read-only `ruleSettingsResolver.ts` (read `League`
   columns + `parseSettingsSnapshot(settings)` + `resolveRedraftRosterConfig()` + team count; NO AI).
2. Commissioner-scoped default-off route `GET /api/app/leagues/[id]/commissioner/rule-settings`
   (`assertCommissioner`, flag `COMMISSIONER_RULE_SETTINGS_ENABLED`).
3. New hub module (own loading/empty/restricted states) + widen the `proof-surface.test.tsx` route
   allowlist for the new route (a new hub module always requires this — see the Phase-4 gotcha).
4. Aggregator tests (deterministic classifications + neutral highlights + banned-judgment scan) +
   route tests (gate/401/403/data/empty). No AI/recommendation source; no live DB.

**Boundary:** explain and summarize configuration; never judge the rules or recommend changes.
