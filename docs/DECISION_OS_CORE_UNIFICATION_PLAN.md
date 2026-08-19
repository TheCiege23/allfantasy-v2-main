# Decision OS Core Unification Plan

**Status:** Phase 0 — Audit & Design (this document)
**Branch:** `g15-event-foundation`
**Scope:** Design-only. No behavior changes. No new wired code paths.

---

## 0. TL;DR for the impatient

- Decision OS (`lib/decision-os/`) already exists, is substantial (~9,000+ lines across core, world, four decision slices, behavioral intelligence, phase6 classifiers, presentation, SDK), and is **architecturally frozen** (`lib/decision-os/ARCHITECTURE_FREEZE.md`). It runs in shadow/hybrid mode behind four decision slices: `manager.lineup.set`, `manager.waiver.claim`, `manager.trade.evaluate`, `commissioner.league.health`.
- Its own core contracts (`Decision<TAction>`, `CanonicalWorld`, `CanonicalAsset`, `BehavioralEvent`) are **already sport-agnostic** — position, week, and sport are plain data fields, never enums or branches. Only **one** hardcoded sport check exists in the entire Decision OS tree (`lib/decision-os/commissioner-health/dco.ts:47`, an NFL-only warning, not a rule).
- The problem is not Decision OS itself. The problem is **everything around it**:
  1. The engines Decision OS wraps (trade, roster/scoring stat keys, schedule, playoff) range from genuinely sport-agnostic (roster, waiver, draft-type registry) to hard-baked NFL/weekly-H2H assumptions (schedule, playoff, trade's `Sport = 'nfl' | 'nba'` enum).
  2. There are **3 parallel, duplicated manager-intelligence engines** (`lib/manager-dna.ts`, `lib/gm-profile`, `lib/decision-os/phase6/dna`) and **2 duplicated league-health engines** (`lib/league-health`, `lib/commissioner-hub/commissionerHubHealth.ts`), each independently computing overlapping things.
  3. "Commissioner OS" is not one system — it's ~6 scattered modules with exactly one intentional bridge into Decision OS.
  4. Chimmy (the AI assistant) has **zero imports of Decision OS anywhere** — it sources everything directly from Prisma and 10+ bespoke per-format context builders, and its structured prompt schema hardcodes `sport: "NFL" | "NCAAF"`.
  5. There is no `SportAdapter` or `ProviderAdapter` interface anywhere in the repo. Three separate half-solutions exist (`lib/sportConfig`, `lib/redraft/sportAdapters`, `lib/providers/providerFallbackPolicy`) with no shared contract between them. Of the three, `providerFallbackPolicy.ts`'s `DataDomain`/`ProviderName` model is the best-shaped starting point.
- **Recommendation:** Decision OS Core does not need a redesign. It needs (a) a formal `SportAdapter`/`ProviderAdapter` contract sitting *below* it, (b) de-duplication of the legacy intelligence engines *around* it in favor of the Phase 5/6 implementations already inside it, and (c) new consumers (Chimmy, Commissioner OS, future DFS/Contest OS) wired to read from it instead of around it.

---

## 1. What already exists (file inventory)

### 1.1 Decision OS Core — `lib/decision-os/`

| Area | Files | Sport-agnostic? | Live? |
|---|---|---|---|
| **Core contracts** | `core/decision.ts`, `core/integrationContract.ts`, `core/parity/`, `core/shadow/`, `core/telemetry*.ts` | Yes | Yes (shadow, all 4 slices) |
| **Canonical World** | `world/facts.ts`, `world/assets.ts`, `world/enrichedWorld.ts`, `world/assemble.ts`, `world/derive.ts`, `world/port.ts`, `world/redraftRoster.ts`, `world/scheduleBye.ts`, `world/playerMetadata.ts`, `world/{injury,adp,projection,weather,news,leagueIntel}EnrichedWorld.ts` | Yes (position/week/sport are data fields, never branched on) | Yes (read-only) |
| **Lineup slice** (Slice 1) | `lineup/{dco,world,rules,decision,canonicalBridge}.ts` | Yes | Yes (shadow) — wraps `lib/redraft/lineupValidation` |
| **Waiver slice** (Slice 2) | `waiver/{dco,world,rules,decision,loader}.ts` | Yes | Yes (shadow) — wraps `lib/waiver-ai-engine`, `lib/waiver-wire/transaction-eligibility` |
| **Trade slice** (Slice 3) | `trade/{dco,world,rules,decision,canonicalMemo}.ts` | Yes | Yes (shadow) — wraps persisted `TradeValueSnapshot`; only 2-participant trades are evaluator-supported, 3+ explicitly flagged `unsupported_by_legacy_evaluator` |
| **Commissioner-health slice** | `commissioner-health/{dco,world,rules,decision,shadow,healthCardAdapter}.ts` | Almost — **1 hardcoded NFL check** at `dco.ts:47` (warning injection only, not a rule branch) | Yes (shadow) — wraps `lib/commissioner-hub/commissionerHubHealth.ts` |
| **Behavioral events** (Phase 5) | `behavioral/events/{types,taxonomy}.ts`, `behavioral/facts.ts`, `behavioral/{manager,league,platform}-intelligence.ts` | Yes | Yes (read-only) |
| **Decision Intelligence** (Phase 6) | `phase6/archetypes/`, `phase6/patterns/`, `phase6/dna/`, `phase6/benchmark/`, `phase6/recommendations/`, `phase6/company/` | Yes | Partial — read-only, not yet gated to live routes |
| **Presentation** (Phase 7) | `presentation/{types,badges,cards,graphs,widgets}.ts` | Yes | Partial |
| **Widget SDK** (Phase 7) | `sdk/{types,auth,config,events,lifecycle,embed,theme}.ts` | Yes | Yes (embedded in app/redraft, app/commissioner) |
| **Top-level orchestrators** | `dashboard-intelligence.ts`, `draft-runtime-intelligence.ts`, `league-pulse.ts`, `manager-dna.ts` (adapter, not duplicate — wraps Phase 6 DNA), `recommendations.ts`, `runtime-event-derivation.ts` | Yes | Varies |
| **ADRs / design docs** (23 files) | `ARCHITECTURE_FREEZE.md`, `DECISION_REGISTRY.md`, `G20_DECISION_OS_INTEGRATION_AUDIT.md`, `PHASE_1_COMPLETE.md`, `PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE.md`, `PHASE_E_TRADE_BRIDGE_ARCHITECTURE.md`, `PRODUCTION_READINESS_CHECKLIST.md`, `ADR_F0`–`ADR_F2_8`, `ADR_PHASE3`–`ADR_PHASE5_1` | — | — |

**Live route wiring confirmed:** `app/api/today/lineup-actions`, `app/api/redraft/trade-proposals`, `app/api/waiver-ai/engine`, `app/api/admin/decision-os/telemetry`, `app/api/dev/decision-os/telemetry`, `app/api/v1/intelligence/{platform,league}`.

**Governance already enforced** (per `ARCHITECTURE_FREEZE.md`, verified against code): Canonical World is read-only/no-storage; `CanonicalAsset` is origin-blind; provider identity survives only as provenance, never as a decision input; enrichment degrades to `null` + warning, never fabricates; AI is explanation-only (`DecisionOSAiBoundary.mayInventFacts: false`); every decision (regardless of domain) emits the same four-part `Decision<TAction>` (what_happened / why_it_matters / how_confident / what_to_do).

### 1.2 "Commissioner OS" — not a unified system

| Module | What it does | Decision OS link |
|---|---|---|
| `lib/commissioner/` | Chat notification triggers on settings change / rating prompts | None |
| `lib/commissioner-ai-draft-manager/` | AI team assignment + trade-rule throttling for drafts | None |
| `lib/commissioner-assistant/` | Deterministic health/engagement/fairness scoring (pre-Decision-OS) | None (parallel reimplementation) |
| `lib/commissioner-hub/commissionerHubHealth.ts` | Builds `CommissionerLeagueHealthSnapshot`, **imports Decision OS shadow runner** (`shouldRunCommissionerHealthShadow`, `runCommissionerHealthShadow`) | **The one real bridge** |
| `lib/commissioner-settings/` | Settings CRUD, rule validation, cache invalidation | None |
| `lib/commissioner-engine/` | Audit doc only, no implementation | — |

**Finding:** Commissioner OS and Decision OS are separate silos that happen to read the same Prisma tables. The single intentional integration point is `commissioner-hub → commissioner-health shadow`. Everything else in "Commissioner OS" is legacy feature code with no shared contract.

### 1.3 Duplicated manager/league intelligence (outside Decision OS)

| Duplicate pair | Overlap | Recommendation |
|---|---|---|
| `lib/manager-dna.ts` (root) ↔ `lib/gm-profile/gm-profile-engine.ts` ↔ `lib/decision-os/phase6/dna/dna.ts` | All three independently classify manager archetypes from trade/waiver/draft behavior (~50-70% conceptual overlap, zero code sharing) | Phase 6 DNA is authoritative going forward (already frozen, already sport-agnostic). Deprecate the other two once callers migrate. |
| `lib/league-health/league-health-engine.ts` ↔ `lib/commissioner-hub/commissionerHubHealth.ts` | Both compute health/engagement/fairness/sustainability scores independently (~60% schema overlap) | `commissionerHubHealth` already feeds Decision OS; converge `league-health` API route onto the same snapshot builder instead of recomputing. |
| `lib/league-intelligence/league-intel-engine.ts` ↔ `lib/decision-os/world/leagueIntelEnrichedWorld.ts` | Per-team grading / league-wide insight generation, independently derived | Decision OS version should become canonical; legacy engine's API route (if any) should be re-pointed. |
| `lib/global-fantasy-intelligence/` | Genuine platform-level, multi-sport, anonymized trend aggregation — not duplicated, but **not integrated** with Decision OS's `platform-intelligence.ts` (Phase 5) | Two platform-level aggregators exist in parallel; needs one seam, not necessarily a merge (different inputs: trends/meta vs. behavioral events). |

### 1.4 Sport abstraction (three uncoordinated half-solutions)

| Layer | Shape | Verdict |
|---|---|---|
| `lib/sport-scope.ts` | `SUPPORTED_SPORTS` enum (NFL/NBA/NHL/MLB/NCAAF/NCAAB/SOCCER), `IDP_SUPPORTED_SPORTS` hardcoded to NFL+NCAAF only | Thin, minimal |
| `lib/sportConfig/` | `SportConfigFull` — has `defaultSeasonWeeks`, `defaultPlayoffStartWeek` (week-hardcoded); scoring per-sport with **zero shared stat-key interface** (NFL: `idp_solo`, `def_sack`; MLB: `r`, `ip`, `sv` — no common type) | Week/points assumptions baked in |
| `lib/sport-defaults/` | `DefaultScheduleConfig.schedule_unit: 'week'\|'round'\|'series'\|'slate'\|'scoring_period'`, `matchup_frequency`, `lock_time_behavior` — genuinely flexible fields exist | **Best design intent**, but `playoff_start_week` still leaks week-assumption, and it's a config registry, not an enforced contract |
| `lib/sport-rules-engine/` | Typed `SportRules`/`RosterRules`/`ScoringRules` contracts exist | Defined but minimal runtime enforcement |
| `lib/multi-sport/MultiSportScheduleResolver.ts` | Hardcoded: `label = sport === 'NFL' \|\| sport === 'NCAAF' ? 'week' : 'round'` | Two-tier hack, not a real abstraction |
| `lib/redraft/sportAdapters/{nfl,mlb,nba,nhl,ncaaf,ncaab,soccer}.ts` | Real `SportAdapter` interface: `parseRawStats()`, `getLineupLockTime()` | **Only real adapter interface in the repo today** — but thin, and `REDRAFT_SPORT_CONFIGS` only has NFL populated |
| `lib/providers/providerFallbackPolicy.ts` | `DataDomain` (player_profile, projections, injuries, schedules, adp, trade_value, …) × `ProviderName` (rolling_insights, thesportsdb, clearsports, sleeper, allfantasy_internal), sport-conditional fallback chains | **Best-abstracted layer in the whole codebase** — sport-independent domain model already |
| Roster templates (`nfl-roster`, `mlb-roster`, …) | Share one `RosterSlotDef` type | Type is shared; `category` enum (`kicker`/`dst`/`idp`/`college`) is football-centric |
| Scoring (`nfl-scoring`, `mlb-scoring`, …) | `NflScoringPreset` / `MlbScoringPreset` — parallel, unrelated types, no generic `ScoringPreset<TStatKey>` | Zero code reuse |

### 1.5 Core domain engines (draft / waiver / trade / scoring / schedule / playoff / roster)

| Engine | Core type | Generic? | Decision OS link |
|---|---|---|---|
| **Draft** | `draft-types/draftTypeRegistry.ts` (`DRAFT_TYPE_DEFINITIONS`, 18+ variants: redraft, dynasty, keeper, best_ball, guillotine, survivor, tournament, devy, c2c, zombie, salary_cap, big_brother) | **Yes** — genuinely sport/format-agnostic already | None (no slice yet) |
| **Waiver** | `waiver-engine/WaiverTypes.ts` | Yes (FAAB/priority generic) | **Slice 2 wraps it** |
| **Trade** | `trade-engine/types.ts` — `Asset`, `LeagueContext` | Partial — `Sport = 'nfl' \| 'nba'` hardcoded (line 3), IDP positions hardcoded, `RosterSlot` assumes Taxi/H2H | **Slice 3 wraps it** (wrap-fidelity, doesn't fix the underlying enum) |
| **Scoring** | `scoring-engine/ScoringEngineTypes.ts`, `category-scoring/types.ts` (`ScoringMode: 'points'\|'h2h_category'\|'roto'`) | **Yes** — core calculator is stat-key-agnostic | None (no slice yet) |
| **Schedule** | No dedicated type file — logic lives in `lib/redraft/scheduleEngine.ts` + `lib/schedule-runtime/canonicalScheduleRuntime.ts` | **No** — week is the hardcoded atomic unit, matchup assumes home/away pairing, bye = `awayRosterId: null`. G13 audit already flagged extraction candidates (`SchedulePolicy`, `ScheduleSlot`, `SchedulePersistenceAdapter`) — not yet extracted | None |
| **Playoff** | `lib/redraft/playoffEngine.ts` (`PlayoffStructure`) | **No** — single-elimination bracket + power-of-2 seeding hardcoded; consolation/toilet-bowl unimplemented. G14 audit flagged extraction candidates (`PlayoffParticipant`, `PlayoffQualificationPolicy`, `PlayoffSeedingPolicy`, `PlayoffBracketPolicy`, `PlayoffPersistenceAdapter`) — not yet extracted | None |
| **Roster** | `roster-engine/RosterEngineTypes.ts` (`RosterTemplateDefinition`, `RosterSlotDefinition`) | **Yes** — template-driven, no hardcoded positions, arbitrary slot names/counts per sport+format | **Slice 1 (lineup) wraps the validator** |

**Pattern confirmed across all three implemented slices (lineup/waiver/trade):** Decision OS never re-implements domain logic. It loads canonical facts, wraps the existing legacy engine's output as a deterministic memo, and computes shadow parity against it. This "wrap-fidelity" pattern is the intentional integration seam and should be the template for every future slice (scoring, schedule, playoff, draft).

### 1.6 Chimmy — completely decoupled from Decision OS

- **Zero** `lib/decision-os` imports anywhere in `lib/chimmy*` or `app/api/chimmy`, `app/api/chat/chimmy` (confirmed by grep).
- Entry: `app/api/chat/chimmy/route.ts` (~2,500 LOC) → `ChimmyOrchestrator` (intent + tool routing) → `ChimmyContextEngine` (10 discrete context providers: user, league, matchup, roster, standings, ranking, difficulty, imported history, schedule, subscription) → 12+ **format-specific** enrichment builders scattered across `dynasty-core`, `tournament-mode`, `trade-value-console`, etc. → PECR unified orchestration (LLM call).
- All intelligence is sourced by direct Prisma queries and bespoke per-format builders — bypassing every Decision OS slice, Canonical World, and Phase 5/6 intelligence layer entirely.
- `lib/chimmy-context/structuredPromptPayload.ts:23` hardcodes `type ChimmyStructuredPayloadSport = "NFL" | "NCAAF"`. Every other sport falls back to unstructured context.
- Chimmy has its **own** action/tool registries (`lib/chimmy-actions/AIActionRegistry.ts` and the separate `lib/ai-tool-registry/registry.ts`) with overlapping intent→action mappings and no single source of truth.

---

## 2. What should become the shared Decision OS Core

Keep as-is (already correct, already frozen, do not redesign without an ADR):
- `core/decision.ts` — `Decision<TAction>` four-part contract
- `core/integrationContract.ts` — `DecisionOSInsight`, `DecisionOSEvidenceSourceType`, `DecisionOSPluginContext`, `DecisionOSAiBoundary`
- `world/*` — Canonical World, origin-blind, read-only
- `behavioral/*` — `BehavioralEvent` taxonomy, manager/league/platform behavioral facts
- `phase6/*` — archetype/pattern/DNA classifiers (deterministic, sport-agnostic)
- `presentation/*`, `sdk/*` — widget/embed layer

Add (net-new, additive, documented in §6):
- A formal `SportAdapter` contract that generalizes `redraft/sportAdapters` + `sportConfig` + `sport-defaults` into one interface Decision OS's World layer can call through, instead of the World layer needing to know about redraft-specific stat parsing at all.
- A formal `ProviderAdapter` contract that generalizes `providers/providerFallbackPolicy` (already the best-shaped piece in the repo) into something pluggable per sport/provider.
- `DecisionEvent` as the ingestion-side generalization of the already-good `BehavioralEvent` — same shape, formalized as the public contract other OSes emit into.

## 3. What should remain specific to Commissioner OS

- Settings CRUD, rule enforcement, and notification triggers (`commissioner-settings`, `commissioner`) — these are actions/mutations, not intelligence, and have no reason to live in Decision OS (which is read-only by design).
- Commissioner-facing UI composition (`commissioner-hub` as a *snapshot assembler* feeding Decision OS stays; its role narrows to "build a `CommissionerLeagueHealthSnapshot` and hand it to Decision OS" rather than also scoring health itself).
- Draft-specific AI team assignment (`commissioner-ai-draft-manager`) is a draft-runtime concern, not league intelligence — stays local, may eventually consume a Draft decision slice once one exists (§8).

## 4. What will eventually power User OS

- Behavioral layer (`behavioral/manager-intelligence.ts`, Phase 6 `dna/`, `patterns/`) is already the right shape for user-level intelligence: draft/trade/waiver behavior, risk tolerance, recommendation acceptance, lineup tendencies. It needs a real `UserContextGraph` read API (currently only exposed via one-off top-level orchestrators like `manager-dna.ts`).
- The 3 duplicated manager-archetype engines (§1.3) should converge here — User OS should have exactly one manager-intelligence source of truth.

## 5. What will eventually power Operator OS

- `behavioral/platform-intelligence.ts` (Phase 5) + `phase6/benchmark/` + `phase6/company/` are already aggregate/anonymized and are the right foundation.
- `lib/platform-analytics/` (growth, tool usage, revenue) is a different concern (product analytics, not decision intelligence) and should stay separate but be linkable via shared `PlatformContextGraph` IDs.
- `lib/global-fantasy-intelligence/` (trend/meta aggregation) is not currently wired to Phase 5/6 platform intelligence — Operator OS will need both, joined, not merged.

## 6. What will eventually support DFS / Pick'em / Contest OS

- Nothing today assumes non-season-long formats will work. The primitives that block this:
  - Schedule engine assumes weekly season-long matchups (§1.5).
  - Playoff engine assumes single-elimination bracket cutover from a regular season (§1.5).
  - `Contest`/`Event` (single-slate, no roster persistence across weeks) has **no existing primitive anywhere** in the repo — this is wholly new for Decision OS Core.
- The Canonical World's `CanonicalAsset` (player/pick/faab/contract/keeper/salary/devy/future_consideration) is close to sufficient for DFS-style single-slate rosters, but `CanonicalWorld`'s league/team facts (`facts.ts`) assume a persistent, season-scoped `League`/`Team`, which a one-off Contest doesn't have. This needs a `Contest` primitive that's a lightweight sibling of `League`, not a special case of it.

## 7. What abstractions are needed to stay all-sports and future-format compatible

1. **Sport is a runtime plugin, not an enum branch.** Every place that currently does `sport === 'NFL'` (there is exactly one inside Decision OS, several outside it) must become a lookup through a `SportAdapter`.
2. **Schedule/Playoff must support non-weekly, non-bracket formats.** Minimum viable generalization: `ScheduleUnit = 'week' | 'round' | 'slate' | 'series' | 'continuous'` and `CompetitionStructure = 'season_long_h2h' | 'bracket_elimination' | 'single_slate' | 'roto_standings' | 'best_of_n_series'`. (`sport-defaults` already has the right instinct with `schedule_unit`; it just isn't enforced anywhere.)
3. **Scoring must support points, category, and roto uniformly**, keyed by a per-sport stat vocabulary rather than a hardcoded field union. `category-scoring/types.ts`'s `ScoringMode` is already the right shape — it needs to be the one scoring contract, not one of several.
4. **Roster/Position must stay data, never enum**, exactly as Canonical World already treats it. `RosterEngineTypes.ts`'s template-driven model is correct; the football-centric `category` enum (kicker/dst/idp/college) needs to become an open string set.
5. **Draft/Waiver/Trade formats must stay data-driven the way `draftTypeRegistry` already is** — that module is the best existing example of "abstract primitive, sport supplies the parameters" and should be the pattern copied elsewhere, not reinvented.
6. **Provider integration must be domain-keyed, not sport-keyed**, exactly as `providerFallbackPolicy`'s `DataDomain` × `ProviderName` already does.

## 8. What Phase 1 should build first

In order (each step additive, testable, non-breaking):

1. **`SportAdapter` contract** (types + registry only). Formalize what `redraft/sportAdapters` already does ad hoc; migrate `sportConfig`, `sport-defaults`, `multi-sport` config lookups to go through it. No behavior change — same data, one seam.
2. **`ProviderAdapter` contract** (types + registry only), generalizing `providers/providerFallbackPolicy`'s already-good `DataDomain`/`ProviderName` shape into a formal interface that Sleeper/ESPN/MFL/Yahoo route handlers implement instead of each hand-rolling parsing.
3. **De-duplicate manager intelligence**: pick `phase6/dna` as canonical, add a compatibility read-path for existing consumers of `lib/manager-dna.ts` / `lib/gm-profile`, then migrate callers off the legacy two. (This is cleanup, not new architecture — do it before adding new consumers, or the duplication triples.)
4. **De-duplicate league health**: same pattern — `commissionerHubHealth` (already Decision-OS-wired) becomes canonical, `lib/league-health`'s API route re-points to it.
5. **Formalize `DecisionEvent`** as the public name for the existing `BehavioralEvent` taxonomy, and give it a real ingestion port other future OSes (DFS, Contest) can emit into without importing internal Decision OS types directly.
6. **Wire one new consumer end-to-end as proof**: Chimmy's league-context provider (`ChimmyContextEngine`'s league provider) reading from Decision OS's `CanonicalWorld` + `commissioner-health` decision instead of raw Prisma, behind a flag, shadow-compared against its current output. This is the same wrap-fidelity pattern already proven for lineup/waiver/trade — apply it to a consumer for the first time instead of only to engines.

## 9. What should explicitly not be built yet

- No AI chat changes. No new UI. No DFS/Pick'em product surface. No new sport-specific feature work (NBA/MLB/NHL redraft, etc.).
- No `Contest`/single-slate primitive implementation (design only, per §6) — real DFS support is a separate phase.
- No migration of Chimmy's dual tool/action registries — that's a real refactor with product risk and needs its own plan once Decision OS has a stable action-recommendation output shape to converge onto.
- No rewrite of Schedule/Playoff engines. G13/G14 audits already scoped the extraction candidates; extracting them is real, breakable surface area (touches every live redraft league) and is out of scope for this design phase.
- No forced retirement of the legacy manager-DNA/league-health engines — only a canonical read-path and a migration plan (§8.3–8.4). Deleting them is a separate, reversible-checked step.

## 10. What tests are required before integration

- **Contract tests** for `SportAdapter`/`ProviderAdapter`: every existing sport config (`sportConfig/configs/*.ts`) and every existing redraft adapter (`redraft/sportAdapters/*.ts`) must satisfy the new interface without modification to their exported data — i.e., the new contract wraps existing data, it doesn't require rewriting seven sport configs on day one.
- **Parity tests** for any de-duplication (§8.3–8.4): before repointing a legacy consumer at the canonical engine, snapshot both outputs on real league data and assert equivalence (this repo already has this exact pattern in `core/parity/shadowParity.ts` — reuse it).
- **Regression tests for the four existing decision slices**: whatever this phase touches (SportAdapter especially, since World layer enrichment ports call into sport config) must not change lineup/waiver/trade/commissioner-health shadow output. Re-run existing shadow-parity telemetry as the gate.
- **No new route should go live-gated** (i.e., actually replace legacy output) until its shadow parity has run against real league data for a defined burn-in period, per the existing `DECISION_OS_{SLICE}_LIVE` kill-switch convention already established for the four existing slices.

---

## 11. Proposed module boundaries (folder structure)

This is additive — nothing below requires moving existing `lib/decision-os/` code on day one. New folders are proposed; existing ones are annotated with their eventual role.

```
lib/decision-os/                    # UNCHANGED — stays frozen per ARCHITECTURE_FREEZE.md
  core/                             # Decision<TAction>, DecisionOSInsight — unchanged
  world/                            # Canonical World — unchanged
  behavioral/                       # DecisionEvent taxonomy (renamed public alias, not a rewrite)
  phase6/                           # Decision Intelligence classifiers — unchanged
  presentation/, sdk/               # unchanged
  lineup/ waiver/ trade/ commissioner-health/   # existing slices — unchanged
  scoring/ schedule/ playoff/ draft/            # NEW slices, built later (§8 is not this)

lib/decision-os-core/               # NEW — the sport/provider abstraction layer this doc proposes
  sport-adapter/
    types.ts                       # SportAdapter contract (§13.2)
    registry.ts                    # sport -> adapter lookup
    adapters/
      nfl.ts ncaaf.ts mlb.ts ...   # thin wrappers delegating to existing sportConfig/redraft adapters
  provider-adapter/
    types.ts                       # ProviderAdapter contract (§13.3)
    registry.ts                    # provider -> adapter lookup
    adapters/
      sleeper.ts espn.ts ...       # thin wrappers delegating to existing provider code
  context/
    types.ts                      # DecisionOSContext, LeagueStateGraph, UserContextGraph, PlatformContextGraph (§13.1, 13.4-13.6)
  events/
    types.ts                      # DecisionEvent (public alias of behavioral/events/types.ts)
  results/
    types.ts                      # RecommendationResult, InsightResult, SimulationResult (§13.8-13.10)

lib/commissioner-os/                # NOT NEW CODE — documentation-only grouping of existing modules
                                     # (commissioner-hub, commissioner-settings, commissioner) — no file moves in Phase 1

lib/chimmy*/                        # unchanged in Phase 1; §8.6 adds one shadow-compared read path
```

---

## 12. Data model primitives (target state)

Per the task's requested vocabulary, mapped onto what already exists vs. what's net-new:

| Requested primitive | Existing equivalent | Status |
|---|---|---|
| Sport | `lib/sport-scope.ts SUPPORTED_SPORTS` (data) + new `SportAdapter` (behavior) | Data exists; behavior contract is new |
| Competition / Contest | — | **Net new** (§6) |
| League | Prisma `League` + `world/facts.ts RawLeagueRow` | Exists |
| Season | Implicit in League rows | Exists, informally |
| Event | `behavioral/events/types.ts BehavioralEvent` | Exists — becomes public `DecisionEvent` |
| Matchup | `redraft` schedule rows (week-hardcoded) | Exists, needs generalizing (§7.2) |
| Participant / Team | `world/facts.ts RawTeamRow` | Exists |
| Player | `world/assets.ts PlayerAssetMetadata` | Exists, sport-agnostic already |
| Roster / Slot | `roster-engine/RosterEngineTypes.ts RosterTemplateDefinition/RosterSlotDefinition` | Exists, sport-agnostic already |
| Asset | `world/assets.ts CanonicalAssetType` | Exists, sport-agnostic already |
| Transaction | `trade-engine`, `waiver-engine` types (separately) | Exists per-domain, not unified |
| Draft / Pick | `draft-types/draftTypeRegistry.ts` | Exists, already generic |
| RuleSet | `sport-rules-engine/types.ts SportRules` | Exists as a type, minimal enforcement |
| ScoringModel | `category-scoring/types.ts ScoringMode` | Exists, already generic |
| ScheduleModel | — (only week-hardcoded impl exists) | **Needs generalization** (§7.2) |
| StandingsModel | Implicit in redraft standings calc | Exists informally, not extracted |
| PlayoffModel | `redraft/playoffEngine.ts PlayoffStructure` (bracket-only) | **Needs generalization** (§7.2) |
| WaiverModel | `waiver-engine/WaiverTypes.ts` | Exists, generic |
| TradeModel | `trade-engine/types.ts` | Exists, needs `Sport` enum fix (§1.5) |
| ManagerProfile | `phase6/dna/dna.ts ManagerDnaProfile` (+ 2 duplicates, §1.3) | Exists, needs de-dup |
| UserProfile | Prisma `User` + behavioral facts | Exists |
| OperatorProfile | `behavioral/platform-intelligence.ts` | Exists |
| Recommendation | `phase6/recommendations/` | Exists |
| Simulation | `lib/simulation-engine`, `lib/monte-carlo.ts` (separate from Decision OS) | Exists, not integrated |
| Insight | `core/integrationContract.ts DecisionOSInsight` | Exists |
| DecisionEvent | `behavioral/events/types.ts BehavioralEvent` | Exists, becomes the public name |

---

## 13. First minimal contracts

These are documentation-only in this phase (per constraint: "do not make broad code changes yet unless purely additive documentation/types"). Each explicitly notes what existing type it wraps or generalizes, so Phase 1 implementation is a thin adapter layer, not a rewrite.

### 13.1 `DecisionOSContext`

Assembles everything a decision needs to be made, generalizing what each slice's `world.ts` currently builds ad hoc.

```typescript
interface DecisionOSContext {
  sport: SportRef;                 // resolved via SportAdapter, never a raw string comparison
  league: LeagueStateGraph;
  user: UserContextGraph | null;    // null for operator-only / anonymous decisions
  platform: PlatformContextGraph;   // always available, always anonymized-safe
  pluginContext: DecisionOSPluginContext; // EXISTING type, core/integrationContract.ts — unchanged
}

interface SportRef {
  sport: string;          // e.g. "NFL" — data, never branched on directly by callers
  adapterVersion: string; // which SportAdapter implementation resolved this context
}
```

### 13.2 `SportAdapter`

Generalizes `lib/redraft/sportAdapters/*.ts` (today's only real adapter interface) plus the config lookups in `sportConfig` / `sport-defaults` / `multi-sport`.

```typescript
interface SportAdapter {
  sport: string;
  scheduleUnit: 'week' | 'round' | 'slate' | 'series' | 'continuous';
  competitionStructure: 'season_long_h2h' | 'bracket_elimination' | 'single_slate' | 'roto_standings' | 'best_of_n_series';
  rosterSlotCategories: string[];       // open set, not the current hardcoded kicker/dst/idp/college enum
  scoringStatVocabulary: string[];      // this sport's valid stat keys, replacing per-sport hardcoded enums
  parseRawStats(raw: Record<string, number>): Record<string, number>;  // == existing SportAdapter.parseRawStats
  getLineupLockTime(gameTimeIso: string): Date;                        // == existing SportAdapter.getLineupLockTime
  supportsIDP: boolean;                 // replaces sport-scope.ts's hardcoded IDP_SUPPORTED_SPORTS list
}
```

### 13.3 `ProviderAdapter`

Generalizes `lib/providers/providerFallbackPolicy.ts`'s `DataDomain` × `ProviderName` model — already the best-shaped piece of this problem in the codebase today.

```typescript
type DataDomain =                       // == existing DataDomain, providerFallbackPolicy.ts
  | 'player_profile' | 'player_stats' | 'projections' | 'injuries'
  | 'schedules' | 'games' | 'adp' | 'trade_value' | 'roster_context' | 'lineup_context';

interface ProviderAdapter {
  providerName: string;                 // == existing ProviderName
  supportedSports: string[];
  supportedDomains: DataDomain[];
  fetch<T>(domain: DataDomain, sport: string, params: Record<string, unknown>): Promise<T | null>;
  // returns null on miss so callers can fall through the existing fallback chain — no change to chainForDomain()
}
```

### 13.4 `LeagueStateGraph`

Generalizes `world/facts.ts` + `world/assemble.ts` (the existing Canonical World) — same data, formal public name.

```typescript
interface LeagueStateGraph {
  league: { id: string; sport: string; format: string; isDynasty: boolean };  // == RawLeagueRow, narrowed
  teams: TeamNode[];            // == RawTeamRow[]
  rosters: RosterNode[];        // == RawRosterRow[], via roster-engine's RosterTemplateDefinition
  standings: StandingsNode | null;   // NET NEW — not currently extracted as a standalone type (§12)
  schedule: ScheduleNode | null;     // generalizes scheduleBye.ts's TeamScheduleContext
}
```

### 13.5 `UserContextGraph`

Generalizes the behavioral layer's per-manager facts (`behavioral/facts.ts ManagerBehavioralFacts`) plus Phase 6 DNA — the target single source of truth replacing the 3 duplicated manager-intelligence engines (§1.3).

```typescript
interface UserContextGraph {
  userId: string;
  behavioralFacts: ManagerBehavioralFacts;   // == existing type, behavioral/facts.ts
  dna: ManagerDnaProfile | null;             // == existing type, phase6/dna/types.ts
  preferences: { riskTolerance: string; favoriteAssets: string[] } | null;
}
```

### 13.6 `PlatformContextGraph`

Generalizes `behavioral/facts.ts PlatformBehavioralFacts` + `phase6/benchmark/` — always anonymized/aggregate.

```typescript
interface PlatformContextGraph {
  platformFacts: PlatformBehavioralFacts;    // == existing type, behavioral/facts.ts
  benchmarks: BenchmarkResult | null;        // == existing type, phase6/benchmark/types.ts
}
```

### 13.7 `DecisionEvent`

The public name for the existing, already-sport-agnostic `BehavioralEvent` (`behavioral/events/types.ts`) — formalized as the ingestion contract other future OSes (DFS, Contest) emit into without reaching into Decision OS internals.

```typescript
interface DecisionEvent {
  eventType: string;          // == BehavioralEvent's event taxonomy, behavioral/events/taxonomy.ts
  actorType: 'manager' | 'commissioner' | 'operator' | 'system';
  leagueId: string | null;    // null for platform-level / operator events
  userId: string | null;
  timestamp: string;
  payload: Record<string, unknown>;  // event-specific, validated against taxonomy.ts per eventType
}
```

### 13.8 `RecommendationResult`

Generalizes `phase6/recommendations/` output + the `what_to_do` arm of `Decision<TAction>`.

```typescript
interface RecommendationResult<TAction = unknown> {
  decision: Decision<TAction>;   // == EXISTING core/decision.ts type, unchanged
  insight: DecisionOSInsight<TAction>; // == EXISTING core/integrationContract.ts type, unchanged
  presentation: RecommendationCard;    // == EXISTING presentation/types.ts type, unchanged
}
```

### 13.9 `InsightResult`

Read-side generalization of `DecisionOSInsight` for non-action-oriented outputs (e.g., league health assessment, benchmarking) — same evidence/derivation contract, no `what_to_do` arm required.

```typescript
interface InsightResult {
  evidence: DecisionOSEvidenceSourceType[];   // == EXISTING core/integrationContract.ts type, unchanged
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  card: IntelligenceCard | HealthCard;        // == EXISTING presentation/types.ts types, unchanged
}
```

### 13.10 `SimulationResult`

Net new — today `lib/simulation-engine` and `lib/monte-carlo.ts` exist entirely outside Decision OS. This is the seam for eventually wrapping them the same wrap-fidelity way lineup/waiver/trade already wrap their legacy engines.

```typescript
interface SimulationResult {
  simulationType: string;
  inputs: LeagueStateGraph;      // reuses §13.4, no new input contract needed
  outcomes: { scenario: string; probability: number }[];
  confidence: 'low' | 'medium' | 'high';
}
```

---

## 14. API boundaries

- **Decision OS Core exposes reads only** — this is already the enforced invariant (`port.ts` is find-only, no writes) and should not change. Every consumer (Chimmy, Commissioner OS, future DFS/Contest OS) calls in; nothing calls out except emitting `DecisionEvent`s.
- **One ingestion boundary**: `DecisionEvent` emission. Today, behavioral events are emitted from inside specific engines (trade, waiver, lineup) directly into `behavioral/`. The formalized contract (§13.7) should be the only sanctioned way any new OS emits activity into Decision OS — no new OS should read/write Prisma tables Decision OS also reads, to avoid recreating the "same table, two silos" problem seen in Commissioner OS today (§1.2).
- **One read boundary per consumer type**: `LeagueStateGraph` for league-scoped reads, `UserContextGraph` for manager-scoped reads, `PlatformContextGraph` for aggregate reads. Chimmy, Commissioner OS, and any future OS should all go through these three, not bespoke queries.

## 15. Adapter strategy

- `SportAdapter` and `ProviderAdapter` (§13.2–13.3) are the only two adapter types Phase 1 introduces. Both are additive wrappers around existing, working code (`redraft/sportAdapters`, `providerFallbackPolicy`) — no existing sport config or provider integration needs to be rewritten to satisfy them on day one.
- Adapters are resolved by registry lookup (`sport -> SportAdapter`, `provider -> ProviderAdapter`), never by inline conditionals. This directly fixes the one hardcoded NFL check in Decision OS today (`commissioner-health/dco.ts:47`) and the several outside it (`multi-sport/MultiSportScheduleResolver.ts`, `sport-scope.ts`'s `IDP_SUPPORTED_SPORTS`).

## 16. Event strategy

- `DecisionEvent` (§13.7) generalizes the existing `BehavioralEvent` taxonomy — no new event bus needs to be built; `behavioral/events/taxonomy.ts` already has the right shape (manager actions, league lifecycle, commissioner actions). Phase 1 only needs to document this as the public contract and give it a stable public name, not re-architect ingestion.
- Future OSes (DFS/Contest) should define their own event types as extensions of the same `DecisionEvent` shape, not a parallel taxonomy.

## 17. Testing strategy

Covered in §10. Key principle: every change in this phase is either (a) a pure type/interface addition with zero runtime behavior change, or (b) a de-duplication with parity-tested equivalence before any consumer switch. Nothing in Phase 1 touches the four live shadow slices' actual decision output.

## 18. Migration plan

1. Land `lib/decision-os-core/` as new, additive, unimported code (types + thin registries wrapping existing adapters). Zero consumers initially — this is the safest possible increment.
2. Add contract tests (§10) proving the new `SportAdapter`/`ProviderAdapter` registries correctly wrap all 7 existing sport configs and both existing provider fallback paths, with no behavior change.
3. Migrate one low-risk internal caller (e.g., `commissioner-health/dco.ts:47`'s hardcoded NFL check) to use the registry instead of a string comparison — this is the very first real consumer and directly deletes the one sport-specific line inside frozen Decision OS code.
4. Execute the manager-DNA and league-health de-duplications (§8.3–8.4) behind parity tests.
5. Wire Chimmy's league-context provider through `LeagueStateGraph` behind a flag, shadow-compared (§8.6) — proves an *external* consumer (not just an internal engine) can read Decision OS Core successfully.
6. Only after step 5 is stable: begin scoping actual Scoring/Schedule/Playoff/Draft decision slices (net-new Decision OS slices, out of scope for this phase).

## 19. Risks and assumptions

- **Risk:** De-duplicating manager-DNA/league-health engines touches live, user-facing API routes (`/api/gm-profile`, `/api/league-health`). Mitigate with parity tests before any route re-point, per §10.
- **Risk:** `trade-engine/types.ts`'s hardcoded `Sport = 'nfl' | 'nba'` enum is a real blocker for any NBA/MLB trade evaluation today, independent of this plan — flagging it here, but fixing it is downstream engine work, not Decision OS Core work.
- **Risk:** Schedule/Playoff generalization (§7.2) is the single largest piece of latent NFL-specificity in the whole audit and is explicitly deferred (§9) because it touches every live redraft league's data model. Treat this as the biggest single risk to eventual multi-sport support, and sequence it deliberately once Phase 1's adapter layer exists to de-risk it.
- **Assumption:** The existing four decision slices' shadow-parity telemetry is currently healthy (per `ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md`, `ADR_PHASE4_6_TELEMETRY.md`) — this plan assumes that baseline holds and doesn't re-verify it. If it's regressed since those ADRs, that should be resolved before starting Phase 1 migration steps (not this design step).
- **Assumption:** "Additive, unimported code" (step 1 of §18) genuinely carries zero deploy risk — true only if `lib/decision-os-core/` has no barrel file re-exported from anywhere consumed by the build. Verify this explicitly when Phase 1 lands.

---

## 20. Definition of Done — this phase

- [x] Existing OS/intelligence code audited (5 parallel deep-dives: Decision OS core, Commissioner/Manager/League intelligence, sport abstraction & providers, draft/waiver/trade/scoring/schedule/playoff engines, Chimmy).
- [x] NFL-specific assumptions identified with file:line precision (§1.4, §1.5, §1.6).
- [x] Sport-agnostic Decision OS Core architecture proposed (§11, building on what's already correct rather than redesigning it).
- [x] First universal interfaces/contracts documented (§13).
- [x] Commissioner OS, User OS, Operator OS, DFS OS, Chimmy shown as consumers of the same core (§3–6, §14).
- [x] No existing redraft/league/draft/waiver/trade/scoring/playoff/Commissioner OS behavior touched — this phase is documentation only.

---

## 21. Handoff

**Files inspected:** `lib/decision-os/**` (all subdirectories + 23 ADR/design docs), `lib/commissioner*/`, `lib/manager-dna.ts`, `lib/gm-profile/`, `lib/league-health/`, `lib/league-intelligence/`, `lib/league-intelligence-graph/`, `lib/global-fantasy-intelligence/`, `lib/global-intelligence/`, `lib/platform-analytics/`, `lib/sport-scope.ts`, `lib/sportConfig/`, `lib/sport-defaults/`, `lib/sport-rules-engine/`, `lib/multi-sport/`, `lib/redraft/sportAdapters/`, `lib/redraft/sportConfig.ts`, `lib/{nfl,ncaaf,mlb,nba,nhl,soccer,ncaab}-{roster,scoring,schedule}/`, `lib/providers/providerFallbackPolicy.ts`, `lib/nfl-provider/`, `lib/draft-types/`, `lib/waiver-engine/`, `lib/trade-engine/`, `lib/scoring-engine/`, `lib/category-scoring/`, `lib/schedule-engine/`, `lib/playoff-engine/`, `lib/roster-engine/`, `lib/league-runtime/`, `lib/chimmy*/` (all 15 chimmy directories), `app/api/chimmy/`, `app/api/chat/chimmy/`, plus corroborating `app/api/*` route wiring checks.

**Files created:** `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` (this document). No other files changed.

**Key findings:**
1. Decision OS Core is already well-built and already sport-agnostic — the unification problem is almost entirely in the surrounding, uncoordinated legacy code, not in Decision OS itself.
2. Three duplicated manager-intelligence engines and two duplicated league-health engines need de-duplication before any new consumer is added, or the duplication compounds.
3. "Commissioner OS" is not a real unified system today — it's scattered modules with one intentional Decision OS bridge.
4. Chimmy is a completely separate intelligence stack today, with a hardcoded NFL/NCAAF-only structured schema — it will need real integration work (§8.6), not just a config change.
5. Provider integration (`providerFallbackPolicy.ts`) is the most mature abstraction already in the codebase and should be the template for the new `ProviderAdapter` contract, not something built from scratch.
6. Schedule and Playoff engines carry the deepest NFL/weekly-H2H assumptions and are explicitly the highest-risk, highest-effort item for true multi-sport support — deliberately deferred past this phase.

**Recommended Phase 1 implementation prompt** (for a future session):
> "Implement `lib/decision-os-core/` per §11 and §13 of `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md`: land the `SportAdapter` and `ProviderAdapter` type/registry files as new, additive, currently-unimported code. Add contract tests proving the registries correctly wrap all 7 existing sport configs (`lib/sportConfig/configs/*.ts`) and the existing `providerFallbackPolicy.ts` chains with zero behavior change. Do not touch any live decision slice, route, or engine in this step."

**Risks to watch:** de-duplication migrations touching live API routes (§19); the single hardcoded NFL check in `commissioner-health/dco.ts:47` is trivial to fix but is inside frozen, shadow-live code — any change there needs a parity re-run before merge, not just a type change.
