# Commissioner Intelligence Service (Shadow Mode) — Phase 10

Commissioner OS consolidation foundation, Fantasy OS Migration Plan. Mirrors the shadow-mode discipline of [`trade`](../trade/README.md), [`waiver`](../waiver/README.md), [`draft`](../draft/README.md), and [`game-day`](../game-day/README.md) — but, like Game Day OS, this module **reuses real, already-live engines directly** rather than reinventing them. The audit found this is the most already-built surface of any phase so far: Mission Control, League Analytics, Daily Brief, Attention Signals, and Power Rankings are ALL real, live, already-federated systems.

## What was audited first (3 parallel research passes)

### Commissioner Hub / Decision OS commissioner modules — extensive prior work found
- `lib/decision-os/missionControl.ts`'s `resolveMissionControlSnapshot()` — already federates League Health + trend + manager counts + activity + retention risk + recommended actions. Real, live, called from `CommissionerHubPageClient.tsx`.
- `lib/decision-os/leagueAnalytics.ts`'s `resolveLeagueAnalyticsSnapshot()` — a real sibling composition (its own header explicitly says "sibling, not wrapper" to avoid double-fetching).
- `lib/decision-os/attentionSignals.ts`'s `deriveLeagueAttentionSignals()` — real, computed, but per its own module structure has **no live route caller today** ("built for a future background job/email/mobile consumer"). This service gives it a real consumer.
- `lib/decision-os/dailyBrief.ts`'s `composeDailyBrief()` — real, live, **cross-league** brief already embedded in `CommissionerCommandCenterSection.tsx`. This phase's own `CommissionerBrief` is a deliberately **different, single-league, structured weekly brief** — not a duplicate.
- `lib/decision-os/commissioner-health/` — a real `Decision<T>` shadow slice, already further along than trade/waiver's (has live parity-gated wiring in `CommissionerHubPageClient.tsx`).
- `lib/decision-os/leagueHealthAlignment.ts`'s `resolveDecisionOsLeagueHealth()` — federates real DB-derived Decision OS inputs into the SAME, untouched `monitorLeagueHealth()` scoring engine (`lib/league-health/league-health-engine.ts`) the legacy `/api/league-health` route also uses (with caller-supplied metrics instead). One scoring formula, two different real input-gathering paths.

### Power Rankings — one real general engine, several confirmed stubs
`lib/league-power-rankings/PowerRankingEngine.ts`'s `computePowerRankings()` is real, deterministic, format-agnostic (weighted record/recent-performance/roster-strength/projection-strength, with rank movement already built in). **Confirmed stubs, never wired to real data**: `lib/bestball/ai/powerRankings.ts` (empty tiers, "preview only"), `lib/keeper/ai/powerRankingsKeeper.ts` (always `[]`), `lib/redraft/ai/powerRankings.ts` ("pending wiring"). This service returns `specialty_adapter_required` for those formats rather than presenting stub output as real.

### Narrative/rivalry/storyline/integrity systems — mostly real, one important caution
`lib/rivalry-engine/RivalryEngine.ts` (real, computed H2H scoring) and `lib/league-story-engine/StoryEngine.ts`/`lib/league-story-creator/` (real deterministic + fact-guarded AI storylines) are genuinely real and already reusable — **not rebuilt here**, deliberately out of scope for this foundation phase (see "What remains"). `lib/integrity/TankingDetectionEngine.ts`/`CollusionDetectionEngine.ts` are real detection infrastructure, but final "suspicious" verdicts are **AI-adjudicated**, not purely deterministic — this service does **not** wire integrity signals in, since blending an AI verdict into a "deterministic facts, narrative separate" architecture would violate this phase's own "never let an LLM calculate results" principle. `lib/ai-explanation-layer` is the established narrative-adapter boundary pattern (already reused by Draft OS in Phase 8) — this service reuses it directly rather than adding a 5th bespoke adapter.

### Authorization — one real, established framework; one documented, unsolved gap
`lib/league/permissions.ts`'s `getLeagueRole()`/`requireCommissionerRole()`/`requireCommissionerOnly()` is THE real, shared authorization helper — this module never creates a second one. Co-commissioners are a real, first-class AF-only concept (`LeagueTeam.isCoCommissioner`). The admin/site-operator gate (`lib/adminAuth.ts`) is confirmed genuinely separate from per-league commissioner access. **Real, documented gap**: for imported leagues, `League.userId` is set to whoever performed the import — the import commissioner-gate (`lib/league-import/commissionerGate.ts`) only checks source-platform league *membership*, never actual commissioner/owner status. Self-attestation is recorded but not enforced. `CommissionerAuthorization.ts`'s `commissionerIdentityVerified` flag surfaces this honestly (`true` only for native leagues) rather than pretending it's solved.

## Modules

- **`CommissionerAuthorization.ts`** — thin wrapper around `getLeagueRole` (no second framework).
- **`CommissionerContextAssembler.ts`** — composes Mission Control + League Analytics + role + honest format awareness + optional Game Day/Knowledge Graph enrichment.
- **`LeaguePulseService.ts`** — explainable, multi-dimension pulse from real engine sub-scores (never one unexplained number).
- **`LeagueHealthService.ts`** — thin categorization wrapper over `resolveDecisionOsLeagueHealth`'s real score.
- **`CommissionerAttentionService.ts`** — reuses `deriveLeagueAttentionSignals` (giving it its first real consumer) + carries over Phase 9 Game Day Lineup Attention items.
- **`CommissionerRankingService.ts`** — wraps `computePowerRankings`; honest `specialty_adapter_required` for confirmed stubs.
- **`CommissionerBriefService.ts`** — genuinely new single-league structured brief (facts/ranking selection only).
- **`CommissionerNarrativeAdapter.ts`** — the only AI-touching module; reuses `lib/ai-explanation-layer`; never invents facts; AI failure always falls back to deterministic text.
- **`CommissionerDivergenceAnalyzer.ts`** — see "Divergence" below.
- **`CommissionerShadowService.ts`** / **`CommissionerShadowResultStore.ts`** — orchestration + in-memory store.

## Divergence

Per the brief: *"Do not force a shadow comparison where no comparable existing engine exists."* The genuinely meaningful comparison found: `lib/decision-os/attentionQueue.ts`'s `resolveAttentionQueueSnapshot()` is a real, separately-composed resolver that wires REAL `draftDateUtc`/`financialStatus` inputs into the same `deriveLeagueAttentionSignals()` this service calls — but `CommissionerAttentionService.ts` currently passes documented placeholders (`financialStatus:'UNKNOWN'`, `draftDateUtc:null`). Diverging against it is not synthetic — it directly measures this foundation phase's own real, documented gap (most visibly via `draft_approaching` signals that can only ever fire in the real resolver). `league_health_status_mismatch`/`stale_data_handling_mismatch` are declared for future use but not produced by this pass.

## Known limitations / what remains

- **Rivalries, storylines, trade fallout, waiver recap are NOT rebuilt here** — `RivalryEngine`/`StoryEngine`/`LeagueStoryCreatorService`/`DramaEventDetector`'s `TRADE_FALLOUT` type are already real and reusable; wiring them into `CommissionerBriefService`'s sections is a documented next step, not attempted this phase (avoiding scope creep on top of an already enormous audit).
- Integrity signals (tanking/collusion) are deliberately NOT surfaced through this service — see "Narrative/rivalry" above.
- `financialStatus`/`draftDateUtc` are placeholders in `CommissionerAttentionService.ts` — wiring real values (via `resolveLeagueFinancialContextSafely`/`LeagueSettings.draftDateUtc`) is the most direct way to close the one real divergence this phase found.
- Trade/Waiver/Draft OS (Phases 5–8) shadow outputs are not yet cross-referenced into `CommissionerContext` — only Game Day OS (Phase 9) is, via the optional `viewerUserId` enrichment path.

## Persistence status

`CommissionerShadowResultStore` is in-memory only, same disclosed non-durable pattern as every prior phase. A schema proposal is documented separately (see `docs/os/COMMISSIONER_SHADOW_SNAPSHOT_SCHEMA_PROPOSAL.md`) rather than an unapproved migration.

## What is NOT done in this phase

No consumer (Commissioner Hub, dashboard commissioner mode, Decision OS commissioner routes, League Health route, Mission Control, League Analytics, Weekly Brief UI, Power Rankings UI, notifications, Chimmy, Discord, provider chats, email, mobile views) is migrated or altered. No existing service is retired. No live commissioner permissions changed. No content is published automatically.
