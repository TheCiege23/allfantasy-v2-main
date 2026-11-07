import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeBestBallLineup, resolveBestBallSlots } from '@/lib/bestball/productionLineup'
import { weekKeyedStatsUnavailableReason } from '@/lib/multi-sport/MultiSportMatchupScoringService'
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'

export type BestBallDataStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'UNRESOLVED'

export type BestBallLineupResult = {
  /**
   * AVAILABLE — every roster player has a real stat row for this week.
   * PARTIAL — some players are missing stats; the lineup was optimized over the rest.
   * UNAVAILABLE — no player has stats. starterIds is EMPTY and there is no best ball score.
   * UNRESOLVED — the league's lineup slots could not be resolved, so no lineup exists to score.
   *   starterIds is EMPTY.
   *
   * 🛑 EMPTY starterIds MEANS "NO BEST BALL SCORE", NEVER "SCORE SOMETHING ELSE". The scoring worker used
   * to fall back to the stale draft starters, or to the WHOLE ROSTER when there were none — a best ball
   * total that was the sum of every rostered player (audit 2026-11-06, finding #17). `scoreLeagueWeek`
   * now reports such a team unavailable and writes nothing for the week.
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
  /**
   * `League.platform` — which id space `rosterPlayerIds` are in. Required because the player lookup
   * cannot be answered without it (see `findSportsPlayersForLeague`); `null` names nobody.
   */
  platform: string | null
  formatType?: string | null
  /**
   * `League.settings`. The lineup is seated over `buildBestBallSlots(sport, leagueSettings)` — exactly the
   * seats matchup scoring uses. Omitted, the sport's `best_ball` roster template is used.
   */
  leagueSettings?: unknown
}): Promise<BestBallLineupResult> {
  if (input.rosterPlayerIds.length === 0) {
    return { status: 'UNAVAILABLE', starterIds: [], totalProjectedPoints: null, missingPlayerIds: [], notes: ['Roster is empty.'] }
  }

  // A sport or week `player_game_stats` cannot answer by `weekOrRound` — the daily sports, or
  // week 0, which would match a daily sport's WHOLE season. See weekKeyedStatsUnavailableReason.
  const refused = weekKeyedStatsUnavailableReason(input.leagueSport, input.weekOrRound)
  if (refused) {
    return {
      status: 'UNAVAILABLE',
      starterIds: [],
      totalProjectedPoints: null,
      missingPlayerIds: [...input.rosterPlayerIds],
      notes: [`Best Ball optimization is unavailable: ${refused}`],
    }
  }

  // The seats production scoring seats for this league (`lib/bestball/productionLineup.ts`), never a
  // second template: the old `getRosterTemplateForLeague` source could disagree with the matchup.
  const slots = resolveBestBallSlots(String(input.leagueSport), input.leagueSettings)
  if (!slots) {
    return {
      status: 'UNRESOLVED',
      starterIds: [],
      totalProjectedPoints: null,
      missingPlayerIds: [],
      notes: [`Best Ball lineup slots could not be resolved for ${input.leagueSport}; no lineup was scored.`],
    }
  }

  const [stats, players] = await Promise.all([
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
    /*
     * 🛑 NOT `externalId IN ids OR sleeperId IN ids`. A roster's ids are in ONE space, fixed by the
     * platform, and `externalId` is several: a Sleeper id there finds Rolling Insights' player of the
     * same number, a stranger (Sleeper 9228 is Bryce Young; RI 9228 is an offensive tackle). Here that
     * stranger's POSITION decided slot eligibility, so a quarterback could be optimised as a lineman.
     */
    findSportsPlayersForLeague(input.leagueSport, input.platform, input.rosterPlayerIds),
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

  // Already keyed by the roster id that asked — never re-keyed by the row's own `externalId`.
  const playerIndex = players

  // Optimize only over players with real statistics — a missing player must never enter the
  // lineup ranked as a legitimate 0.0. Seated exactly as production seats it (`computeOptimalLineup`).
  const lineup = computeBestBallLineup({
    slots,
    players: playersWithStats.map((playerId) => {
      const player = playerIndex.get(playerId)
      return {
        playerId,
        playerName: player?.name ?? `Player ${playerId}`,
        position: player?.position ?? 'UTIL',
        points: pointsByPlayerId.get(playerId) ?? 0,
      }
    }),
  })

  // A partial player pool can leave required slots genuinely unfillable — that is an
  // UNAVAILABLE result, not a "successful" short lineup.
  if (lineup.unfilledSlots.length > 0 && missingPlayerIds.length > 0) {
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
  const notes = [
    `Best Ball lineup seated exactly (${lineup.provenance.algorithm}): ${lineup.total.toFixed(1)} points from ${lineup.assignments.length} of ${lineup.provenance.seatCount} seats.`,
    ...lineup.unfilledSlots.map((u) => `${u.slot} #${u.seat} unfilled — no eligible player.`),
  ]
  if (status === 'PARTIAL') {
    notes.unshift(
      `Best Ball results are partial: statistics are missing for ${missingPlayerIds.length} of ${input.rosterPlayerIds.length} rostered players; they were excluded rather than counted as 0.0.`,
    )
  }

  return {
    status,
    starterIds: lineup.assignments.map((a) => a.playerId),
    totalProjectedPoints: lineup.total,
    missingPlayerIds,
    notes,
  }
}
