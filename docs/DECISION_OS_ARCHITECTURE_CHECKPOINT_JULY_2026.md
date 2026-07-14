# Decision OS Architecture Checkpoint — July 2026

**Status:** Architecture review only. No source code, API, schema, or behavior changed.
**Branch:** `g15-event-foundation`
**Purpose:** The new architectural baseline for the next stage of Decision OS development, superseding piecemeal understanding accumulated across `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` and the Manager DNA de-duplication workstream (Phases 2A–2K).
**Method:** Synthesizes (a) this session's own extensive hands-on audit and implementation work across the Core Unification, Manager DNA de-duplication, and classifier-bug workstreams, (b) two fresh parallel research passes covering simulation/learning/recommendation duplication and knowledge-graph/consumer completeness, and (c) direct reading of the repo's own prior audits (`G20_DECISION_OS_INTEGRATION_AUDIT.md`, `PRODUCTION_READINESS_CHECKLIST.md`, `PHASE_8_0`–`8.3` pipeline-unification docs, `G21`–`G29` polish/proof audits) — cited by name throughout rather than re-derived.

---

## Executive summary

Decision OS's **core** (Canonical World, the four-answer Decision contract, the four decision slices, behavioral intelligence, Phase 6 pattern/DNA classifiers, the presentation/SDK layer) is genuinely mature, frozen, tested, and — as of Phase 8.1–8.3 — **live-wired to three real customer-facing surfaces** (Dashboard, League Home, Commissioner Hub) with authenticated browser proof on two of them (`G28_DECISION_OS_LEAGUE_HOME_PROOF_GAP.md`). This is materially further along than a purely code-level reading would suggest.

What's genuinely missing or duplicated is **almost entirely outside `lib/decision-os/` itself**: four independent recommendation engines, at least two redundant matchup simulators, zero closed feedback/confidence-learning loop anywhere in the codebase, a mature but architecturally separate knowledge-graph system, a Commissioner OS that's still scattered modules rather than a program, and a Chimmy that remains completely decoupled — plus one confirmed, still-open correctness bug (the `conservative_roster_pattern` false-positive, ADR drafted, not yet implemented) inside Decision OS's own Phase 6.1.

**The single most important fact for planning purposes:** per `PRODUCTION_READINESS_CHECKLIST.md`, all four decision slices are code-complete and shadow-verified, but **zero production soak has started** — every `DECISION_OS_*_LIVE` kill switch is still off. The architecture is not blocked on more building; it's blocked on turning switches on and watching them for seven days each, in sequence.

---

## 1. Intelligence duplication

| Domain | Canonical (Decision OS) implementation | Duplicate(s) | Migration complexity | Migration priority |
|---|---|---|---|---|
| **Manager identity/archetype** | `lib/decision-os/phase6/dna/` (Phase 6.2, frozen, live via Phase 8.1–8.3 wiring) | `lib/manager-dna.ts` (root, **live** — AI Coach, Trade Analyzer, Trade Proposal Generator, `/api/legacy/manager-dna`, `/api/ai/manager-dna`); `lib/gm-profile/` (**retired**, Phase 2B, `f1581dcd8`) | **High** for `lib/manager-dna.ts` — real public API contract, real LLM-prompt consumers, genuinely different data source (Sleeper-linked + dynasty-import trades vs. Decision OS's now-real redraft trade/waiver/lineup-history data). Full audit trail exists: `docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md` through `PHASE2J`. | **Blocked** — not on missing engineering, but on the still-open `conservative_roster_pattern` false-positive (ADR drafted) and unmeasured real-world activity volume. See §7. |
| **League health / commissioner health** | `lib/decision-os/commissioner-health/` (Slice 4, live shadow) | `lib/league-health/league-health-engine.ts`, `lib/commissioner-hub/commissionerHubHealth.ts` (the LATTER is the one intentional bridge — it wraps the Decision OS shadow, per the Core Unification audit) | Medium — `league-health-engine.ts` has ~60% schema overlap with `commissionerHubHealth.ts` and no shared contract. | Medium — lower urgency than Manager DNA since Commissioner Health is assessment-only (never blocks an action). |
| **League-level intelligence / grading** | `lib/decision-os/world/leagueIntelEnrichedWorld.ts` (flat, deterministic facts, no graph) | `lib/league-intelligence/league-intel-engine.ts` (~40% conceptual overlap, no code sharing) | Medium | Medium |
| **Knowledge graph / relationship modeling** | **None** — Decision OS's world model is deliberately flat facts, not a graph | `lib/league-intelligence-graph/` (mature, Prisma-persisted, 22 edge types, centrality/rivalry/trade-cluster analysis — a real, separate system, not currently consumed by Decision OS at all) | High if ever unified — genuinely different data model (nodes/edges vs. flat facts), not just a naming difference | **Low** — not a duplicate in the harmful sense; it's a complementary analytics capability nobody has decided whether to fold into Decision OS's substrate or keep standalone. Needs a product decision, not a migration. |
| **Manager/user-tier recommendations** | `lib/decision-os/phase6/recommendations/` (`assembleManagerRecommendations`, live via Phase 8.1–8.3) | `lib/smart-trade-recommendations.ts` (**direct overlap** — independently derives a user's trade archetype and suggests moves from Sleeper trade history, not Decision OS patterns); `lib/user-recommendation-engine/` (**significant overlap** — aggregates activity/tool-usage into engagement recommendations, competing "user engagement recommendation" turf); `lib/league-recommendations/` (discovery-focused, genuinely distinct purpose, low overlap) | High for `smart-trade-recommendations.ts` and `user-recommendation-engine` — different data sources, no shared contract, both live | High — this is the least-noticed but most concretely duplicative area found in this checkpoint; two systems are answering "what should this manager do next" independently of Decision OS's own answer to the same question. |
| **Recommendation persistence / "shelf"** | Decision OS emits `Decision<TAction>`/`RecommendationSet` per-call, no persistence layer of its own | `lib/saved-recommendations/SavedRecommendationsService.ts` — designed as a universal sink but **not migrated to Prisma** (mutations currently no-op) | Low-to-medium — it's an incomplete scaffold, not a competing live system | Low urgency now, but worth finishing as *the* place Decision OS output lands if a persistent recommendation history is ever wanted. |
| **Simulation** | **None** — Decision OS has no simulation engine of its own; `RecommendationResult`/`SimulationResult` contracts exist only as documentation in `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §13.10, never implemented | `lib/simulation-engine.ts` (generic Monte Carlo trade/scenario simulator), `lib/monte-carlo.ts` (lower-level primitives), `lib/matchup-intelligence/matchup-sim-engine.ts` (NFL-specific, injury-adjusted matchup simulation), `lib/matchup-simulator/` (UI/presentation bridge), `lib/matchup-prediction-engine/` (unread in this pass — flagged as a likely third redundant engine) | Medium-high — none import Decision OS today; wiring even one in is real integration work, not a refactor | Medium — genuinely useful capability with zero architectural convergence; the three matchup-specific engines (`matchup-sim-engine.ts`, `matchup-simulator/`, `matchup-prediction-engine/`) should be reconciled with each other *before* any of them is wired to Decision OS, to avoid formalizing triplication. |
| **Learning / feedback / confidence calibration** | **None** — `Decision<TAction>.confidence` and `DecisionOSInsight.confidence` are both static, calibration-only values with no feedback path | `lib/acceptance-model.ts` (static logistic classifier, hardcoded weights, never updated), `lib/feedback-store.ts` + `lib/trade-feedback-profile.ts` (collects votes, feeds an LLM prompt, never recalibrates any model), `lib/ai/outcomes/trackRecommendationOutcome.ts` (logs outcomes, **read-only**, admin-metrics-only consumer) | N/A — there is nothing canonical to migrate duplicates *toward* yet | **This is a genuine platform gap, not a duplication.** See §2's Learning Engine row and §7. |
| **AI chat / intelligence context assembly** | **None consumed** — Chimmy (`lib/chimmy-context/`) builds its own context independently | Chimmy's 10 context providers + 12+ format-specific enrichment builders (documented exhaustively in `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §1.6); a **second, dormant** "Chimmy Intelligence" rail (`DashboardIntelligenceRail`, gated by an unset env flag, fetching a route — `/api/ai/intelligence` — that doesn't exist, per `PHASE_8_3_DASHBOARD_INTELLIGENCE_UNIFICATION.md`) | High — Chimmy is a real, shipped product surface; replacing its context assembly is a redesign, not a migration | High long-term value, but explicitly deferred by this program's own prior decisions (`docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §9, `PHASE_8_3`'s "do not replace Chimmy" rule) — not re-litigated here. |

---

## 2. Core platform architecture

| Component | Current implementation | Maturity | Gaps | Recommended next milestone |
|---|---|---|---|---|
| **Event Engine** | `lib/decision-os/behavioral/` (Phase 5.0/5.1) — a real, versioned, 14-type taxonomy with read-only ports (7 loaders as of Phase 2H: waiver, Af-trade, Af-roster-move, draft, redraft-trade, redraft-free-agent, redraft-lineup-history) and pure mappers to `BehavioralEvent[]` | **Solid for what it covers.** Deterministic, tested, honest-degradation throughout. | Only 8 of 14 taxonomy event types have any real mapper (`lineup_viewed`, `commissioner_action`, `rules_changed`, `league_opened`, `live_scoring_opened`, `recap_viewed` have zero source — confirmed directly, `docs/DECISION_OS_MANAGER_DNA_PHASE2I_READINESS_AFTER_LINEUP_HISTORY.md` §4). No engagement/session signal exists anywhere, so every engagement-tier computation is starved of that dimension. | Close the `league_opened`/`live_scoring_opened` gap — even simple page-view logging would unlock a whole class of engagement-tier accuracy improvements cheaply, since the taxonomy and pipeline already exist end-to-end for other event types. |
| **Knowledge Graph** | **Two parallel, non-integrated systems.** `lib/league-intelligence-graph/` is a real, mature, Prisma-persisted node/edge model (Manager, Franchise, League, TeamSeason, Player, DraftPick, Trade, Championship nodes; 22 edge types including TRADED_WITH, RIVAL_OF, INFLUENCED_BY, POWER_SHIFT_EDGE) with its own standalone API routes. Decision OS's own `world/` substrate is deliberately flat facts, never nodes/edges. | Graph system: production-grade, tested, live via its own routes. Decision OS integration: **zero**. | Not a "missing" component so much as an **unintegrated** one — a real product decision (fold the graph into Decision OS's substrate, or keep it a standalone analytics feature) has never been made explicitly. | Make that decision explicitly, in its own ADR, before either system grows further in isolation — this is exactly the kind of "two teams building the same shape of thing without knowing it" risk this checkpoint exists to catch. |
| **Context Engine** | `LeagueStateGraph`/`UserContextGraph`/`PlatformContextGraph` are documented contracts (`docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §13.4–13.6) wrapping existing Canonical World/behavioral-facts types; `lib/decision-os-core/context/types.ts` implements them as pure types only | **Type-level only.** No assembly function exists yet — nothing builds a real `DecisionOSContext` from Prisma today; each decision slice still assembles its own decision-specific World independently. | The unifying context-assembly layer this checkpoint's own pipeline diagram (§6) implies doesn't exist as a single real function — it's four independent per-slice World resolvers plus `dashboard-intelligence.ts`'s own bespoke composition. | Build one real `resolveDecisionOSContext()` that the four slices *could* converge onto — not urgent, since the current per-slice approach works and is well-tested, but it's the honest gap between "documented contract" and "built system." |
| **Recommendation Engine** | `lib/decision-os/phase6/recommendations/` (`assembleManagerRecommendations`) — real, tested, **live** via Phase 8.1–8.3's three-surface wiring | Production, with real authenticated browser proof on 2 of 3 surfaces (`G28`) | Manager-tier only; no commissioner-tier recommendation set is wired to any live surface yet (deferred explicitly in `PHASE_8_1` §"Remaining disconnected areas" item 3) | Wire commissioner-tier recommendations into Commissioner Hub, resolving the "which league's context" design question `PHASE_8_1` explicitly deferred. |
| **Simulation Engine** | **None inside Decision OS.** `SimulationResult` is a documented, unimplemented contract (`docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §13.10) | Non-existent as a Decision OS component; real capability exists elsewhere (§1) | Total — this is the platform's single largest missing core component relative to the requested pipeline (§6) | Do not build a new one. Reconcile the three existing matchup simulators first (§1), then wrap the survivor the same wrap-fidelity way the four decision slices already wrap their legacy engines — proven pattern, not a new one. |
| **Learning Engine** | **None, anywhere in the codebase.** Confirmed directly: `Decision<TAction>.confidence` is static; `trackRecommendationOutcome` logs outcomes but has zero consumers besides admin metrics; `feedback-store.ts`/`trade-feedback-profile.ts` collect votes that feed an LLM prompt, never recalibrate anything. | Non-existent | Total | This is the platform's second-largest gap relative to a "universal Decision Intelligence Platform" vision. See §7 — recommend this become a real Phase 3/4 initiative, not a side effect of another ticket. |
| **Explanation contracts** | `Decision.four_answers` (what_happened/why_it_matters/how_confident/what_to_do) + `DecisionOSInsight`'s evidence/derivation-chain/AI-boundary model (`core/integrationContract.ts`) | **Strong and consistently enforced** — `assertDecisionOSInsightGrounded()` runtime-checks evidence presence and AI-boundary invariants; used uniformly across all four slices | None significant found | Extend the same contract to any future Simulation/Learning Engine output rather than inventing a new explanation shape. |
| **Confidence model** | `Decision.confidence` (0–100) and `DecisionOSInsight.confidence`/`dataCompleteness` (separate 0–100 values) — calibrated once per decision type, asserted to be finite and in-range | Structurally sound, but **static** — no feedback loop updates it (see Learning Engine row) | The confidence number is honest about *input completeness*, not about *historical accuracy* — these are different claims and the platform only computes the first | Do not conflate fixing this with building a Learning Engine from scratch — the confidence *contract* is fine; it's the missing feedback loop that would make the number more than a completeness proxy. |
| **Outcome tracking** | `lib/ai/outcomes/trackRecommendationOutcome.ts` — real insert-only logging of `followed`/outcome score, but genuinely read-only (`lib/ai/admin/getAIMetrics.ts` is its only consumer) | Data model exists; feedback loop does not | The gap between "we log outcomes" and "outcomes change future behavior" is total | This is the natural Phase 3/4 companion to closing the Learning Engine gap — the raw data already exists, just needs a consumer. |
| **Feedback learning** | `lib/feedback-store.ts` (in-memory, capped, session-scoped) + `lib/trade-feedback-profile.ts` (persisted, 6-hour cache, feeds an LLM prompt) | Real, live, but **one-directional** (votes → prompt context, never votes → recalibration) | No system anywhere closes votes back into `acceptance-model.ts`'s weights or Decision OS's confidence | Same recommendation as Learning Engine — a real, scoped initiative, not a side quest. |

---

## 3. Product integrations

| Consumer | Status | Evidence |
|---|---|---|
| **Dashboard** (`DashboardOverview.tsx`, the real `/dashboard`) | **Consuming Decision OS correctly**, via the adapter pattern (`buildManagerDnaViewModel`, `buildDecisionRecommendationsViewModel`, `buildDashboardLeaguePulse`) | Wired in Phase 8.3; compile-verified but not fully authenticated-browser-proven (`PHASE_8_3` §Step 5 — honest about this gap) |
| **League Home** (`LeagueTab.tsx`) | **Consuming Decision OS correctly**, same adapter pattern | Wired in Phase 8.1; **full authenticated browser proof** exists (`G28`) — League Pulse, Manager DNA, Recommended Moves, confidence/evidence display, light/dark, mobile all verified |
| **Commissioner Hub** (`CommissionerHubPageClient.tsx`) | **Consuming Decision OS correctly**, same adapter pattern | Wired in Phase 8.2 (referenced, not re-read this pass); **full authenticated browser proof** exists (`G28`), including the commissioner-specific "evidence-limited Recommended Moves empty state" |
| **Commissioner OS** (the broader program: `commissioner-ai-draft-manager`, `commissioner-assistant`, `commissioner-settings`, etc.) | **Mostly bypassing Decision OS.** Confirmed in the Core Unification audit: scattered modules, one intentional bridge (`commissioner-hub/commissionerHubHealth.ts` → Slice 4 shadow) | `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §1.2, §3 |
| **User OS** | **Does not exist as a named program** — the closest real thing is the Dashboard's per-manager view, now genuinely Decision-OS-backed (above). "User OS" remains aspirational vocabulary from `commercial-platform-vision.md`, not a built system. | This checkpoint found no code, route, or doc naming a "User OS" |
| **Chimmy** (chat/context assembly, `lib/chimmy-context/`, `lib/chimmy-orchestration/`) | **Completely bypassing Decision OS**, confirmed with zero Decision OS imports anywhere in `lib/chimmy-*` | `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §1.6; reconfirmed by `PHASE_8_3`'s explicit "do not replace Chimmy" scoping note |
| **"Chimmy Intelligence" dashboard rail** (`DashboardIntelligenceRail`) | **Dormant** — gated by an unset env flag, its fetch target (`/api/ai/intelligence`) doesn't exist in the codebase | `PHASE_8_3_DASHBOARD_INTELLIGENCE_UNIFICATION.md` §Step 1 — a real, if currently inert, second Chimmy-adjacent system worth knowing exists before anyone re-enables it casually |
| **Partner Sandbox / Widget SDK** | **Real, live, consuming Decision OS's SDK layer directly** — 6 API routes (`validate-config`, `preview-theme`, `widget-catalog`, `check-widget-permission`, `embed-instructions`, `test-key-metadata`) all import from `lib/decision-os/sdk/partner-sandbox-handlers` | Found fresh in this checkpoint's consumer sweep — **more built than the Core Unification Plan's "Widget Platform" vision assumed**; this deserves its own follow-up audit, not further scope creep here |
| **Existing Decision OS APIs** (`/api/v1/intelligence/*`, `/api/decision-os/manager-intelligence`, telemetry routes) | **Live, correctly scoped, real callers** | Reconfirmed directly this pass — no undocumented direct-read pattern found; every UI consumer goes through published adapters, not raw Decision OS internals |
| **Draft runtime** | **Partially bypassing Decision OS**, but with one real bridge found this pass: `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts` imports `deriveDraftRuntimeIntelligence` | More connected than the original Core Unification audit assumed ("Draft Engine: needs canonical Decision OS bridge") — worth re-auditing narrowly rather than assuming it's still fully disconnected |

---

## 4. Sport abstraction

| Layer | Status | Football-centric assumptions remaining |
|---|---|---|
| **SportAdapter** (`lib/decision-os-core/sport-adapter/`) | Real, additive, currently-unimported (Phase 1). Wraps 13 existing `sportConfig` entries (NFL, NCAAF, NBA, NCAAB, MLB, NHL, SOCCER, GOLF, NASCAR, WWE, CRICKET, HORSE_RACING, TENNIS) plus the existing `redraft/sportAdapters` per-sport stat parsers. | `tracksProviderDataCoverage` is honestly `true` only for NFL (Phase 2H's fix target) — a real, documented, non-hidden asymmetry, not a bug. |
| **ProviderAdapter** (`lib/decision-os-core/provider-adapter/`) | Real, additive, currently-unimported. Wraps `providers/providerFallbackPolicy.ts`'s already-sport-agnostic `DataDomain`×`ProviderName` model — confirmed the best-shaped abstraction pre-existing in the codebase. `fetch()` is a deliberate stub (`ProviderFetchNotWiredError`), not wired to real provider clients. | None found beyond the deliberate non-implementation of `fetch()`. |
| **Scoring abstraction** | `category-scoring/types.ts`'s `ScoringMode: 'points' | 'h2h_category' | 'roto'` is already generic; `ScoringCalculator.ts` is stat-key-agnostic | Per-sport stat key vocabularies remain fully independent enums (NFL vs. MLB share zero code) — genuine but *expected* variation, not a football bias per se. |
| **Roster abstraction** | `roster-engine/RosterEngineTypes.ts` is template-driven, no hardcoded positions | Confirmed clean in the original audit. |
| **Schedule abstraction** | **Still the deepest football-centric assumption in the platform.** Week is the hardcoded atomic unit; matchup assumes home/away pairing; bye = `awayRosterId: null`. | Unchanged since the Core Unification Plan (§7.2) — explicitly deferred there as the highest-risk, highest-effort item; still deferred here. |
| **Playoff abstraction** | **Second-deepest.** Single-elimination bracket + power-of-2 seeding hardcoded; no support for roto-standings, single-slate, or best-of-N formats. | Unchanged since the Core Unification Plan; G13/G14 audits already scoped extraction candidates (`SchedulePolicy`, `PlayoffBracketPolicy`, etc.) that have never been built. |

**Net assessment:** the *adapter layer* (SportAdapter/ProviderAdapter) is real and sound, but it's a foundation with zero consumers — none of Decision OS's four decision slices or Phase 6 classifiers route through it yet. The two genuinely unresolved football-centric surfaces (schedule, playoff) are unchanged from six months of prior audits — not because they're hard to *find*, but because fixing them touches every live redraft league's data model, correctly making them the platform's most deliberately-deferred item.

---

## 5. Event taxonomy

Current taxonomy (`lib/decision-os/behavioral/events/taxonomy.ts`): 14 types across 5 categories (roster, transaction, commissioner, engagement, draft).

| Dimension | Assessment |
|---|---|
| **Coverage today** | 8 of 14 types have a real mapper (`lineup_saved`, `trade_created/accepted/rejected`, `waiver_claim_created/processed`, `draft_started/pick_made`). 6 have zero real data source (`lineup_viewed`, `commissioner_action`, `rules_changed`, `league_opened`, `live_scoring_opened`, `recap_viewed`) — confirmed by direct grep against every mapper in `lib/decision-os/behavioral/mappers.ts`, per `PHASE2I` §4. |
| **Missing event types** | Not missing from the *taxonomy* — missing *data sources*. The taxonomy already anticipates engagement/session tracking; nothing populates it. This is a data-pipeline gap, not a design gap. |
| **Future multi-sport compatibility** | The taxonomy itself contains zero sport-specific vocabulary — `trade_created`, `waiver_claim_created`, `lineup_saved` are all format-neutral. Multi-sport compatibility is not blocked by the taxonomy; it's blocked by the same schedule/playoff hardcoding named in §4 (e.g., a `lineup_saved` event's `week` field assumes a weekly cadence that doesn't fit every future sport/format). |
| **Future DFS/contest compatibility** | Not compatible today, and not close — every event in the taxonomy assumes a persistent, season-long league/roster relationship (`leagueId`, `rosterId`). A single-slate DFS contest has no natural `leagueId` and no roster continuity across "weeks." This would need new event types (e.g., `contest_entry_submitted`, `lineup_locked_for_slate`) and a `Contest` primitive that doesn't yet exist (`docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §6, still unimplemented). |
| **Operator analytics compatibility** | Partially there — `behavioral/platform-intelligence.ts` (Phase 5.4) already aggregates cross-league behavioral facts anonymized for platform-level use. What's missing is upstream: an operator/admin action taxonomy (nothing here logs commissioner-tool usage, support actions, or moderation events) — `commissioner_action` exists in name but, per the coverage gap above, has no real source either. |

---

## 6. Decision pipeline: intended vs. actual

**Intended** (per this checkpoint's brief):

```
Provider Data → Event Engine → Knowledge Graph → Context Engine → Simulation Engine
→ Recommendation Engine → Confidence → Decision → Explanation Contract → Chimmy
```

**Actual, traced stage by stage:**

| Stage | Real today? | Where it diverges |
|---|---|---|
| Provider Data | ✅ Real | `lib/providers/providerFallbackPolicy.ts` + per-provider clients; genuinely sport-agnostic domain model. |
| → Event Engine | ✅ Real | `lib/decision-os/behavioral/` (§2), with the coverage gaps noted in §5. |
| → **Knowledge Graph** | ❌ **Diverges** | Events do not feed a graph. They feed flat `ManagerBehavioralFacts`/`LeagueBehavioralFacts` directly. `lib/league-intelligence-graph/` is real but reads from a *different* data path entirely (not from `BehavioralEvent[]`), and its output does not feed forward into Context/Simulation/Recommendation at all. **This is the single largest structural divergence from the intended pipeline.** |
| → Context Engine | ⚠️ **Partial** | No single `resolveDecisionOSContext()` exists (§2). Each decision slice (lineup/waiver/trade/commissioner-health) builds its own decision-specific World independently, each wrapping Canonical World. This works, but it's four parallel context-assembly paths, not one Context Engine. |
| → **Simulation Engine** | ❌ **Missing entirely** | No stage between "context" and "recommendation" runs any simulation. Decision OS's four slices go straight from World → deterministic rule evaluation → Decision. The `SimulationResult` contract is documented, never implemented (§2). |
| → Recommendation Engine | ✅ Real (manager-tier only) | `phase6/recommendations/`, live via Phase 8.1–8.3. |
| → Confidence | ✅ Real, but static | Correct contract, no learning loop (§2, §7). |
| → Decision | ✅ Real | `Decision<TAction>`, frozen, uniform across all four slices. |
| → Explanation Contract | ✅ Real | `DecisionOSInsight` + `assertDecisionOSInsightGrounded()`, consistently enforced. |
| → **Chimmy** | ❌ **Does not connect** | Zero Decision OS imports anywhere in Chimmy. The pipeline's final arrow doesn't exist — Chimmy assembles its own, entirely separate context and never reads a `Decision` or `DecisionOSInsight` object. |

**Summary of divergence:** the pipeline is real and sound from Provider Data through Explanation Contract, *except* that (a) there is no Knowledge Graph stage in the actual data flow — the real graph system exists but is architecturally parallel, not upstream of Context; (b) there is no Simulation Engine stage at all; and (c) the pipeline's stated final consumer, Chimmy, is not connected to any of it. Of the intended nine stages, five are real and well-built (Provider Data, Event Engine, Recommendation Engine, Confidence, Decision, Explanation Contract — six, actually), one is partially real (Context Engine), and two are structurally absent from the live data flow (Knowledge Graph integration, Simulation Engine), with the terminal connection (→ Chimmy) also absent.

---

## 7. Technical debt, ranked

### Blockers (must resolve before further consumer migration or cutover)

1. **`conservative_roster_pattern` false-positive** (impact: high — actively produces a *less accurate* primary identity for genuinely engaged managers; migration difficulty: low-medium, ADR already drafted and not yet approved; production risk: currently shadow-only, so contained, but blocks any future consumer migration onto Phase 6 DNA — `docs/adr/ADR_DECISION_OS_PHASE6_DNA_CONSERVATIVE_ROSTER_PATTERN_COMPLETENESS_GUARD.md`).
2. **No real-world activity-volume evidence** for Manager DNA (impact: high — the entire de-duplication migration decision hinges on it; migration difficulty: low, it's a measurement task, not engineering; production risk: none, it's a staging read-only query pending explicit approval — `PHASE2G`/`PHASE2I`).
3. **Zero production soak started** on any of the four decision slices (impact: high — this is the actual bottleneck standing between "code complete" and "live cutover" for the whole Decision OS core; migration difficulty: low, it's a rollout-discipline task per `PRODUCTION_READINESS_CHECKLIST.md`, not new code; production risk: managed by design, kill-switch rollback is instant).

### Important improvements (should happen soon, not urgent enough to block anything)

4. **Duplicated recommendation engines** — `smart-trade-recommendations.ts` and `user-recommendation-engine` both independently answer "what should this manager do" (impact: medium-high, real user-facing inconsistency risk if a manager gets conflicting advice from two systems; migration difficulty: high, both are live with independent data sources; production risk: low to touch, since neither currently talks to Decision OS — no shared-state risk).
5. **Two redundant lineup-identity engines still live** — `lib/manager-dna.ts` remains the AI Coach/Trade Analyzer/Trade Proposal Generator's data source, unmigrated, blocked on items 1–2 above (impact: medium, contained scope; migration difficulty: high, real public API + LLM-prompt-format preservation required; production risk: currently zero, since it's untouched).
6. **Commissioner OS remains scattered** — no unifying program, one intentional Decision OS bridge (impact: medium; migration difficulty: medium, mostly a consolidation exercise; production risk: low).
7. **Simulation engine triplication** (`matchup-sim-engine.ts`, `matchup-simulator/`, `matchup-prediction-engine/`) (impact: medium — real maintenance cost, unclear which is authoritative; migration difficulty: medium, needs reconciliation before any Decision OS wiring; production risk: low, none currently touch shared state).
8. **`lib/saved-recommendations` scaffold incomplete** (impact: low-medium — would be a natural persistence layer for Decision OS output; migration difficulty: low, it's finishing a migration, not designing one; production risk: none, currently a no-op).

### Future enhancements (real value, no urgency)

9. **No Learning Engine / feedback loop anywhere** (impact: high long-term, low short-term — the platform works fine with static confidence today; migration difficulty: high, genuinely new infrastructure; production risk: low, purely additive).
10. **Knowledge Graph / Decision OS integration decision** (impact: medium long-term; migration difficulty: high if pursued; production risk: low — this is a "decide, then maybe build" item, not urgent).
11. **Schedule/playoff sport-agnostic rewrite** (impact: high for multi-sport expansion, zero for current NFL-redraft-only reality; migration difficulty: very high, touches every live league; production risk: high if rushed — correctly still deferred).
12. **Event taxonomy engagement-signal gap** (impact: medium; migration difficulty: low — the pipeline already exists end-to-end for other event types; production risk: low).
13. **DFS/Contest primitive** (impact: high if DFS is ever pursued, zero today; migration difficulty: high, genuinely new data model; production risk: none, purely additive when it happens).

---

## 8. Roadmap: Phase 3, 4, 5

This roadmap is evidence-based, sequenced from the debt ranking above — it is not a wishlist reordering.

### Phase 3 — Close the open loops before adding anything new

**Dependencies:** none — every item here is already scoped, most already have an ADR or an audit doc.

1. Approve and implement the `conservative_roster_pattern` completeness-guard ADR (Phase 2K, per `docs/adr/ADR_DECISION_OS_PHASE6_DNA_CONSERVATIVE_ROSTER_PATTERN_COMPLETENESS_GUARD.md`).
2. Run the staging volume check for redraft trade/waiver/lineup-history activity (needs explicit user sign-off to connect, per the established convention in this workstream).
3. Begin the Phase 5 production soak sequence exactly as `PRODUCTION_READINESS_CHECKLIST.md` already specifies: Commissioner Health → Trade → Waiver → Lineup, 7 days each, gated on 0 `parity_failed` events.

**Expected risk:** low — every step here is measurement or a previously-reviewed rollback-safe flag flip, not new architecture.
**Expected payoff:** unblocks the entire Manager DNA migration decision and starts the clock on Decision OS's actual production cutover, which nothing else in this roadmap can happen ahead of.

### Phase 4 — Resolve real duplication, in priority order

**Dependencies:** Phase 3 items 1–2 (a fixed classifier and real volume data are prerequisites for any AI Coach migration decision).

1. Decide and execute the `lib/manager-dna.ts` migration path for AI Coach (lowest-risk first consumer per prior analysis), building the still-missing LLM-prompt-formatting shim's real integration (the shim itself was built in Phase 2C; only the wiring remains).
2. Reconcile `smart-trade-recommendations.ts` and `user-recommendation-engine` against `phase6/recommendations/` — this needs its own audit-first ticket (mirroring this checkpoint's own methodology) before any code moves, since neither currently touches Decision OS at all.
3. Reconcile the three matchup simulation engines into one, before any Decision OS simulation-engine work begins.

**Expected risk:** medium — real user-facing consumers, real public contracts to preserve (matching this whole workstream's established discipline of parity harnesses and behavior-preservation tests before any cutover).
**Expected payoff:** removes the platform's most concrete "two systems answering the same question differently" risk, and clears the path for a real Simulation Engine to have exactly one Recommendation Engine to feed.

### Phase 5 — Build the genuinely missing core components

**Dependencies:** Phase 4's simulation-engine reconciliation (item 3) and recommendation-engine consolidation (item 2) — building a Learning Engine or Simulation Engine on top of duplicated, uncertain inputs would just formalize the duplication.

1. **Simulation Engine**: wrap the reconciled matchup simulator using the exact wrap-fidelity pattern the four decision slices already prove works (shadow, parity-compare, never mutate legacy). This is the single largest genuinely-missing pipeline stage (§6).
2. **Learning Engine / feedback loop**: connect `trackRecommendationOutcome`'s already-real data to actual confidence recalibration — start narrow (one recommendation type, one feedback signal) rather than a platform-wide redesign.
3. **Knowledge Graph decision**: write the ADR deciding whether `lib/league-intelligence-graph/` becomes Decision OS's relationship substrate or stays a standalone analytics feature — do this before either system grows further independently.

**Expected risk:** high — these are the platform's first genuinely new core components since the architecture freeze, not enrichments of existing frozen ones. Each should get its own ADR per `ARCHITECTURE_FREEZE.md`'s governance rule, exactly as this whole Manager DNA workstream has modeled.
**Expected payoff:** this is what actually closes the gap between "Decision OS today" and "a universal Decision Intelligence Platform" — the two components (Simulation, Learning) that would make Decision OS's recommendations get *better over time* rather than staying at their initial calibration forever.

---

## Files changed in this checkpoint

- `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` (this document, new)

No other file was created, modified, or deleted. No source code, API, or schema was changed. Not committed — awaiting explicit request per this task's instructions.
