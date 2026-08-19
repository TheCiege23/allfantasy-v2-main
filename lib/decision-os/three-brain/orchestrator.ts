/**
 * Decision OS three-brain / four-provider orchestrator (STANDALONE — no route/persistence/token integration).
 *
 * Flow: DeepSeek ∥ Grok (parallel, each only the evidence packet + its role prompt) → validate each →
 * OpenAI synthesis called ONLY after both specialists settle, receiving BOTH validated evaluations →
 * validate → deterministic agreement + confidence stamped by the server → Claude (Anthropic) runs SELECTIVELY:
 *   • OpenAI succeeded + Claude eligible → Claude REVIEWS the synthesis (approve / qualify / reject).
 *   • OpenAI failed → Claude may produce a FALLBACK synthesis from the same verified evidence.
 * Claude runs AT MOST ONCE per request and never on every request. It can lower confidence, never raise it.
 * Both specialist failures → deterministic_only (no synthesis, no false consensus).
 *
 * The provider boundary (`getProvider`) and telemetry are injectable so tests exercise this real service with
 * mocked providers (no real paid calls). Per-provider timeouts use an AbortController: where the underlying
 * client supports cancellation (Anthropic), a timeout CANCELS the request; a late completion is discarded and
 * never mutates the returned result.
 */
import { getProvider as realGetProvider } from '@/lib/ai-orchestration/provider-registry'
import type { AIModelRole } from '@/lib/unified-ai/types'
import type { ProviderChatRequest, ProviderChatResult } from '@/lib/ai-orchestration/types'
import { recordLlmUsage } from '@/lib/telemetry/llm-usage'
import { buildDeepSeekRequest, buildGrokRequest, buildSynthesisRequest } from './prompts'
import { validateSpecialistOutput, validateSynthesisOutput, type SynthesisDraftValidated } from './validate'
import {
  adjustConfidenceForReview,
  collectMinorityWarnings,
  computeAgreementState,
  computeConfidence,
  mergeCaveats,
} from './confidence'
import {
  evaluateClaudeReviewEligibility,
  shouldRunClaudeFallback,
  type ClaudeReviewPolicy,
} from './eligibility'
import { buildClaudeReviewRequest, validateClaudeReview } from './claudeReview'
import { createAnthropicThreeBrainClient } from './anthropicClient'
import { evidenceIdSet } from './evidencePacket'
import type {
  ThreeBrainChatOptions,
  ThreeBrainProviderClient,
  ThreeBrainProviderGetter,
  ThreeBrainRole,
} from './providerClient'
import {
  THREE_BRAIN_SCHEMA_VERSION,
  type AgreementState,
  type ClaudeReviewEvaluation,
  type ClaudeState,
  type ClaudeReviewVerdict,
  type DecisionOSEvidencePacket,
  type SpecialistEvaluation,
  type ThreeBrainDecisionResult,
} from './types'

// Re-exported for backward compatibility (Phase 1 callers/tests import these from the orchestrator module).
// ClaudeReviewPolicy is intentionally NOT re-exported here — the barrel surfaces it from ./eligibility (its
// single source) to avoid an ambiguous `export *` collision.
export type { ThreeBrainChatOptions, ThreeBrainProviderClient, ThreeBrainProviderGetter, ThreeBrainRole }
export type RecordUsageFn = typeof recordLlmUsage

export type RunThreeBrainOptions = {
  /** defaults to the production provider registry (+ the Anthropic adapter for the 'anthropic' role). */
  getProvider?: ThreeBrainProviderGetter
  perProviderTimeoutMs?: number
  /** defaults to the production PII-safe telemetry sink. Injectable so tests avoid the DB. */
  recordUsage?: RecordUsageFn
  /** Selective-Claude policy. Absent in ordinary standalone execution (Claude is NOT premium by default). */
  reviewPolicy?: ClaudeReviewPolicy
  /** EXTERNAL cancellation — the Phase 2 durable-refresh lease-loss / hard-deadline signal. When it aborts, every
   *  in-flight provider network request is cancelled and no further provider call (synthesis, fallback, review)
   *  is started. Absent for ordinary standalone execution. */
  signal?: AbortSignal
  /** Grace to await a cancelled request settling before returning (no detached work). Test override. */
  cancelGraceMs?: number
  /** Invoked ONCE per provider request ISSUED during the attempt, at its settlement — for EVERY request, whether
   *  it settled before, during, or after an external abort (so a stage that completed early is never forgotten).
   *  The Phase 2 owner accumulates the full history and folds it via `aggregateExecutionSettlement` to decide
   *  whether an aborted attempt was wholly CONFIRMED cancelled (safe to re-execute) or UNKNOWN (block re-exec). */
  onProviderRequest?: (outcome: ProviderRequestOutcome) => void
}

/** True once external cancellation has fired — used to stop starting further provider calls after an abort. */
function isAborted(opts: RunThreeBrainOptions): boolean {
  return opts.signal?.aborted === true
}

/** Settlement classification of ONE issued provider request (reported for EVERY request in the attempt, whether it
 *  settled before, during, or after an external abort):
 *   • completed     — the request's promise RESOLVED: the remote produced a response (a billable stage finished).
 *   • cancelled     — REJECTED with a RECOGNIZED cancellation (AbortError/APIUserAbortError): terminated before
 *                     producing a usable response.
 *   • indeterminate — did NOT settle within the grace, OR rejected with an AMBIGUOUS/timeout error: the remote may
 *                     have completed or may still be running — its outcome is UNKNOWN. */
export type ProviderCallSettlement = 'cancelled' | 'completed' | 'indeterminate'

/** One row of the orchestration's complete execution history — retained for EVERY issued provider request so a
 *  stage that completed BEFORE an external abort is never forgotten by the whole-run settlement decision. */
export type ProviderRequestOutcome = {
  role: ThreeBrainRole
  classification: ProviderCallSettlement
  /** The remote produced a response (the promise resolved) — a completed, potentially-billable stage. */
  usableResponse: boolean
  /** The response was actually used by later orchestration work (resolved AND not discarded by our timeout). */
  incorporated: boolean
  startedAtMs: number
  settledAtMs: number
}

/** Aggregate settlement of an ENTIRE aborted orchestration attempt — what the Phase 2 owner needs to decide fate.
 *   • confirmed_cancelled — NO request produced a usable response AND none is indeterminate (every issued request
 *                           confirmed cancellation, or none was issued): the ONLY automatically-retryable outcome.
 *   • confirmed_completed — at least one request produced a usable response: a billable stage finished, so the
 *                           whole run cannot be re-run without duplicating it → UNKNOWN (completed-but-unsettled).
 *   • unknown             — no usable response, but at least one request is indeterminate: cannot prove safety. */
export type OwnerExecutionSettlement = 'confirmed_cancelled' | 'confirmed_completed' | 'unknown'

/**
 * True ONLY for a RECOGNIZED cancellation/abort rejection — never for a timeout or an ambiguous transport error.
 * A dropped connection, `socket hang up`, `ECONNRESET`, or a bare timeout does NOT prove the remote provider
 * stopped, so those are deliberately NOT treated as confirmed cancellations (→ classified `indeterminate`).
 */
export function isCancellationError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = String((e as { name?: unknown }).name ?? '')
  return name === 'AbortError' || name === 'APIUserAbortError'
}

/**
 * Fold the COMPLETE execution history into the owner-level decision (conservative whole-run contract). A completed
 * stage (usable response) anywhere in the attempt — even one that settled BEFORE the external abort while another
 * request was later cancelled — forbids a wholesale CONFIRMED_CANCELLED, because a full re-run would duplicate it.
 * Precedence: any usable response → `confirmed_completed`; else any indeterminate → `unknown`; else (empty, or
 * every issued request confirmed-cancelled with no usable response) → `confirmed_cancelled`.
 */
export function aggregateExecutionSettlement(history: ProviderRequestOutcome[]): OwnerExecutionSettlement {
  if (history.some((r) => r.usableResponse)) return 'confirmed_completed'
  if (history.some((r) => r.classification === 'indeterminate')) return 'unknown'
  return 'confirmed_cancelled'
}

const DEFAULT_TIMEOUT_MS = 25_000
/** After aborting a request we AWAIT it settling up to this grace, so nothing continues detached. Cancellable
 *  providers settle well within it; overridable for deterministic tests. */
const DEFAULT_CANCEL_GRACE_MS = 2_000

const asProvider = (role: ThreeBrainRole): ProviderChatResult['provider'] =>
  role as unknown as ProviderChatResult['provider']

function timeoutResult(role: ThreeBrainRole): ProviderChatResult {
  return { text: '', model: 'unknown', provider: asProvider(role), status: 'timeout', timedOut: true }
}
function failedResult(role: ThreeBrainRole, error: string): ProviderChatResult {
  return { text: '', model: 'unknown', provider: asProvider(role), status: 'failed', error: error.slice(0, 200) }
}

// One memoized Anthropic adapter for the default getter (the specialists/synthesizer come from the registry).
let _anthropicClient: ThreeBrainProviderClient | null = null
function defaultAnthropicClient(): ThreeBrainProviderClient {
  if (!_anthropicClient) _anthropicClient = createAnthropicThreeBrainClient()
  return _anthropicClient
}
const defaultGetProvider: ThreeBrainProviderGetter = (role) =>
  role === 'anthropic'
    ? defaultAnthropicClient()
    : (realGetProvider(role as AIModelRole) as ThreeBrainProviderClient)

/**
 * Race the provider call against a hard per-provider timeout AND an external cancellation signal. Never rejects.
 * On timeout OR external abort it aborts the shared controller the provider client receives.
 *
 * Which providers TERMINATE the network request on abort: the Anthropic adapter (`anthropicClient.ts`) forwards
 * `{ signal }` into the actual SDK/HTTP request of EVERY provider — Anthropic (`@anthropic-ai/sdk`), OpenAI +
 * DeepSeek (OpenAI SDK `create(body, { signal })`), and Grok (xAI `fetch(url, { signal })`) — so a lease-loss /
 * hard-deadline / per-provider-timeout abort GENUINELY terminates the in-flight network request.
 *
 * NO DETACHED WORK: on timeout or external abort the controller is aborted and we then AWAIT the (now-cancelled)
 * request to SETTLE before returning, bounded by a short grace so a pathological non-cancelling client cannot
 * hang the runner. For a cancellable provider the abort settles the request promptly.
 *
 * EXECUTION HISTORY: `onProviderRequest` is invoked once at THIS request's settlement — for EVERY issued request,
 * regardless of when it settles relative to an external abort — with its cause-aware disposition:
 *   • `completed`     — the promise RESOLVED (a usable remote response was produced), whether or not an abort later
 *                       fired. `incorporated` is false if our per-provider timeout had already discarded it.
 *   • `cancelled`     — REJECTED with a recognized cancellation and NOT via our own per-provider timeout: proven
 *                       terminated before producing a response.
 *   • `indeterminate` — did not settle within the grace, was aborted by OUR per-provider timeout (the remote may
 *                       have completed), or rejected ambiguously. A bounded wait returning is NOT proof of anything.
 * The owner keeps the full history so a stage that COMPLETED before the abort is never forgotten.
 */
async function callWithTimeout(
  client: ThreeBrainProviderClient,
  request: ProviderChatRequest,
  timeoutMs: number,
  role: ThreeBrainRole,
  externalSignal?: AbortSignal,
  cancelGraceMs: number = DEFAULT_CANCEL_GRACE_MS,
  onProviderRequest?: (outcome: ProviderRequestOutcome) => void,
): Promise<ProviderChatResult> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const startedAtMs = Date.now()
  let reported = false
  // Record THIS request's disposition in the orchestration history (once), for every issued request.
  const record = (classification: ProviderCallSettlement, usableResponse: boolean, incorporated: boolean) => {
    if (reported) return
    reported = true
    onProviderRequest?.({ role, classification, usableResponse, incorporated, startedAtMs, settledAtMs: Date.now() })
  }
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve() }, timeoutMs)
  })
  try {
    // client.chat is inside the try so a bad/misconfigured provider client → failedResult (never uncaught).
    const chatPromise = client.chat({ ...request, timeoutMs }, { signal: controller.signal })
    const settled = chatPromise.then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }))
    // Wait for the request to settle OR the timeout to fire (which aborts it).
    await Promise.race([settled, timeout])
    if (externalSignal?.aborted && !timedOut) controller.abort()
    // AWAIT the (cancelled) request settling so nothing continues detached; bounded grace as a safety net.
    const outcome = await Promise.race([
      settled,
      new Promise<{ grace: true }>((res) => setTimeout(() => res({ grace: true }), cancelGraceMs)),
    ])
    if ('grace' in outcome) {
      // Did NOT settle within the grace → remote outcome UNKNOWN (a bounded wait returning proves nothing).
      record('indeterminate', false, false)
      return timeoutResult(role)
    }
    if (outcome.ok) {
      // RESOLVED → the remote produced a response; usable even if our per-provider timeout already discarded it.
      record('completed', true, !timedOut)
      return timedOut ? timeoutResult(role) : outcome.r
    }
    // Rejected. A rejection AFTER our own per-provider timeout aborted it does NOT prove the remote stopped → UNKNOWN.
    // Only a recognized cancellation that was NOT our timeout is a proven cancellation.
    record(!timedOut && isCancellationError(outcome.e) ? 'cancelled' : 'indeterminate', false, false)
    return failedResult(role, outcome.e instanceof Error ? outcome.e.message : 'provider error')
  } catch (err) {
    // Synchronous client fault BEFORE a network request was issued → nothing to record (no history entry).
    return failedResult(role, err instanceof Error ? err.message : 'provider error')
  } finally {
    if (timer) clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

function collectEvidenceIds(...evals: SpecialistEvaluation[]): string[] {
  const ids = new Set<string>()
  for (const e of evals) for (const f of e.findings) for (const id of f.evidenceIds) ids.add(id)
  return [...ids]
}

function summarizeFindings(...evals: SpecialistEvaluation[]): string {
  const claims = evals.flatMap((e) => e.findings.map((f) => f.claim)).slice(0, 6)
  return claims.length ? claims.join(' ') : 'No grounded specialist findings were available.'
}

type SpecialistStatusRecord = { deepseek: string; grok: string; openai: string; anthropic: string }

function deterministicOnlyResult(
  packet: DecisionOSEvidencePacket,
  deepseek: SpecialistEvaluation,
  grok: SpecialistEvaluation,
): ThreeBrainDecisionResult {
  return {
    schemaVersion: THREE_BRAIN_SCHEMA_VERSION,
    decisionType: packet.decisionType,
    shortAnswer: 'AI analysis unavailable — relying on the deterministic Decision OS evidence only.',
    whatDataSays: '',
    whatItMeans: '',
    recommendedAction: undefined,
    alternatives: [],
    caveats: ['Both specialist models were unavailable; no three-brain synthesis was performed.'],
    evidenceIds: [],
    agreementState: 'deterministic_only',
    specialistStatus: { deepseek: deepseek.status, grok: grok.status, openai: 'skipped', anthropic: 'not_requested' },
    claudeState: 'not_requested',
    reviewVerdict: undefined,
    confidencePct: undefined,
    freshness: packet.freshness,
    missingInformation: packet.missingInformation,
  }
}

/** OpenAI (and any Claude fallback) failed → honest degraded result. Specialist findings + minority warnings
 *  surface; no fabricated synthesis. */
function degradedResult(a: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
  note: string
  confidencePct?: number
  anthropicStatus: string
  claudeState: ClaudeState
}): ThreeBrainDecisionResult {
  const minority = collectMinorityWarnings(a.deepseek, a.grok)
  return {
    schemaVersion: THREE_BRAIN_SCHEMA_VERSION,
    decisionType: a.packet.decisionType,
    shortAnswer: 'Synthesis unavailable — showing verified evidence and specialist findings only.',
    whatDataSays: summarizeFindings(a.deepseek, a.grok),
    whatItMeans: '',
    recommendedAction: undefined,
    alternatives: [],
    caveats: mergeCaveats([a.note, ...a.deepseek.caveats, ...a.grok.caveats].filter(Boolean), minority),
    evidenceIds: collectEvidenceIds(a.deepseek, a.grok),
    agreementState: 'degraded',
    specialistStatus: { deepseek: a.deepseek.status, grok: a.grok.status, openai: 'failed', anthropic: a.anthropicStatus },
    claudeState: a.claudeState,
    reviewVerdict: undefined,
    confidencePct: a.confidencePct,
    freshness: a.packet.freshness,
    missingInformation: a.packet.missingInformation,
  }
}

/** Build a synthesis-backed result, stamping server-owned fields and preserving minority warnings. */
function buildSynthesisResult(a: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
  synthDraft: SynthesisDraftValidated
  agreementState: AgreementState
  confidencePct?: number
  specialistStatus: SpecialistStatusRecord
  claudeState: ClaudeState
  reviewVerdict?: ClaudeReviewVerdict
  extraCaveats?: string[]
  overrideShortAnswer?: string
}): ThreeBrainDecisionResult {
  const minority = collectMinorityWarnings(a.deepseek, a.grok)
  const caveats = mergeCaveats([...a.synthDraft.caveats, ...(a.extraCaveats ?? [])], minority)
  return {
    schemaVersion: THREE_BRAIN_SCHEMA_VERSION,
    decisionType: a.packet.decisionType,
    shortAnswer: a.overrideShortAnswer ?? a.synthDraft.shortAnswer,
    whatDataSays: a.synthDraft.whatDataSays,
    whatItMeans: a.synthDraft.whatItMeans,
    recommendedAction: a.synthDraft.recommendedAction,
    alternatives: a.synthDraft.alternatives,
    caveats,
    evidenceIds: a.synthDraft.evidenceIds.length ? a.synthDraft.evidenceIds : collectEvidenceIds(a.deepseek, a.grok),
    agreementState: a.agreementState,
    specialistStatus: a.specialistStatus,
    claudeState: a.claudeState,
    reviewVerdict: a.reviewVerdict,
    confidencePct: a.confidencePct,
    freshness: a.packet.freshness,
    missingInformation: a.packet.missingInformation,
  }
}

/** Apply Claude's validated review verdict to the OpenAI synthesis. */
function applyReviewToResult(a: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
  synthDraft: SynthesisDraftValidated
  agreementState: AgreementState
  confidencePct?: number
  review: ClaudeReviewEvaluation
}): ThreeBrainDecisionResult {
  const { review } = a
  const specialistStatus: SpecialistStatusRecord = {
    deepseek: a.deepseek.status,
    grok: a.grok.status,
    openai: 'completed',
    anthropic: review.status,
  }

  if (review.verdict === 'rejected') {
    // No false consensus: surface the concerns, drop to disagreement, and lower confidence.
    return buildSynthesisResult({
      packet: a.packet,
      deepseek: a.deepseek,
      grok: a.grok,
      synthDraft: a.synthDraft,
      overrideShortAnswer:
        'Independent review flagged material concerns with the synthesis — treat this as unresolved rather than a confident recommendation.',
      agreementState: 'disagreement',
      confidencePct: adjustConfidenceForReview(a.confidencePct, 'rejected'),
      specialistStatus,
      claudeState: 'completed',
      reviewVerdict: 'rejected',
      extraCaveats: [...review.requiredCaveats, ...review.findings.map((f) => f.claim)],
    })
  }

  if (review.verdict === 'qualified') {
    return buildSynthesisResult({
      packet: a.packet,
      deepseek: a.deepseek,
      grok: a.grok,
      synthDraft: applyCorrections(a.synthDraft, review.correctedContent),
      agreementState: a.agreementState,
      confidencePct: adjustConfidenceForReview(a.confidencePct, 'qualified'),
      specialistStatus,
      claudeState: 'completed',
      reviewVerdict: 'qualified',
      extraCaveats: review.requiredCaveats,
    })
  }

  // approved → preserve OpenAI synthesis; append any required caveats; never raise confidence.
  return buildSynthesisResult({
    packet: a.packet,
    deepseek: a.deepseek,
    grok: a.grok,
    synthDraft: a.synthDraft,
    agreementState: a.agreementState,
    confidencePct: adjustConfidenceForReview(a.confidencePct, 'approved'),
    specialistStatus,
    claudeState: 'completed',
    reviewVerdict: 'approved',
    extraCaveats: review.requiredCaveats,
  })
}

/** Overlay only the evidence-grounded corrections Claude supplied (already URL-stripped + schema-bounded). */
function applyCorrections(
  draft: SynthesisDraftValidated,
  cc: ClaudeReviewEvaluation['correctedContent'],
): SynthesisDraftValidated {
  if (!cc) return draft
  return {
    ...draft,
    shortAnswer: cc.shortAnswer || draft.shortAnswer,
    whatDataSays: cc.whatDataSays || draft.whatDataSays,
    whatItMeans: cc.whatItMeans || draft.whatItMeans,
    recommendedAction: cc.recommendedAction ?? draft.recommendedAction,
    alternatives: cc.alternatives && cc.alternatives.length ? cc.alternatives : draft.alternatives,
  }
}

export async function runThreeBrainAnalysis(
  packet: DecisionOSEvidencePacket,
  opts: RunThreeBrainOptions = {},
): Promise<ThreeBrainDecisionResult> {
  const getProvider = opts.getProvider ?? defaultGetProvider
  const timeoutMs = opts.perProviderTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const cancelGraceMs = opts.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS
  const recordUsage = opts.recordUsage ?? recordLlmUsage
  const validIds = evidenceIdSet(packet)

  const emit = (role: ThreeBrainRole, res: ProviderChatResult) => {
    // Non-sensitive telemetry only — never prompts, raw responses, or league payloads.
    void Promise.resolve(
      recordUsage({
        endpoint: 'decision_os_three_brain',
        tool: `three_brain_${role}`,
        userId: packet.userId,
        model: res.model,
        usage: { prompt_tokens: res.tokensPrompt, completion_tokens: res.tokensCompletion },
        ok: res.status === 'ok',
      }),
    ).catch(() => {})
  }

  // 0) Already aborted before any provider call → do NOT start the network requests.
  if (isAborted(opts)) {
    const d = validateSpecialistOutput('deepseek', failedResult('deepseek', 'aborted'), validIds).evaluation
    const g = validateSpecialistOutput('grok', failedResult('grok', 'aborted'), validIds).evaluation
    return deterministicOnlyResult(packet, d, g)
  }

  // 1) Specialists in parallel. Each receives ONLY the evidence packet + its role prompt + the external signal,
  //    so a lease-loss / deadline abort cancels BOTH in-flight requests.
  const [dSettled, gSettled] = await Promise.allSettled([
    callWithTimeout(getProvider('deepseek'), buildDeepSeekRequest(packet), timeoutMs, 'deepseek', opts.signal, cancelGraceMs, opts.onProviderRequest),
    callWithTimeout(getProvider('grok'), buildGrokRequest(packet), timeoutMs, 'grok', opts.signal, cancelGraceMs, opts.onProviderRequest),
  ])
  const dRaw = dSettled.status === 'fulfilled' ? dSettled.value : failedResult('deepseek', 'settle error')
  const gRaw = gSettled.status === 'fulfilled' ? gSettled.value : failedResult('grok', 'settle error')
  emit('deepseek', dRaw)
  emit('grok', gRaw)

  const dVal = validateSpecialistOutput('deepseek', dRaw, validIds)
  const gVal = validateSpecialistOutput('grok', gRaw, validIds)
  const deepseek = dVal.evaluation
  const grok = gVal.evaluation

  // 2) Both specialists failed → deterministic_only. No synthesis call, no false consensus, no Claude.
  if (deepseek.status === 'failed' && grok.status === 'failed') {
    return deterministicOnlyResult(packet, deepseek, grok)
  }

  // 3) OpenAI synthesis — ONLY after both specialists settled, receiving BOTH evaluations. Do not START it if
  //    the execution was cancelled between stages (no post-abort provider call).
  if (isAborted(opts)) return deterministicOnlyResult(packet, deepseek, grok)
  const oRaw = await callWithTimeout(getProvider('openai'), buildSynthesisRequest(packet, deepseek, grok), timeoutMs, 'openai', opts.signal, cancelGraceMs, opts.onProviderRequest)
  emit('openai', oRaw)
  const synth = validateSynthesisOutput(oRaw, validIds)

  const agreementState = computeAgreementState(deepseek, grok, synth.ok)
  const specialistDrops =
    dVal.droppedUnsupported + dVal.droppedUnknownEvidence + gVal.droppedUnsupported + gVal.droppedUnknownEvidence
  const confidencePct = computeConfidence({
    packet,
    deepseek,
    grok,
    agreementState,
    droppedClaims: specialistDrops + (synth.ok ? synth.droppedUnknownEvidence : 0),
  })

  // 4) OpenAI failed → Claude FALLBACK synthesis (from the same verified evidence + specialist evals).
  if (!synth.ok) {
    if (!isAborted(opts) && shouldRunClaudeFallback({ packet, deepseek, grok })) {
      const fRaw = await callWithTimeout(getProvider('anthropic'), buildSynthesisRequest(packet, deepseek, grok), timeoutMs, 'anthropic', opts.signal, cancelGraceMs, opts.onProviderRequest)
      emit('anthropic', fRaw)
      const fallback = validateSynthesisOutput(fRaw, validIds)
      if (fallback.ok) {
        const fallbackConfidence = computeConfidence({
          packet,
          deepseek,
          grok,
          agreementState,
          droppedClaims: specialistDrops + fallback.droppedUnknownEvidence,
        })
        return buildSynthesisResult({
          packet,
          deepseek,
          grok,
          synthDraft: fallback.draft,
          agreementState,
          confidencePct: fallbackConfidence,
          specialistStatus: { deepseek: deepseek.status, grok: grok.status, openai: 'failed', anthropic: 'completed' },
          claudeState: 'fallback_synthesis',
          reviewVerdict: undefined,
          extraCaveats: ['OpenAI synthesis was unavailable; Claude produced this synthesis from the same verified evidence.'],
        })
      }
      // Claude fallback also failed → degraded (both synthesizers down).
      return degradedResult({
        packet,
        deepseek,
        grok,
        note: synth.note,
        confidencePct,
        anthropicStatus: 'failed',
        claudeState: 'failed',
      })
    }
    // No usable material for a fallback → degraded, Claude not requested.
    return degradedResult({
      packet,
      deepseek,
      grok,
      note: synth.note,
      confidencePct,
      anthropicStatus: 'not_requested',
      claudeState: 'not_requested',
    })
  }

  // 5) OpenAI succeeded → Claude REVIEWS only when eligible (disagreement / low confidence / policy). An abort
  //    between stages skips the review entirely (no post-abort provider call) and returns the OpenAI synthesis.
  const eligibility = evaluateClaudeReviewEligibility({ agreementState, confidencePct, policy: opts.reviewPolicy })
  const baseStatus: SpecialistStatusRecord = {
    deepseek: deepseek.status,
    grok: grok.status,
    openai: 'completed',
    anthropic: 'not_requested',
  }
  if (!eligibility.eligible || isAborted(opts)) {
    return buildSynthesisResult({
      packet,
      deepseek,
      grok,
      synthDraft: synth.draft,
      agreementState,
      confidencePct,
      specialistStatus: baseStatus,
      claudeState: 'not_requested',
      reviewVerdict: undefined,
    })
  }

  const rRaw = await callWithTimeout(
    getProvider('anthropic'),
    buildClaudeReviewRequest({
      packet,
      deepseek,
      grok,
      synthesis: synth.draft,
      serverContext: { agreementState, confidencePct, freshness: packet.freshness },
    }),
    timeoutMs,
    'anthropic',
    opts.signal,
    cancelGraceMs,
    opts.onProviderRequest,
  )
  emit('anthropic', rRaw)
  const review = validateClaudeReview(rRaw, validIds)

  // 6) Claude failed after a valid OpenAI synthesis → preserve OpenAI, disclose review unavailable.
  if (review.evaluation.status === 'failed') {
    return buildSynthesisResult({
      packet,
      deepseek,
      grok,
      synthDraft: synth.draft,
      agreementState,
      confidencePct,
      specialistStatus: { ...baseStatus, anthropic: 'failed' },
      claudeState: 'failed',
      reviewVerdict: 'unavailable',
      extraCaveats: ['Independent Claude review was unavailable; showing the validated synthesis without that extra check.'],
    })
  }

  // 7) Apply the validated verdict (approve preserves; qualify corrects; reject withholds consensus).
  return applyReviewToResult({ packet, deepseek, grok, synthDraft: synth.draft, agreementState, confidencePct, review: review.evaluation })
}
