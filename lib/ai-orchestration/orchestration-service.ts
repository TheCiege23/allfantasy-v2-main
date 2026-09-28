/**
 * Orchestration service — validate → resolve mode → call providers (timeout/retry) → runOrchestration → normalize.
 * Single entry for unified AI backend; deterministic-first, graceful fallback.
 */

import type { AIContextEnvelope, AIModelRole, ModelOutput, OrchestrationMode } from '@/lib/unified-ai/types'
import type { UnifiedAIRequest, UnifiedAIResponse, UnifiedAIError, ProviderChatResult, OrchestrationResult } from './types'
import { validateAIRequest } from './request-validator'
import { getProvider, getAvailableFromRequested, getAvailableProviders } from './provider-registry'
import { enrichEnvelopeWithSportsData } from './sports-context-enricher'
import { buildAiTimeContextPayload } from '@/lib/time-engine/userContext'
import { isModeAllowed, resolveEffectiveMode } from './tool-registry'
import { runOrchestration } from '@/lib/unified-ai/AIOrchestrator'
import {
  resolveOrchestrationMode,
  resolveSingleModel,
  resolveSpecialistPair,
  resolveModelsForConsensus,
} from '@/lib/unified-ai/ModelRoutingResolver'
import { normalizeToUnifiedResponse } from './response-normalizer'
import { toUnifiedAIError, toHttpStatus, fromThrown } from './error-handler'
import { generateTraceId, logOrchestrationResult } from './tracing'
import type { ProviderResultMeta } from '@/lib/ai-reliability/types'
import {
  recordProviderFailure,
  recordProviderFallback,
  recordProviderLatency,
  recordDegradedModeActivation,
  logDiagnosticsEvent,
} from '@/lib/provider-diagnostics'
import type { ProviderId } from '@/lib/provider-diagnostics'
import { redactAndCap } from '@/lib/security/redactSecrets'
import { reportAllProvidersDown, reportProviderFailure } from './providerOutageAlert'
import { getToolRegistration } from '@/lib/ai-tool-registry'
import type { DeterministicSource } from '@/lib/unified-ai/DeterministicToAIContextBridge'
import { normalizeOrchestrationToolKey } from './tool-key-normalizer'
import {
  DeterministicContextEnvelopeSchema,
  buildEnvelopeFromTool,
  toProviderInputContract,
  type DeterministicContextEnvelope,
  type ProviderInputContract,
} from '@/lib/ai-context-envelope'
import { resolveChimmyRoutingPlan, runChimmyOrchestrator } from '@/lib/chimmy-orchestration'
import { CHIMMY_IDENTITY, getChimmyPromptStyleBlock } from '@/lib/chimmy-interface/ChimmyPromptStyleResolver'

/** Per-call ceiling for Claude on the Chimmy push path; see `callRole` in `runUnifiedOrchestration`. */
const CHIMMY_CLAUDE_TIMEOUT_MS = 45_000
import { createHash } from 'crypto'

function getDefaultTimeoutMs(): number {
  const v = process.env.AI_ORCHESTRATION_TIMEOUT_MS
  if (v == null || v === '') return 25_000
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 25_000
}

function getDefaultMaxRetries(): number {
  const v = process.env.AI_ORCHESTRATION_RETRY_COUNT
  if (v == null || v === '') return 1
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

function getProviderResponseCacheTtlMs(): number {
  const v = process.env.AI_PROVIDER_RESPONSE_CACHE_TTL_MS
  if (v == null || v === '') return 20_000
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : 20_000
}

type ProviderCacheEntry = {
  result: ProviderChatResult
  expiresAt: number
}

const PROVIDER_RESPONSE_CACHE = new Map<string, ProviderCacheEntry>()
const PROVIDER_IN_FLIGHT = new Map<string, Promise<ProviderChatResult>>()
const PROVIDER_CACHE_MAX_ENTRIES = 500

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`).join(',')}}`
}

function buildProviderCallCacheKey(input: {
  role: AIModelRole
  messages: Array<{ role: 'system' | 'user'; content: string }>
  timeoutMs: number
}): string {
  const payload = {
    role: input.role,
    timeoutMs: input.timeoutMs,
    messages: input.messages,
  }
  const digest = createHash('sha256').update(stableSerialize(payload)).digest('hex').slice(0, 32)
  return `ai-provider:${input.role}:${digest}`
}

/** Maps internal freshness labels to LLM instructions so "cached" is not read as "APIs are down". */
function describeSportsDataFreshnessForPrompt(state: string | undefined): string | null {
  if (!state || typeof state !== 'string') return null
  switch (state) {
    case 'live':
      return 'Sports context freshness: live / recently refreshed pipeline data.'
    case 'cached':
      return 'Sports context freshness: loaded from AllFantasy synced database and platform cache (normal). Do not tell the user that live sports feeds or news APIs are unavailable unless missing data below explicitly says so.'
    case 'stale':
      return 'Sports context freshness: older snapshot — note uncertainty if relevant; do not claim feeds are offline unless missing data indicates it.'
    case 'missing':
      return 'Sports context freshness: no structured sports/news bundle was attached for this turn — say when specific stats or schedules are unavailable; do not invent.'
    default:
      return `Sports data freshness state: ${state}.`
  }
}

function pruneProviderResponseCache(now: number) {
  for (const [key, entry] of PROVIDER_RESPONSE_CACHE.entries()) {
    if (entry.expiresAt <= now) PROVIDER_RESPONSE_CACHE.delete(key)
  }
  if (PROVIDER_RESPONSE_CACHE.size <= PROVIDER_CACHE_MAX_ENTRIES) return
  const sorted = [...PROVIDER_RESPONSE_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  for (const [key] of sorted.slice(0, PROVIDER_RESPONSE_CACHE.size - PROVIDER_CACHE_MAX_ENTRIES)) {
    PROVIDER_RESPONSE_CACHE.delete(key)
  }
}

/*
 * 🛑 THE CHIMMY GROUNDING WAS CUT AT 4,000 CHARACTERS HERE, MID-BLOCK, AFTER THE ROUTE HAD
 * CAREFULLY BUDGETED IT TO 30,000 IN WHOLE BLOCKS.
 *
 * `/api/chat/chimmy` nests its grounding text (`pecrContext.legacyEnrichmentContext`, already
 * passed through `applyGroundingBudget`, and `legacyMemorySection`, already capped at 4,000) at
 * the END of `deterministicPayload`. This function then JSON-stringified the whole payload and
 * sliced it to 4,000 — so the model saw the first few blocks at most, escaped onto one line, and
 * the cut landed wherever it landed: keeping a block's data while losing its closing constraint
 * line, the outcome `lib/chimmy/groundingBudget.ts` exists to prevent. It is a strong (not yet
 * proven) candidate for the 2026-09-20 KBFL answer that "the league's trade history isn't
 * itemized" while 27 trades were on file — that block is appended ~19th.
 *
 * So those two text fields are lifted out and sent as plain text under their own caps, and the
 * remaining JSON keeps its old limit. The payload object itself is not modified.
 */
const DATA_CONTEXT_JSON_MAX_CHARS = 4000
/** A little over `DEFAULT_GROUNDING_BUDGET` (30k): the route has already trimmed it in whole blocks. */
const GROUNDING_TEXT_MAX_CHARS = 32_000
const MEMORY_TEXT_MAX_CHARS = 4000

export function liftGroundingText(source: Record<string, unknown>): {
  payload: Record<string, unknown>
  grounding: string | null
  memory: string | null
} {
  const pecr = source.pecrContext
  if (!pecr || typeof pecr !== 'object' || Array.isArray(pecr)) {
    return { payload: source, grounding: null, memory: null }
  }
  const { legacyEnrichmentContext, legacyMemorySection, ...restPecr } = pecr as Record<string, unknown>
  const grounding =
    typeof legacyEnrichmentContext === 'string' && legacyEnrichmentContext.trim() ? legacyEnrichmentContext : null
  const memory = typeof legacyMemorySection === 'string' && legacyMemorySection.trim() ? legacyMemorySection : null
  if (!grounding && !memory) return { payload: source, grounding: null, memory: null }
  return { payload: { ...source, pecrContext: restPecr }, grounding, memory }
}

function buildMessages(
  envelope: AIContextEnvelope,
  providerInput?: ProviderInputContract
): Array<{ role: 'system' | 'user'; content: string }> {
  const normalizedFeatureType = normalizeOrchestrationToolKey(envelope.featureType)
  const systemParts: string[] = [
    normalizedFeatureType === 'chimmy_chat'
      ? `${CHIMMY_IDENTITY} Answer real-world sports questions (schedules, drafts, games, standings, injuries, stats) and fantasy sports questions within the supported sports and context provided, and be explicit about uncertainty.`
      : 'You are a helpful fantasy sports analyst. Be concise, calm, and explicit about uncertainty.',
    'Deterministic-first: never override hard engine outputs.',
    'Never invent player values, rankings, injuries, roster needs, team context, probabilities, or simulations.',
    'Always respect sport, league format, scoring settings, and roster settings in the provided context.',
  ]
  if (envelope.hardConstraints?.length) {
    systemParts.push('Hard constraints: ' + envelope.hardConstraints.join('; '))
  }
  if (providerInput?.systemPromptSuffix) {
    systemParts.push(providerInput.systemPromptSuffix)
  }
  if (normalizedFeatureType === 'chimmy_chat') {
    systemParts.push('Chimmy prompt style:\n' + getChimmyPromptStyleBlock())
    systemParts.push(
      'If deterministic context includes userTemporalContext, that clock (profile timezone + server UTC) is authoritative for "today", day-of-week, and days-until math. Never substitute an assumed or training-cutoff calendar date.'
    )
  }
  systemParts.push(`Sport context: ${envelope.sport}.`)
  if (envelope.leagueId) {
    systemParts.push(`League context id: ${envelope.leagueId}.`)
  }
  const userParts: string[] = []
  if (envelope.deterministicPayload && typeof envelope.deterministicPayload === 'object') {
    const { payload, grounding, memory } = liftGroundingText(envelope.deterministicPayload)
    userParts.push('Data context:\n' + JSON.stringify(payload).slice(0, DATA_CONTEXT_JSON_MAX_CHARS))
    if (memory) userParts.push('Chimmy memory for this user:\n' + memory.slice(0, MEMORY_TEXT_MAX_CHARS))
    if (grounding) userParts.push('Grounding (league, roster and sports data):\n' + grounding.slice(0, GROUNDING_TEXT_MAX_CHARS))
  }
  if (envelope.statisticsPayload && typeof envelope.statisticsPayload === 'object') {
    const stats = envelope.statisticsPayload
    if (stats.sportsData && typeof stats.sportsData === 'object') {
      userParts.push('Sports context (teams/games — use only this, do not invent):\n' + JSON.stringify(stats.sportsData).slice(0, 2000))
    }
    if (stats.sportsDataSource) userParts.push(`(Source: ${stats.sportsDataSource})`)
    if (stats.sportsDataState && typeof stats.sportsDataState === 'string') {
      const freshnessLine = describeSportsDataFreshnessForPrompt(stats.sportsDataState)
      if (freshnessLine) userParts.push(freshnessLine)
    }
    if (stats.sportsDataCoverage && typeof stats.sportsDataCoverage === 'object') {
      const coverage = stats.sportsDataCoverage as {
        requested?: unknown
        available?: unknown
        missing?: unknown
      }
      const requested = Array.isArray(coverage.requested) ? coverage.requested.join(', ') : ''
      const available = Array.isArray(coverage.available) ? coverage.available.join(', ') : ''
      const missing = Array.isArray(coverage.missing) ? coverage.missing.join(', ') : ''
      if (requested || available || missing) {
        userParts.push(
          `Sports data coverage — requested: ${requested || 'n/a'}; available: ${available || 'n/a'}; missing: ${missing || 'none'}.`
        )
      }
    }
    if (stats.sportsDataAttemptedSources && Array.isArray(stats.sportsDataAttemptedSources)) {
      userParts.push(`Sports providers attempted: ${stats.sportsDataAttemptedSources.join(', ') || 'none'}.`)
    }
  }
  if (envelope.dataQualityMetadata?.missing?.length) {
    userParts.push('Unavailable or missing data: ' + envelope.dataQualityMetadata.missing.join(', ') + '. State when information is unavailable; do not invent.')
  }
  if (providerInput?.envelope?.evidence?.summaryForAI) {
    userParts.push('Deterministic evidence summary:\n' + providerInput.envelope.evidence.summaryForAI)
  }
  if (providerInput?.envelope?.evidence?.items?.length) {
    const evidenceLines = providerInput.envelope.evidence.items
      .slice(0, 10)
      .map((item) => `- ${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`)
      .join('\n')
    userParts.push('Deterministic evidence items (facts only):\n' + evidenceLines)
  }
  if (providerInput?.envelope?.confidence) {
    const confidence = providerInput.envelope.confidence
    userParts.push(
      `Deterministic confidence: ${confidence.scorePct}% (${confidence.label})` +
      (confidence.cappedByData ? ` [capped: ${confidence.capReason ?? 'data limits'}]` : '')
    )
  }
  if (providerInput?.envelope?.uncertainty?.items?.length) {
    const uncertaintyLines = providerInput.envelope.uncertainty.items
      .slice(0, 6)
      .map((item) => `- ${item.what} (${item.impact} impact)${item.reason ? `: ${item.reason}` : ''}`)
      .join('\n')
    userParts.push('Explicit uncertainty (must acknowledge):\n' + uncertaintyLines)
  }
  if (providerInput?.envelope?.missingData?.items?.length) {
    const missingLines = providerInput.envelope.missingData.items
      .slice(0, 8)
      .map((item) => `- ${item.what} (${item.impact} impact)`)
      .join('\n')
    userParts.push('Missing deterministic data (do not infer):\n' + missingLines)
  }
  if (envelope.afTimeContext && typeof envelope.afTimeContext === 'object') {
    userParts.push(
      'AllFantasy time context (authoritative for "now", calendar date, and user-local wording — server UTC + account timezone; device fields are diagnostic only):\n' +
        JSON.stringify(envelope.afTimeContext).slice(0, 3500)
    )
  }
  if (envelope.userMessage) userParts.push('User: ' + envelope.userMessage)
  if (envelope.promptIntent) userParts.push('Intent: ' + envelope.promptIntent)
  const user = userParts.length ? userParts.join('\n\n') : 'Summarize the data above.'
  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: user },
  ]
}

function toConfidenceLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 75) return 'high'
  if (score < 50) return 'low'
  return 'medium'
}

/*
 * ⚠ SAY IT IS AN OUTAGE BEFORE ANYTHING ELSE. This used to open "Deterministic guidance from NFL
 * context: …" and only admit in its last clause that no model had answered, so users read it as
 * a poor answer and reported "Chimmy got dumb" — not as the outage it was. The lead sentence now
 * says so plainly; the "Deterministic guidance from" marker is kept after it because that string
 * is what the runbook tells people to look for.
 */
const AI_UNAVAILABLE_LEAD =
  "Chimmy's AI models are unavailable right now, so this is not a full answer — only the raw context I have."

function buildDeterministicFallbackText(envelope: AIContextEnvelope): string {
  const payload = envelope.deterministicPayload
  if (!payload || typeof payload !== 'object') {
    return 'AI providers are temporarily unavailable and deterministic context is missing. Retry shortly.'
  }
  const keyValues = Object.entries(payload)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${String(value)}`)
  const contextLabels = Object.keys(payload)
    .slice(0, 4)
    .map((key) => key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim().toLowerCase())
  const summary = keyValues.length > 0
    ? keyValues.join('; ')
    : contextLabels.length > 0
      ? `available context includes ${contextLabels.join(', ')}`
      : 'deterministic context is available'
  const missing = envelope.dataQualityMetadata?.missing?.length
    ? ` Missing data: ${envelope.dataQualityMetadata?.missing?.slice(0, 4).join(', ')}.`
    : ''
  return `${AI_UNAVAILABLE_LEAD} Deterministic guidance from ${envelope.sport} context: ${summary}.${missing} AI explanation is temporarily unavailable.`
}

const FALLBACK_MAX_CONFIDENCE_PCT = 35

function buildDeterministicFallbackResult(params: {
  envelope: AIContextEnvelope
  mode: OrchestrationMode
  modelOutputs: ModelOutput[]
  reason: string
}): OrchestrationResult {
  const { envelope, mode, modelOutputs, reason } = params
  const baseConfidence =
    typeof envelope.confidenceMetadata?.score === 'number'
      ? envelope.confidenceMetadata.score
      : envelope.deterministicPayload
        ? 58
        : 34
  const missingPenalty = (envelope.dataQualityMetadata?.missing?.length ?? 0) * 5
  const stalePenalty = envelope.dataQualityMetadata?.stale ? 8 : 0
  /*
   * Capped LOW. No model reasoned about this question, so a "MEDIUM CONFIDENCE 58%" badge on a
   * data dump overstates it — which is exactly how the 2026-09-20 outage was misread as advice.
   */
  const confidencePct = Math.max(20, Math.min(FALLBACK_MAX_CONFIDENCE_PCT, baseConfidence - missingPenalty - stalePenalty))
  const factGuardWarnings = envelope.dataQualityMetadata?.missing?.length
    ? [`Data unavailable: ${envelope.dataQualityMetadata.missing.slice(0, 5).join(', ')}`]
    : undefined

  return {
    mode,
    primaryAnswer: buildDeterministicFallbackText(envelope),
    confidencePct,
    confidenceLabel: toConfidenceLabel(confidencePct),
    reason,
    modelOutputs,
    usedDeterministic: Boolean(envelope.deterministicPayload),
    factGuardWarnings,
  }
}

function toModelOutput(result: ProviderChatResult): ModelOutput {
  return {
    model: result.provider,
    modelName: result.model,
    raw: result.text,
    structured: result.json && typeof result.json === 'object'
      ? (result.json as Record<string, unknown>)
      : null,
    error: result.error,
    skipped: result.status !== 'ok',
    tokensPrompt: result.tokensPrompt,
    tokensCompletion: result.tokensCompletion,
  }
}

function toProviderResultMeta(role: AIModelRole, result: ProviderChatResult, startMs: number): ProviderResultMeta {
  const status =
    result.status === 'ok'
      ? 'ok'
      : result.timedOut
        ? 'timeout'
        : result.status === 'invalid_response'
          ? 'invalid_response'
          : 'failed'
  return {
    provider: role,
    status,
    error: result.error,
    latencyMs: Date.now() - startMs,
  }
}

function resolveDeterministicSource(featureType: string): DeterministicSource | undefined {
  switch (normalizeOrchestrationToolKey(featureType)) {
    case 'trade_analyzer':
    case 'trade_evaluator':
      return 'trade_engine'
    case 'waiver_ai':
      return 'waiver_engine'
    case 'rankings':
      return 'rankings_engine'
    case 'draft_helper':
      return 'draft_board'
    case 'matchup':
    case 'simulation':
      return 'simulation'
    case 'psychological':
    case 'psychological_profiles':
      return 'psychological'
    case 'legacy_score':
    case 'reputation':
      return 'legacy_score'
    case 'rivalries':
    case 'graph_insight':
      return 'graph'
    default:
      return undefined
  }
}

function resolveDeterministicContextEnvelope(
  envelope: AIContextEnvelope
): DeterministicContextEnvelope | null {
  if (envelope.deterministicContextEnvelope) {
    const parsed = DeterministicContextEnvelopeSchema.safeParse(envelope.deterministicContextEnvelope)
    if (parsed.success) return parsed.data
  }
  if (!envelope.deterministicPayload) return null

  const confidence = envelope.confidenceMetadata?.score != null
    ? {
        scorePct: Math.max(0, Math.min(100, envelope.confidenceMetadata.score)),
        label: toConfidenceLabel(
          envelope.confidenceMetadata.label === 'high' ||
          envelope.confidenceMetadata.label === 'medium' ||
          envelope.confidenceMetadata.label === 'low'
            ? envelope.confidenceMetadata.label === 'high' ? 80
              : envelope.confidenceMetadata.label === 'medium' ? 60
              : 40
            : envelope.confidenceMetadata.score
        ),
        reason: envelope.confidenceMetadata.reason,
        cappedByData: Boolean(envelope.dataQualityMetadata?.missing?.length),
        capReason: envelope.dataQualityMetadata?.missing?.length
          ? `Missing: ${envelope.dataQualityMetadata.missing.slice(0, 4).join(', ')}`
          : undefined,
      }
    : undefined
  const missingData = envelope.dataQualityMetadata?.missing?.length
    ? {
        items: envelope.dataQualityMetadata.missing.slice(0, 8).map((item) => ({
          what: item,
          impact: 'medium' as const,
          suggestedAction: `Provide deterministic metric "${item}" for full confidence.`,
        })),
        summaryForAI: envelope.dataQualityMetadata.missing.join(', '),
      }
    : undefined
  const uncertainty = envelope.dataQualityMetadata?.missing?.length
    ? {
        items: envelope.dataQualityMetadata.missing.slice(0, 6).map((item) => ({
          what: item,
          impact: 'medium' as const,
          reason: 'Deterministic field missing.',
        })),
        summaryForAI: envelope.dataQualityMetadata.missing.join(', '),
      }
    : undefined

  const built = buildEnvelopeFromTool(
    normalizeOrchestrationToolKey(envelope.featureType),
    envelope.sport,
    {
      leagueId: envelope.leagueId ?? null,
      userId: envelope.userId ?? null,
      deterministicPayload: envelope.deterministicPayload ?? null,
      confidence,
      missingData,
      uncertainty,
      hardConstraints: envelope.hardConstraints,
      envelopeId: `auto-${Date.now().toString(36)}`,
      dataQualitySummary: envelope.dataQualityMetadata?.missing?.length
        ? `Missing deterministic fields: ${envelope.dataQualityMetadata.missing.join(', ')}`
        : undefined,
    }
  )
  const parsed = DeterministicContextEnvelopeSchema.safeParse(built)
  return parsed.success ? parsed.data : null
}

async function runProviderCallWithTimeout(
  role: AIModelRole,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs: number,
  skipCache = false
): Promise<ProviderChatResult> {
  const now = Date.now()
  const cacheKey = buildProviderCallCacheKey({ role, messages, timeoutMs })
  const cacheTtlMs = getProviderResponseCacheTtlMs()
  if (!skipCache && cacheTtlMs > 0) {
    pruneProviderResponseCache(now)
    const cached = PROVIDER_RESPONSE_CACHE.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.result
    }
    const inFlight = PROVIDER_IN_FLIGHT.get(cacheKey)
    if (inFlight) {
      return inFlight
    }
  }

  const provider = getProvider(role)
  const requestPromise = new Promise<ProviderChatResult>((resolve) => {
    let finished = false
    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      resolve({
        text: '',
        model: '',
        provider: role,
        status: 'timeout',
        timedOut: true,
        error: `Provider timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    provider
      .chat({
        messages,
        timeoutMs,
        maxTokens: 1000,
        temperature: 0.5,
      })
      .then((result) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        resolve(result)
      })
      .catch((error) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        const message = error instanceof Error ? error.message : String(error)
        resolve({
          text: '',
          model: '',
          provider: role,
          status: 'failed',
          error: message.slice(0, 240),
        })
      })
  })

  if (!skipCache && cacheTtlMs > 0) {
    PROVIDER_IN_FLIGHT.set(cacheKey, requestPromise)
  }

  try {
    const result = await requestPromise
    if (!skipCache && cacheTtlMs > 0 && result.status === 'ok') {
      PROVIDER_RESPONSE_CACHE.set(cacheKey, {
        result,
        expiresAt: Date.now() + cacheTtlMs,
      })
    }
    return result
  } finally {
    if (!skipCache && cacheTtlMs > 0) {
      PROVIDER_IN_FLIGHT.delete(cacheKey)
    }
  }
}

async function callProviderWithRetry(
  role: AIModelRole,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs: number,
  maxRetries: number,
  skipCache = false
): Promise<{ result: ProviderChatResult; meta: ProviderResultMeta }> {
  const startMs = Date.now()
  let lastResult: ProviderChatResult | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await runProviderCallWithTimeout(role, messages, timeoutMs, skipCache)
    if (lastResult.status === 'ok') break
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  const result = lastResult!
  const meta = toProviderResultMeta(role, result, startMs)
  return { result, meta }
}

export type RunOrchestrationResult =
  | { ok: true; response: UnifiedAIResponse }
  | { ok: false; error: UnifiedAIError; status: number }

/**
 * Run full orchestration: validate, resolve mode, call available providers, merge, normalize.
 * Returns unified response or structured error. No dead fallback branches; deterministic-only when all providers fail.
 */
export async function runUnifiedOrchestration(req: UnifiedAIRequest): Promise<RunOrchestrationResult> {
  const traceId = req.options?.traceId ?? generateTraceId()

  const validation = validateAIRequest(req)
  if (!validation.valid || !validation.envelope) {
    const error = toUnifiedAIError(validation.errorCode ?? 'envelope_validation_failed', {
      message: validation.errorMessage,
      traceId,
    })
    return { ok: false, error, status: toHttpStatus(error.code) }
  }

  let envelope: AIContextEnvelope = validation.envelope
  try {
    envelope = await enrichEnvelopeWithSportsData(envelope)
  } catch (_e) {
    // Non-blocking: proceed with unenriched envelope
  }

  if (envelope.userId && envelope.afTimeContext == null) {
    try {
      const tc = await buildAiTimeContextPayload(envelope.userId)
      envelope = { ...envelope, afTimeContext: tc as unknown as Record<string, unknown> }
    } catch (_e) {
      // Non-blocking: orchestration proceeds without time bundle
    }
  }

  const registration = getToolRegistration(envelope.featureType)
  if (registration?.deterministicRequired && !envelope.deterministicPayload) {
    const error = toUnifiedAIError('envelope_validation_failed', {
      message: `Tool "${registration.toolName}" requires deterministic context before AI orchestration.`,
      traceId,
    })
    return { ok: false, error, status: toHttpStatus(error.code) }
  }
  let deterministicEnvelope = resolveDeterministicContextEnvelope(envelope)
  if (registration?.deterministicRequired && !deterministicEnvelope) {
    const error = toUnifiedAIError('envelope_validation_failed', {
      message: `Tool "${registration.toolName}" requires a deterministic context envelope.`,
      traceId,
    })
    return { ok: false, error, status: toHttpStatus(error.code) }
  }
  if (registration?.deterministicRequired) {
    const missingRequiredFields = registration.requiredContextFields.filter(
      (field) => envelope.deterministicPayload?.[field] == null
    )
    if (missingRequiredFields.length > 0) {
      const existingMissing = deterministicEnvelope?.missingData?.items ?? []
      const missingDataItems = [
        ...existingMissing,
        ...missingRequiredFields.map((field) => ({
          what: field,
          impact: 'high' as const,
          suggestedAction: `Provide deterministic value for "${field}" before trusting high-confidence recommendations.`,
        })),
      ]
      const uncertaintyItems = [
        ...(deterministicEnvelope?.uncertainty?.items ?? []),
        ...missingRequiredFields.map((field) => ({
          what: field,
          impact: 'high' as const,
          reason: 'Required deterministic metric is missing.',
        })),
      ]
      deterministicEnvelope = deterministicEnvelope
        ? {
            ...deterministicEnvelope,
            missingData: {
              items: missingDataItems,
              summaryForAI: `Missing required deterministic fields: ${missingRequiredFields.join(', ')}`,
            },
            uncertainty: {
              items: uncertaintyItems,
              summaryForAI: `Uncertain due to missing required deterministic fields: ${missingRequiredFields.join(', ')}`,
            },
            confidence: deterministicEnvelope.confidence
              ? {
                  ...deterministicEnvelope.confidence,
                  cappedByData: true,
                  capReason: deterministicEnvelope.confidence.capReason
                    ? `${deterministicEnvelope.confidence.capReason}; missing required fields: ${missingRequiredFields.join(', ')}`
                    : `Missing required fields: ${missingRequiredFields.join(', ')}`,
                }
              : deterministicEnvelope.confidence,
          }
        : buildEnvelopeFromTool(
            normalizeOrchestrationToolKey(envelope.featureType),
            envelope.sport,
            {
              leagueId: envelope.leagueId ?? null,
              userId: envelope.userId ?? null,
              deterministicPayload: envelope.deterministicPayload ?? null,
              missingData: {
                items: missingDataItems,
                summaryForAI: `Missing required deterministic fields: ${missingRequiredFields.join(', ')}`,
              },
              uncertainty: {
                items: uncertaintyItems,
                summaryForAI: `Uncertain due to missing required deterministic fields: ${missingRequiredFields.join(', ')}`,
              },
              hardConstraints: envelope.hardConstraints,
              dataQualitySummary: `Missing required deterministic fields: ${missingRequiredFields.join(', ')}`,
            }
          )
      envelope = {
        ...envelope,
        dataQualityMetadata: {
          ...(envelope.dataQualityMetadata ?? {}),
          missing: Array.from(new Set([...(envelope.dataQualityMetadata?.missing ?? []), ...missingRequiredFields])),
        },
      }
    }
  }
  envelope = {
    ...envelope,
    deterministicContextEnvelope: deterministicEnvelope ?? envelope.deterministicContextEnvelope ?? null,
  }

  const modeOverride = req.mode
  const toolDefaultMode = resolveEffectiveMode(envelope.featureType, modeOverride) as OrchestrationMode
  const inferredMode = resolveOrchestrationMode(envelope, toolDefaultMode)
  const effectiveMode = isModeAllowed(envelope.featureType, inferredMode) ? inferredMode : toolDefaultMode
  const timeoutMs = req.options?.timeoutMs ?? getDefaultTimeoutMs()
  const maxRetries = req.options?.maxRetries ?? getDefaultMaxRetries()

  let modelsToCall: AIModelRole[]
  /*
   * CHIMMY ASKS CLAUDE FIRST, AND ALONE (user decision 2026-09-23: Claude is the main model, fallback
   * path included). The keyword router below still picks the legacy OpenAI/DeepSeek/Grok set, but that
   * set is only called if Claude fails — kept here as `chimmyLegacyModels`. Calling Claude ALONE is the
   * point: fanning out to all four would bill four providers for one charged message.
   */
  let chimmyLegacyModels: AIModelRole[] | null = null
  const normalizedFeatureKey = normalizeOrchestrationToolKey(envelope.featureType)
  if (normalizedFeatureKey === 'chimmy_chat') {
    const routingPlan = resolveChimmyRoutingPlan({
      envelope,
      availableProviders: getAvailableProviders(),
    })
    if (getProvider('anthropic').isAvailable()) {
      modelsToCall = ['anthropic']
      chimmyLegacyModels = routingPlan.models
    } else {
      modelsToCall = routingPlan.models
    }
  } else {
    switch (effectiveMode) {
      case 'single_model':
        modelsToCall = [resolveSingleModel(envelope)]
        break
      case 'specialist': {
        const pair = resolveSpecialistPair(envelope)
        modelsToCall = [pair.analysis, pair.explanation]
        break
      }
      case 'consensus':
      case 'unified_brain':
        modelsToCall = resolveModelsForConsensus(envelope)
        break
      default:
        modelsToCall = resolveModelsForConsensus(envelope)
    }
  }

  const requestedAvailable = getAvailableFromRequested(modelsToCall)
  const allAvailable = getAvailableProviders()
  let available = requestedAvailable
  let fallbackSelectionReason: string | undefined
  if (available.length === 0 && allAvailable.length > 0) {
    available = effectiveMode === 'single_model' ? [allAvailable[0]] : allAvailable
    fallbackSelectionReason =
      'Requested provider(s) are unavailable; switched to configured fallback provider(s).'
  }

  if (available.length === 0) {
    /* Nothing to call at all — alert before either branch below, both of which are an outage. */
    reportAllProvidersDown({
      featureKey: normalizedFeatureKey,
      stage: 'before_execution',
      failures: modelsToCall.map((provider) => ({ provider, detail: 'not configured or unavailable' })),
    })
    const providerResults: ProviderResultMeta[] = modelsToCall.map((provider) => ({
      provider,
      status: 'failed',
      error: 'Provider not configured or unavailable.',
    }))
    const modelOutputs: ModelOutput[] = modelsToCall.map((provider) => ({
      model: provider,
      raw: '',
      error: 'Provider unavailable',
      skipped: true,
    }))

    if (envelope.deterministicPayload) {
      recordDegradedModeActivation('all_providers_unavailable_before_execution')
      const fallbackResult = buildDeterministicFallbackResult({
        envelope,
        mode: effectiveMode,
        modelOutputs,
        reason: 'Deterministic fallback (all providers unavailable before execution).',
      })
      const response = normalizeToUnifiedResponse({
        result: fallbackResult,
        providerResults,
        envelope,
        traceId,
        cached: false,
      })
      return { ok: true, response }
    }

    const error = toUnifiedAIError('provider_unavailable', {
      message: 'No AI providers are configured or available.',
      traceId,
      details: {
        requestedProviders: modelsToCall,
      },
    })
    return { ok: false, error, status: toHttpStatus(error.code) }
  }

  const providerInput = deterministicEnvelope
    ? toProviderInputContract({
        envelope: deterministicEnvelope,
        userMessage: envelope.userMessage,
        intent: envelope.promptIntent,
      })
    : undefined
  const messages = buildMessages(envelope, providerInput)

  const callRole = (role: AIModelRole) =>
    callProviderWithRetry(
      role,
      messages,
      // Adaptive thinking makes a Claude turn slower than the 25s the legacy providers get.
      role === 'anthropic' ? Math.max(timeoutMs, CHIMMY_CLAUDE_TIMEOUT_MS) : timeoutMs,
      maxRetries,
      Boolean(req.options?.skipCache)
    )
  const results = await Promise.all(available.map(callRole))

  /*
   * Claude failed (credit, outage, refusal, timeout): only NOW call the legacy set, so the user still
   * gets an answer. Both attempts stay in `results`/`available`, so the diagnostics, the outage alert
   * and `providerStatus` below report Claude's failure as well as whichever provider answered.
   */
  if (chimmyLegacyModels && results.every((r) => r.result.status !== 'ok')) {
    const requestedLegacy = getAvailableFromRequested(chimmyLegacyModels)
    const legacy = (requestedLegacy.length > 0 ? requestedLegacy : getAvailableProviders()).filter(
      (role) => !available.includes(role)
    )
    if (legacy.length > 0) {
      results.push(...(await Promise.all(legacy.map(callRole))))
      available = [...available, ...legacy]
    }
  }

  for (let i = 0; i < results.length; i++) {
    const role = available[i] as ProviderId
    const { result, meta } = results[i]
    if (typeof meta.latencyMs === 'number') {
      recordProviderLatency(role, meta.latencyMs)
      logDiagnosticsEvent('latency', role, `${meta.latencyMs}ms`)
    }
    if (result.status !== 'ok') {
      recordProviderFailure(role, result.error)
      /* A billing or credential failure is one a human has to fix; see providerOutageAlert. */
      reportProviderFailure({ provider: role, status: result.status, detail: result.error, surface: normalizedFeatureKey })
      /*
       * ── 🛑 "failed" IS NOT A DIAGNOSIS, AND IT WAS THE ONLY THING IN THE LOG ──────────────
       *
       * This logged `result.status` — one of four enum values — and dropped `result.error`,
       * which the line directly above already hands to `recordProviderFailure`. So when every
       * provider went down in production on 2026-09-20 and every Chimmy answer degraded to the
       * "AI explanation is temporarily unavailable" fallback, the whole record was:
       *
       *     [ProviderDiagnostics] failure grok failed
       *     [ProviderDiagnostics] failure openai failed
       *     [ProviderDiagnostics] failure deepseek invalid_response
       *
       * Auth, quota, rate limit, bad model name and a network blip are indistinguishable there,
       * and the enum is derivable from the status field anyway — so the line cost a log write
       * and carried no information the reader did not already have.
       *
       * 🛑 REDACTED THROUGH `redactAndCap`, NOT THROUGH THE LOCAL `sanitizeProviderError`, AND
       * THE DIFFERENCE IS A CREDENTIAL. This was first written to copy `lib/clear-sports/client.ts`,
       * which logs through `sanitizeProviderError` in exactly this shape. But that helper is one
       * of the private half-redactors `lib/security/redactSecrets.ts` exists to replace: it covers
       * `sk-` and `api_key=` only, anchors on a leading `\b` (so a credential concatenated onto
       * preceding text slips past), and CAPS BEFORE REDACTING, which can slice a secret in half
       * and leave the front readable.
       *
       * That matters unusually much here: Rolling Insights passes `RSC_token` as a QUERY
       * PARAMETER and TheSportsDB puts its key in a URL PATH SEGMENT, so any provider error
       * quoting a URL carries a live credential — and `sanitizeProviderError` catches neither.
       * Adopting the neighbouring pattern is not the same as using the canonical rule.
       *
       * `redactAndCap` redacts first and caps second, by construction.
       */
      const reason = result.error ? redactAndCap(result.error, 160) : ''
      logDiagnosticsEvent('failure', role, reason ? `${result.status} ${reason}` : result.status)
    }
  }
  const succeededIdx = results.findIndex((r) => r.result.status === 'ok')
  if (succeededIdx >= 0 && available.length > 1) {
    const usedRole = available[succeededIdx] as ProviderId
    for (let i = 0; i < results.length; i++) {
      if (i !== succeededIdx && results[i].result.status !== 'ok') {
        const failedRole = available[i] as ProviderId
        recordProviderFallback(failedRole, usedRole)
        logDiagnosticsEvent('fallback', failedRole, `used_${usedRole}`)
      }
    }
  }

  const modelOutputs: ModelOutput[] = results.map(({ result }) => toModelOutput(result))
  const providerResults: ProviderResultMeta[] = results.map(({ meta }) => meta)
  const allProvidersFailed = providerResults.length > 0 && providerResults.every((provider) => provider.status !== 'ok')

  try {
    if (allProvidersFailed) {
      reportAllProvidersDown({
        featureKey: normalizedFeatureKey,
        stage: 'all_calls_failed',
        failures: results.map(({ result }, i) => ({ provider: String(available[i]), detail: result.error ?? result.status })),
      })
      if (envelope.deterministicPayload) {
        recordDegradedModeActivation('all_provider_calls_failed_deterministic_fallback')
        const fallbackResult = buildDeterministicFallbackResult({
          envelope,
          mode: effectiveMode,
          modelOutputs,
          reason: 'Deterministic fallback (all provider calls failed).',
        })
        const response = normalizeToUnifiedResponse({
          result: fallbackResult,
          providerResults,
          envelope,
          traceId,
          cached: false,
        })
        return { ok: true, response }
      }

      const error = toUnifiedAIError('provider_unavailable', {
        message: 'All provider calls failed and deterministic context is unavailable.',
        traceId,
        details: {
          providerStatus: providerResults.map((provider) => ({
            provider: provider.provider,
            status: provider.status,
          })),
        },
      })
      return { ok: false, error, status: toHttpStatus(error.code) }
    }

    const orchestrationResult =
      normalizedFeatureKey === 'chimmy_chat'
        ? runChimmyOrchestrator({
            envelope,
            modelOutputs,
            mode: effectiveMode,
          })
        : runOrchestration({
            envelope,
            modelOutputs,
            mode: effectiveMode,
            deterministicSource: resolveDeterministicSource(envelope.featureType),
          })

    const response = normalizeToUnifiedResponse({
      result: orchestrationResult,
      providerResults,
      envelope,
      traceId,
      cached: false,
    })
    if (fallbackSelectionReason) {
      response.reliability.message = response.reliability.message
        ? `${response.reliability.message} ${fallbackSelectionReason}`
        : fallbackSelectionReason
    }

    await logOrchestrationResult({
      traceId,
      featureType: envelope.featureType,
      mode: effectiveMode,
      primaryAnswer: orchestrationResult.primaryAnswer,
      confidencePct: orchestrationResult.confidencePct,
      usedDeterministic: orchestrationResult.usedDeterministic,
      providerResults: providerResults.map((r) => ({ provider: r.provider, status: r.status })),
      leagueId: envelope.leagueId,
      userId: envelope.userId,
    })

    return { ok: true, response }
  } catch (e) {
    const error = fromThrown(e, traceId)
    return { ok: false, error, status: toHttpStatus(error.code) }
  }
}
