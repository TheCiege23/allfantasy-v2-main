/**
 * Observability for draft enrichment identity mismatches (deterministic; AI-ready later).
 * Powers future AI/admin review of bad IDs — failures never block draft resolution.
 */

import { prisma } from '@/lib/prisma'

export type PlayerMismatchReason =
  | 'NO_SPORT_PLAYER_RECORD_MATCH'
  | 'AMBIGUOUS_LOOSE_MATCH_SKIPPED'
  | 'STRICT_TEAM_MISMATCH'
  | 'LOW_CONFIDENCE_MATCH'
  | 'ID_DRIFT_STRICT_MATCH_USED'
  | 'CROSS_SPORT_BLOCKED'
  | 'INVALID_PLAYER_ID'

export type PlayerMismatchLogPayload = {
  leagueId?: string | null
  sport: string
  poolPlayerId?: string | null
  poolExternalId?: string | null
  sportsPlayerRecordId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  attemptedMatchType?: string | null
  confidence?: number | null
  reason: PlayerMismatchReason
  details?: Record<string, unknown> | null
}

function safeJson(payload: PlayerMismatchLogPayload) {
  return JSON.stringify({
    ...payload,
    createdAt: new Date().toISOString(),
  })
}

/**
 * Persist mismatch event when DB table exists; otherwise structured stderr (dev) / no-op.
 */
export async function logPlayerMismatchEvent(payload: PlayerMismatchLogPayload): Promise<void> {
  try {
    await prisma.playerIdentityMismatchLog.create({
      data: {
        leagueId: payload.leagueId ?? null,
        sport: payload.sport,
        poolPlayerId: payload.poolPlayerId ?? null,
        poolExternalId: payload.poolExternalId ?? null,
        sportsPlayerRecordId: payload.sportsPlayerRecordId ?? null,
        playerName: payload.playerName ?? null,
        position: payload.position ?? null,
        team: payload.team ?? null,
        attemptedMatchType: payload.attemptedMatchType ?? null,
        confidence:
          payload.confidence != null && Number.isFinite(payload.confidence)
            ? payload.confidence
            : null,
        reason: payload.reason,
        details: payload.details ?? undefined,
      },
    })
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[playerMismatchLogger]', safeJson(payload), e)
    }
  }
}

/** Fire-and-forget — never await in hot paths if unnecessary */
export function logPlayerMismatchEventVoid(payload: PlayerMismatchLogPayload): void {
  void logPlayerMismatchEvent(payload)
}

export function summarizePlayerMismatchForAi(event: PlayerMismatchLogPayload): string {
  const parts = [
    `reason=${event.reason}`,
    `sport=${event.sport}`,
    event.leagueId ? `league=${event.leagueId}` : null,
    event.playerName ? `player=${event.playerName}` : null,
    event.position ? `pos=${event.position}` : null,
    event.team != null ? `team=${event.team}` : null,
    event.poolExternalId ? `poolExternalId=${event.poolExternalId}` : null,
    event.poolPlayerId ? `poolPlayerId=${event.poolPlayerId}` : null,
    event.sportsPlayerRecordId ? `sprId=${event.sportsPlayerRecordId}` : null,
    event.attemptedMatchType ? `attempted=${event.attemptedMatchType}` : null,
    event.confidence != null ? `confidence=${event.confidence}` : null,
  ].filter(Boolean)
  return `Player identity mismatch: ${parts.join('; ')}. Review IDs and team normalization before merging enrichment.`
}
