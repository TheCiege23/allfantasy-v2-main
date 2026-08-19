import { isDevAdminUserId } from '@/lib/dev-admin/access'
import type { DecisionTelemetryDebugFilters } from './telemetryDebugStore'
import { isDecisionTelemetryDebugEnabled } from './telemetryDebugStore'

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? normalized : null
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function isStagingLikeValue(value: string | null): boolean {
  if (!value) return false
  return ['preview', 'staging', 'stage', 'development', 'dev', 'test'].includes(
    value.toLowerCase(),
  )
}

export function isDecisionTelemetryDebugSurfaceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isDecisionTelemetryDebugEnabled(env)) return false

  if (String(env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') {
    return true
  }

  if (isStagingLikeValue(normalizeString(env.VERCEL_ENV))) return true
  if (isStagingLikeValue(normalizeString(env.APP_ENV))) return true
  if (isStagingLikeValue(normalizeString(env.AF_ENV))) return true
  if (isStagingLikeValue(normalizeString(env.DEPLOY_ENV))) return true

  return false
}

export function canAccessDecisionTelemetryDebugSurface(
  userId: string | null | undefined,
): boolean {
  return isDevAdminUserId(userId)
}

export function normalizeDecisionTelemetryDebugFilters(input: {
  event?: unknown
  decisionType?: unknown
  userId?: unknown
  leagueId?: unknown
  decisionId?: unknown
  limit?: unknown
}): DecisionTelemetryDebugFilters {
  return {
    event: normalizeString(input.event),
    decisionType: normalizeString(input.decisionType),
    userId: normalizeString(input.userId),
    leagueId: normalizeString(input.leagueId),
    decisionId: normalizeString(input.decisionId),
    limit: normalizeNumber(input.limit),
  }
}
