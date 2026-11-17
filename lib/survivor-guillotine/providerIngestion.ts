import { recoverSGOfficialNbaGames } from './providerNbaOfficial'
import { fetchSGNflState } from '@/lib/workers/providers/survivorSleeper'
import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ingestRollingInsightsGameLogs } from '@/lib/sports-data/survivorNbaGameLogs'
import { pendingStatCorrectionDates } from '@/lib/sports-data/statCoverage'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { syncSGProviderCatalog, type SGProviderSport } from './providerCatalog'
import { sgNflWeekAwaitingKickoff, syncSGProviderSchedule } from './providerSchedule'
import { syncSGNflWeek } from './providerNflSnapshot'
import { saveSGProviderHealth } from './providerHealth'

export type SGIngestRequest = { sport: SGProviderSport; season?: number; week?: number; date?: string; refreshCatalog?: boolean }
/** Per-sport lease prevents overlapping scheduled/manual fetches from racing snapshots. */
export async function ingestSGProviderData(args: SGIngestRequest) {
  const now = new Date(), leaseId = randomUUID(), cacheKey = `sg:provider-lease:${args.sport}`, expiresAt = new Date(now.getTime() + 240_000), lease = { leaseId }
  const created = await prisma.sportsDataCache.createMany({ data: [{ cacheKey, data: lease, expiresAt }], skipDuplicates: true })
  const acquired = created.count === 1 || (await prisma.sportsDataCache.updateMany({ where: { cacheKey, expiresAt: { lte: now } }, data: { data: lease, expiresAt } })).count === 1
  if (!acquired) return { ok: true, sport: args.sport, skipped: 'already_running' as const }
  let season = args.season ?? (now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1)
  let diagnostics: { incompleteGameIds: string[]; gameResults: unknown } | undefined
  try {
    let stateWeek: number | undefined
    if (args.sport === 'NFL' && (!args.season || !args.week)) {
      const state = await fetchSGNflState()
      if (!/^\d{4}$/.test(String(state.season))) throw Error('NFL season state is malformed')
      season = args.season ?? Number(state.season)
      if (state.season_type === 'regular' && Number.isInteger(Number(state.week))) stateWeek = Number(state.week)
    }
    if (!Number.isInteger(season) || season < 2020 || season > 2100) throw Error('Invalid provider season')
    const catalog = await syncSGProviderCatalog(args.sport, now, args.refreshCatalog)
    const schedule = await syncSGProviderSchedule(args.sport, season, now)
    if (args.sport === 'NFL') {
      const current = args.week ?? stateWeek
      // Offseason still keeps profiles and published schedules ready for drafts.
      if (current == null) {
        await saveSGProviderHealth(args.sport, season, { checkedAt: new Date().toISOString(), status: 'healthy' })
        return { ok: true, sport: args.sport, season, catalog, scheduledGames: schedule.games, waitingForRegularSeason: true }
      }
      if (!Number.isInteger(current) || current < 1 || current > 18) throw Error('Invalid NFL scoring week')
      const pending = args.week ? [] : await prisma.$queryRaw<Array<{ week: number }>>`SELECT week FROM sports_stat_coverage WHERE sport='NFL' AND season=${season}
        AND source='sleeper_weekly_stats' AND "firstFinalObservedAt" <= ${new Date(Date.now() - 12 * 3600_000)}
        AND "recordedAt" < "firstFinalObservedAt" + interval '12 hours' ORDER BY "firstFinalObservedAt" LIMIT 2`
      const weeks = [...new Set([current, ...(args.week ? [] : [current - 1, ...pending.map(row => row.week)])])].filter(week => week >= 1)
      const snapshots = []
      const waitingForWeeks: number[] = []
      for (const week of weeks) {
        const slate = schedule.rows.filter(game => game.week === week)
        if (sgNflWeekAwaitingKickoff(slate, now)) { waitingForWeeks.push(week); continue }
        const snapshot = await syncSGNflWeek(season, week)
        if (slate.length && slate.every(game => game.status === 'final') && !snapshot.complete) throw Error(`Week ${week} has incomplete final stat coverage`)
        snapshots.push(snapshot)
      }
      await saveSGProviderHealth(args.sport, season, { checkedAt: new Date().toISOString(), status: 'healthy' })
      return { ok: true, sport: args.sport, season, catalog, scheduledGames: schedule.games, snapshots, waitingForWeeks }
    }
    const today = easternCalendarDay(now)!.toISOString().slice(0, 10)
    const dates = args.date ? [args.date] : [...new Set([today, ...[1, 2].map(days => easternCalendarDay(new Date(now.getTime() - days * 86400_000))!.toISOString().slice(0, 10)), ...await pendingStatCorrectionDates(prisma, 'NBA', now, 2)])]
    if (dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) throw Error('Invalid NBA game date')
    const result = await ingestRollingInsightsGameLogs({ sport: 'NBA', dates, persistSchedule: true, expectedSeason: season,
      reportGames: true, batchPlayerWrites: true, protectOfficialNba: true, shouldStop: () => Date.now() - now.getTime() > 180_000 })
    const expected = schedule.rows.filter(game => game.startTime <= now && dates.includes(easternCalendarDay(game.startTime)!.toISOString().slice(0, 10)) && !['postponed', 'cancelled'].includes(game.status))
    const measured = new Map((result.gameResults ?? []).map(game => [game.gameId, game]))
    let missing = expected.filter(game => !measured.get(game.externalId)?.committed || (game.status === 'final' && !measured.get(game.externalId)?.boxCertified))
    diagnostics = { incompleteGameIds: missing.map(game => game.externalId), gameResults: result.gameResults }
    const official = await recoverSGOfficialNbaGames(season, missing.filter(game => game.status === 'final'))
    const recovered = new Set(official.map(game => game.gameId))
    missing = missing.filter(game => !recovered.has(game.externalId))
    const officialById = new Map(official.map(game => [game.gameId,game]))
    const gameResults = (result.gameResults ?? []).map(game => {
      const replacement = officialById.get(game.gameId)
      return replacement ? {...game,...replacement,written:replacement.lines,unresolved:0} : game
    })
    const unresolved = gameResults.reduce((sum,game)=>sum+game.unresolved,0)
    diagnostics = { incompleteGameIds: missing.map(game => game.externalId), gameResults }
    if ((result.errors.length && !official.length) || unresolved || missing.length) throw Error(`NBA snapshot incomplete: ${result.errors.length} errors, ${unresolved} unresolved players, ${missing.length} missing complete boxes`)
    await saveSGProviderHealth(args.sport, season, { checkedAt: new Date().toISOString(), status: 'healthy' })
    return { ok: true, sport: args.sport, season, catalog, scheduledGames: schedule.games, dates, games: result.games, lines: result.lines,
      written: result.written + official.reduce((sum,game)=>sum+game.lines,0), expectedGames: expected.length, gameResults, officialRecoveries: official, primaryErrors: result.errors }
  } catch (error) {
    // Only owned messages leave the job. Provider URLs/tokens never enter its HTTP response.
    const message = error instanceof Error && !/https?:|token|password/i.test(error.message) ? error.message.slice(0, 180) : 'Provider ingestion failed'
    await saveSGProviderHealth(args.sport, season, { checkedAt: new Date().toISOString(), status: 'failed', message }).catch(() => {})
    return { ok: false, sport: args.sport, season, error: message, ...(diagnostics ? { diagnostics } : {}) }
  } finally {
    await prisma.sportsDataCache.updateMany({ where: { cacheKey, data: { equals: lease } }, data: { expiresAt: new Date() } }).catch(() => {})
  }
}
