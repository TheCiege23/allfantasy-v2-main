import { persistDynastySeason } from '@/lib/dynasty-import/normalize-historical'
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { prisma } from '@/lib/prisma'
import {
  getLeagueMatchups,
  getLeagueRosters,
  getLosersBracket,
  getPlayoffBracket,
  type SleeperLeague,
  type SleeperMatchup,
  type SleeperPlayoffBracket,
  type SleeperRoster,
} from '@/lib/sleeper-client'
import { getSleeperHistoricalLeagueChain } from './SleeperHistoricalLeagueChain'

const MAX_SLEEPER_MATCHUP_WEEKS = 18

interface PersistedMatchupFactRow {
  leagueId: string
  sport: string
  weekOrPeriod: number
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
  season: number
}

interface PlayoffFinishInfo {
  isChampion: boolean
  isRunnerUp: boolean
  playoffWins: number
  playoffLosses: number
  bestFinish: number
  madePlayoffs: boolean
}

export interface SleeperHistoricalMatchupSyncSummary {
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  reason?: string
  seasonsProcessed?: number
  matchupFactsPersisted?: number
  playoffSeasonsWithBracket?: number
  weeksWithMatchups?: number
  error?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown error'
}

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toPlainBracket(bracket: SleeperPlayoffBracket[]): Array<Record<string, number | null>> {
  return bracket.map((matchup) => ({
    round: matchup.r ?? null,
    matchup: matchup.m ?? null,
    team1: matchup.t1 ?? null,
    team2: matchup.t2 ?? null,
    winner: matchup.w ?? null,
    loser: matchup.l ?? null,
  }))
}

function extractPlayoffParticipants(bracket: SleeperPlayoffBracket[]): Set<number> {
  const participants = new Set<number>()
  for (const matchup of bracket) {
    if (safeNumber(matchup.t1) > 0) participants.add(safeNumber(matchup.t1))
    if (safeNumber(matchup.t2) > 0) participants.add(safeNumber(matchup.t2))
  }
  return participants
}

function computePlayoffSeedFromBracket(
  rosterId: number,
  bracket: SleeperPlayoffBracket[]
): number | null {
  if (!bracket.length) return null

  const roundOneMatchups = bracket
    .filter((matchup) => safeNumber(matchup.r) === 1)
    .sort((left, right) => safeNumber(left.m) - safeNumber(right.m))

  for (let index = 0; index < roundOneMatchups.length; index += 1) {
    const matchup = roundOneMatchups[index]
    const teamOne = safeNumber(matchup.t1)
    const teamTwo = safeNumber(matchup.t2)

    if (teamOne === rosterId) {
      return index + 1
    }

    if (teamTwo === rosterId) {
      return roundOneMatchups.length * 2 - index
    }
  }

  const roundTwoMatchups = bracket.filter((matchup) => safeNumber(matchup.r) === 2)
  for (const matchup of roundTwoMatchups) {
    const teamOne = safeNumber(matchup.t1)
    const teamTwo = safeNumber(matchup.t2)
    if (teamOne === rosterId) return 1
    if (teamTwo === rosterId) return 2
  }

  return null
}

function getPlayoffSeedForRoster(
  roster: SleeperRoster,
  winnersBracket: SleeperPlayoffBracket[]
): number | null {
  const directSeed = roster.settings?.playoff_seed ?? roster.settings?.seed ?? null
  if (typeof directSeed === 'number' && Number.isFinite(directSeed) && directSeed > 0) {
    return directSeed
  }

  return computePlayoffSeedFromBracket(roster.roster_id, winnersBracket)
}

function analyzePlayoffBracket(
  bracket: SleeperPlayoffBracket[],
  rosterIds: number[]
): Map<number, PlayoffFinishInfo> {
  const results = new Map<number, PlayoffFinishInfo>()

  for (const rosterId of rosterIds) {
    results.set(rosterId, {
      isChampion: false,
      isRunnerUp: false,
      playoffWins: 0,
      playoffLosses: 0,
      bestFinish: 999,
      madePlayoffs: false,
    })
  }

  if (!bracket.length) {
    return results
  }

  const maxRound = Math.max(...bracket.map((matchup) => safeNumber(matchup.r)))
  for (const matchup of bracket) {
    const round = safeNumber(matchup.r)
    const teamOne = safeNumber(matchup.t1)
    const teamTwo = safeNumber(matchup.t2)
    const winner = safeNumber(matchup.w)
    const loser = safeNumber(matchup.l)

    if (teamOne > 0) {
      const info = results.get(teamOne)
      if (info) info.madePlayoffs = true
    }
    if (teamTwo > 0) {
      const info = results.get(teamTwo)
      if (info) info.madePlayoffs = true
    }

    if (winner > 0) {
      const winnerInfo = results.get(winner)
      if (winnerInfo) {
        winnerInfo.playoffWins += 1
        if (round === maxRound) {
          winnerInfo.isChampion = true
          winnerInfo.bestFinish = 1
        }
      }
    }

    if (loser > 0) {
      const loserInfo = results.get(loser)
      if (loserInfo) {
        loserInfo.playoffLosses += 1
        if (round === maxRound) {
          loserInfo.isRunnerUp = true
          loserInfo.bestFinish = Math.min(loserInfo.bestFinish, 2)
        } else {
          const finishFromRound = Math.pow(2, maxRound - round) + 1
          loserInfo.bestFinish = Math.min(loserInfo.bestFinish, finishFromRound)
        }
      }
    }
  }

  for (const [, info] of results) {
    if (!info.isChampion && info.madePlayoffs && info.bestFinish === 999) {
      info.bestFinish = rosterIds.length
    }
  }

  return results
}

function toPlayoffFinishLabel(info: PlayoffFinishInfo): string | null {
  if (info.isChampion) return 'Champion'
  if (info.isRunnerUp) return 'Runner-up'
  if (info.bestFinish <= 4) return 'Semifinalist'
  if (info.madePlayoffs) return 'Playoff Team'
  return null
}

/**
 * The current season's canonical team id for a roster, as stamped into `playerData`
 * by the import. Exported because the DRAFT sync needs the identical resolution —
 * it wrote raw historical roster ids for a long time, which attributed picks to
 * whoever happens to hold that roster slot today. One definition, not two that drift.
 */
export function getSourceTeamIdFromPlayerData(playerData: unknown): string | null {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) {
    return null
  }

  const sourceTeamId = (playerData as Record<string, unknown>).source_team_id
  return typeof sourceTeamId === 'string' && sourceTeamId.trim() ? sourceTeamId.trim() : null
}

function buildSeasonMatchupFacts(args: {
  leagueId: string
  sport: string
  season: number
  weekMatchups: Array<{ week: number; matchups: SleeperMatchup[] }>
  canonicalIdByHistoricalRosterId: Map<string, string>
}): PersistedMatchupFactRow[] {
  const rows: PersistedMatchupFactRow[] = []
  const seenKeys = new Set<string>()

  for (const weekMatchup of args.weekMatchups) {
    const byMatchupId = new Map<number, SleeperMatchup[]>()

    for (const matchup of weekMatchup.matchups) {
      const matchupId = safeNumber(matchup.matchup_id)
      if (matchupId <= 0) continue

      if (!byMatchupId.has(matchupId)) {
        byMatchupId.set(matchupId, [])
      }
      byMatchupId.get(matchupId)!.push(matchup)
    }

    for (const [matchupId, matchupEntries] of byMatchupId) {
      const uniqueEntries = Array.from(
        new Map(
          matchupEntries
            .filter((entry) => safeNumber(entry.roster_id) > 0)
            .map((entry) => [String(entry.roster_id), entry])
        ).values()
      )

      if (uniqueEntries.length !== 2) {
        continue
      }

      const [teamOne, teamTwo] = uniqueEntries.sort(
        (left, right) => safeNumber(left.roster_id) - safeNumber(right.roster_id)
      )

      const scoreA = typeof teamOne.points === 'number' ? teamOne.points : 0
      const scoreB = typeof teamTwo.points === 'number' ? teamTwo.points : 0
      const winnerTeamId =
        scoreA > scoreB
          ? String(teamOne.roster_id)
          : scoreB > scoreA
            ? String(teamTwo.roster_id)
            : null

      const dedupeKey = `${args.season}:${weekMatchup.week}:${matchupId}:${teamOne.roster_id}:${teamTwo.roster_id}`
      if (seenKeys.has(dedupeKey)) {
        continue
      }
      seenKeys.add(dedupeKey)

      rows.push({
        leagueId: args.leagueId,
        sport: args.sport,
        season: args.season,
        weekOrPeriod: weekMatchup.week,
        teamA:
          args.canonicalIdByHistoricalRosterId.get(String(teamOne.roster_id)) ??
          String(teamOne.roster_id),
        teamB:
          args.canonicalIdByHistoricalRosterId.get(String(teamTwo.roster_id)) ??
          String(teamTwo.roster_id),
        scoreA,
        scoreB,
        winnerTeamId:
          winnerTeamId != null
            ? args.canonicalIdByHistoricalRosterId.get(winnerTeamId) ?? winnerTeamId
            : null,
      })
    }
  }

  return rows
}

function mergeSeasonMetadata(
  existing: unknown,
  next: Record<string, unknown>
): Record<string, unknown> {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return next
  }

  return {
    ...(existing as Record<string, unknown>),
    ...next,
  }
}

function buildMatchupMetadata(args: {
  league: SleeperLeague
  rosters: SleeperRoster[]
  winnersBracket: SleeperPlayoffBracket[]
  losersBracket: SleeperPlayoffBracket[]
  weekMatchups: Array<{ week: number; matchups: SleeperMatchup[] }>
  canonicalIdByHistoricalRosterId: Map<string, string>
}): Record<string, unknown> {
  const rawSettings = (args.league.settings ?? {}) as Record<string, unknown>
  const playoffWeekStartRaw = rawSettings.playoff_week_start
  const playoffWeekStart = safeNumber(playoffWeekStartRaw) || null
  const playoffParticipants = Array.from(extractPlayoffParticipants(args.winnersBracket))
    .filter((rosterId) => rosterId > 0)
    .sort((left, right) => left - right)
  const playoffFinishMap = analyzePlayoffBracket(
    args.winnersBracket,
    args.rosters.map((roster) => roster.roster_id)
  )

  const playoffSeedsByRosterId = Object.fromEntries(
    args.rosters.map((roster) => [
      String(roster.roster_id),
      getPlayoffSeedForRoster(roster, args.winnersBracket),
    ])
  )

  const playoffFinishByRosterId = Object.fromEntries(
    Array.from(playoffFinishMap.entries()).map(([rosterId, info]) => [
      String(rosterId),
      {
        ...info,
        playoffSeed: playoffSeedsByRosterId[String(rosterId)] ?? null,
        canonicalRosterId:
          args.canonicalIdByHistoricalRosterId.get(String(rosterId)) ?? String(rosterId),
        label: toPlayoffFinishLabel(info),
      },
    ])
  )

  return {
    matchupHistory: {
      weeksWithMatchups: args.weekMatchups
        .filter((week) => week.matchups.length > 0)
        .map((week) => week.week),
      weekMatchupCounts: Object.fromEntries(
        args.weekMatchups
          .filter((week) => week.matchups.length > 0)
          .map((week) => [String(week.week), week.matchups.length])
      ),
    },
    playoffStructure: {
      playoffWeekStart,
      regularSeasonLength: playoffWeekStart != null && playoffWeekStart > 0 ? playoffWeekStart - 1 : null,
      playoffTeams: safeNumber(rawSettings.playoff_teams) || playoffParticipants.length || null,
      playoffParticipants,
      canonicalRosterIdByHistoricalRosterId: Object.fromEntries(
        Array.from(args.canonicalIdByHistoricalRosterId.entries())
      ),
      playoffSeedsByRosterId,
      playoffFinishByRosterId,
      winnersBracket: toPlainBracket(args.winnersBracket),
      losersBracket: toPlainBracket(args.losersBracket),
    },
  }
}

async function fetchWeekMatchups(
  externalLeagueId: string
): Promise<Array<{ week: number; matchups: SleeperMatchup[] }>> {
  const weekNumbers = Array.from({ length: MAX_SLEEPER_MATCHUP_WEEKS }, (_, index) => index + 1)
  const matchupLists = await Promise.all(
    weekNumbers.map(async (week) => ({
      week,
      matchups: await getLeagueMatchups(externalLeagueId, week),
    }))
  )

  return matchupLists
}

export async function syncSleeperHistoricalMatchupsAfterImport(args: {
  leagueId: string
  maxPreviousSeasons?: number
}): Promise<SleeperHistoricalMatchupSyncSummary> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
    },
  })

  if (!league) {
    return {
      attempted: false,
      refreshed: false,
      skipped: true,
      reason: 'League not found.',
    }
  }

  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      attempted: false,
      refreshed: false,
      skipped: true,
      reason: 'Historical matchup sync only applies to Sleeper leagues with a platformLeagueId.',
    }
  }

  try {
    const sport = normalizeSportForWarehouse(league.sport)
    const currentRosters = await prisma.roster.findMany({
      where: { leagueId: league.id },
      select: {
        platformUserId: true,
        playerData: true,
      },
    })
    const canonicalIdByManagerId = new Map<string, string>()
    for (const roster of currentRosters) {
      const sourceTeamId = getSourceTeamIdFromPlayerData(roster.playerData)
      if (sourceTeamId) {
        canonicalIdByManagerId.set(roster.platformUserId, sourceTeamId)
      }
    }

    const historyChain = await getSleeperHistoricalLeagueChain(
      league.platformLeagueId,
      args.maxPreviousSeasons ?? 10
    )

    if (!historyChain.length) {
      return {
        attempted: true,
        refreshed: false,
        skipped: true,
        reason: 'No historical Sleeper seasons were available to sync.',
        seasonsProcessed: 0,
        matchupFactsPersisted: 0,
        playoffSeasonsWithBracket: 0,
        weeksWithMatchups: 0,
      }
    }

    let seasonsProcessed = 0
    let matchupFactsPersisted = 0
    let playoffSeasonsWithBracket = 0
    let weeksWithMatchups = 0

    for (const seasonState of historyChain) {
      const [rosters, winnersBracket, losersBracket, weekMatchups, existingSeason] = await Promise.all([
        getLeagueRosters(seasonState.externalLeagueId),
        getPlayoffBracket(seasonState.externalLeagueId),
        getLosersBracket(seasonState.externalLeagueId),
        fetchWeekMatchups(seasonState.externalLeagueId),
        prisma.leagueDynastySeason.findUnique({
          where: {
            uniq_league_dynasty_season_league_season: {
              leagueId: league.id,
              season: seasonState.season,
            },
          },
          select: {
            metadata: true,
          },
        }),
      ])

      const canonicalIdByHistoricalRosterId = new Map<string, string>()
      for (const roster of rosters) {
        const historicalRosterId = String(roster.roster_id)
        const canonicalId =
          (roster.owner_id ? canonicalIdByManagerId.get(roster.owner_id) : undefined) ??
          historicalRosterId
        canonicalIdByHistoricalRosterId.set(historicalRosterId, canonicalId)
      }

      const matchupRows = buildSeasonMatchupFacts({
        leagueId: league.id,
        sport,
        season: seasonState.season,
        weekMatchups,
        canonicalIdByHistoricalRosterId,
      })

      const mergedMetadata = mergeSeasonMetadata(
        existingSeason?.metadata,
        buildMatchupMetadata({
          league: seasonState.league,
          rosters,
          winnersBracket,
          losersBracket,
          weekMatchups,
          canonicalIdByHistoricalRosterId,
        })
      )

      const writes = [
        prisma.matchupFact.deleteMany({
          where: {
            leagueId: league.id,
            season: seasonState.season,
          },
        }),
      ]

      if (matchupRows.length > 0) {
        writes.push(
          prisma.matchupFact.createMany({
            data: matchupRows,
          })
        )
      }

      await prisma.$transaction(writes)
      await persistDynastySeason(
        league.id,
        seasonState.season,
        seasonState.externalLeagueId,
        'sleeper',
        mergedMetadata
      )

      seasonsProcessed += 1
      matchupFactsPersisted += matchupRows.length
      weeksWithMatchups += weekMatchups.filter((week) => week.matchups.length > 0).length
      if (winnersBracket.length > 0 || losersBracket.length > 0) {
        playoffSeasonsWithBracket += 1
      }
    }

    return {
      attempted: true,
      refreshed: true,
      skipped: false,
      seasonsProcessed,
      matchupFactsPersisted,
      playoffSeasonsWithBracket,
      weeksWithMatchups,
    }
  } catch (error) {
    return {
      attempted: true,
      refreshed: false,
      skipped: false,
      error: getErrorMessage(error),
    }
  }
}
