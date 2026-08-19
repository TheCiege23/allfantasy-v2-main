# Decision OS — Recommendation Consolidation Plan

**Status:** Architecture audit and design only. No source code, API, schema, or behavior changed.
**Branch:** `g15-event-foundation`
**Builds on:** `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` (§1 intelligence duplication, §6 pipeline actual-vs-intended, §7 debt ranking, §8 Phase 3/4/5 roadmap — assumed as read, not re-derived), `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` (§1 file inventory, §11 module boundaries, §13 first contracts, §18 migration plan — assumed as read), `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` (§1 recommendation inventory for trade/waiver/discovery domains, §5 the one real learning mechanism — assumed as read).
**Method:** Direct reading of the three docs above plus four parallel deep-dive passes this session covering (a) AI Coach / Fantasy Coach, (b) draft recommendation systems, (c) lineup/roster optimization systems, (d) Chimmy's action/tool registries and remaining platform-intelligence modules — closing every gap the three prior documents left unexamined.

---

## Why this document exists, and what it does not re-litigate

The three prerequisite documents already did most of the hard work of finding duplication in **manager intelligence** (3 archetype engines), **league health** (2 engines), **league grading** (2 engines), and **trade/waiver/discovery recommendations** (Decision OS `phase6/recommendations` vs. `smart-trade-recommendations.ts` vs. `user-recommendation-engine`). This document does not re-derive those findings — it cites them by section and focuses on the parts of the recommendation landscape those three documents left unexamined: **AI Coach, Fantasy Coach, every lineup/roster/draft optimizer, and Chimmy's internal action/tool registries.** The result is the first genuinely complete recommendation inventory across the platform.

**Explicitly out of scope for this document, per this task's instructions:** Trade Learning (operationally complete as of Phase 12, `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` — left alone until real staging volume exists), enabling any `DECISION_OS_*_LIVE`/`TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` flag, Manager Intelligence behavior changes, Chimmy wiring, AI Coach redesign, and any customer-facing behavior change. Nothing below moves code.

---

## 1. Complete recommendation inventory

Organized by domain. Each system is documented with purpose / inputs / outputs / consumers / deterministic-vs-AI / current owner. Systems already fully documented in the three prerequisite docs are given a one-line summary with a citation rather than re-derived in full.

### 1.1 Decision OS core (the canonical target)

| System | Purpose | Inputs | Outputs | Consumers | Det. vs AI | Owner |
|---|---|---|---|---|---|---|
| `phase6/recommendations/assembleManagerRecommendations()` | Per-manager recommendation set (trade_coaching, waiver_strategy, lineup_discipline, engagement_boost) | Phase 6.1 patterns + Phase 6.2 DNA outputs (behavioral facts) | `RecommendationCard[]`, each backed by `Decision<TAction>` + `DecisionOSInsight` | Dashboard, League Home, Commissioner Hub (via `resolveManagerIntelligencePayload` → `GET /api/decision-os/manager-intelligence`) | Deterministic — pure rule evaluation over classifier outputs, zero LLM calls | Live, frozen, Decision OS (Checkpoint §2 "Recommendation Engine" row) |
| Four decision slices (`lineup/`, `waiver/`, `trade/`, `commissioner-health/`) | Wrap an existing legacy engine's output as a canonical `Decision<TAction>` with shadow parity | Canonical World facts + the wrapped legacy engine's own output | `Decision<TAction>` (what_happened/why_it_matters/how_confident/what_to_do) + `DecisionOSInsight` | Shadow-only (parity telemetry); manager-tier recommendations above are the only *live* consumer today | Deterministic wrap; explanation-only AI boundary (`mayInventFacts: false`) is asserted but not yet exercised by any of the four slices | Live shadow, Core Unification Plan §1.1 |

**This is the architectural template the rest of this document proposes generalizing** — see §3.

### 1.2 Trade domain

Already fully inventoried in `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §1.2. Summary, not re-derived:

| System | Purpose | Det. vs AI | Owner |
|---|---|---|---|
| Dual-brain trade analyzer / core-engine | ACCEPT/REJECT/LEAN verdict + grade | Deterministic core + AI narrative | Live |
| `acceptance-model.ts` | Static logistic acceptance probability | Deterministic, hardcoded weights | Live, uncoordinated with trade-engine's own model |
| `smart-trade-recommendations.ts` | Acquire/sell/swap suggestions from Sleeper history | Deterministic (FantasyCalc) | Live — **confirmed direct duplicate of `phase6/recommendations`'s `trade_coaching` category** (Checkpoint §1) |
| `trade-alternatives.ts` | Refinement options after a rejected proposal | Deterministic | Live, complementary (not duplicative) |
| Trade AI DM Service | Private-message verdict on a received offer | Deterministic | Live |
| Trade Learning (`trade-engine/{accept-calibration,auto-recalibration,isotonic-calibrator,drift-detection}.ts`) | Closed-loop calibration of the acceptance model's intercept | Deterministic statistics | **Out of scope this phase** — operationally complete, see `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` |

### 1.3 Waiver domain

`lib/ai/waivers/waiverRecommendationService.ts` → `generateWaiverRecommendations()`, live via `POST /api/ai/waivers/recommend`. 3–5 ranked add/drop suggestions with confidence + suggested FAAB bid, falls back to static stubs on data gaps. Deterministic scoring, no LLM. No outcome-learning (`docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §1.3). Wrapped, unmodified, by Decision OS's waiver slice (§1.1).

### 1.4 Lineup / roster optimization domain (new this pass — the prior three documents did not inventory this)

Seven distinct systems, confirmed genuinely distinct problems (validate vs. optimize vs. auto-fix vs. advise), not duplication:

| System | Purpose | Inputs | Outputs | Consumers | Det. vs AI | Owner |
|---|---|---|---|---|---|---|
| `LineupOptimizerEngine` (`lib/lineup-optimizer-engine/LineupOptimizerEngine.ts`) | Maximize projected points within roster-slot constraints (bestball, ad hoc) | Roster + projected points + slot definitions, multi-sport | Ranked starters/bench, total points, unfilled slots | `lib/bestball/leagueOptimizer.ts`, `POST /api/bestball/optimize`, and reused by AI Coach's `optimizeLineupDeterministic()` | Pure algorithmic (DP) | Live core engine |
| `AutoSubLineupEngine` (`lib/auto-sub-lineup-engine/`) | Injury/inactive-triggered auto-substitution | Starters+bench with injury status, slot locks, user preference profile | Executed/blocked auto-subs with confidence + reasoning | Live AI tool | Deterministic composite scoring (WeeklyStart/RoleSecurity/Health/SlotFit/Preference weights) | Live |
| `IdpBestBallOptimizer` (`lib/idp/IdpBestBallOptimizer.ts`) | IDP-specific greedy best-ball optimizer | IDP players + offensive/defensive slot defs | `starters[]`/`bench[]`/total points | `/api/bestball/optimize` (IDP branch) | Pure greedy algorithm | Live, specialist |
| `StartSitAnalysisEngine` (`lib/ai-tools-start-sit/runStartSitAnalysis.ts`) | Weekly, fixture-aware start/sit advice, incorporating live game state | Lineup, injury/news, opponent matchup context, historical FPPG | Per-player action + confidence + reasoning | `POST /api/ai-tools/start-sit/analyze` | Hybrid — deterministic scoring + optional AI narrative | Live AI tool |
| Decision OS lineup slice | Validate a **submitted** lineup against canonical facts, emit a Decision | LineupDCO (already-submitted lineup) + rules engine | `Decision<LineupActionItem>` | Shadow-only, no live surface | Deterministic wrap of `lib/redraft/lineupValidation`, no AI | Shadow, Core Unification Plan §1.1 |
| AI Coach `optimizeLineupDeterministic()` (`lib/ai-coach/deterministic-recommenders.ts`) | Single-decision lineup-optimization advice inside a coaching session | `AICoachInput` (roster, matchup, league settings) | `CoachRecommendation` + AI-narrated `CoachExplanation` | `POST /api/coach/advice`, `CoachAdvicePanel.tsx` | Deterministic base, OpenAI explanation layer with deterministic fallback | Live |
| `lib/bestball/leagueOptimizer.ts` | Thin bestball-specific wrapper around `LineupOptimizerEngine` | League + roster context | Optimized lineup | `/api/bestball/optimize` | Deterministic (delegates) | Live wrapper, not a separate engine |

**Verdict: no true duplication found here.** Each answers a genuinely different question (*validate what was submitted* vs. *optimize from scratch* vs. *auto-fix on injury* vs. *advise on one decision this week*), confirmed by direct code reading, not just naming. This is the one domain in the entire audit where surface-level "there are 7 lineup systems!" concern does **not** hold up — see §2.

### 1.5 Draft domain (new this pass)

Six distinct systems share one deterministic backbone (`lib/draft-helper/RecommendationEngine.ts`'s `computeDraftRecommendation()`/`computeDraftPlayerRankings()`) — a genuinely good example of architectural convergence already achieved at the *evidence* layer. The duplication in this domain is at the **orchestration/routing layer**, not the scoring layer (see §2).

| System | Purpose | Consumers | Det. vs AI | Owner |
|---|---|---|---|---|
| `RecommendationEngine` (`lib/draft-helper/`) | Shared deterministic scoring backbone: needs-based vs. BPA, ADP edge, positional scarcity | Consumed by all five systems below | Deterministic | Live, canonical evidence source |
| `aiDraftHelper` / "War Room" (`lib/ai/aiDraftHelper.ts`) | Interactive advisor with narrative reasoning, risk, alternatives | `POST /api/ai/draft/recommend` | Deterministic base + OpenAI/DeepSeek narrative, deterministic fallback | Live |
| `draft-ai-engine` (`lib/draft-ai-engine/`) | Lighter-weight assist with optional 2-sentence explanation | `POST /api/draft/recommend`, `POST /api/draft-ai/route.ts` | Deterministic base + optional AI explanation | Live — **a second route wrapping the same engine as War Room** |
| `aiOpponentDraft` / live autopick (`lib/ai/opponents/liveDraftAiAutopick.ts`) | Automated pick selection for AI-controlled bot teams on timer expiry | Live-draft timer-expiry hook | Pure deterministic (archetype tendency weights, chaos noise) | Live |
| `DraftIntelligenceSnapshot` (`lib/ai/draft/aiDraftIntelligence.ts`) | Value-vs-market / reach / risk / confidence snapshot for UI overlays | Mock draft UI, dashboard overlays | Deterministic, no LLM | Live |
| `LiveDraftBrain` (`lib/live-draft-brain/`) | Real-time multi-mode (BPA/needs/upside/safe/win_now) pick scoring + post-draft letter grading | Live draft room UI | Pure deterministic | Live |
| `CommissionerAiDraftManager` | AI-persona assignment + trade-rule throttling for bot teams (not itself a recommender) | Commissioner setup UI; consumed by `liveDraftAiAutopick` | No AI — pure rules/config engine | Live |

### 1.6 Manager / league intelligence domain

Already fully inventoried in `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` §1 (Manager identity/archetype row, League health row, League-level intelligence row). Not re-derived — cited by reference. Summary for completeness of this document's inventory:

| System | Owner | Status |
|---|---|---|
| `phase6/dna/` | Canonical target | Live, frozen |
| `lib/manager-dna.ts` | Live duplicate (AI Coach/Trade Analyzer/Trade Proposal Generator consumer) | Blocked on `conservative_roster_pattern` ADR + volume evidence (Checkpoint §7) |
| `lib/gm-profile/` | Retired | `f1581dcd8` |
| `lib/commissioner-hub/commissionerHubHealth.ts` | The one intentional Decision OS bridge | Live |
| `lib/league-health/league-health-engine.ts` | Duplicate | ~60% schema overlap |
| `lib/league-intelligence/league-intel-engine.ts` | Duplicate | ~40% conceptual overlap with `world/leagueIntelEnrichedWorld.ts` |

### 1.7 AI Coach and Fantasy Coach (new this pass)

Confirmed **layered, not duplicated**, via direct import tracing:

| System | Purpose | Inputs | Outputs | Consumers | Det. vs AI | Owner |
|---|---|---|---|---|---|---|
| `lib/ai-coach/` (`AICoachService.ts`, `deterministic-recommenders.ts`) | Single-decision tactical advice for one advice type per call: start_sit, lineup_optimization, waiver, trade, draft | `AICoachInput` (roster, matchup, league settings, player stats) | `AICoachResponse` (recommendation + explanation), logged to `ai_output` table | `POST /api/coach/advice`, `CoachAdvicePanel.tsx` | Deterministic recommender first (`getDeterministicRecommendation()`); OpenAI explanation second, with deterministic-text fallback if the LLM call fails | Live |
| `lib/fantasy-coach/` (`FantasyCoachAI.ts`, `CoachEvaluationService.ts`) | Weekly holistic team evaluation: strengths/weaknesses, waiver/trade opportunities, metrics | `CoachContext` (leagueId, teamName, week, sport) — reconstructs roster internally via simulation presets | `CoachEvaluationResult` (rich multi-field: strengths, weaknesses, opportunities, metrics, three parallel AI-provider overlays) | `POST /api/coach/evaluation`, `GET /api/coach/evaluation`, `CoachDashboard.tsx`, `AdvantageDashboardPage.tsx` | Deterministic base (`buildDeterministicCoachEvaluation()`) + three parallel LLM overlays (DeepSeek for roster-math explanation, Grok for strategy framing, OpenAI for weekly-advice narrative), each with a deterministic fallback | Live |

**Confirmed relationship:** `ai-coach/deterministic-recommenders.ts` **imports** `getStrategyRecommendation()` from `fantasy-coach/StrategyRecommendationEngine.ts` for its waiver/trade/draft advice types — genuine delegation. AI Coach is the single-decision front-end; Fantasy Coach is the holistic-evaluation engine that AI Coach borrows generic strategy templates from. Neither imports `lib/decision-os/` or `lib/manager-dna.ts`.

### 1.8 Chimmy internals (new this pass, deeper than the prior docs went)

| System | Purpose | Det. vs AI | Consumers | Owner |
|---|---|---|---|---|
| `AIActionRegistry` (`lib/chimmy-actions/AIActionRegistry.ts`) | Static metadata for 54 action types (label, safety class, permissions, destructiveness, valid surfaces) — **UI action choreography, not a recommender** | No logic at all — pure declarative metadata | `app/api/ai/actions/execute/route.ts`, `app/api/ai/actions/validate/route.ts` | Live |
| `AIToolRegistry` (`lib/ai-tool-registry/registry.ts`) | Tool-calling orchestration for LLM backends: 16 tools, each declaring deterministic-prerequisite requirements + allowed providers + response schema | Deterministic context validation → LLM routing | Backend chat orchestration | Live |
| Chimmy's 10 context providers + 12+ format-specific enrichment builders | Assembles chat context from direct Prisma queries, bypassing every Decision OS layer | Mixed | `app/api/chat/chimmy/route.ts` | Live, Core Unification Plan §1.6 |

**Finding confirmed:** `AIActionRegistry` and `AIToolRegistry` overlap **only in intent naming** (both have a `trade_analyzer`/`analyze_trade`-style pair) — they serve genuinely different architectural roles (UI action binding vs. backend LLM tool-selection), but the naming collision means neither is a reliable single source of truth for "what can Chimmy recommend/do," which is the actual root of the "no single source of truth" finding the Core Unification Plan already flagged (§1.6) — this document narrows that finding to its precise cause.

### 1.9 Platform / discovery domain

Already substantially covered by the Checkpoint (§1 "Manager/user-tier recommendations" row) and Closed-Loop Audit (§1.4). New-this-pass confirmation:

| System | Purpose | Det. vs AI | Overlap finding |
|---|---|---|---|
| `GlobalFantasyIntelligenceEngine` | Platform-level, multi-sport, anonymized trend/meta/dynasty/simulation aggregation | Fully deterministic aggregator — a context-builder for downstream AI, not itself a recommender | Complementary to `behavioral/platform-intelligence.ts` (Phase 5) — different inputs (market trends vs. behavioral events), needs one seam, not a merge (Core Unification Plan §1.3) |
| `ProductInsights` (`lib/analytics/productInsights.ts`) | Telemetry/reporting aggregation | Deterministic SQL aggregation | **Not a recommendation system** — included here only to confirm it was checked and correctly excluded |
| `LeagueRecommendationEngine` | League-discovery matching by format/scoring/size | Deterministic scoring; **optional** AI narrative-only refinement (never changes the recommendation itself) | Confirmed distinct, low overlap (Checkpoint §1 already found this; re-confirmed with file-level detail this pass) |
| `user-recommendation-engine` | Aggregates tool-usage/engagement events into recommendations | Deterministic | **Confirmed duplicate** of Decision OS's `engagement_boost` category (Checkpoint §1) |
| `saved-recommendations` | Universal recommendation-persistence sink | N/A — scaffold, mutations no-op | Incomplete, not a competing live system (Checkpoint §1) |

### 1.10 Simulation domain

Already fully inventoried, Checkpoint §1/§2/§7 item 7. Not re-derived: `lib/simulation-engine.ts`, `lib/monte-carlo.ts`, `lib/matchup-intelligence/matchup-sim-engine.ts`, `lib/matchup-simulator/`, `lib/matchup-prediction-engine/` — flagged triplication, none import Decision OS, reconciliation recommended before any Decision OS Simulation Engine work begins (Checkpoint §8 Phase 4 item 3).

---

## 2. Duplication analysis

### 2.1 True duplication (multiple systems independently answering the same question, no shared source of truth)

| # | Duplication | Systems | Severity | Status |
|---|---|---|---|---|
| 1 | Manager archetype/DNA | `lib/manager-dna.ts` vs. `lib/gm-profile` (retired) vs. `phase6/dna` | High — real public API + LLM-prompt consumers | Already scoped, blocked on `conservative_roster_pattern` ADR (Checkpoint §7 item 1) |
| 2 | League health scoring | `lib/league-health/league-health-engine.ts` vs. `commissionerHubHealth.ts` | Medium | Already scoped (Core Unification Plan §1.3) |
| 3 | League-level grading | `lib/league-intelligence/league-intel-engine.ts` vs. `world/leagueIntelEnrichedWorld.ts` | Medium | Already scoped (Core Unification Plan §1.3) |
| 4 | "What should this manager do" | `phase6/recommendations` vs. `smart-trade-recommendations.ts` vs. `user-recommendation-engine` | **High — the single most concrete user-facing risk found across all four audits** (conflicting advice from two systems) | Already scoped, highest Phase 4 priority (Checkpoint §7 item 4) |
| 5 | Acceptance-probability models | `acceptance-model.ts` vs. trade-engine's own internal calibrated model | Medium — same concept, two uncoordinated static models | Already scoped (Checkpoint §1 "Learning/feedback" row) |
| 6 | **Draft recommendation orchestration** (new finding this pass) | `aiDraftHelper` (`/api/ai/draft/recommend`) vs. `draft-ai-engine` (`/api/draft/recommend`, `/api/draft-ai/route.ts`) | Medium — both wrap the identical deterministic `RecommendationEngine`, add near-identical optional-LLM-narrative logic, via three separate routes | **Not previously documented** — new item, see §4 Phase B |
| 7 | **Chimmy's dual action/tool registries** (deepened this pass) | `AIActionRegistry` vs. `AIToolRegistry` — overlapping intent naming (`trade_analyzer`/`analyze_trade`) | Low-medium — narrow naming collision, not full logic duplication, but is the precise root of Chimmy's "no single source of truth" finding | **Root cause newly isolated** — see §4 Phase C |
| 8 | Simulation engines | `matchup-sim-engine.ts` vs. `matchup-simulator/` vs. `matchup-prediction-engine/` | Medium | Already scoped (Checkpoint §7 item 7) |

### 2.2 Intentional specialization (confirmed genuinely distinct, not duplication despite surface similarity)

| Systems | Why they're distinct |
|---|---|
| AI Coach vs. Fantasy Coach | Single-decision tactical advice vs. weekly holistic evaluation; confirmed delegation (AI Coach imports Fantasy Coach's strategy engine), not parallel reimplementation |
| The 7 lineup/roster systems (§1.4) | Each answers a different question: validate a submission, optimize from scratch, auto-fix on injury, advise on one decision, IDP-specific slot rules. Confirmed via direct code reading, not naming. |
| Draft's 5 front-ends sharing 1 deterministic backbone (§1.5), minus the orchestration duplication in §2.1 item 6 | Mock-draft overlay, live war room, live bot autopick, and post-draft grading are legitimately different presentation contexts for the same evidence — this is convergence done right, at the scoring layer |
| `CommissionerAiDraftManager` | Rules/config/throttling, not intelligence — has no business being folded into a recommendation engine |
| `LeagueRecommendationEngine` | League-discovery matching is a different problem from in-league advice |
| `GlobalFantasyIntelligenceEngine` vs. `behavioral/platform-intelligence.ts` | Different data sources (market trend/meta vs. behavioral events) — complementary, needs a seam not a merge |
| Knowledge graph (`lib/league-intelligence-graph/`) | Different data model entirely (nodes/edges vs. flat facts) — a product decision, not a duplication (Checkpoint §1) |
| Trade Learning | Narrow, mature, operationally complete calibration system — explicitly out of scope this phase |

---

## 3. Canonical architecture — the recommendation pipeline this codebase should converge on

**The right design is not a new invention — it's the wrap-fidelity pattern the four live decision slices already prove works, generalized to cover every recommendation producer in §1, not just lineup/waiver/trade/commissioner-health.**

```
Domain engines (evidence producers — UNCHANGED, stay exactly where they are)
  trade-engine · waiver-engine · lineup-optimizer-engine · auto-sub-lineup-engine
  draft-helper/RecommendationEngine · roster-engine · fantasy-coach's strategy engine
  acceptance-model · (simulation engines, once reconciled per Checkpoint §7 item 7)
        │
        │  each already produces a deterministic, typed evidence shape
        │  (TradeDriverData, ScoredWaiverTarget, DraftPlayerRankingRow, optimized-lineup result, …)
        ▼
Decision OS decision slices (the proven wrap-fidelity seam — EXTEND, don't redesign)
  existing: lineup · waiver · trade · commissioner-health
  new, proposed by this plan: draft · manager-coaching (wraps AI Coach/Fantasy Coach's
    deterministic layer) · league-discovery (wraps LeagueRecommendationEngine, lowest priority)
        │
        │  each slice: load canonical facts, wrap the evidence above as a deterministic
        │  memo, compute shadow parity against the existing legacy consumer's output
        ▼
Decision<TAction> + DecisionOSInsight (the ALREADY-FROZEN four-answer contract)
  what_happened / why_it_matters / how_confident / what_to_do
  evidence[] / derivation chain / AI-boundary (mayInventFacts: false)
        │
        │  ONE explanation layer, reused everywhere a narrative is needed today
        │  (AI Coach's OpenAI call, Fantasy Coach's 3-provider overlay, draft's
        │  War Room narrative, League Recommendation's optional refinement) —
        │  each of those becomes "narrate this Decision," not "assemble your own
        │  evidence AND narrate it"
        ▼
Surface adapters (existing pattern, already proven on 3 surfaces)
  Dashboard · League Home · Commissioner Hub
  new, proposed: CoachAdvicePanel/CoachDashboard · Draft Room/War Room · Chimmy
    (each reads the same Decision object instead of re-deriving its own)
```

**Why this is the right design for *this* codebase specifically, not a generic textbook pipeline:**

1. It does not ask any domain engine to change. Every evidence producer in §1 stays exactly where it is, doing exactly what it does today — this is the same non-negotiable invariant the four existing slices already honor (`ARCHITECTURE_FREEZE.md`: Canonical World is read-only, origin-blind, never fabricates).
2. It targets the actual, confirmed root cause found across every duplication in §2.1: each duplicate pair is really two independent *evidence-assembly-plus-narration* pipelines answering the same question, not two different underlying facts. Converging them onto one `Decision<TAction>` + one explanation layer removes the duplication without removing any domain logic.
3. It explains, for the first time, why AI Coach/Fantasy Coach/draft's War Room/League Recommendation's AI refinement all independently reinvented the identical shape (deterministic-first, LLM-explanation-second, with a deterministic fallback) — because that shape is *already* Decision OS's own `Decision` + explanation-only AI-boundary pattern, just never named or shared as such outside `lib/decision-os/`.
4. It reuses, rather than replaces, the *only* two genuinely reusable abstractions already proven live: the four-answer `Decision<TAction>` contract, and the wrap-fidelity migration pattern (shadow first, parity-gated, kill-switched) that every one of this workstream's prior successful migrations (Manager DNA, Trade Learning, the four existing slices) has used.

---

## 4. Migration phases

**Every phase is additive.** No phase requires deleting or rewriting a domain engine; every phase either adds a new, currently-unimported Decision OS slice, or converges an *orchestration* layer onto an already-existing one behind a shadow/parity gate — the same discipline already proven across this entire workstream (Trade Learning Phases 8–9, Manager DNA de-dup).

This plan explicitly **does not re-scope** the manager-DNA, league-health, league-grading, or user-recommendation-engine de-duplications — those already have owners, ADRs, and sequencing in `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` §8 (Phase 3/4/5). The phases below are net-new sequencing for the gaps this document closed (§2.1 items 6–7) plus the natural next step those existing phases imply (a Decision OS slice for AI Coach's deterministic layer).

### Phase A — Formalize the shared evidence/decision contract (net-new types only)

- **Scope:** Document (types only, zero wiring) an `EvidenceSet` shape that generalizes what every domain engine in §3 already independently produces (`TradeDriverData`, `ScoredWaiverTarget`, `DraftPlayerRankingRow`, lineup-optimizer results). Mirrors `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §13's own "documentation-only contracts" precedent exactly.
- **Dependencies:** None.
- **Risk:** None — no runtime code changes, no imports added anywhere.
- **Expected customer impact:** None.

### Phase B — Converge draft recommendation orchestration (§2.1 item 6)

- **Scope:** Reconcile `aiDraftHelper` and `draft-ai-engine` into one orchestration wrapper around the already-shared `RecommendationEngine`. Snapshot both existing routes' (`/api/ai/draft/recommend`, `/api/draft/recommend`, `/api/draft-ai/route.ts`) outputs on real data first (parity harness, reusing `core/parity/shadowParity.ts` per Core Unification Plan §10's own precedent), then re-point the routes to the single wrapper only once parity holds.
- **Dependencies:** None — the underlying deterministic engine is unchanged either way.
- **Risk:** Low-medium — three real, live routes, but zero scoring-logic change; pure orchestration consolidation.
- **Expected customer impact:** None if parity holds (the deliverable of this phase); this is exactly the kind of consumer-facing surface this workstream always parity-tests before touching.

### Phase C — Resolve Chimmy's dual-registry naming collision (§2.1 item 7)

- **Scope:** Define one canonical intent taxonomy that both `AIActionRegistry` (UI action metadata) and `AIToolRegistry` (LLM tool-selection) reference, rather than each maintaining independent `trade_analyzer`/`analyze_trade`-style names for the same concept. This is a naming/contract fix, not a logic migration — no chat behavior changes.
- **Dependencies:** None.
- **Risk:** Low — additive alias, not a behavior change; explicitly stops short of the dual-registry *architectural* merge, which `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §9 already correctly defers ("No migration of Chimmy's dual tool/action registries — that's a real refactor with product risk").
- **Expected customer impact:** None.

### Phase D — Wrap AI Coach's deterministic layer as a new Decision OS slice

- **Scope:** Apply the exact wrap-fidelity pattern already proven on lineup/waiver/trade/commissioner-health to `lib/ai-coach/deterministic-recommenders.ts`'s `getDeterministicRecommendation()` — a fifth decision slice (`manager-coaching`), shadow-only at first, computing parity against AI Coach's existing live output. This is the natural next slice given AI Coach already delegates part of its logic to Fantasy Coach's strategy engine, and both already produce the identical deterministic-then-AI-explanation shape Decision OS's own contract already models.
- **Dependencies:** None on Phase A–C, but benefits from Phase A's formalized evidence contract existing first.
- **Risk:** Medium — real, live, user-facing consumer (`CoachAdvicePanel.tsx`), but shadow-only with no route re-point in this phase; identical risk profile to how the four existing slices were introduced.
- **Expected customer impact:** None during shadow phase (by design — this is the same kill-switch/shadow discipline every prior Decision OS slice used).

### Phase E — Cross-reference: execute the already-scoped duplications

- **Scope:** This is not new scoping — it is a pointer. Once Phase 3/4 of the Architecture Checkpoint's own roadmap executes (manager-DNA, league-health, league-grading, user-recommendation-engine, simulation-engine de-duplications), the manager-tier and league-tier recommendations converging through Decision OS become the same pipeline this document proposes generalizing in §3. **Do not re-derive a separate roadmap for these** — follow `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` §8 as written.
- **Dependencies:** As already documented there (blocked on `conservative_roster_pattern` ADR + real-activity-volume evidence).
- **Risk:** As already documented there.
- **Expected customer impact:** As already documented there.

---

## 5. Systems that should remain independent

| System | Why |
|---|---|
| The 7 lineup/roster systems (§1.4) | Each solves a genuinely different problem (validate/optimize/auto-fix/advise/IDP-specific) — confirmed by direct code reading. Consolidating them would destroy real functional distinctions, not remove duplication. |
| `CommissionerAiDraftManager` | Rules/config/throttling for draft-bot behavior — an action/mutation concern, not intelligence. Decision OS is read-only by design (`ARCHITECTURE_FREEZE.md`); this system has no business inside it. |
| `LeagueRecommendationEngine` | League-discovery matching is a different problem domain (finding a league to join) from in-league advice (what Decision OS's `phase6/recommendations` answers). |
| `GlobalFantasyIntelligenceEngine` | Genuinely different data source (market trend/meta aggregation) from behavioral-event-derived intelligence. Complementary, needs a seam (a shared `PlatformContextGraph`, per Core Unification Plan §5), not a merge. |
| Knowledge graph (`lib/league-intelligence-graph/`) | Different data model (nodes/edges vs. flat facts) — an explicit, still-pending product decision (Checkpoint §1), not a duplication to resolve engineering-first. |
| Simulation engines, until reconciled with each other | Real capability, genuinely useful, but three-way redundant with each other first — reconciling them with Decision OS before they're reconciled with themselves would formalize triplication (Checkpoint §8 Phase 4 item 3, unchanged recommendation). |
| Trade Learning | Narrow, mature, operationally complete, explicitly out of scope this phase (per this task's own instructions) and per the user's own stated intent this session ("leave Trade Learning alone until it has real data"). |
| `draft-helper/RecommendationEngine`'s five presentation front-ends (mock draft, war room, bot autopick, post-draft grading, intelligence snapshot) — **minus** the orchestration duplication already flagged in §2.1 item 6 | Legitimately different presentation contexts consuming the same shared evidence layer — this is convergence done correctly and should be the template Phase B measures success against, not something to further collapse. |

---

## 6. Risks

- **Risk (Phase B, draft orchestration):** Three real, live routes serve real traffic today. Mitigate exactly as `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §10 already prescribes for any de-duplication: parity-snapshot both outputs on real data before any route re-point.
- **Risk (Phase D, AI Coach slice):** `CoachAdvicePanel.tsx` is a real, live, user-facing surface. Mitigate with shadow-only introduction — no route re-point in this phase, matching how every one of the four existing slices was introduced.
- **Risk (general):** This document's §3 canonical architecture asks nothing of any domain engine, but does propose *new* Decision OS slices (draft, manager-coaching). Per `ARCHITECTURE_FREEZE.md`'s own governance rule, each new slice needs its own ADR before implementation begins, exactly as the `conservative_roster_pattern` fix and the Trade Learning capture architecture ADR already modeled in this workstream.
- **Risk (sequencing):** Phase E depends entirely on work already scoped elsewhere and blocked on items outside this document's control (an ADR approval, a staging volume measurement). This document does not shorten that dependency chain — it only shows where the newly-discovered items (Phases B–D) fit alongside it.
- **Assumption:** The four existing decision slices' shadow-parity telemetry remains healthy, per Core Unification Plan §19's own stated assumption — this document inherits that assumption rather than re-verifying it.

## 7. Rollout strategy

Identical discipline to every successful migration this workstream has already executed (Trade Learning Phases 8–9, the four existing Decision OS slices): **additive code → shadow-only → parity-gated → kill-switched live cutover, one phase at a time, never a big-bang replacement.** No phase in §4 requires touching a route's live behavior until its own parity gate is proven on real data. Nothing in this plan enables any switch, flag, or route re-point — that remains a separate, explicitly-requested future step, exactly as every phase of the Trade Learning workstream required its own explicit go-ahead before any write or flag flip.

## 8. Estimated implementation order

1. Phase A (types only) — no risk, can start immediately, blocks nothing else.
2. Phase C (Chimmy naming) — no risk, independent of everything else, can run in parallel with Phase A.
3. Phase B (draft orchestration) — low-medium risk, independent of Phase D, benefits from Phase A's contract existing first but doesn't strictly require it.
4. Phase D (AI Coach slice) — medium risk, the most architecturally significant new work in this plan, should follow Phase A so the new slice's evidence shape isn't invented ad hoc a second time.
5. Phase E (execute already-scoped Checkpoint §8 Phase 3/4/5 items) — proceeds on its own existing timeline, independent of Phases A–D; the two tracks converge once both complete, at which point Decision OS is the recommendation source of truth for manager-tier, league-tier, trade, waiver, lineup, and coaching advice alike.

---

## Files created in this session

- `docs/DECISION_OS_RECOMMENDATION_CONSOLIDATION_PLAN.md` (this document, new)

No other file was created, modified, or deleted. No source code, API, schema, or recommendation behavior was changed. No migration was executed. No flag was enabled.
