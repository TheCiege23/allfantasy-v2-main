import 'server-only'
import { readSGProviderHealth } from './providerHealth'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { loadHistoricalPeriod } from '@/lib/redraft/lineupHistory'
import { calculateScoreForLeague, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { accumulateTeamTotals } from '@/lib/category-scoring'
import { calculateCappedGameScores, type CappedGame } from './capped-scoring'
import { buildSGSchedule } from './config'
import type { SGConfig } from './types'

/** Uses kickoff/day-time ownership, commissioned scoring, and certified source coverage, never today's roster. */
export async function refreshSGScores(leagueId: string, requestedPeriod?: number) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const period = requestedPeriod ?? season.currentPeriod
  const rule = buildSGSchedule(config).periods.find(p => p.period === period)
  if (!rule || period < 1 || period > season.currentPeriod) throw new Error('Choose an opened Survivor Guillotine period.')
  if (rule.mode === 'off') return { period, final: true, scores: [] }
  const calendar = season.periodCalendar as Record<string, { scoringStartsAt?: string; scoringEndsAt?: string }>
  const dates = calendar[String(period)]
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  if (!isNativePlatform(league.platform) || league.leagueVariant !== 'survivor_guillotine') throw new Error('Combined native scoring cannot write an imported league.')
  const settings = league.settings as Record<string, unknown> | null
  if (settings?.lineup_history_version !== 1) throw new Error('Initialize the native scoring roster and lineup history before scoring Survivor Guillotine.')
  if (!dates?.scoringStartsAt || !dates.scoringEndsAt) throw new Error('Save real scoring start/end dates before scoring this period.')
  const startsAt = new Date(dates.scoringStartsAt), endsAt = new Date(dates.scoringEndsAt)
  const redraft = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId, season: league.season } })
  const eliminated = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId, period: { lt: period }, reversedAt: null }, select: { rosterId: true } })).map(row => row.rosterId))
  const rosters = (await prisma.roster.findMany({ where: { leagueId }, select: { id: true, redraftRosterId: true } })).filter(row => !eliminated.has(row.id))
  if (rosters.length !== rule.teamsEntering || rosters.some(row => !row.redraftRosterId)) throw new Error('All surviving managers need a linked scoring roster.')
  const capped = config.sport === 'NBA' && config.nbaScoring === 'capped_games'
  const providerHealth = await readSGProviderHealth(config.sport, league.season)
  const history = await loadHistoricalPeriod(prisma, { leagueId, seasonId: redraft.id, sport: config.sport,
    season: league.season, week: period, settings: league.settings, includeBench: capped,
    scoringWindow: { startsAt, endsAt }, requireAtomicNflSnapshot: providerHealth.enabled })
  const final = (!providerHealth.enabled || providerHealth.ready) && history.sourceSnapshotReady !== false && history.slateFinal && history.correctionsReady && history.missingPlayerIds.length === 0 && Date.now() >= endsAt.getTime()
  let totals: Map<string, number>
  if (capped) {
    const daily = await prisma.survivorGuillotineDailyLineup.findMany({ where: { leagueId, period }, orderBy: { gameDay: 'asc' } })
    const legacy = new Map(rosters.map(r => [r.redraftRosterId!, r.id]))
    const games: CappedGame[] = []
    for (const contribution of history.contributions) {
      const rosterId = legacy.get(contribution.player.rosterId)
      if (!rosterId) continue
      if (!Number.isFinite(contribution.gameStartsAt)) throw new Error('Capped scoring needs a verified game start time.')
      const instant = new Date(contribution.gameStartsAt!)
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
      const lineup = daily.filter(row => row.rosterId === rosterId && row.gameDay.toISOString().slice(0, 10) <= day).at(-1)
      const selected = lineup ? Array.isArray(lineup.playerIds) && lineup.playerIds.includes(contribution.player.playerId)
        : isScoringStarterSlot(contribution.player.slotType)
      if (selected) games.push({ rosterId, playerId: contribution.player.playerId, gameId: contribution.gameId,
        gameDate: instant, points: calculateScoreForLeague(league, contribution.stats, contribution.player.position) })
    }
    totals = calculateCappedGameScores(rosters.map(r => r.id), games, config.nbaGameCap)
  } else {
    totals = new Map(rosters.map(roster => {
      const contributions = history.contributions.filter(c => c.player.rosterId === roster.redraftRosterId)
      const players = new Map(contributions.map(c => [c.player.playerId, c.player]))
      let points = 0
      for (const player of players.values()) points += calculateScoreForLeague(league,
        accumulateTeamTotals(contributions.filter(c => c.player.playerId === player.playerId).map(c => c.stats)), player.position)
      return [roster.id, Math.round(points * 100) / 100]
    }))
  }
  for (const [rosterId, points] of totals) totals.set(rosterId, Math.round(points * 100) / 100)
  await prisma.$transaction(async tx => {
    const current = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision }, data: { revision: { increment: 1 } } })
    if (current.count !== 1) throw new Error('The league changed while scores were calculated; retry.')
    for (const [rosterId, totalPoints] of totals) {
      const data = { totalPoints, status: final ? 'final' : 'live', opponentRosterId: null, winLoss: null,
        categoryBreakdown: { source: 'survivor_guillotine_history', missingPlayerIds: history.missingPlayerIds,
          startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), correctionsReady: history.correctionsReady } as Prisma.InputJsonValue }
      await tx.teamWeekResult.upsert({ where: { leagueId_season_week_rosterId: { leagueId, season: league.season, week: period, rosterId } },
        create: { leagueId, season: league.season, week: period, rosterId, ...data }, update: data })
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000, maxWait: 10000 })
  return { period, final, providerHealth, scores: [...totals].map(([rosterId, totalPoints]) => ({ rosterId, totalPoints })),
    missingPlayerIds: history.missingPlayerIds }
}

/** All modes receive live scores; hosted ceremonies do not depend on automatic Chop Night. */
export async function runSGScoreRefresh(limit = 10) {
  const rows = await prisma.survivorGuillotineLeague.findMany({ where: { status: 'active', currentPeriod: { gt: 0 } },
    orderBy: { updatedAt: 'asc' }, take: limit, select: { leagueId: true } })
  const results: { leagueId: string; status: string }[] = []
  const startedAt = Date.now()
  for (const row of rows) {
    if (Date.now() - startedAt > 40_000) break
    try { const score = await refreshSGScores(row.leagueId); results.push({ leagueId: row.leagueId, status: score.final ? 'final' : 'live' }) }
    catch { results.push({ leagueId: row.leagueId, status: 'awaiting_verified_scoring' }) }
    finally { await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId: row.leagueId }, data: { updatedAt: new Date() } }).catch(() => {}) }
  }
  return { results }
}
