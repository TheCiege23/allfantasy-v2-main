# Full Product Blueprint — Phased Gap Audit — Phase 0: Decision OS Existence Check

**Status:** discovery only, no code changes made · **Prepared:** 2026-07-17 · **Branch:**
`claude/blueprint-audit-phase-0-decision-os`

## Headline finding

**The backlog's Phase 0 hypothesis is wrong.** The blueprint's own brief called this "likely CONFIRMED
GAP" based on nothing surfacing in this session's prior audits. It's the opposite: `lib/decision-os/` is
a **252-file, extensively tested (1735+ Decision OS tests, 679 GREEN on the Stage-1 slices alone),
deliberately architected system already on `origin/main`** — not a sibling/unmerged branch, not
vaporware. It maps closely to the blueprint's imagined shape, has its own frozen architecture doc, an
append-only decision registry, ADRs for every phase, and 20 real UI components under
`components/decision-os/`.

**The real, more useful finding is a three-tier reality gap between "exists as code" and "drives what a
real user sees today":**

| Tier | What it is | Status |
|---|---|---|
| 1. Core decision slices (lineup/waiver/trade/commissioner-health) | Architecture + 4 decisions | Built, tested, wired into real API routes — but **status = Hybrid, production = Shadow** for all 4 (per the registry). Computes silently beside the legacy path; does not drive the response a user acts on unless a kill-switch env var is set, and nothing found in this pass suggests any has ever been flipped on in production. |
| 2. Decision Intelligence layer (patterns/DNA/archetypes/benchmarking/recommendations/company intel) | "Phase 6" | Code-complete, 449 tests GREEN — but **self-documented as having zero live data pipeline, zero API exposure, zero UI consumers** as of its own completion doc. |
| 3. UI layer (`components/decision-os/`, 20 components) | Command centers, cards, brief | **Real and reachable** — imported by real page routes (`/commissioner-hub`, `/manager-hub`) and by the main dashboard (`DashboardContent.tsx`). Whether what renders there is live/enabled-by-default for a real user session is **not resolved by this pass** — prior-session context suggests at least the Manager Intelligence Platform ships "all default-off," and this needs a live browser check, not a code-existence check. |

This directly overturns backlog items **#19** (`AttentionSignal` "CONFIRMED GAP") and **#21**
(Commissioner Daily Brief "UNKNOWN") — both exist, richly, as shown below. It also means Phase 1-7 of
this audit should be re-scoped: for most of the blueprint's 20 systems, the question is very unlikely to
be "does this exist at all" and much more likely to be "is this tier-1/2/3 gap the same shape here too."

---

## 1. Does a shared decision/recommendation pipeline exist?

Yes. `lib/decision-os/` (confirmed via `git ls-tree -r origin/main -- lib/decision-os`): **252 files**,
including 20+ `ADR_*.md` documents (one per build phase, `ADR_F2_1_PLAYER_METADATA.md` through
`ADR_PHASE5_1_BEHAVIORAL_EVENT_PORTS.md`), a frozen architecture doc, and a decision registry. Backed by
**158 files under `__tests__/decision-os/`** plus more test files embedded elsewhere in the tree (Phase 6
alone claims 449 of a reported 1735 total Decision OS tests).

It is explicitly designed for reuse across features, not a one-off calculation. From
`lib/decision-os/attentionSignals.ts`'s own header comment: *"Decision OS owns signal generation,
Commissioner OS owns presentation"* — every signal is built to be consumed by "Commissioner OS's
`commissionerCommandCenter.ts`, the standalone `attentionQueue.ts` resolver, a future Notification
Engine, a future Daily Brief, Platform OS, or a mobile client... without those consumers duplicating the
actual severity/ordering rules themselves."

## 2. Structural mapping against the blueprint's proposed shape

The blueprint imagined `context/`, `signals/`, `evaluators/`, `explainers/`, `policies/`, `outputs/`.
The real structure uses different names for close-to-equivalent concepts:

| Blueprint concept | Real equivalent | Notes |
|---|---|---|
| `context/` (context resolution) | `lib/decision-os/world/` ("Canonical World") | Explicitly "origin-blind, read-only, storage-less derived fact layer." Provider-agnostic by design — assembled facts "never reveal or branch on provider." |
| `signals/` | `lib/decision-os/attentionSignals.ts`, `lib/decision-os/phase6/patterns/` | Two layers: cross-feature `DecisionOsAttentionSignal` (see §3) and Phase 6's 12 behavioral pattern types (`repeated_lineup_indecision`, `waiver_aggression_streak`, `league_activity_surge`, etc). |
| `evaluators/` | `lib/decision-os/{lineup,waiver,trade,commissioner-health}/rules.ts` | Per-domain deterministic rule files, e.g. `waiver/rules.ts` → `assertWaiverClaimEligibility`. |
| `explainers/` | `Decision.explanation` field + `four_answers.why_it_matters`/`how_confident` | Built into the core contract itself, not a separate module — see §4. |
| `policies/` | `lib/decision-os/core/shadow/`, `lib/decision-os/core/parity/` | `shouldRunShadow(flag)` gate + shadow/live parity comparison — this is the confidence/freshness/rollout policy layer. |
| `outputs/` | `Decision<TAction>` (core/decision.ts), `RecommendationSet` (phase6/recommendations), `DecisionOsAttentionSignal` | Multiple typed output shapes depending on consumer, not one universal envelope. |

The blueprint's imagined shape and the real one converge on the same idea (deterministic core,
confidence/uncertainty always attached, explanation never fabricated) even though the file layout
differs. This is a genuine architectural match, not just a naming coincidence — see §4's governance
rules below.

## 3. `AttentionSignal` — confirmed to exist, contradicts backlog item #19

`lib/decision-os/attentionSignals.ts` defines `DecisionOsAttentionSignal`:

```ts
export interface DecisionOsAttentionSignal {
  id: string                              // stable/deterministic — dedupeable by id alone
  leagueId: string
  type: AttentionSignalType               // draft_approaching | league_context_incomplete |
                                           // low_league_health | high_league_health |
                                           // league_requires_review | manager_engagement_risk |
                                           // manager_recommendation
  severity: AttentionSignalSeverity       // critical | high | medium | low | informational
  priorityScore: number                   // deterministic ordering key
  title: string
  explanation: string
  recommendedAction: string | null        // null only when explanation IS the action, or genuinely nothing to do
  // + timestamp, source
}
```

Sources are real, already-computed values, not new intelligence: the league health engine's own
status/score/alerts (`missionControl.ts`), League Context's financial status (`leagueContext.ts`),
`LeagueSettings.draftDateUtc`, and `UserOsSnapshot` for the manager-facing variant. The file's own
comment explains two originally-planned signal types ("Trade Activity Change", "Waiver Activity Change")
were **deliberately omitted** because no per-type historical trend exists anywhere in the codebase yet —
"otherwise omit," not an oversight. That's the honest-degradation discipline the blueprint asks for,
already being followed.

This directly overturns backlog item #19's "CONFIRMED GAP" tag for the shared prioritized-action model.
What's actually unconfirmed is narrower: whether the *dashboard specifically* renders a "Today's
Priorities"-style list built from this — that's a dashboard-wiring question (already in scope for the
separate dashboard league-data-binding audit), not an existence question.

## 4. The core Decision Object (`Decision<TAction>`)

`lib/decision-os/core/decision.ts` — every decision answers exactly four mandatory questions
(`assertFourAnswers` throws if any is empty):

```ts
interface FourAnswers {
  what_happened: string
  why_it_matters: string
  how_confident: string
  what_to_do: string
}

interface Decision<TAction = unknown> {
  decision_id: string
  decision_type: string
  decider_scope: 'user' | 'commissioner' | 'operator'
  four_answers: FourAnswers
  recommended_actions: TAction[]
  rule_verdicts: RuleVerdict[]           // legal | illegal | temporarily_illegal | requires_approval
  confidence: number                      // 0-100
  data_completeness: number               // 0-100, separate from confidence
  uncertainty_sources: string[]
  provenance: { weakest_source: string; weakest_trust: 'authoritative'|'high'|'medium'|'low'|'unverified' }
  automation_capable: boolean
  explanation: string                     // "Plain-language why, safe for the Today Card. Never exposes models/AI."
  telemetry: DecisionTelemetryFlags
}
```

Governance rules documented in `ARCHITECTURE_FREEZE.md` (frozen 2026-06-29, changes require an ADR):
- **P1 Purpose Blindness** — the substrate owns facts; decision-specific interpretation lives elsewhere.
- **P1a Origin Blindness** — assembled facts never reveal or branch on provider (enforced by
  `canonical-world-architecture.test.ts`).
- **P2 Enrichment-as-truth** — unsourced fields degrade to null + uncertainty; never fabricated.
- **P3 AI governance** — "AI may summarize, explain, prioritize, or communicate deterministic decisions.
  AI may NEVER generate, replace, or fabricate deterministic facts used by the Decision OS." Confirmed
  in the registry's KPI table: *"Deterministic decisions: 100% (AI is explanation-only, never in the
  verdict path)."*

This is a stricter, more explicit no-fabrication discipline than the Chimmy hallucination guard already
audited this session — worth cross-referencing when Phase 6 (Chimmy Intelligence Layer, item #40) of the
larger blueprint audit runs.

## 5. Registry — the authoritative status of the 4 "Stage 1" decisions

`lib/decision-os/DECISION_REGISTRY.md` (append-only, one row per decision — but **itself stale**: last
touched 2026-06-29, before Phase 6 existed, so it only covers the original 4 slices, not anything built
since):

| Decision ID | Scope | Status | Production |
|---|---|---|---|
| `manager.lineup.set` | user | Hybrid | **Shadow** |
| `manager.waiver.claim` | user | Hybrid | **Shadow** |
| `manager.trade.evaluate` | user | Hybrid | **Shadow** |
| `commissioner.league.health` | commissioner | Hybrid | **Shadow** |

All four are wired into real, live code paths — confirmed directly, not just from docs:
- `app/api/redraft/trade-proposals/route.ts` genuinely appends a `decisionOs: { decisionId, card,
  completeness, uncertaintySources }` field to its JSON response when `DECISION_OS_TRADE_LIVE=true`
  (commit `323385f7f`, verified by reading the current file content on `origin/main`, not just the
  commit message).
- `lib/commissioner-hub/commissionerHubHealth.ts` similarly gates on `DECISION_OS_COMMISSIONER_HEALTH_LIVE`.

But "Shadow" in the registry's own legend means: *shadow computation runs beside the legacy path,
compared for parity, and never overrides what the user actually sees* unless a kill switch promotes it
to Stage 1 LIVE. `lib/decision-os/PRODUCTION_READINESS_CHECKLIST.md` (2026-06-30) shows all 4 Phase-5
soaks at "⏳ Awaiting flag activation" with blank start/pass dates — **no evidence any of the 4 kill
switches has ever been turned on in production.** This pass has no access to live Vercel environment
variables, so "still off today" can't be asserted with certainty — only that nothing in the repo's
history after 2026-06-30 shows a soak starting or passing.

## 6. Phase 6 — Decision Intelligence Layer — built, self-documented as disconnected

`lib/decision-os/phase6/PHASE_6_COMPLETION_CHECKPOINT.md` (2026-07-01, "Status: COMPLETE," 449 tests):
six sub-phases — Behavioral Patterns (12 types), Manager DNA (8 identity labels + 5 dimensions), League
Archetype Classifier (10 labels), Platform Benchmarking (5 percentile-ranked dimensions), a
Recommendation Engine (16 categories across manager/commissioner/platform tiers), and a Company
Intelligence Foundation (9 aggregate-only, privacy-safe sections for licensee reporting). All pure
functions — "no DB, no IO, no AI, no side effects."

The document's own "Remaining Gaps" section (§6a-6g) is unusually candid and worth quoting directly
rather than summarizing away:
- **6a:** "No live pipeline feeds Phase 5 outputs into Phase 6 automatically."
- **6b:** "No public or internal API routes expose Phase 6 outputs."
- **6c:** "Phase 6 assemblers recompute on every call... results must be cached" (not yet built).
- **6e:** "All Phase 6 outputs are point-in-time snapshots. No week-over-week comparison exists."
- Consumer table: Commissioner UI "not yet built," Manager UI "not yet built," Widget Platform "not yet
  built."

This is a full tier below the Stage-1 slices in integration maturity — those at least run against real
requests in shadow mode; Phase 6 doesn't run against live data at all yet outside of tests.

`lib/decision-os/sdk/PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md` (2026-07-01) is explicitly labeled
"planning-only ADR" — a design document, not implementation. Treat anything numbered "Phase 7.x" as
proposal-stage unless directly verified otherwise.

## 7. UI layer — real routes confirmed, live-behavior not resolved by this pass

`components/decision-os/` has 20 files. Traced import chains directly (not from docs) confirm real page
routes render this:

```
app/commissioner-hub/CommissionerHubPageClient.tsx
  → CommissionerCommandCenterSection.tsx
      → CommissionerCommandCenterOverview.tsx, TodaysBriefCard.tsx, CommissionerAttentionQueue.tsx, ...

app/manager-hub/ManagerHubPageClient.tsx
  → ManagerCommandCenterSection.tsx
      → ManagerCommandCenterOverview.tsx, TodaysBriefCard.tsx, ...

app/dashboard/DashboardContent.tsx
  → LeaguePulseCard, ManagerDnaCard, DecisionRecommendationsCard
      → lib/decision-os/league-pulse.ts, manager-dna.ts, recommendations.ts
```

This means a **Commissioner Daily Brief-equivalent (`TodaysBriefCard`) already exists and is wired into
a real page** — directly contradicting backlog item #21's "UNKNOWN — NEEDS AUDIT" tag. Same for item
#28 (cross-league manager overview) — `ManagerCommandCenterOverview` at `/manager-hub` is a strong
candidate for exactly this, pending live verification of what it actually renders.

**What this pass could not resolve:** whether what's *reachable* is what a real logged-in user actually
sees by default. This session's own memory of prior work states the Manager Intelligence Platform
shipped "all default-off," and `CommissionerHubPageClient.tsx` contains a code comment calling out a
"redundancy flagged" against `CommissionerCommandCenterOverview`'s own stat chips — a hint that this
surface may already have known rough edges. Confirming what actually renders for a real session (feature
flags, empty states, whether `/commissioner-hub` and `/manager-hub` are linked from anywhere a user would
find them) is a live-verification task, not a code-existence one — exactly the kind of check the
dashboard league-data-binding audit is already doing for the main dashboard. The same discipline should
extend to these two hub pages before Phase 3 of this larger audit runs.

## 8. What this means for the rest of the phased audit

The backlog's Phase 0 assumption ("likely confirmed gap... every OS needs this built from scratch")
does not hold. Re-scoping implication for Phases 1-7: for most blueprint systems, expect to find a
**Tier 1/2/3 split like the one above** (working shadow logic tested but not cut over; intelligence
logic built but disconnected from data flow; UI shells that exist but whose live/default state is
unverified) rather than a clean built/not-built binary. Phase-by-phase audits should explicitly check
for existing `lib/decision-os/` coverage before concluding something needs to be built — several
backlog items (#19, #21, likely #22's fuller League Health model, #28, #30, #48) may turn out to be
"exists in decision-os, not yet reaching the surface being audited" rather than true ground-up gaps.

**Not re-derived here, flagged for whoever scopes actual build phases:** the registry's own staleness
(§5) means a full, current inventory of every decision now covered by Decision OS — not just the
original 4 — doesn't exist as a single document anywhere. That inventory (which of the blueprint's ~46
still-unknown items already have a decision-os equivalent) is worth building before committing to any
"build from scratch" plan for items this audit hasn't reached yet.

## 9. Explicitly not covered by this pass

No fixes made. No live browser verification of `/commissioner-hub`, `/manager-hub`, or the dashboard's
decision-os cards — that's a live-verification task, not this discovery pass's job. No assessment of
whether the Stage-1 kill switches are currently on in the actual production environment (no access to
live Vercel env vars from this session). Phases 1-7 of the larger blueprint audit have not been started.
