import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { optimizeLineupDeterministic } from '@/lib/lineup-optimizer-engine/LineupOptimizerEngine'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'

export type BestBallDataStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'

export type BestBallLineupResult = {
  /**
   * AVAILABLE — every roster player has a real stat row for this week.
   * PARTIAL — some players are missing stats; the lineup was optimized over the rest.
   * UNAVAILABLE — no player has stats. starterIds is EMPTY so callers fall back to the
   *   roster's actual starters instead of an arbitrary all-zero "optimized" lineup.
   */
  status: BestBallDataStatus
  starterIds: string[]
  /** null when no statistics exist — missing data is never presented as a real 0.0. */
  totalProjectedPoints: number | null
  missingPlayerIds: string[]
  notes: string[]
}

export async function selectBestBallLineupForRoster(input: {
  leagueId: string
  leagueSport: LeagueSport
  season: number
  weekOrRound: number
  rosterPlayerIds: string[]
  formatType?: string | null
}): Promise<BestBallLineupResult> {
  if (input.rosterPlayerIds.length === 0) {
    return { status: 'UNAVAILABLE', starterIds: [], totalProjectedPoints: null, missingPlayerIds: [], notes: ['Roster is empty.'] }
  }

  const [template, stats, players] = await Promise.all([
    getRosterTemplateForLeague(input.leagueSport, input.formatType ?? undefined, input.leagueId),
    prisma.playerGameStat.findMany({
      where: {
        sportType: input.leagueSport,
        season: input.season,
        weekOrRound: input.weekOrRound,
        playerId: { in: input.rosterPlayerIds },
      },
      select: {
        playerId: true,
        fantasyPoints: true,
      },
    }),
    prisma.sportsPlayer.findMany({
      where: {
        sport: input.leagueSport,
        OR: [
          { externalId: { in: input.rosterPlayerIds } },
          { sleeperId: { in: input.rosterPlayerIds } },
        ],
      },
      select: {
        externalId: true,
        sleeperId: true,
        name: true,
        position: true,
        team: true,
      },
    }),
  ])

  // Presence of a stat row is the availability signal: a row with fantasyPoints 0 is a REAL
  // zero-point performance; the absence of any row is missing data. The old `?? 0` fallback
  // conflated the two, so an empty PlayerGameStat table produced an arbitrary "optimized"
  // lineup with every player valued 0.0 and success-shaped notes.
  const pointsByPlayerId = new Map<string, number>()
  for (const row of stats) {
    pointsByPlayerId.set(row.playerId, (pointsByPlayerId.get(row.playerId) ?? 0) + Number(row.fantasyPoints ?? 0))
  }

  const playersWithStats = input.rosterPlayerIds.filter((id) => pointsByPlayerId.has(id))
  const missingPlayerIds = input.rosterPlayerIds.filter((id) => !pointsByPlayerId.has(id))

  if (playersWithStats.length === 0) {
    return {
      status: 'UNAVAILABLE',
      starterIds: [],
      totalProjectedPoints: null,
      missingPlayerIds,
      notes: [
        `Best Ball optimization is unavailable: no player game statistics exist for ${input.leagueSport} season ${input.season} week ${input.weekOrRound}.`,
      ],
    }
  }

  const playerIndex = new Map<string, (typeof players)[number]>()
  for (const player of players) {
    playerIndex.set(player.externalId, player)
    if (player.sleeperId) playerIndex.set(player.sleeperId, player)
  }

  // Optimize only over players with real statistics — a missing player must never enter the
  // lineup ranked as a legitimate 0.0.
  const optimizerResult = optimizeLineupDeterministic({
    sport: input.leagueSport,
    players: playersWithStats.map((playerId) => {
      const player = playerIndex.get(playerId)
      return {
        id: playerId,
        name: player?.name ?? `Player ${playerId}`,
        positions: [player?.position ?? 'UTIL'],
        projectedPoints: pointsByPlayerId.get(playerId) ?? 0,
        team: player?.team ?? undefined,
      }
    }),
    slots: template.slots
      .flatMap((slot) =>
        Array.from({ length: slot.starterCount }, (_, index) => ({
          id: `${slot.slotName}-${index + 1}`,
          code: slot.slotName,
          label: slot.slotName,
          allowedPositions: slot.allowedPositions,
        }))
      ),
  })

  // A partial player pool can leave required slots genuinely unfillable — that is an
  // UNAVAILABLE result, not a "successful" short lineup.
  if (optimizerResult.unfilledSlots.length > 0 && missingPlayerIds.length > 0) {
    return {
      status: 'UNAVAILABLE',
      starterIds: [],
      totalProjectedPoints: null,
      missingPlayerIds,
      notes: [
        `Best Ball optimization is unavailable: statistics are missing for ${missingPlayerIds.length} of ${input.rosterPlayerIds.length} rostered players and a valid lineup cannot be filled from the rest.`,
      ],
    }
  }

  const status: BestBallDataStatus = missingPlayerIds.length > 0 ? 'PARTIAL' : 'AVAILABLE'
  const notes = [...optimizerResult.deterministicNotes]
  if (status === 'PARTIAL') {
    notes.unshift(
      `Best Ball results are partial: statistics are missing for ${missingPlayerIds.length} of ${input.rosterPlayerIds.length} rostered players; they were excluded rather than counted as 0.0.`,
    )
  }

  return {
    status,
    starterIds: optimizerResult.starters.map((starter) => starter.playerId),
    totalProjectedPoints: optimizerResult.totalProjectedPoints,
    missingPlayerIds,
    notes,
  }
}
