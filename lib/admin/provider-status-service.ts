/**
 * PROMPT 155 — Provider status and diagnostics service.
 * Tracks recent failures, fallback events, latency. Safe diagnostics only (no secrets, no stack traces).
 */

import { sanitizeProviderError } from '@/lib/ai-orchestration/provider-utils'

export type ProviderId = 'openai' | 'deepseek' | 'grok' | 'clearsports'

const MAX_FAILURES_PER_PROVIDER = 50
const MAX_FALLBACK_EVENTS = 100
const MAX_DEGRADED_MODE_EVENTS = 50
const LATENCY_SAMPLES_PER_PROVIDER = 20

interface FailureEntry {
  at: number
  provider: ProviderId
  error?: string
}

interface FallbackEntry {
  at: number
  primary: ProviderId
  used: ProviderId
}

interface DegradedModeEntry {
  at: number
  reason: string
}

const recentFailures: FailureEntry[] = []
const fallbackEvents: FallbackEntry[] = []
const degradedModeEvents: DegradedModeEntry[] = []
const latencyByProvider: Partial<Record<ProviderId, number[]>> = {}

function trimFailures() {
  const byProvider = new Map<ProviderId, FailureEntry[]>()
  for (const e of recentFailures) {
    const list = byProvider.get(e.provider) || []
    list.push(e)
    byProvider.set(e.provider, list)
  }
  recentFailures.length = 0
  for (const [, list] of byProvider) {
    const sorted = list.sort((a, b) => b.at - a.at).slice(0, MAX_FAILURES_PER_PROVIDER)
    recentFailures.push(...sorted)
  }
  recentFailures.sort((a, b) => b.at - a.at)
}

function trimFallbacks() {
  if (fallbackEvents.length > MAX_FALLBACK_EVENTS) {
    fallbackEvents.sort((a, b) => b.at - a.at)
    fallbackEvents.length = MAX_FALLBACK_EVENTS
  }
}

function trimDegradedModeEvents() {
  if (degradedModeEvents.length > MAX_DEGRADED_MODE_EVENTS) {
    degradedModeEvents.sort((a, b) => b.at - a.at)
    degradedModeEvents.length = MAX_DEGRADED_MODE_EVENTS
  }
}

/** Record a provider failure (error message is sanitized before storage). */
export function recordProviderFailure(provider: ProviderId, error?: string): void {
  recentFailures.push({
    at: Date.now(),
    provider,
    error: error ? sanitizeProviderError(error) : undefined,
  })
  trimFailures()
}

/** Record that a fallback was used (primary failed or skipped, used instead). */
export function recordProviderFallback(primary: ProviderId, used: ProviderId): void {
  fallbackEvents.push({ at: Date.now(), primary, used })
  trimFallbacks()
}

/** Record latency for a provider (ms). */
export function recordProviderLatency(provider: ProviderId, latencyMs: number): void {
  const arr = latencyByProvider[provider] || []
  arr.push(latencyMs)
  if (arr.length > LATENCY_SAMPLES_PER_PROVIDER) arr.shift()
  latencyByProvider[provider] = arr
}

/** Record a degraded-mode activation event (safe reason string only). */
export function recordDegradedModeActivation(reason: string): void {
  const safeReason = sanitizeProviderError(reason).slice(0, 160) || 'degraded_mode_active'
  degradedModeEvents.push({
    at: Date.now(),
    reason: safeReason,
  })
  trimDegradedModeEvents()
}

/** Safe log for server logs only (no secrets). */
export function logDiagnosticsEvent(event: 'failure' | 'fallback' | 'latency', provider: string, detail?: string): void {
  if (process.env.NODE_ENV === 'development' || event === 'failure') {
    const msg = detail ? `[ProviderDiagnostics] ${event} ${provider} ${detail}` : `[ProviderDiagnostics] ${event} ${provider}`
    if (event === 'failure') console.warn(msg)
    else console.info(msg)
  }
}

