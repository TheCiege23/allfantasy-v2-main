import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { pirateRehearsalEnabled, isPirateRehearsalLeague } from '@/lib/pirate/stagingRehearsalScope'
import { capturePirateLineupEvidence } from '@/lib/pirate/lineupEvidence'
import { seedPirateClaims, maintainPirateClaims } from '@/lib/pirate/service'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { finalizeCompletedWeeksForSeason } from '@/lib/redraft/weekFinalizer'
import { isRedraftWeekSealed } from '@/lib/redraft/weekSealed'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { syncRiSeasonSchedule } from '@/lib/sports-data/riSeasonSchedule'
import { scheduleKeyPrefix, type ScheduleCacheDb } from '@/lib/sports-data/riScheduleCache'

export const dynamic = 'force-dynamic'
export const maxDuration = 240

/** A fixed, bot-owned fixture only. The ordinary production score-sync is unchanged. */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) return NextResponse.json({ ok: false }, { status: 401 })
  if (!pirateRehearsalEnabled(process.env)) return NextResponse.json({ ok: false, disabled: true }, { status: 404 })
  const task = request.nextUrl.searchParams.get('task') || 'capture'
  if (!['capture', 'score', 'schedules'].includes(task)) return NextResponse.json({ ok: false }, { status: 400 })
  const leagueId = process.env.PIRATE_REHEARSAL_LEAGUE_ID!
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: {
    id: true, tenantId: true, platform: true, leagueType: true, leagueVariant: true, settings: true,
  } })
  if (!league || !isPirateRehearsalLeague(league, leagueId)) return NextResponse.json({ ok: false }, { status: 409 })
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, status: 'active' },
    select: { id: true, season: true, sport: true, currentWeek: true, rosters: { select: { ownerId: true } } } })
  // Rehearsal claim events may enter the outbox, but only for these uncontactable QA accounts.
  if (!season || season.sport !== 'NFL' || season.currentWeek < 1 || !season.rosters.length) {
    return NextResponse.json({ ok: false }, { status: 409 })
  }
  const owners = await prisma.appUser.findMany({ where: { id: { in: season.rosters.map(r => r.ownerId) } }, select: { id: true, email: true } })
  if (season.rosters.some(r => !owners.some(u => u.id === r.ownerId && u.email?.endsWith('@example.invalid')))) {
    return NextResponse.json({ ok: false }, { status: 409 })
  }
  try {
    const result = await withSyncJobRun({ jobName: `cron-pirate-rehearsal-${task}`, jobScope: leagueId, trigger: 'cron', sport: 'NFL' }, async () => {
      const input = { leagueId, seasonId: season.id, season: season.season, week: season.currentWeek }
      const captured = await capturePirateLineupEvidence(input)
      if (task === 'capture') return { ok: true, captured, scoresUpserted: 0, finalized: 0, claimsCreated: 0, transferred: 0 }
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
    }, r => ({ rowsWritten: r.captured + r.scoresUpserted + r.finalized + r.claimsCreated + r.transferred,
      status: r.ok ? 'success' : 'failed', metadata: r }))
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch {
    // No provider text, database URLs, or request headers in an externally visible error.
    return NextResponse.json({ ok: false, error: 'Staging rehearsal task failed; inspect its heartbeat.' }, { status: 500 })
  }
}
