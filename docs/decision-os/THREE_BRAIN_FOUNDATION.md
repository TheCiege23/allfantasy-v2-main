# Decision OS Three‑Brain Intelligence — Foundation Audit & Phased Plan

> Status: **Audit + design (Phase 0)**. No orchestration code yet. Branch `feat/decision-os-three-brain`
> from `origin/main` (3d99b234e). Does **not** touch PR #347 / PR #348, production, schema, prices, or the
> deterministic Decision OS. Verdict on whether the live system is a three‑brain system today: **NO** (see §1).

This document is the ground‑truth audit the batch required *before* architectural assumptions, plus the
phased implementation plan. It deliberately reuses existing repository infrastructure; it does **not**
introduce a competing response format, URL resolver, token path, or schema.

---

## 1. Verdict (honest) — is the live Decision OS a three‑brain system today?

**No.** Two independent facts, both verified in code:

1. **The four live Decision OS routes are deterministic‑only.** `user-os`, `manager-intelligence`,
   `mission-control`, `commissioner-command-center` each do: session gate → `authorizeLeagueRead(leagueId,
   userId)` → a degraded‑safe snapshot resolver (`resolveUserOsSnapshot` / `resolveManagerIntelligencePayload`
   / `resolveMissionControlSnapshot` / `resolveCommissionerCommandCenterSnapshot`) → `NextResponse.json`.
   **None invoke any AI provider.** (mission-control adds an optional, gated, *informational*
   `describeCommissionerSportsContext` that, by its own contract, "never alters commissioner recommendations
   or governance scoring" — it is not a model call.)

2. **The existing multi‑model orchestration selects one model; it does not synthesize.** In
   `lib/ai-orchestration/orchestration-service.ts` `runUnifiedOrchestration`, the prompt is built **once**
   (`buildMessages`, ~L754) and every provider gets the **identical** messages in **parallel**
   (`Promise.all(available.map(callProviderWithRetry))`, ~L756‑760). The outputs are then handed to
   `lib/unified-ai/UnifiedBrainComposer.ts` → `lib/unified-ai/ConsensusEvaluator.ts` `evaluateConsensus`,
   which **picks the first non‑empty answer in a preference order (OpenAI → Grok → DeepSeek)** and returns
   that model's raw text. **OpenAI never receives DeepSeek's or Grok's conclusions.** There is **no
   synthesizer LLM call.** (The Chimmy path, `lib/chimmy-orchestration/ResponseAggregator.ts`
   `firstUsableOutput`, is the same "pick, don't synthesize" pattern — its `reason` string says "synthesis"
   but the code is a pick.)

So the batch's premise is correct: the models are independent voters and OpenAI's original answer is usually
preferred; there is no stage where DeepSeek + Grok's verified conclusions feed a final OpenAI synthesis.

---

## 2. Live Decision OS route map

| Route | Resolver (deterministic) | Scope | Notes |
|---|---|---|---|
| `GET /api/decision-os/user-os` | `lib/decision-os/userOs.ts` `resolveUserOsSnapshot` | session user, one league | `authorizeLeagueRead` gate |
| `GET /api/decision-os/manager-intelligence` | `lib/decision-os/dashboard-intelligence.ts` `resolveManagerIntelligencePayload` | session user, one league | Manager DNA + recommendations |
| `GET /api/decision-os/mission-control` | `lib/decision-os/missionControl.ts` `resolveMissionControlSnapshot` | one league | + optional gated informational sports context |
| `GET /api/decision-os/commissioner-command-center` | `lib/decision-os/commissionerCommandCenter.ts` `resolveCommissionerCommandCenterSnapshot` | session commissioner, own leagues | resolves own commissioner leagues server‑side |

Adjacent (not named integration targets this program): `platform-os`, `manager-command-center`,
`league-analytics`, `league-context`. Every resolver is **degraded‑safe** (returns honest `available:false`
/ nulls, never a 500).

---

## 3. Existing infrastructure to REUSE (no new schema, no competing contracts)

### Providers & roles (real API calls)
- `lib/ai-orchestration/provider-registry.ts` — `getProvider(role)`, `getAvailableProviders()`,
  `getAvailableFromRequested(roles)`, `checkProviderHealth()`. Roles: `['openai','deepseek','grok']`.
- Real clients: `lib/ai-orchestration/providers/{openai,deepseek,grok}-provider.ts` →
  `lib/{openai-client,deepseek-client,xai-client}.ts` (OpenAI SDK / DeepSeek SDK / xAI fetch). Keys stay
  server‑side (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`); `isAvailable()` = env presence.
- **Roles already named** in `lib/unified-ai/ModelRoutingResolver.ts` `MODEL_RESPONSIBILITIES`: `openai` →
  synthesis, `deepseek` → analytical/numeric, `grok` → trend/narrative. (Currently metadata only — not wired
  into a chained pipeline.)

### Evidence / decision contracts (build the packet on these — do NOT invent a parallel type)
- `lib/decision-os/core/integrationContract.ts` — `DecisionOSInsight`, **`DecisionOSEvidenceRef`**
  (`sourceType`/`trust`/`observedAt` — the canonical "signal"), `DecisionOSAiBoundary`
  (`mayInventFacts:false`, `mustCiteEvidence:true`), guard `assertDecisionOSInsightGrounded`.
- `lib/ai-context-envelope/schema.ts` — Zod **`DeterministicContextEnvelope`**, `EvidenceItem`/`EvidenceBlock`,
  `Confidence` (`cappedByData`/`capReason`), `NormalizedToolOutput`. Already zod‑validated on input.
- Avoid `lib/decision-os-core/*` (Phase‑1 primitives, imported by nothing — enforced by a no‑live‑imports test).

### Persistence (reuse — no migration)
- **`AiResult`** (`ai_results`, `resultKey @unique`, `inputHash`, `feature`, `scopeType/scopeId`, `provider`,
  `model`, `status`, `resultJson`, `expiresAt`) via `lib/ai/ai-result-cache.ts` `getOrCreateAiResult` /
  `buildAiInputHash` (sha256) — the durable, content‑hashed AI‑result cache.
- `lib/ai/aiInsightCache.ts` — grounding‑hash variant (auto‑invalidates when live data changes).
- `DecisionLog` (+`DecisionOutcome`), `AiRecommendationLog`, `AIEvidenceItem` (per‑fact provenance +
  confidence + freshness + expiry + `stale`). **Do not** use `lib/saved-recommendations/*` (unmigrated stub).

### Gating & tokens (reuse the production idempotent charge‑then‑refund path)
- `lib/subscription/entitlement-middleware.ts` `requireFeatureEntitlement` → (token fallback)
  `lib/tokens/TokenSpendService.ts` `spendTokensForRule({confirmed})` (atomic `$transaction`, `idempotencyKey`
  short‑circuit) + `refundSpendByLedger` on failure. Pricing: `pricing-matrix.ts` / `subscription-policy.ts`.
  There is **no reserve/hold** primitive — the model is idempotent charge, conditional refund.

### Resilience (reuse)
- Circuit breaker + single‑flight: `lib/sports-router.ts` (`isCircuitOpen`/`recordCircuitSuccess`/`Failure`,
  `inflightRequests`). Retry+fallback: `lib/failover/run-with-failover.ts`. AI reliability:
  `lib/ai-reliability/*` (`ProviderFailureResolver`, `DeterministicFallbackService`,
  `ConsensusDisagreementResolver`, `AIConfidenceResolver`, `AIFactGuard`). Coalescing:
  `lib/ai-cost-control/AICostControlService.ts` `IN_FLIGHT`. Rate limit: `lib/rate-limit.ts`
  `consumeRateLimit`. Per‑provider timeout/retry already in `orchestration-service.ts`
  (`runProviderCallWithTimeout`, `callProviderWithRetry`).

### Observability (reuse — PII‑safe)
- `lib/telemetry/llm-usage.ts` `recordLlmUsage` (per‑LLM‑call metering), `lib/telemetry/usage.ts`
  `logUsageEvent`/`withApiUsage`, `lib/chimmy-chat/analytics-events.ts` `persistChimmyAIAnalyticsEvent`
  (+`sanitizeChimmyAnalyticsMetadata` strips prompts/PII). Sinks: `AnalyticsEvent`, `ApiUsageEvent/Rollup`,
  `AiOutput`.

### Gap to close (not present today)
- **No server‑side zod validation of provider OUTPUT** (`NormalizedToolOutputSchema` exists but is unused in
  the orchestration path). The three‑brain synthesizer must validate every model output before use.

---

## 4. Target three‑brain architecture (new synthesizer stage, reusing the above)

```
Canonical DB/cache
  → deterministic Decision OS snapshot (unchanged, authoritative)
  → DecisionOSEvidencePacket  (built from DecisionOSEvidenceRef + DeterministicContextEnvelope; each fact/signal has a stable id)
  → eligibility policy (deterministic; see §6)         ── not eligible ─→ deterministic result only
        │ eligible + authorized + not already cached
        ▼
   DeepSeek (analyst)  ─┐   (parallel; each gets ONLY the evidence packet, role prompt)
   Grok (trend)  ───────┤
                        ▼
   OpenAI (synthesizer): evidence packet + DeepSeek eval + Grok eval  → reconciled recommendation
  → zod‑validate every model output (reject claims citing unknown evidence ids)
  → deterministic confidence + disagreement guard (server owns the displayed confidence)
  → persist (AiResult, content‑hash of evidence fingerprint) BEFORE authoritative use
  → attach to Decision OS route as { deterministic, intelligence?{status,result?,lastVerifiedAt?} }
  → Chimmy consumes the saved result via the PR#348 certified structured contract
```

Page loads remain DB‑first: a route returns the deterministic result immediately, plus any **saved**
three‑brain result. It never blocks on three model calls, and never triggers them on ordinary navigation.

Provider calling convention to reuse: `getProvider('deepseek'|'grok'|'openai').chat(...)` (real client;
`isAvailable()` gates on keys). The new flow is **distinct** from `runUnifiedOrchestration` (which sends one
shared prompt to all): specialists get role prompts over the evidence packet, and the synthesizer receives
the specialists' completed structured outputs.

---

## 5. Contracts (reuse existing types; names below are conceptual until P1 lands)

- `DecisionOSEvidencePacket` — assembled server‑side from the deterministic snapshot: `schemaVersion`,
  `requestId`, `userId`, `canonicalLeagueId`, `platform`, `sport`, `season`, `teamOrRosterId`, `userRole`,
  `mode`, `decisionType`, `signals: DecisionOSEvidenceRef[]` (each with a stable `id`), `facts` (verified,
  with provenance + freshness), `missingInformation`, `providerStatus`, **`evidenceFingerprint`** (sha256 via
  `buildAiInputHash`), `generatedAt`. Only decision‑necessary evidence — never whole DB rows or unnecessary
  private data.
- `SpecialistEvaluation` (`provider: 'deepseek'|'grok'`, `status`, `findings[]{claim, evidenceIds[], impact}`,
  `recommendation?`, `caveats[]`) — zod‑validated; claims citing unknown `evidenceIds` are dropped.
- `ThreeBrainDecisionResult` (`schemaVersion`, `shortAnswer`, `whatDataSays`, `whatItMeans`,
  `recommendedAction?`, `alternatives[]`, `caveats[]`, `evidenceIds[]`, `agreementState:
  consensus|partial_consensus|disagreement|degraded|deterministic_only`, `specialistStatus{deepseek,grok,
  openai}`, `confidencePct?`, `freshness`, `missingInformation[]`) — **server‑owned** confidence, freshness,
  ids; no model‑authored URLs; no chain‑of‑thought stored or returned.

**Authoritative boundary:** models may only interpret the supplied evidence. Identity, league access,
entitlement, token status, provider/ingestion timestamps, sports status/clock/injury, source URLs, confidence
score, and the evidence fingerprint are all set by deterministic server code — never by a model.

---

## 6. Eligibility policy (deterministic — three‑brain is selective, not default)

Run three‑brain analysis only when ALL hold: request is **authorized** (league access verified), canonical
evidence is **present and fresh enough** for the decision, no valid **cached** result already covers the
evidence fingerprint, and the case is **high‑value** — one of: explicit deep‑analysis request; paid/token‑
authorized premium recommendation; high‑importance lineup; complex trade; material waiver; commissioner
health/intervention; **conflicting deterministic signals**; or a low‑confidence deterministic decision.
Never run for: ordinary navigation/hydration; basic schedule/score/result facts; free basic summaries; static
history; logos/headshots; unauthorized/missing‑evidence/too‑stale requests; or a repeat request with a valid
saved result. Existing tier/entitlement/token rules are preserved; no new pricing.

---

## 7. Phased implementation plan (each phase = its own focused, validated batch)

- **P1 — Three‑brain orchestration + validated synthesis (standalone service).** Evidence‑packet assembler
  (over `DecisionOSEvidenceRef`/`DeterministicContextEnvelope`), eligibility policy, DeepSeek∥Grok specialist
  evaluations → OpenAI synthesis **receiving both completed evaluations**, zod output validation
  (unknown‑evidence‑id rejection, prompt‑injection‑safe: imported names/text are data), deterministic
  confidence + disagreement guard, degraded / deterministic‑only fallback. Provider‑boundary‑mocked tests
  (no real paid calls). **Not wired into live routes.**
- **P2 — Persistence, caching, coalescing, gating.** `getOrCreateAiResult` keyed on the evidence fingerprint
  (+ user/league/team/decisionType/entitlement/contract version); single‑flight coalescing; refresh‑while‑
  serving; idempotent `requireFeatureEntitlement` → `spendTokensForRule`/`refundSpendByLedger` (no charge on
  cache hit / failure / validation failure / missing evidence).
- **P3 — Decision OS route integration.** One shared Decision OS intelligence service attaches
  `{ deterministic, intelligence?{status,result?,lastVerifiedAt?} }` to the four routes; deterministic
  contract unchanged; DB‑first; no auto three‑provider calls; commissioner dual‑role preserved (personal
  manager intelligence AND oversight, clearly distinguished).
- **P4 — Chimmy consumption + end‑to‑end certification.** Chimmy reads the saved result via the PR#348
  certified structured contract without re‑running models; agreement/caveat states preserved; safe‑link
  protections intact; full test matrix + build; the program's draft PR is completed.

**Honesty rule (from the batch):** the live Decision OS is not a three‑brain system until P3 lands and the
routes actually consume it. P1 alone is orchestration plumbing, not a live capability.

---

## 8. What this Phase‑0 change contains
Only this document. No code, no schema, no route changes — so there is zero risk to the deterministic
Decision OS, Chimmy, or any existing suite. P1 begins the implementation on this branch.

---

## 9. Phase 1.5 — Claude (Anthropic) as a SELECTIVE reviewer + synthesis fallback (landed on this branch)

Extends the standalone P1 service to a **four‑provider** flow. Still standalone — **no route/persistence/token/
Chimmy/UI wiring** (those remain P2–P4). Claude does **not** run on every request.

**Flow:** `DeepSeek(quant) ∥ Grok(trend) → OpenAI synthesis → Claude review (only when eligible)`. If OpenAI
fails: `evidence + validated specialist evals → Claude fallback synthesis`. Claude runs **at most once** per
request.

**Eligibility (deterministic, `eligibility.ts`).** REVIEW (OpenAI succeeded) fires only if ≥1 holds: specialists
materially disagree · server confidence ≤ threshold (`DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD = 45`, the
disagreement base) · caller policy `explicitReviewRequested` · caller policy `highStakesPremium`. With **no
caller policy** (ordinary standalone execution) a confident consensus is **not** reviewed — nothing is treated
as premium by default. FALLBACK (OpenAI failed) fires only when usable specialist/evidence material remains.
The module invents **no** entitlements, tokens, prices, or tiers — it implements the policy contract only.

**Review role (`claudeReview.ts`).** Claude receives the minimized evidence packet, both validated specialist
evals, the validated OpenAI synthesis, and the server‑owned agreement/confidence/freshness as **read‑only**
context. It reviews for: unsupported claims, hidden/flattened disagreement, misread evidence, dropped
minority/safety warnings, overconfidence, missing caveats, internal contradiction. It may **not** browse,
fetch, invent facts/URLs, change identity, decide access, assign confidence, or override freshness — enforced
in both prompt and validation.

**`ClaudeReviewEvaluation` contract (`types.ts` / `schemas.ts`).** `{ provider:'anthropic',
status:'completed'|'degraded'|'failed'|'not_requested', verdict:'approved'|'qualified'|'rejected'|'unavailable',
findings[], requiredCaveats[], correctedContent? }`. Evidence ids validated; a review finding critiquing an
**unsupported** synthesis claim may cite **no** id (it points at an absence), but a finding that cites ids of
which none are known is dropped; URLs stripped; zod strips any attempt to set authoritative fields.

**Final‑result behavior (`orchestrator.ts`).** approve → preserve OpenAI synthesis; qualify → apply only the
grounded corrections + keep required caveats (confidence −8); reject → **no false consensus** (state →
`disagreement`, concerns disclosed, confidence capped ≤40); Claude fails after a valid OpenAI → preserve OpenAI
+ disclose review unavailable; OpenAI fails → Claude fallback synthesis (`claudeState:'fallback_synthesis'`);
both fail → degraded. **Claude never raises confidence** merely because it ran; it may only lower it. The
result distinguishes `not_requested` / `completed` / `failed` / `fallback_synthesis`, so a run is never
described as four‑provider when Claude didn't run.

**Disagreement coverage (`confidence.ts`).** Deterministic detection now spans lineup start/sit, trade
accept/decline, waiver add/drop, buy/sell + hold/trade, commissioner intervene/do‑not‑intervene,
insufficient‑evidence‑vs‑directive, and one‑warns‑risk‑while‑the‑other‑recommends‑action. Material minority
warnings (high‑impact risk findings + risk‑worded caveats) are **unioned into the final caveats** so a
downstream model can never silently drop a safety warning.

**Timeout / cost safety.** The Anthropic adapter (`anthropicClient.ts`, wrapping `@anthropic-ai/sdk`) honors an
**AbortSignal**, so a per‑provider timeout **cancels** the request; a late completion is swallowed and never
mutates the returned result; a timeout never triggers a duplicate fallback. Registry providers
(OpenAI/DeepSeek/Grok) are called via `getProvider(role).chat()` and do **not** accept a signal — for them a
timeout is stop‑awaiting only (late result discarded), an honest limitation. Non‑sensitive telemetry
(`three_brain_anthropic`) is recorded; tests make **no** real paid calls (provider boundary mocked).

**Tests:** `__tests__/decision-os/three-brain-claude.test.ts` (34 proofs) + the unchanged P1 suite (19) all
green (53/53). Retry/circuit‑breaker are intentionally **not** inherited (this service calls the raw provider
boundary, not `runUnifiedOrchestration`) — to be added in a later phase if needed.
