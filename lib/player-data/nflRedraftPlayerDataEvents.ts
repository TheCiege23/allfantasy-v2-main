import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import type { NflRedraftCanonicalPlayer, NflRedraftFallback } from '@/lib/player-data/nflRedraftCanonicalPlayer'

export type BuildNflRedraftPlayerDataEventsInput = {
  leagueId: string
  player: NflRedraftCanonicalPlayer
  previous?: NflRedraftCanonicalPlayer | null
  actorUserId?: string | null
  occurredAtIso?: string
}

function event(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEvent['type']
  actorUserId?: string | null
  occurredAtIso: string
  payload: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return {
    leagueId: input.leagueId,
    type: input.type,
    occurredAtIso: input.occurredAtIso,
    actorUserId: input.actorUserId ?? null,
    sourceEventType: input.type,
    payload: input.payload,
  }
}

function fallbackPayload(player: NflRedraftCanonicalPlayer, fallback: NflRedraftFallback): Record<string, unknown> {
  return {
    playerId: player.playerId,
    playerName: player.displayName,
    field: fallback.field,
    reason: fallback.reason,
    source: fallback.source,
    modelVersion: player.modelVersion,
  }
}

export function buildNflRedraftPlayerDataEvents(
  input: BuildNflRedraftPlayerDataEventsInput,
): CanonicalLeagueRuntimeEvent[] {
  const occurredAtIso = input.occurredAtIso ?? new Date().toISOString()
  const player = input.player
  const previous = input.previous ?? null
  const events: CanonicalLeagueRuntimeEvent[] = [
    event({
      leagueId: input.leagueId,
      type: 'player.data.refreshed',
      occurredAtIso,
      actorUserId: input.actorUserId,
      payload: {
        playerId: player.playerId,
        playerName: player.displayName,
        team: player.teamAbbr,
        position: player.fantasyPosition,
        lastUpdatedAt: player.lastUpdatedAt,
        modelVersion: player.modelVersion,
      },
    }),
  ]

  if (previous) {
    if (previous.activeStatus !== player.activeStatus) {
      events.push(
        event({
          leagueId: input.leagueId,
          type: 'player.status.changed',
          occurredAtIso,
          actorUserId: input.actorUserId,
          payload: {
            playerId: player.playerId,
            from: previous.activeStatus,
            to: player.activeStatus,
          },
        }),
      )
    }
    if (previous.injury.designation !== player.injury.designation) {
      events.push(
        event({
          leagueId: input.leagueId,
          type: 'player.injury.status_changed',
          occurredAtIso,
          actorUserId: input.actorUserId,
          payload: {
            playerId: player.playerId,
            from: previous.injury.designation,
            to: player.injury.designation,
            source: player.injury.source,
          },
        }),
      )
    }
    if (previous.currentProjection.weeklyProjectedPoints !== player.currentProjection.weeklyProjectedPoints) {
      events.push(
        event({
          leagueId: input.leagueId,
          type: 'player.projection.updated',
          occurredAtIso,
          actorUserId: input.actorUserId,
          payload: {
            playerId: player.playerId,
            from: previous.currentProjection.weeklyProjectedPoints,
            to: player.currentProjection.weeklyProjectedPoints,
            source: player.currentProjection.source,
          },
        }),
      )
    }
    if (previous.teamAbbr !== player.teamAbbr) {
      events.push(
        event({
          leagueId: input.leagueId,
          type: 'player.team.changed',
          occurredAtIso,
          actorUserId: input.actorUserId,
          payload: {
            playerId: player.playerId,
            from: previous.teamAbbr,
            to: player.teamAbbr,
          },
        }),
      )
    }
  }

  for (const fallback of player.fallbacks) {
    events.push(
      event({
        leagueId: input.leagueId,
        type: 'player.data.fallback_used',
        occurredAtIso,
        actorUserId: input.actorUserId,
        payload: fallbackPayload(player, fallback),
      }),
    )
  }

  return events
}
