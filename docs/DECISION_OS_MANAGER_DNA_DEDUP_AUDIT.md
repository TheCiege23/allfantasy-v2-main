# Decision OS — Manager DNA De-duplication Audit (Phase 2A)

**Status:** Audit only. No source code changed in this phase.
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §1.3 / §8.3, `docs/DECISION_OS_CORE_PHASE1_IMPLEMENTATION_NOTE.md`

## TL;DR

This is not a clean three-way duplicate. It's three modules in three very different states of aliveness, with genuinely different input data sources — the migration is not "pick a winner and swap imports."

| Module | Status | Risk to migrate |
|---|---|---|
| `lib/gm-profile/` | **Dead code.** API route exists, zero UI/programmatic consumers, zero tests. | **Lowest** — safe to retire almost immediately. |
| `lib/manager-dna.ts` (repo root) | **Live**, but in a narrow, high-stakes lane: AI Coach, Trade Analyzer, Trade Proposal Generator (LLM prompt context) + its own public API routes (`/api/legacy/manager-dna`, `/api/ai/manager-dna`) backed by a dedicated Prisma table (`managerDNA`) keyed by Sleeper username. | **Highest** — public API shape + LLM prompt format both need preserving; input data source (Sleeper + Prisma trade history) differs fundamentally from Decision OS's behavioral-event pipeline. |
| `lib/decision-os/phase6/dna/` + `lib/decision-os/manager-dna.ts` (adapter) | **Canonical.** Frozen per `ARCHITECTURE_FREEZE.md`, fully live (not shadow) in 5 UI surfaces, 835-assertion contract test suite. | **N/A — this is the target**, not a migration source. |

**Recommendation:** Phase 6 DNA is already the correct canonical implementation and needs no code change. Phase 2B should (1) delete `lib/gm-profile/` outright, and (2) build the *missing* LLM-prompt-formatting shim for Phase 6 DNA as a prerequisite — before touching a single line of `lib/manager-dna.ts`'s three live AI consumers.

---

## 1. What each module currently owns

### 1.1 `lib/gm-profile/gm-profile-engine.ts` + `index.ts`

Deterministic (<10ms, no AI/LLM calls) archetype classifier from aggregate trade/waiver/draft/lineup counters. Exposed via `POST /api/gm-profile/route.ts` (Zod-validated body, NextAuth session required, wraps engine output as `{ data: GmProfileResult }`).

### 1.2 `lib/manager-dna.ts` (repo root, ~23KB)

A Sleeper-integrated, Prisma-cached (`managerDNA` table, 7-day TTL) archetype classifier. Computes 10 fine-grained 0–1 behavioral metrics from real trade history (queried from Prisma) and waiver transactions (fetched live from the Sleeper API), classifies one of 8 archetypes, and additionally exposes `formatDNAForPrompt()` — a markdown-formatting function that renders the profile as an LLM prompt-context block. This is the piece none of the other two modules have: **a text-formatting adapter for AI prompt injection**, not a UI view-model.

### 1.3 `lib/decision-os/phase6/dna/` (`dna.ts` + `types.ts`) + `lib/decision-os/manager-dna.ts` (adapter)

The Decision OS Phase 6.2 identity classifier: an 8-priority, threshold-gated pipeline (`assembleManagerDna()`) that scores a manager against `ghost_manager` → `set_and_forget` → `reactive_manager` → `indecisive_tinkerer` → `serial_trader` → `waiver_hawk` → `trade_seeker` → `committed_grinder` → `unknown`, driven entirely by **Decision OS behavioral events** (Phase 6.1 detected patterns + Phase 5.2 manager signals), not by direct Sleeper/Prisma reads. `lib/decision-os/manager-dna.ts` is a separate, thin adapter (`buildManagerDnaViewModel()`) that turns the classifier's output into a presentation-ready `ManagerDnaViewModel` for React components — title-cased labels, confidence buckets, evidence strings, and an "insufficient data" fallback state.

---

## 2. Consumers

| Module | Consumers |
|---|---|
| **`lib/gm-profile/`** | `app/api/gm-profile/route.ts` only. `lib/chimmy-deterministic-analysis/ChimmyModuleInterface.ts` lists `'gm-profile'` in a `MODULE_NAMES` registry string constant but never imports or calls the engine. **No components, no tests, no other lib code.** |
| **`lib/manager-dna.ts`** | `server/api-route-modules/legacy/manager-dna/route.ts` (POST computes+caches, GET reads cache; rate-limited); `app/api/ai/manager-dna/route.ts` (strangler-pattern wrapper around the same legacy route, dual-tags telemetry for both `/api/ai/*` and `/api/legacy/*` during the in-flight route migration); `server/api-route-modules/legacy/ai-coach/route.ts` (calls `formatDNAForPrompt()` for LLM coaching context); `server/api-route-modules/legacy/trade/analyze/route.ts` (same, for trade valuation context); `server/api-route-modules/legacy/trade/proposal-generator/route.ts` (`getCachedDNA()`, influences generated proposals). **No direct unit tests for this file's own exports.** |
| **`lib/decision-os/phase6/dna/` (core)** | `lib/decision-os/manager-dna.ts` (adapter), `lib/decision-os/league-pulse.ts`, `lib/decision-os/dashboard-intelligence.ts` (Phase 8.1 assembly pipeline), `__tests__/decision-os/phase6/manager-dna.test.ts` (835 lines, the contract test), `__tests__/league-pulse-decision-os.test.tsx`. |
| **`lib/decision-os/manager-dna.ts` (adapter)** | `components/decision-os/ManagerDnaCard.tsx`, `app/dashboard/DashboardContent.tsx`, `app/dashboard/components/DashboardOverview.tsx`, `app/league/[leagueId]/tabs/LeagueTab.tsx`, `app/commissioner-hub/CommissionerHubPageClient.tsx`, `__tests__/manager-dna-decision-os.test.tsx`. |

Two unrelated modules share the "manager-dna" name but are **not** part of this audit or this de-duplication (confirmed not to import from any of the three above): `lib/mock-draft/manager-dna.ts` (`buildManagerDNAFromLeague`, used by `lib/mock-draft/board-drift.ts`) — a mock-draft-specific heuristic, out of scope.

---

## 3. Overlapping output fields (same concept, different name/shape)

| Concept | `lib/manager-dna.ts` | `lib/gm-profile/` | Phase 6 DNA |
|---|---|---|---|
| Primary archetype/identity | `archetype: string` (8 labels, "The X" style) | `gmArchetype: string` (11 labels, "The X" style, 1 dead) | `primaryIdentity: ManagerIdentityLabel` (9 snake_case labels) |
| Confidence | `confidence: number` (0–1) | `confidencePct: number` (25–90 range) | `confidence: number` (0–1) |
| Strengths | `strengths: string[]` (3) | `strengths: string[]` | `traits[]` where `strength: 'strong'` (no dedicated "strengths" field — traits carry this) |
| Weaknesses | `blindSpots: string[]` (3) | `weaknesses: string[]`, `growthAreas` (alias) | `traits[]` where `strength: 'weak'` |
| Coaching text | `recommendations: string[]` (≤5) | `coachingRecommendations: string[]` | No direct equivalent in the core classifier; the *adapter* (`buildManagerDnaViewModel`) synthesizes a single `coachingFocus: string` |
| Risk posture | `metrics.riskTolerance` (0–1, input-derived) | `riskProfile: string` (templated), `riskTolerance` (input) | `riskTendency: 'risk_taking' \| 'risk_averse' \| 'neutral'` (output enum) |
| Transaction behavior style | Only implicit via archetype | `negotiationStyle`, `waiverStyle`, `lineupStyle`, `draftStyle` (4 separate fields) | `transactionStyle: 'trade_dominant' \| 'waiver_dominant' \| 'balanced' \| 'passive'` (1 field) |
| Trade/waiver activity counts | `tradeCount`, `waiverCount`, `seasonsCovered` | Only as *input* (`totalTradesMade`, `waiverClaimCount`, `seasonsTracked`) | Not exposed in output at all — only feeds the internal rate/tier calculation |

---

## 4. Unique output fields (no equivalent elsewhere)

**`lib/manager-dna.ts` only:** `secondaryArchetype` (nullable second-place label), `metrics.positionBias` (per-position allocation record), `metrics.consolidationTendency`, `metrics.pickHoarding`, `metrics.agePreference`, `metrics.buyLowTendency`, `metrics.sellHighTendency` (fine-grained 0–1 dials with no Phase 6 counterpart at all), `formatDNAForPrompt()` (LLM prompt text renderer — this is a *format*, not a field, but it's the single most important thing to replace before any consumer migration).

**`lib/gm-profile/` only:** `decisionQualityScore`, `consistencyScore` (0–100), `gmEvolutionTrend` (`'improving' | 'stable' | 'regressing' | 'volatile'`), `selfSabotageFlags: string[]`, `marketTimingGrade` / `disciplineGrade` / `adaptabilityGrade` (A–F letter grades), `recurringLeaks`, `behavioralPatterns` (3-element narrative array), `pressureBehavior`, `rebuildVsCompeteBias`, `positionBiases: string[]` (list form, distinct from manager-dna's numeric record).

**Phase 6 DNA only:** `completeness: number` (0–100, distinct from `confidence` — an honest data-sufficiency signal none of the legacy modules have), `derivation: string[]` (full classifier audit trail — which rule fired and why, per the Decision OS "explainability" invariant), `warnings: string[]` (e.g. conflicting-signal detection: conservative-roster pattern alongside high trade/waiver activity), `leagueContext`-aware classification (uses league archetype + engagement percentile as an input signal — none of the legacy modules are league-context-aware), dual-keyed by `managerId` + `leagueId` (legacy modules are keyed by Sleeper username across leagues, a materially different identity model).

---

## 5. Which implementation should become canonical

**Phase 6 DNA (`lib/decision-os/phase6/dna/` + its adapter) — already is, and needs no further code work to earn that status.** It is:
- Explicitly frozen and declared authoritative in `lib/decision-os/ARCHITECTURE_FREEZE.md` (2026-06-29).
- Fully live (not shadow) across 5 real UI surfaces today.
- The only one of the three with a real backward-compatibility contract test suite (835 assertions covering all 8 classifiers, thresholds, boosters, conflict detection, completeness scoring, deterministic ordering, input immutability).
- The only one with honest degradation semantics (`warnings`, `completeness`) consistent with the rest of Decision OS.

This matches what `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §1.3 already concluded. This audit does not change that conclusion — it just proves it field-by-field and surfaces the real migration cost, which is higher than "swap an import" for one of the two legacy modules.

---

## 6. Fields needing adapter/shim support for backward compatibility

| Gap | Why it's needed | Exists today? |
|---|---|---|
| **LLM-prompt-text formatter for `ManagerDnaProfile`** (a `formatDNAForPrompt()` equivalent) | AI Coach, Trade Analyzer, and Trade Proposal Generator all consume `lib/manager-dna.ts`'s `formatDNAForPrompt()` output as raw prompt text, not a UI view-model. The only existing Phase 6 adapter (`buildManagerDnaViewModel`) produces a UI shape, not prompt text. **This must be built before any of the three AI consumers can be migrated.** | **No — does not exist.** |
| **Legacy archetype-label mapping** ("The Architect" ↔ `set_and_forget`, etc.) | If `/api/legacy/manager-dna` or `/api/ai/manager-dna` ever need to be backed by Phase 6 data while preserving their current JSON shape, the 8 "The X" labels and Phase 6's 9 snake_case labels don't cleanly biject (Phase 6 has no equivalent to `metrics.positionBias`, `secondaryArchetype`, etc., and its label taxonomy was designed independently). | **No — and may not be fully achievable.** Treat this as a strong signal that these two routes should be **deprecated at the consumer level**, not silently re-pointed at Phase 6 under the same response shape. |
| **`DNAMetrics` (10-field 0–1 dial record) equivalent** | If any *undiscovered* consumer reads `metrics.*` directly from the legacy shape (this audit found none, but Phase 2B should grep specifically for `.metrics.` access on manager-dna results before assuming none exist), there is no Phase 6 equivalent — those fields would need to stay computed by the legacy engine or be explicitly dropped with sign-off. | **No.** |
| **`gm-profile`** | None — zero live consumers means no shim is needed. Retire outright. | N/A |

---

## 7. Safest migration order

1. **Retire `lib/gm-profile/` first.** Zero consumers, zero tests, one dead archetype label already (a real internal bug — "The Draft Guru" is declared but never returned). Lowest possible risk; can happen in Phase 2B with a one-time response-shape snapshot test taken *before* deletion as cheap insurance, then delete the module, the route, and its `MODULE_NAMES` registry string.
2. **Do not touch Phase 6 DNA's code.** It's the target, not a migration source. Phase 2B/2C work here should be *data-completeness validation* (does the behavioral-event pipeline have equivalent historical depth to what `lib/manager-dna.ts` computes directly from Sleeper + Prisma trade history for the same leagues?), not a refactor.
3. **Build the missing LLM-prompt shim** (§6) against Phase 6 DNA, with its own contract tests, entirely independent of touching any live consumer.
4. **Migrate the three AI consumers one at a time** (AI Coach → Trade Analyzer → Trade Proposal Generator), each behind its own comparison/shadow step, only after step 3's shim is proven and step 2's data-completeness question is answered. This is the highest-risk step and should be its own dedicated phase, not bundled with anything else.
5. **Leave `/api/legacy/manager-dna` and `/api/ai/manager-dna` (and the `managerDNA` Prisma table) alone** until a future, explicitly-scoped phase decides whether to (a) deprecate them in favor of a Decision OS-backed equivalent endpoint, or (b) keep them permanently as a stable legacy contract. Per this task's constraint ("preserve all current API response shapes... unless explicitly migrated"), do not attempt to silently re-point them at Phase 6 data given the label-mapping gap in §6.

---

## 8. Tests required before any code migration

- **Golden/snapshot test for `/api/gm-profile`'s response shape**, taken immediately before deletion — cheap, and closes out any risk that an undiscovered consumer exists.
- **Golden/snapshot tests for `/api/legacy/manager-dna` and `/api/ai/manager-dna`'s exact JSON response shapes.** None exist today. Required before touching `lib/manager-dna.ts` at all, since these are public API contracts this task explicitly requires preserving.
- **Contract test for `formatDNAForPrompt()`'s exact current output string format.** None exist today. Required as the diff baseline before building its Phase 6 replacement in step 3 above.
- **A parity/equivalence harness** that runs both `lib/manager-dna.ts`'s classifier and Phase 6 DNA's classifier against the same real historical trade/waiver data for a sample of leagues, and reports how often (and how) their archetype outputs disagree. This is a data question, not a code-correctness question, and should exist *before* any decision to migrate the three AI consumers — it's the evidence needed to answer the data-completeness question in migration step 2.
- **Re-run the existing 835-assertion `__tests__/decision-os/phase6/manager-dna.test.ts` and `__tests__/manager-dna-decision-os.test.tsx`** as the standing regression gate for any future adapter work — these already exist and are strong; no changes needed to them in Phase 2A/2B, just keep them green.

---

## Recommended Phase 2B implementation prompt

> Perform Phase 2B of the Manager DNA de-duplication per
> `docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md`. Scope: **only** step 1 of the
> migration order (§7) — retire `lib/gm-profile/` outright. Concretely:
> (1) add a one-time golden snapshot test for `POST /api/gm-profile`'s current
> response shape; (2) delete `lib/gm-profile/gm-profile-engine.ts`,
> `lib/gm-profile/index.ts`, `app/api/gm-profile/route.ts`, and the
> `'gm-profile'` entry in `lib/chimmy-deterministic-analysis/ChimmyModuleInterface.ts`'s
> `MODULE_NAMES` registry; (3) remove the now-dead golden snapshot test itself
> once deletion is confirmed clean (or keep it as a permanent 404 regression
> test — your call, note which you chose). Do **not** touch `lib/manager-dna.ts`,
> its three AI consumers, its two API routes, or anything under
> `lib/decision-os/` in this phase — those are explicitly deferred to Phase 2C+
> per the audit's migration order. Run the full test suite and typecheck;
> commit only if both pass with no unexpected regressions.

## Risks to watch

- The biggest risk in this whole de-duplication is **not** code — it's whether Decision OS's behavioral-event pipeline has enough historical depth, for enough leagues, to match what `lib/manager-dna.ts` computes directly from live Sleeper API + Prisma trade history. This audit did not measure that (it's a data question, not a static-analysis question) — the parity harness in §8 is how Phase 2C should answer it before migrating any AI consumer.
- `/api/legacy/manager-dna` and `/api/ai/manager-dna` are real public API surfaces with a dedicated Prisma table and their own caching/rate-limiting. Nothing in this audit found a plan to retire them — that's a separate, larger decision this document deliberately does not make.
