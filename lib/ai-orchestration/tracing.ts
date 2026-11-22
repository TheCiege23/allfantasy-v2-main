/**
 * Logging / tracing hooks — traceId, AiOutput logging, optional trace record.
 * No PII in logs; keys server-side only.
 */

import type { AITraceRecord } from './types'
import { logAiOutput } from '@/lib/ai/output-logger'

const TRACE_PREFIX = 'ai_'

/**
 * Generate a short unique trace id for this request.
 */
export function generateTraceId(): string {
  return TRACE_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

/**
 * Log orchestration result to AiOutput (audit trail). Uses featureType as taskType.
 */
export async function logOrchestrationResult(params: {
  traceId?: string
  featureType: string
  mode: string
  primaryAnswer: string
  confidencePct?: number
  usedDeterministic: boolean
  providerResults: { provider: string; status: string }[]
  leagueId?: string | null
  userId?: string | null
}): Promise<void> {
  try {
    await logAiOutput({
      provider: 'orchestration',
      role: 'narrative',
      taskType: params.featureType,
      targetType: 'league',
      targetId: params.leagueId ?? undefined,
      contentText: params.primaryAnswer.slice(0, 50_000),
      confidence: params.confidencePct ?? undefined,
      meta: {
        traceId: params.traceId,
        mode: params.mode,
        usedDeterministic: params.usedDeterministic,
        providerResults: params.providerResults,
      },
    })
  } catch (e) {
    console.error('[ai-orchestration] Failed to log result:', e)
  }
}

/**
 * Build trace record for server-side observability (e.g. admin debug). Not sent to client by default.
 */
export function buildTraceRecord(params: {
  traceId: string
  featureType: string
  mode: string
  envelopeSummary: { sport: string; leagueId?: string | null }
  modelOutputsCount: number
  usedDeterministic: boolean
  durationMs: number
  cached?: boolean
  errorCode?: string
}): AITraceRecord {
  return {
    traceId: params.traceId,
    featureType: params.featureType,
    mode: params.mode as AITraceRecord['mode'],
    envelopeSummary: params.envelopeSummary,
    modelOutputsCount: params.modelOutputsCount,
    usedDeterministic: params.usedDeterministic,
    durationMs: params.durationMs,
    cached: params.cached,
    errorCode: params.errorCode as AITraceRecord['errorCode'],
  }
}
