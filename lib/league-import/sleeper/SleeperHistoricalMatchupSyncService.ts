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
import {
  analyzePlayoffBracket,
  placementLabel,
  readStoredTitleGame,
  resolveBracketPlacements,
} from './bracketPlacements'
import { shouldSkipImportedSeason } from '../seasonCompletion'
import { mergeSeasonMetadata } from './seasonMetadata'

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

export interface SleeperHistoricalMatchupSyncSummary {
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  reason?: string
  seasonsProcessed?: number
  /** Completed seasons left alone: stored, and settled (see `isStoredSeasonSettled`). */
  seasonsSkippedComplete?: number
  /** Completed seasons fetched once more because their stored row was written before they settled. */
  completedSeasonsRefreshed?: number
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

/**
 * ⚠ `placement` AND THE `*From` LINKS ARE KEPT. The first version of this flattener
 * dropped `p`, `t1_from` and `t2_from`, which left every stored bracket unable to say
 * which last-round game was the final — see `bracketPlacements.ts`.
 */
function toPlainBracket(bracket: SleeperPlayoffBracket[]): Array<Record<string, unknown>> {
  return bracket.map((matchup) => ({
    round: matchup.r ?? null,
    matchup: matchup.m ?? null,
    team1: matchup.t1 ?? null,
    team2: matchup.t2 ?? null,
    winner: matchup.w ?? null,
    loser: matchup.l ?? null,
    placement: matchup.p ?? null,
    team1From: matchup.t1_from ?? null,
    team2From: matchup.t2_from ?? null,
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

/**
 * Has a COMPLETED season's stored row already captured everything Sleeper will ever say?
 *
 * 🛑 "COMPLETE AND STORED" WAS NOT ENOUGH. The four-hourly refresh re-runs the season being
 * played, so a season is first stored mid-season with an UNDECIDED winners bracket. Once Sleeper
 * flips it to `complete`, matchup facts already exist — and the old gate skipped it on every
 * later run, so the title game and the final playoff weeks were never written. A run landing
 * between the championship and the status flip was the only way out.
 *
 * Settled means either:
 *   - the stored bracket names a decided title game (`readStoredTitleGame`, which also reads
 *     rows written before `bracketPlacementVersion: 2`), or
 *   - the row was written while Sleeper already reported the season `complete`
 *     (`seasonStatusAtSync`). That write saw everything there is to see.
 *
 * ⚠ THE SECOND CONDITION IS WHAT KEEPS THIS TO ONE EXTRA REFRESH. Elimination formats
 * (Guillotine, Chopped, …) never have a winners bracket, and Sleeper answers `null` for them. A
 * gate on the title game alone would re-fetch every such season on every run, forever — the
 * vendor load the completion gate exists to prevent.
 *
 * ⚠ A BRACKET FETCH THAT FAILS DURING THAT ONE REFRESH IS NOT RETRIED. `getPlayoffBracket`
 * returns `[]` for a failed request and for a league with no bracket alike, so the two cannot be
 * told apart here.
 */
export function isStoredSeasonSettled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const stored = metadata as Record<string, unknown>
  if (readStoredTitleGame(stored.playoffStructure) != null) return true
  return stored.seasonStatusAtSync === 'complete'
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
  const titleResult = resolveBracketPlacements(args.winnersBracket)

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
        label: placementLabel(info),
      },
    ])
  )

  return {
    /** Sleeper's status for the season when this row was written — read by `isStoredSeasonSettled`. */
    seasonStatusAtSync: args.league.status ?? null,
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
      /*
       * The title game's result, and how it was identified (`placement` = Sleeper's
       * `p: 1`). Written so a reader never has to re-derive "who won" from the
       * per-roster map, and so a backfill can tell a corrected row from an old one.
       */
      championRosterId: titleResult.championRosterId,
      runnerUpRosterId: titleResult.runnerUpRosterId,
      titleGameSource: titleResult.source,
      bracketPlacementVersion: 2,
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
    let seasonsSkippedComplete = 0
    let completedSeasonsRefreshed = 0
    let matchupFactsPersisted = 0
    let playoffSeasonsWithBracket = 0
    let weeksWithMatchups = 0

    for (const seasonState of historyChain) {
      /*
       * Completion gate — 1b, and the OPPOSITE failure from its two siblings.
       *
       * 🛑 THIS SERVICE HAD NO GATE AT ALL. The draft and season-state services skipped any season
       * with rows, freezing the live one; this one skipped nothing, so every run re-fetched FOUR
       * Sleeper endpoints for every season in the chain — rosters, both playoff brackets, and
       * `fetchWeekMatchups`, which is itself multi-week. A completed season's matchups cannot
       * change, so all of that was spent re-learning settled history.
       *
       * Three siblings, three different answers to one question nobody had named. That is why the
       * predicate is shared and provider-agnostic rather than inlined here.
       *
       * ⚠ THREE conditions now: complete, already persisted, AND settled. Completion alone would
       * skip a finished season that was never imported, which is exactly the history this exists
       * to fetch. "Persisted" alone froze a season stored mid-season with its final undecided —
       * see `isStoredSeasonSettled`.
       */
      const storedSeasonRead = () =>
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
        })
      let storedSeason: Awaited<ReturnType<typeof storedSeasonRead>> | undefined
      if (shouldSkipImportedSeason({ force: undefined, league: seasonState.league })) {
        const [alreadyPersisted, stored] = await Promise.all([
          prisma.matchupFact.findFirst({
            where: { leagueId: league.id, season: seasonState.season },
            select: { matchupId: true },
          }),
          storedSeasonRead(),
        ])
        storedSeason = stored
        if (alreadyPersisted && isStoredSeasonSettled(stored?.metadata)) {
          seasonsSkippedComplete += 1
          continue
        }
        if (alreadyPersisted) completedSeasonsRefreshed += 1
      }

      const [rosters, winnersBracket, losersBracket, weekMatchups, existingSeason] = await Promise.all([
        getLeagueRosters(seasonState.externalLeagueId),
        getPlayoffBracket(seasonState.externalLeagueId),
        getLosersBracket(seasonState.externalLeagueId),
        fetchWeekMatchups(seasonState.externalLeagueId),
        storedSeason !== undefined ? Promise.resolve(storedSeason) : storedSeasonRead(),
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
      seasonsSkippedComplete,
      completedSeasonsRefreshed,
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
