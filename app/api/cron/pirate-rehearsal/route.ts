import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { pirateRehearsalEnabled, isPirateRehearsalLeague, isPirateDailyRehearsalLeague } from '@/lib/pirate/stagingRehearsalScope'
import { capturePirateLineupEvidence } from '@/lib/pirate/lineupEvidence'
import { seedPirateClaims, maintainPirateClaims } from '@/lib/pirate/service'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { finalizeCompletedWeeksForSeason } from '@/lib/redraft/weekFinalizer'
import { isRedraftWeekSealed } from '@/lib/redraft/weekSealed'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { syncRiSeasonSchedule } from '@/lib/sports-data/riSeasonSchedule'
import { scheduleKeyPrefix, readRiScheduleWindow, type ScheduleCacheDb } from '@/lib/sports-data/riScheduleCache'
import { pirateDailySlateComplete } from '@/lib/pirate/stagingDailySlate'
import { getLiveScoresForSport } from '@/lib/sports-live-scores-service'
import { ingestRollingInsightsGameLogs } from '@/lib/sports-data/rollingInsightsGameLogs'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { daysInWindow } from '@/lib/redraft/dailyLineups'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'

export const dynamic = 'force-dynamic'
export const maxDuration = 240

/** A fixed, bot-owned fixture only. The ordinary production score-sync is unchanged. */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) return NextResponse.json({ ok: false }, { status: 401 })
  if (!pirateRehearsalEnabled(process.env)) return NextResponse.json({ ok: false, disabled: true }, { status: 404 })
  const task = request.nextUrl.searchParams.get('task') || 'capture'
  if (!['capture', 'score', 'schedules', 'data'].includes(task)) return NextResponse.json({ ok: false }, { status: 400 })
  const pilot = request.nextUrl.searchParams.get('pilot')
  if (pilot != null && pilot !== 'daily') return NextResponse.json({ ok: false }, { status: 400 })
  const daily = pilot === 'daily'
  if ((daily && task === 'schedules') || (!daily && task === 'data')) return NextResponse.json({ ok: false }, { status: 400 })
  const leagueId = daily ? process.env.PIRATE_DAILY_REHEARSAL_LEAGUE_ID?.trim() : process.env.PIRATE_REHEARSAL_LEAGUE_ID!
  if (!leagueId) return NextResponse.json({ ok: false, disabled: true }, { status: 404 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: {
    id: true, tenantId: true, platform: true, leagueType: true, leagueVariant: true, settings: true,
  } })
  if (!league || !(daily ? isPirateDailyRehearsalLeague(league, leagueId) : isPirateRehearsalLeague(league, leagueId))) return NextResponse.json({ ok: false }, { status: 409 })
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, status: 'active' },
    select: { id: true, season: true, sport: true, currentWeek: true, rosters: { select: { ownerId: true } } } })
  // Rehearsal claim events may enter the outbox, but only for these uncontactable QA accounts.
  if (!season || season.sport !== (daily ? 'NBA' : 'NFL') || season.currentWeek < 1 || !season.rosters.length) {
    return NextResponse.json({ ok: false }, { status: 409 })
  }
  const owners = await prisma.appUser.findMany({ where: { id: { in: season.rosters.map(r => r.ownerId) } }, select: { id: true, email: true } })
  if (season.rosters.some(r => !owners.some(u => u.id === r.ownerId && u.email?.endsWith('@example.invalid')))) {
    return NextResponse.json({ ok: false }, { status: 409 })
  }
  if (daily && task === 'score') {
    const dataRun = await prisma.syncJobRun.findFirst({ where: { jobName: 'cron-pirate-rehearsal-data', jobScope: leagueId },
      orderBy: { startedAt: 'desc' }, select: { status: true, completedAt: true } })
    if (dataRun?.status !== 'success' || !dataRun.completedAt || Date.now() - dataRun.completedAt.getTime() < 0 ||
      Date.now() - dataRun.completedAt.getTime() > 30 * 60000) return NextResponse.json({ ok: false, reason: 'daily_data_not_certified' }, { status: 409 })
  }
  try {
    const result = await withSyncJobRun({ jobName: `cron-pirate-rehearsal-${task}`, jobScope: leagueId, trigger: 'cron', sport: season.sport }, async () => {
      const input = { leagueId, seasonId: season.id, season: season.season, week: season.currentWeek }
      const captured = await capturePirateLineupEvidence(input)
      if (task === 'capture') return { ok: true, captured, scoresUpserted: 0, finalized: 0, claimsCreated: 0, transferred: 0 }
      if (task === 'data') {
        const window = resolveDailySportWeekWindow(season.sport, season.season, season.currentWeek)
        const today = easternCalendarDay(new Date())
        if (!window || !today) throw new Error('Unknown daily week')
        const days = daysInWindow(window).map(day => day.toISOString().slice(0, 10))
        let expected = await readRiScheduleWindow(prisma as unknown as ScheduleCacheDb, { sport: season.sport, season: season.season, window })
        if (!expected?.length || expected.some(g => !g.homeTeam || !g.awayTeam)) {
          await syncRiSeasonSchedule({ sport: season.sport, season: season.season, db: prisma as unknown as ScheduleCacheDb })
          expected = await readRiScheduleWindow(prisma as unknown as ScheduleCacheDb, { sport: season.sport, season: season.season, window })
        }
        // Refresh the whole week, including future days. A today's-only slate
        // must not become the finalizer's falsely complete seven-day calendar.
        const slate = await getLiveScoresForSport({ sport: season.sport, forceRefresh: true,
          espnDates: days.map(day => day.replaceAll('-', '')) })
        // An unstarted day legitimately has no /live box yet. Request only
        // dates with an observed scheduled start at or before the real clock;
        // 304 after play begins remains an uncertified provider outcome.
        const dates = days.filter(day => day <= today.toISOString().slice(0, 10) && slate.scores.some(game => {
          const at = new Date(game.startTime)
          return at.getTime() <= Date.now() && easternCalendarDay(at)?.toISOString().slice(0, 10) === day
        })).slice(-2)
        const logs = await ingestRollingInsightsGameLogs({ sport: season.sport, dates })
        const slateCertified = slate.refreshed && slate.source === 'espn_live' && pirateDailySlateComplete(expected, slate.scores)
        const statsCertified = !logs.errors.length && !logs.unsupported && !logs.notModifiedDates.length && logs.datesFetched === dates.length
        return { ok: slateCertified && statsCertified, slateCertified, statsCertified,
          captured, scoresUpserted: 0, finalized: 0, claimsCreated: 0, transferred: 0, gameStatsWritten: logs.written,
          statsErrors: logs.errors.length, statsNotModifiedDates: logs.notModifiedDates, unresolvedPlayers: logs.unresolved }
      }
      if (task === 'schedules') {
        const outcomes = await Promise.allSettled(['NBA', 'MLB', 'NHL'].map(async sport => {
          const meta = await prisma.sportsDataCache.findUnique({ where: { cacheKey: `${scheduleKeyPrefix(sport, season.season)}meta` }, select: { data: true } })
          const syncedAt = Date.parse((meta?.data as { syncedAt?: string } | null)?.syncedAt || '')
          if (Number.isFinite(syncedAt) && Date.now() - syncedAt >= 0 && Date.now() - syncedAt < 12 * 3600000) return true
          const result = await syncRiSeasonSchedule({ sport, season: season.season, db: prisma as unknown as ScheduleCacheDb })
          return result.fetched && !result.error && !result.notModified && !result.unsupported && result.games > 0
        }))
        return { ok: outcomes.every(r => r.status === 'fulfilled' && r.value), captured,
          scoresUpserted: 0, finalized: 0, claimsCreated: 0, transferred: 0 }
      }
      let scoresUpserted = 0
      // Repeated ticks must never reopen a sealed result.
      if (!await isRedraftWeekSealed(prisma, season.id, season.currentWeek)) {
        const sync = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: season.id, week: season.currentWeek, actorId: 'system:pirate-rehearsal' })
        scoresUpserted = sync.scoresUpserted
        await recalculateMatchupsForSeasonWeek(season.id, season.currentWeek)
      }
      const sweep = await finalizeCompletedWeeksForSeason({ seasonId: season.id, throughWeek: season.currentWeek }, {
        notifyResults: async () => {}, enqueueTankingScan: async () => {}, resolvePredictions: async () => {},
        syncWeekStats: async args => { await syncPlayerWeeklyScoresForRedraftSeason({ ...args, actorId: 'system:pirate-rehearsal-backfill' }) },
      })
      if (sweep.finalized) await updateStandings(season.id, season.currentWeek)
      const claimsCreated = await seedPirateClaims(leagueId)
      const claims = await maintainPirateClaims({ leagueId, limit: 8 })
      return { ok: claims.failed === 0, captured, scoresUpserted, finalized: sweep.finalized,
        refusals: sweep.refusals, claimsCreated, transferred: claims.transferred }
    }, r => ({ rowsWritten: r.captured + r.scoresUpserted + r.finalized + r.claimsCreated + r.transferred + ('gameStatsWritten' in r ? r.gameStatsWritten ?? 0 : 0),
      status: r.ok ? 'success' : 'failed', metadata: r }))
    return NextResponse.json({ ...result, pilot: daily ? 'daily' : 'nfl' }, { status: result.ok ? 200 : 500 })
  } catch {
    // No provider text, database URLs, or request headers in an externally visible error.
    return NextResponse.json({ ok: false, error: 'Staging rehearsal task failed; inspect its heartbeat.' }, { status: 500 })
  }
}
