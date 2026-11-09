import type { LeagueSport } from '@prisma/client'
import { computeBestBallLineup, resolveBestBallSlots } from '@/lib/bestball/productionLineup'
import { computeRosterScoreForWeek, weekKeyedStatsUnavailableReason } from '@/lib/multi-sport/MultiSportMatchupScoringService'
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
  /** playerId -> the position each optimized player was seated at in THIS selection. Empty when no lineup. */
  positionsUsed?: Record<string, string>
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
  /**
   * The format the week is SCORED with — the same value `scoreLeagueWeek` passes to
   * `computeRosterScoreForWeek`, so each player is valued here exactly as the score will count him.
   */
  formatType?: string | null
  /**
   * `League.settings`. The lineup is seated over `buildBestBallSlots(sport, leagueSettings)` — exactly the
   * seats matchup scoring uses. Omitted, the sport's `best_ball` roster template is used.
   */
  leagueSettings?: unknown
  /**
   * A LOCKED week's positions, recorded by the write that locked it (`TeamPerformance.data.sealedPositions`,
   * see `scoreLeagueWeek`). A player listed here is seated at that position, never at today's: there is no
   * position history in the schema, so a TE re-listed as a WR would otherwise re-seat every locked week on
   * rescore. Players not listed (and every open week) use the current position.
   */
  sealedPositions?: Readonly<Record<string, string | null>> | null
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

  /*
   * 🛑 EACH PLAYER IS VALUED BY THE PIPELINE THAT SCORES THE WEEK, NOT BY `playerGameStat.fantasyPoints`.
   *
   * This read `fantasyPoints` — the stat row's own number — while `scoreLeagueWeek` then scored the
   * seated lineup with `computeRosterScoreForWeek`, which recomputes every row from `normalizedStatMap`
   * under the LEAGUE's scoring rules. Two numbers for one player: the lineup that was best by the first
   * was scored by the second, so a league whose rules rank two players the other way round was handed
   * the worse lineup (a PPR-heavy row outranking a league that pays nothing per catch). The whole roster
   * is now valued by that same call, with the same arguments the score uses, and seated on its
   * `byPlayerId` — the selection and the score cannot disagree about who is better.
   */
  const [scored, players] = await Promise.all([
    computeRosterScoreForWeek({
      leagueId: input.leagueId,
      leagueSport: input.leagueSport,
      season: input.season,
      weekOrRound: input.weekOrRound,
      rosterPlayerIds: input.rosterPlayerIds,
      starterPlayerIds: input.rosterPlayerIds,
      formatType: input.formatType ?? undefined,
    }),
    /*
     * 🛑 NOT `externalId IN ids OR sleeperId IN ids`. A roster's ids are in ONE space, fixed by the
     * platform, and `externalId` is several: a Sleeper id there finds Rolling Insights' player of the
     * same number, a stranger (Sleeper 9228 is Bryce Young; RI 9228 is an offensive tackle). Here that
     * stranger's POSITION decided slot eligibility, so a quarterback could be optimised as a lineman.
     */
    findSportsPlayersForLeague(input.leagueSport, input.platform, input.rosterPlayerIds),
  ])

  // Presence of a stat row is the availability signal: a row worth 0 is a REAL zero-point
  // performance; the absence of any row is missing data. The old `?? 0` fallback conflated the two,
  // so an empty PlayerGameStat table produced an arbitrary "optimized" lineup with every player
  // valued 0.0 and success-shaped notes. `byPlayerId` holds exactly the players with a row.
  const pointsByPlayerId = new Map<string, number>(
    scored.status === 'UNAVAILABLE' ? [] : Object.entries(scored.byPlayerId),
  )

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
        position: input.sealedPositions?.[playerId] ?? player?.position ?? 'UTIL',
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

  const positionsUsed: Record<string, string> = {}
  for (const playerId of playersWithStats) {
    positionsUsed[playerId] = input.sealedPositions?.[playerId] ?? playerIndex.get(playerId)?.position ?? 'UTIL'
  }

  return {
    status,
    starterIds: lineup.assignments.map((a) => a.playerId),
    totalProjectedPoints: lineup.total,
    missingPlayerIds,
    notes,
    positionsUsed,
  }
}
