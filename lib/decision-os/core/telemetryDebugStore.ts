import type { DecisionTelemetryEvent } from './telemetry'

const DEFAULT_LIMIT = 500

export interface DecisionTelemetryDebugFilters {
  event?: string | null
  decisionType?: string | null
  userId?: string | null
  leagueId?: string | null
  decisionId?: string | null
  limit?: number | null
}

export interface DecisionTelemetryDebugEvent extends DecisionTelemetryEvent {
  userId: string | null
  leagueId: string | null
}

const events: DecisionTelemetryDebugEvent[] = []

function normalizeString(value: unknown, lowercase = false): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return null
  return lowercase ? normalized.toLowerCase() : normalized
}

function toLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(2000, Math.floor(parsed)))
}

function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.DECISION_OS_DEBUG_TELEMETRY ?? '').trim().toLowerCase() === 'true'
}

export function isDecisionTelemetryDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env)
}

export function clearDecisionTelemetryDebugEvents(): void {
  events.length = 0
}

export function recordDecisionTelemetryDebugEvent(
  event: DecisionTelemetryEvent,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isEnabled(env)) return

  const payload: DecisionTelemetryDebugEvent = {
    ...event,
    userId: normalizeString(event.flags?.userId),
    leagueId: normalizeString(event.flags?.leagueId),
  }

  events.unshift(payload)
  const max = toLimit(env.DECISION_OS_DEBUG_TELEMETRY_LIMIT)
  if (events.length > max) {
    events.length = max
  }
}

export function listDecisionTelemetryDebugEvents(
  filters: DecisionTelemetryDebugFilters = {},
): DecisionTelemetryDebugEvent[] {
  const eventName = normalizeString(filters.event)
  const decisionType = normalizeString(filters.decisionType)
  const userId = normalizeString(filters.userId)
  const leagueId = normalizeString(filters.leagueId)
  const decisionId = normalizeString(filters.decisionId)
  const limit = toLimit(filters.limit ?? DEFAULT_LIMIT)

  return events
    .filter((entry) => {
      if (eventName && entry.event !== eventName) return false
      if (decisionType && entry.decision_type !== decisionType) return false
      if (decisionId && entry.decision_id !== decisionId) return false
      if (userId && normalizeString(entry.userId) !== userId) return false
      if (leagueId && normalizeString(entry.leagueId) !== leagueId) return false
      return true
    })
    .slice(0, limit)
}
