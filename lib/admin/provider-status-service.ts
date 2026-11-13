/**
 * PROMPT 155 — Provider status and diagnostics service.
 * Tracks recent failures, fallback events, latency. Safe diagnostics only (no secrets, no stack traces).
 */

import { sanitizeProviderError } from '@/lib/ai-orchestration/provider-utils'
import type { ProviderStatus } from '@/lib/provider-config'

export type ProviderId = 'openai' | 'deepseek' | 'grok' | 'clearsports'
type ProviderPublicId = 'openai' | 'deepseek' | 'xai' | 'clearsports'

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

function toPublicProviderId(id: ProviderId): ProviderPublicId {
  if (id === 'grok') return 'xai'
  return id
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

type ProviderStatusState = 'configured' | 'available' | 'degraded' | 'unavailable' | 'fallback_active'

interface ProviderDiagnosticsEntry {
  id: ProviderPublicId
  state: ProviderStatusState
  configured: boolean
  available: boolean
  healthy?: boolean
  error?: string
  fallbackActive: boolean
  degradedReasons: string[]
  lastLatencyMs?: number
  avgLatencyMs?: number
  latencyTrend: 'unknown' | 'stable' | 'elevated' | 'critical'
  recentFailureCount: number
  lastFailureAt?: number
  fallbackUsedCount: number
}

interface RecentFailureSummary {
  provider: ProviderPublicId
  at: number
  error?: string
}

interface FallbackEventSummary {
  at: number
  primary: ProviderPublicId
  used: ProviderPublicId
}

interface DegradedModeSummary {
  active: boolean
  recentEvents: Array<{
    at: number
    reason: string
  }>
}

interface ClearSportsSyncHistoryEntry {
  entityType: string
  sport?: string | null
  key?: string | null
  lastStartedAt?: number
  lastCompletedAt?: number
  lastSuccessAt?: number
  lastErrorAt?: number
  lastError?: string | null
  recordsImported: number
  recordsUpdated: number
  recordsSkipped: number
  updatedAt: number
}

interface ProviderDiagnosticsPayload {
  providers: ProviderDiagnosticsEntry[]
  recentFailures: RecentFailureSummary[]
  fallbackEvents: FallbackEventSummary[]
  degradedMode: DegradedModeSummary
  latencyTrend: Record<ProviderPublicId, number[]>
  clearSportsSyncHistory?: ClearSportsSyncHistoryEntry[]
  generatedAt: number
}

/** Get recent failure count for a provider (e.g. last hour). */
function getRecentFailureCount(provider: ProviderId, windowMs: number = 3600_000): number {
  const cutoff = Date.now() - windowMs
  return recentFailures.filter((e) => e.provider === provider && e.at >= cutoff).length
}

/** Get fallback count where this provider was the primary that was skipped. */
function getFallbackUsedCount(provider: ProviderId, windowMs: number = 3600_000): number {
  const cutoff = Date.now() - windowMs
  return fallbackEvents.filter((e) => e.primary === provider && e.at >= cutoff).length
}

function getLatestFailure(provider: ProviderId): FailureEntry | undefined {
  return recentFailures.filter((e) => e.provider === provider).sort((a, b) => b.at - a.at)[0]
}

function getLatencyStats(provider: ProviderId): {
  lastLatencyMs?: number
  avgLatencyMs?: number
  trend: 'unknown' | 'stable' | 'elevated' | 'critical'
} {
  const samples = latencyByProvider[provider] || []
  if (samples.length === 0) {
    return { trend: 'unknown' }
  }

  const lastLatencyMs = samples[samples.length - 1]
  const recent = samples.slice(-5)
  const avgLatencyMs = Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length)

  let trend: 'unknown' | 'stable' | 'elevated' | 'critical' = 'stable'
  if (avgLatencyMs >= 3500) trend = 'critical'
  else if (avgLatencyMs >= 1800) trend = 'elevated'

  return { lastLatencyMs, avgLatencyMs, trend }
}

interface ProviderHealthEntryInput {
  role: string
  available: boolean
  healthy?: boolean
  error?: string
}

interface ClearSportsHealthInput {
  configured: boolean
  available: boolean
  latencyMs?: number
  error?: string
}

/** Build safe diagnostics payload for admin (no secrets, no stack traces). */
export function getProviderDiagnostics(input: {
  healthEntries: ProviderHealthEntryInput[]
  providerStatus: ProviderStatus
  clearSportsHealth: ClearSportsHealthInput
}): ProviderDiagnosticsPayload {
  const { healthEntries, providerStatus, clearSportsHealth } = input
  const windowMs = 3600_000
  const entries: ProviderDiagnosticsEntry[] = []

  const aiProviders: Array<{ runtimeId: Extract<ProviderId, 'openai' | 'deepseek' | 'grok'>; configured: boolean }> = [
    { runtimeId: 'openai', configured: providerStatus.openai },
    { runtimeId: 'deepseek', configured: providerStatus.deepseek },
    { runtimeId: 'grok', configured: providerStatus.xai },
  ]

  for (const { runtimeId, configured } of aiProviders) {
    const health = healthEntries.find((entry) => entry.role === runtimeId)
    const probePresent = Boolean(health)
    const healthy = health?.healthy
    const available = configured && (probePresent ? healthy !== false : false)
    const failureCount = getRecentFailureCount(runtimeId, windowMs)
    const fallbackCount = getFallbackUsedCount(runtimeId, windowMs)
    const lastFailure = getLatestFailure(runtimeId)
    const latency = getLatencyStats(runtimeId)
    const fallbackActive = fallbackCount > 0
    const degradedReasons: string[] = []
    if (failureCount >= 3) degradedReasons.push('recent_failures')
    if (latency.trend === 'elevated') degradedReasons.push('latency_elevated')
    if (latency.trend === 'critical') degradedReasons.push('latency_critical')
    if (healthy === false) degradedReasons.push('health_check_failed')
    const degraded = available && degradedReasons.length > 0

    let state: ProviderStatusState = 'unavailable'
    if (!configured) state = 'unavailable'
    else if (!probePresent) state = 'configured'
    else if (!available) state = 'unavailable'
    else if (fallbackActive) state = 'fallback_active'
    else if (degraded) state = 'degraded'
    else state = 'available'

    entries.push({
      id: toPublicProviderId(runtimeId),
      state,
      configured,
      available,
      healthy,
      error: health?.error ? sanitizeProviderError(health.error) : undefined,
      fallbackActive,
      degradedReasons,
      lastLatencyMs: latency.lastLatencyMs,
      avgLatencyMs: latency.avgLatencyMs,
      latencyTrend: latency.trend,
      recentFailureCount: failureCount,
      lastFailureAt: lastFailure?.at,
      fallbackUsedCount: fallbackCount,
    })
  }

  const clearsportsConfigured = providerStatus.clearsports || clearSportsHealth.configured
  const clearsportsProbePresent = clearSportsHealth != null
  const clearsportsAvailable = clearsportsConfigured && clearSportsHealth.available
  const clearSportsFailureCount = getRecentFailureCount('clearsports', windowMs)
  const clearSportsLastFailure = getLatestFailure('clearsports')
  const clearSportsLatency = getLatencyStats('clearsports')
  const clearSportsDegradedReasons: string[] = []
  if (clearSportsFailureCount >= 3) clearSportsDegradedReasons.push('recent_failures')
  if (clearSportsLatency.trend === 'elevated') clearSportsDegradedReasons.push('latency_elevated')
  if (clearSportsLatency.trend === 'critical') clearSportsDegradedReasons.push('latency_critical')
  const clearSportsDegraded = clearsportsAvailable && clearSportsDegradedReasons.length > 0

  let clearSportsState: ProviderStatusState = 'unavailable'
  if (!clearsportsConfigured) clearSportsState = 'unavailable'
  else if (!clearsportsProbePresent) clearSportsState = 'configured'
  else if (!clearsportsAvailable) clearSportsState = 'unavailable'
  else if (clearSportsDegraded) clearSportsState = 'degraded'
  else clearSportsState = 'available'

  entries.push({
    id: 'clearsports',
    state: clearSportsState,
    configured: clearsportsConfigured,
    available: clearsportsAvailable,
    healthy: clearsportsProbePresent ? clearSportsHealth.available : undefined,
    error: clearSportsHealth.error
      ? sanitizeProviderError(clearSportsHealth.error)
      : clearSportsLastFailure?.error,
    fallbackActive: false,
    degradedReasons: clearSportsDegradedReasons,
    lastLatencyMs: clearSportsLatency.lastLatencyMs ?? clearSportsHealth.latencyMs,
    avgLatencyMs: clearSportsLatency.avgLatencyMs,
    latencyTrend: clearSportsLatency.trend,
    recentFailureCount: clearSportsFailureCount,
    lastFailureAt: clearSportsLastFailure?.at,
    fallbackUsedCount: 0,
  })

  const failureSummary = recentFailures
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, 30)
    .map((e) => ({ provider: toPublicProviderId(e.provider), at: e.at, error: e.error }))

  const fallbackSummary = fallbackEvents
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, 30)
    .map((e) => ({ at: e.at, primary: toPublicProviderId(e.primary), used: toPublicProviderId(e.used) }))

  const latencyTrend: Record<ProviderPublicId, number[]> = {
    openai: [...(latencyByProvider.openai || [])],
    deepseek: [...(latencyByProvider.deepseek || [])],
    xai: [...(latencyByProvider.grok || [])],
    clearsports: [...(latencyByProvider.clearsports || [])],
  }

  const recentDegradedModeEvents = degradedModeEvents
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, 20)
    .map((event) => ({ at: event.at, reason: event.reason }))

  return {
    providers: entries,
    recentFailures: failureSummary,
    fallbackEvents: fallbackSummary,
    degradedMode: {
      active: recentDegradedModeEvents.length > 0,
      recentEvents: recentDegradedModeEvents,
    },
    latencyTrend,
    generatedAt: Date.now(),
  }
}
