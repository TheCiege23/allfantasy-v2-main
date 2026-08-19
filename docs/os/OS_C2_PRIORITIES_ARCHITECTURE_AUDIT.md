# Phase OS-C2 — Part 1: Manager Priorities Architecture Audit

Required before any Lineup/Trade/Waiver Priorities code is written, per this phase's own explicit
instruction: determine which of three candidate systems is the canonical source for Manager OS's first
decision-making modules, so OS-C2 doesn't accidentally fork Decision OS intelligence.

## Candidate A — `ManagerIntelligenceHub` modules

- **Ownership**: `lib/decision-os/manager-intelligence/{team-health,weekly-outlook,transaction-readiness}/`,
  rendered by `components/manager-intelligence/ManagerIntelligenceHub.tsx` at the existing single-league
  route `/league/[leagueId]/manager-hub`.
- **Data source**: real, deterministic, Prisma-backed aggregators over `RedraftRosterPlayer`
  (slotType/injuryStatus/byeWeek) and `RedraftMatchup`/`RedraftSeason`. No LLM, no recommendation engine
  — each module's own docstring is explicit: "NOT an AI feature, NOT a recommendation," "READINESS, not
  opportunity discovery," "never a start/sit, waiver, trade, or matchup recommendation."
- **Decision OS compatibility**: low. It fetches from its own route family
  (`/api/app/leagues/[id]/team-health`, `/weekly-outlook`, `/transaction-readiness`) — NOT the
  `/api/decision-os/*` convention every OS-B/OS-C1 primitive uses. It does not consume or produce a
  `DecisionOsAttentionSignal`, a `DailyBrief`, or a `Recommendation`. Reusing it as Manager OS's
  canonical priorities source would mean bridging two architectures, the same class of problem OS-B4.5
  solved for Platform OS (which "predated and never adopted the newer signal model").
- **Duplication risk**: low against Candidate B — this is genuinely different information (roster/lineup
  *composition* facts: injured starters, bye-week conflicts, bench depth, open roster slots) that neither
  `UserOsSnapshot` nor the Phase 6.4 recommendation engine computes today.
- **Existing browser usage**: gated off by default — `NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED`
  defaults to off (confirmed: not set in any `.env*` file in this repo) and the hub's own code shows a
  quiet "not available" state until it's explicitly turned on. Real, tested, "no remaining placeholders"
  per its own docstring — but not yet graduated to default-on anywhere.
- **Long-term suitability**: good future enrichment source for Lineup Priorities specifically (Team
  Health's injured/bye-week/bench-depth facts are a close match for the user's own named examples), but
  it is single-league only today — using it here would require building a NEW cross-league aggregation
  layer (mirroring the `userOs.ts` → `managerCommandCenter.ts` work from OS-C1) before it could power a
  multi-league Priorities module. More work than "clearly justified" for this phase.

## Candidate B — `UserOsSnapshot.recommendations` / `.activitySummary`

- **Ownership**: `lib/decision-os/userOs.ts` (`resolveUserOsSnapshot`), already aggregated cross-league by
  OS-C1's own `managerCommandCenter.ts`.
- **Data source**: Phase 6.4's real recommendation engine (`lib/decision-os/phase6/recommendations/`),
  reached via `resolveManagerIntelligencePayload` → `assembleManagerDna`/pattern detection →
  `Recommendation[]` with `tier: 'manager'`. Crucially, `RecommendationCategory` already includes
  `'lineup_discipline'`, `'trade_coaching'`, and `'waiver_opportunity'` as real, existing manager-tier
  categories — this engine already covers exactly the three domains OS-C2 wants Priorities modules for.
- **Decision OS compatibility**: highest of the three. This is already the exact system OS-C1 built
  Manager OS's Attention Queue on (`deriveManagerAttentionSignals`'s `manager_recommendation` signal type
  reuses this engine's own `priority`/`expectedImpact`/`recommendedActions` verbatim).
- **Duplication risk**: none introduced by using it — it's already the canonical path.
- **Existing browser usage**: live, unconditional, no feature flag. `resolveManagerIntelligencePayload`
  has no gate in its own code, and `userOs.ts`'s own docstring confirms it's "already reachable without a
  commissioner gate on `LeagueTab.tsx`." Now also powers `/manager-hub` (OS-C1).
- **Long-term suitability**: highest. Cross-league aggregation already exists; the categories already
  match; no new plumbing needed.

## Candidate C — trade/waiver/lineup card adapters

- **Ownership**: `lib/decision-os/{trade,waiver,lineup}/` — `toTradeCard`, `toWaiverCard`,
  `toTodayLineupCard`, each a pure presentation transform over a `Decision<T>` object.
- **Data source**: the Decision OS "Canonical World" Decision Object pipeline (`manager.trade.evaluate`,
  `manager.waiver.claim`) — genuinely real, deterministic evaluation logic.
- **Decision OS compatibility**: architecturally real Decision OS, but a DIFFERENT stage of it. Reading
  `trade/shadow.ts` directly: this whole pathway runs as a **shadow/parity check beside the legacy trade
  flow**, gated by `DECISION_OS_TRADE_SHADOW`, explicitly documented as "NEVER throws or affects the
  legacy response," with a separate `DECISION_OS_TRADE_LIVE` kill switch for a not-yet-taken production
  cutover. It is currently wired only into internal feature routes (`trade-proposals`,
  `today/lineup-actions`, `waiver-ai/engine`) as a correctness-verification object, not a customer-facing
  card anywhere.
- **Duplication risk**: real and directional — if this pathway is ever cut over to production, it would
  likely supersede or need reconciling with Phase 6.4's `trade_coaching`/`waiver_opportunity`
  recommendations (Candidate B). That reconciliation is exactly the kind of production-intelligence
  cutover decision this codebase already treats as its own explicit ADR process (see
  `PLATFORM_INTELLIGENCE_CUTOVER_ADR.md` for the precedent of treating "cut a shadow system into a live
  UI" as a dedicated decision, not an incidental one).
- **Existing browser usage**: none. Shadow-only.
- **Long-term suitability**: potentially high once cut over — but using it today, in a Manager-facing
  Priorities module, would be an undocumented, unilateral pre-cutover decision this phase is not
  positioned to make. Disqualified for OS-C2 on that basis alone, independent of the other three
  candidates' own merits.

## Decision

**Candidate B (`UserOsSnapshot.recommendations`, already flowing through `managerCommandCenter.ts`) is
the canonical source.** It already owns real, live, cross-league, multi-category (including all three of
lineup/trade/waiver) manager-tier recommendation intelligence — the Decision Rule's first branch applies
directly: "If one system already owns the intelligence: Reuse it." No new algorithm, no new derivation.

Candidate A is real and not a duplicate, but adopting it now would require new aggregation work
disproportionate to "reuse, don't invent" — documented as a future enrichment candidate, not built.
Candidate C is disqualified outright: it's shadow-only, gated behind unflipped kill switches, and
promoting it to customer-facing status is a cutover decision this phase does not have standing to make.

**No systems are combined.** Building Lineup/Trade/Waiver Priorities on Candidate B means *grouping*
already-real `Recommendation` objects (already computed, already flowing into `managerCommandCenter.ts`)
by their own already-real `category` field — three of the six manager-tier categories
(`lineup_discipline`, `trade_coaching`, `waiver_opportunity`) map directly to the three requested modules;
the other three (`engagement_boost`, `league_participation`, `draft_preparation`) continue to surface only
through the existing, unchanged generic Attention Queue.

## Documented technical debt (not fixed opportunistically, per this phase's own instruction)

- Candidate A's real Team Health/Weekly Outlook/Transaction Readiness data is unused by Manager OS's
  multi-league surface. A future phase could build a cross-league aggregation layer for it once
  `NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED` is graduated toward default-on, to enrich Lineup
  Priorities with real roster-composition facts beyond what Phase 6.4's `lineup_discipline` category
  alone captures.
- Candidate C's shadow trade/waiver/lineup Decision Objects remain pre-cutover. If/when
  `DECISION_OS_TRADE_LIVE`-style flags are ever flipped, the resulting live decisions will need explicit
  reconciliation against Phase 6.4's `trade_coaching`/`waiver_opportunity` recommendations — two systems
  that would then both claim to answer "what trade/waiver should I make," which is exactly the kind of
  duplication this audit was built to prevent from happening silently.

---

# Part 2 — Build (on the audited Candidate B path)

`managerCommandCenter.ts` gained one new field, `recommendations: ManagerCommandCenterRecommendation[]`
— the SAME real Phase 6.4 `Recommendation` objects `deriveManagerAttentionSignals` already reads for
the generic Attention Queue's `manager_recommendation` signals, now also exposed directly (tagged with
`leagueId`) so the UI can group them by their own real `category` instead of only seeing them flattened
into one generic signal list. Zero new derivation — this is a second, richer view of data the
composition already computed.

One new generic component, `ManagerPriorityModule.tsx`, instantiated 3× by
`ManagerCommandCenterSection.tsx` (Lineup/Trade/Waiver Priorities, filtering on
`lineup_discipline`/`trade_coaching`/`waiver_opportunity` respectively) — built as one shared component
from the start rather than three near-copies, since the "rule of three" this codebase already applies
after a third occurrence accumulates was known to apply immediately here. Each entry's severity reuses
`recommendation.priority` verbatim, its headline reuses `recommendedActions[0].action`, its "why" text
reuses `expectedImpact`, and up to 2 real `evidence` bullets are shown — never invented text.

**Honest gap, not silently dropped**: no `Recommendation` field supports "what happens if you ignore
this" (the UX principle explicitly asked for by this phase). `rollbackCriteria` describes when to
*withdraw* a recommendation, not the consequence of inaction — using it for that purpose would be a
fabrication. Documented as a real, open UX gap rather than answered with invented copy.

**Placement**: the 3 modules render between the Attention Queue and Notification Center, per this
phase's own explicit hierarchy (Today's Brief → Attention Queue → Priority Modules). Showing the same
underlying recommendations in both the Attention Queue (cross-domain glance) and a Priority Module
(domain-specific, actionable) is the same "two distinct surfaces over overlapping data" pattern OS-B6
already established for `CommissionerAttentionQueue`/`NotificationCenter` — not the kind of duplication
this phase's "no duplicate recommendations" principle is aimed at (which is about not showing the exact
same item twice within one list).

## Part 2 — Verification

- **Real bug found and fixed during the build, not before shipping**: `managerCommandCenter.ts`'s
  aggregation loop already had `const { teamHealth, recommendations, leagueTrend } = snapshot` — adding
  a new outer `const recommendations: ManagerCommandCenterRecommendation[] = []` accumulator of the
  exact same name created a real variable-shadowing bug (`recommendations.push(...)` inside the loop
  silently resolved to the wrong variable, a `RecommendationSet | null` with no `.push` method).
  Caught immediately by `npm run typecheck` (158 → 160 errors), not by manual review or a test failure
  — fixed by renaming the outer accumulator to `recommendationEntries`. Re-confirmed 158/158 baseline
  after the fix.
- **30 new/updated tests**: 7 new in `manager-priority-module.test.tsx` (category filtering, real-
  priority-based ordering, honest empty state, headline/evidence fidelity, the `limit` prop, the real
  count in the panel title), 3 new in `manager-command-center.test.ts` (the new `recommendations`
  field's pass-through/tagging/aggregation), plus updated assertions in
  `manager-command-center-section.test.tsx` proving all 3 modules wire correctly end to end.
- **142 files / 3020 tests passing** (`__tests__/decision-os/` + commissioner-hub wiring) — zero
  regressions from either the new `recommendations` field or the 3 new modules.
- **Typecheck**: 158/158 baseline unchanged (re-confirmed after the shadowing-bug fix).
- **Live browser verification**: same signed-out sandbox limitation as OS-C1 — `/manager-hub`
  re-rendered correctly after this phase's changes (zero-leagues honest empty state, matching DOM
  snapshot to before the change), zero new console errors (only the same pre-existing
  Facebook-SDK-over-HTTP sandbox noise). The populated-Priorities-modules path was not verified live
  (no stored credentials in this sandbox) — covered by `manager-priority-module.test.tsx`'s and
  `manager-command-center-section.test.tsx`'s real-fixture render tests instead.
