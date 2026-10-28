/** Notification-free live provider preparation for the isolated Pirate staging database. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

assert.equal(process.env.PIRATE_STAGE_LIVE_DATA, '1', 'Explicit PIRATE_STAGE_LIVE_DATA=1 required for provider requests')
const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || 'G:/allfantasy-v2-main/.env.staging'))
const main = dotenv.parse(fs.readFileSync(process.env.PIRATE_PRODUCTION_ENV || 'G:/allfantasy-v2-main/.env'))
const host = new URL(stage.DATABASE_URL).hostname.replace('-pooler', '')
assert(host.includes('winter-salad') && host !== new URL(main.DATABASE_URL).hostname.replace('-pooler', ''), 'Verified separate staging required')
const providerKeys = ['ROLLING_INSIGHTS_API_KEY', 'ROLLING_INSIGHTS_CLIENT_ID', 'ROLLING_INSIGHTS_CLIENT_SECRET',
  'ROLLING_INSIGHTS_CLIENT_ID2', 'ROLLING_INSIGHTS_CLIENT_SECRET2', 'ROLLING_INSIGHTS_REST_BASE',
  'ROLLING_INSIGHTS_BASE_URL', 'ROLLING_INSIGHTS_RSC_TOKEN']
Object.assign(process.env, stage, Object.fromEntries(providerKeys.filter(key => main[key]).map(key => [key, main[key]])),
  { DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL, NODE_ENV: 'test' })
const RuntimeClient: typeof PrismaClient = process.env.PIRATE_PRISMA_CLIENT
  ? createRequire(`${process.cwd()}/package.json`)(process.env.PIRATE_PRISMA_CLIENT).PrismaClient : PrismaClient
const db = new RuntimeClient({ datasources: { db: { url: stage.DATABASE_URL } } })
;(globalThis as unknown as { prisma: PrismaClient }).prisma = db
// Provider diagnostics may include request details. Emit only the bounded summary below.
const output = console.log.bind(console)
console.log = console.warn = console.error = () => {}

async function run() {
  const [{ syncRollingInsightsInjuriesToDb }, { syncEspnInjuriesToDb }, { recordInjurySyncRun },
    { syncRiSeasonSchedule }, { readRiScheduleWindow }] = await Promise.all([
    import('../lib/injuries/rollingInsightsInjuries'), import('../lib/injuries/espnInjuries'),
    import('../lib/injuries/injurySyncState'), import('../lib/sports-data/riSeasonSchedule'), import('../lib/sports-data/riScheduleCache'),
  ])
  const now = new Date(), season = Number(process.env.PIRATE_REHEARSAL_SEASON || now.getUTCFullYear())
  assert(Number.isInteger(season) && season >= 2025 && season <= 2100)
  const outcomes = await Promise.allSettled(['NFL', 'NBA', 'MLB', 'NHL'].map(async sport => {
    const [ri, espn, schedule] = await Promise.all([
      syncRollingInsightsInjuriesToDb({ sport }), syncEspnInjuriesToDb({ sport }),
      sport === 'NFL' ? Promise.resolve(null) : syncRiSeasonSchedule({ sport, season, db: db as never }),
    ])
    const providerErrored = ri.errors.length > 0 || espn.errors.length > 0 || ri.unsupported || ri.notModified
    const cleanEmpty = !providerErrored && ri.fetched === 0 && espn.fetched === 0
    const failed = providerErrored || (!cleanEmpty && ri.written === 0 && espn.written === 0)
    const completeForLineup = !failed && ri.unparseableStatus === 0
    const completeCoverageForLineup = !failed && espn.skippedNoPlayer === 0
    await recordInjurySyncRun({ sport, written: ri.written + espn.written, fetched: ri.fetched + espn.fetched,
      failed, error: providerErrored ? 'A provider did not return a clean complete injury response.' : null, completeForLineup, completeCoverageForLineup })
    const feed = await db.providerSyncState.findFirst({ where: { provider: 'injuries-cron', entityType: 'injuries', sport, key: 'lineup-evidence-v2' },
      select: { lastSuccessAt: true, lastErrorAt: true } })
    const upcoming = sport === 'NFL'
      ? await db.sportsGame.count({ where: { sport, season, startTime: { gte: now, lt: new Date(now.getTime() + 7 * 86400000) } } })
      : (await readRiScheduleWindow(db as never, { sport, season, window: { start: now, end: new Date(now.getTime() + 7 * 86400000) } }))?.length ?? 0
    return { sport, injuries: { fetched: ri.fetched + espn.fetched, written: ri.written + espn.written,
      providerErrored, unparseableStatuses: ri.unparseableStatus, completeForLineup, completeCoverageForLineup, attestedAt: feed?.lastSuccessAt ?? null },
      schedule: { fetched: schedule?.fetched ?? false, gamesImported: schedule?.games ?? 0,
        providerErrored: !!schedule?.error, upcomingGames: upcoming } }
  }))
  const results = outcomes.map((result, index) => result.status === 'fulfilled' ? result.value :
    { sport: ['NFL', 'NBA', 'MLB', 'NHL'][index], failed: true })
  const report = { checkedAt: new Date().toISOString(), scope: 'Live provider ingestion into verified isolated staging. No notification delivery.', results }
  fs.writeFileSync('docs/pirate-validation/live-rehearsal-readiness.json', JSON.stringify(report, null, 2))
  output(JSON.stringify(report, null, 2))
  if (outcomes.some(result => result.status === 'rejected' ||
      !result.value.injuries.completeCoverageForLineup || result.value.schedule.providerErrored)) process.exitCode = 1
}
run().catch(() => { output('Live staging preparation failed; credentials and provider diagnostics omitted.'); process.exitCode = 1 })
  .finally(() => db.$disconnect())
