/**
 * Conduct strikes — pure. The original league's rule: "first violation is a warning, second is
 * removal from the game". A strike is an audit row (`SurvivorAuditEntry`, category `conduct`) and a
 * withdrawal is another, so the history is append-only and nothing needs a new table.
 */
import type { SurvivorGovernanceSettings } from './survivorGovernanceSettings'

export const CONDUCT_STRIKE_ISSUED = 'conduct_strike_issued'
export const CONDUCT_STRIKE_REVOKED = 'conduct_strike_revoked'
export const CONDUCT_STRIKE_REASON_MAX = 280

export interface ConductAuditRow {
  id: string
  action: string
  targetUserId: string | null
  week: number | null
  createdAt: Date | string
  data: unknown
}

export interface ConductStrike {
  id: string
  userId: string
  reason: string
  week: number | null
  issuedAt: string
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Strikes still standing (issued and not withdrawn), oldest first, optionally for one castaway. */
export function activeConductStrikes(rows: readonly ConductAuditRow[], userId?: string): ConductStrike[] {
  const revoked = new Set(rows.filter((r) => r.action === CONDUCT_STRIKE_REVOKED).map((r) => String(rec(r.data).strikeId ?? '')))
  return rows
    .filter((r) => r.action === CONDUCT_STRIKE_ISSUED && r.targetUserId && !revoked.has(r.id) && (!userId || r.targetUserId === userId))
    .map((r) => ({
      id: r.id,
      userId: r.targetUserId!,
      reason: String(rec(r.data).reason ?? ''),
      week: r.week,
      issuedAt: new Date(r.createdAt).toISOString(),
    }))
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
}

export function validateStrikeReason(reason: string): string | null {
  const clean = reason.trim()
  if (clean.length < 3) return 'Give a reason the castaway will see (at least 3 characters).'
  if (clean.length > CONDUCT_STRIKE_REASON_MAX) return `Keep the reason under ${CONDUCT_STRIKE_REASON_MAX} characters.`
  return null
}

/** What a strike count means under the league's policy. */
export function conductStrikeOutcome(activeCount: number, settings: Pick<SurvivorGovernanceSettings, 'strikeLimit' | 'strikeAutoRemove'>): { limitReached: boolean; removeNow: boolean; remaining: number } {
  const limitReached = activeCount >= settings.strikeLimit
  return { limitReached, removeNow: limitReached && settings.strikeAutoRemove, remaining: Math.max(0, settings.strikeLimit - activeCount) }
}
