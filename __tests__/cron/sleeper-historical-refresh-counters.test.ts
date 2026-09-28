/**
 * `/api/cron/sleeper-historical-refresh` reports what the matchup sync's completion gate did.
 *
 * Before this, the route kept only "refreshed / failed" per league, so the gate added in #995
 * (refresh a finished season once if it was stored before it settled, then leave it alone) could
 * not be seen from the cron log or the SyncJobRun row. And a league whose matchup sync failed
 * still counted as refreshed, because that sync reports its error instead of throwing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  dynastyBackfillStatus: { findMany: vi.fn() },
  league: { findMany: vi.fn() },
}))
const backfill = vi.hoisted(() => ({ syncSleeperHistoricalBackfillAfterImport: vi.fn() }))
const telemetry = vi.hoisted(() => ({ outcomes: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalBackfillService', () => backfill)
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
    const result = await fn()
    telemetry.outcomes.push(extract ? extract(result) : undefined)
    return result
  },
}))

const { GET } = await import('@/app/api/cron/sleeper-historical-refresh/route')
const { addMatchupSeasonCounters, emptyMatchupSeasonCounters } = await import(
  '@/lib/league-import/sleeper/historicalRefreshCounters'
)

const SECRET = 'test-cron-secret'

function request(auth = `Bearer ${SECRET}`) {
  return new Request('http://localhost/api/cron/sleeper-historical-refresh', { headers: { authorization: auth } })
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  telemetry.outcomes.length = 0
  db.dynastyBackfillStatus.findMany.mockReset()
  db.league.findMany.mockReset()
  backfill.syncSleeperHistoricalBackfillAfterImport.mockReset()

  // Three starved leagues, nobody viewing anything.
  db.dynastyBackfillStatus.findMany.mockResolvedValue([
    { leagueId: 'L1', updatedAt: new Date('2026-09-01T00:00:00Z') },
    { leagueId: 'L2', updatedAt: new Date('2026-09-01T00:00:00Z') },
    { leagueId: 'L3', updatedAt: new Date('2026-09-01T00:00:00Z') },
  ])
  db.league.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
    args?.where && 'lastViewedAt' in args.where
      ? []
      : [
          { id: 'L1', isDynasty: true },
          { id: 'L2', isDynasty: true },
          { id: 'L3', isDynasty: false },
        ],
  )
  backfill.syncSleeperHistoricalBackfillAfterImport.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
    if (leagueId === 'L1') {
      return {
        attempted: true,
        skipped: false,
        matchups: { attempted: true, refreshed: true, skipped: false, seasonsProcessed: 2, seasonsSkippedComplete: 5, completedSeasonsRefreshed: 1 },
      }
    }
    if (leagueId === 'L2') {
      // The matchup sync caught its own failure; the league still "refreshes".
      return { attempted: true, skipped: false, matchups: { attempted: true, refreshed: false, skipped: false, error: 'boom' } }
    }
    throw new Error('league L3 exploded')
  })
})

describe('sleeper-historical-refresh counters', () => {
  it('sums the matchup gate across leagues into the response and the SyncJobRun row', async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()

    const expected = { processed: 2, skippedComplete: 5, completedRefreshed: 1, leaguesWithError: 1 }
    // ⚠ `ok` was hard-coded true, so a fire with a failed league read as clean. It now mirrors
    // decision-os-activity-ingest: ok only when nothing failed.
    expect(body).toMatchObject({ ok: false, status: 'partial', leaguesRefreshed: 2, leaguesFailed: 1 })
    expect(body.metadata.matchupSeasons).toEqual(expected)
    // The existing metadata is still there.
    expect(body.metadata).toMatchObject({ leagueCap: 25, budgetMs: 240_000 })

    expect(telemetry.outcomes).toHaveLength(1)
    expect((telemetry.outcomes[0] as { metadata: Record<string, unknown> }).metadata.matchupSeasons).toEqual(expected)
  })

  it('reports zeros, not nothing, when no league touched a season', async () => {
    backfill.syncSleeperHistoricalBackfillAfterImport.mockResolvedValue({ attempted: true, skipped: false })
    const body = await (await GET(request())).json()
    expect(body.metadata.matchupSeasons).toEqual(emptyMatchupSeasonCounters())
    expect(body.leaguesRefreshed).toBe(3)
  })

  /*
   * 🛑 `syncSleeperHistoricalBackfillAfterImport` CATCHES ITS OWN BACKFILL ERROR and returns
   * `backfill.success === false`, so the route's try/catch never fired and the league counted as
   * refreshed. A fire where every backfill failed recorded `success` and answered `ok: true`.
   */
  it('counts a league whose backfill reported success=false as FAILED, not refreshed', async () => {
    backfill.syncSleeperHistoricalBackfillAfterImport.mockImplementation(async ({ leagueId }: { leagueId: string }) =>
      leagueId === 'L2'
        ? {
            attempted: true,
            skipped: false,
            backfill: {
              success: false,
              status: 'failed',
              seasonsDiscovered: 0,
              seasonsImported: 0,
              seasonsSkipped: 0,
              tradesPersisted: 0,
              failureMessage: 'sleeper 503',
            },
          }
        : { attempted: true, skipped: false, backfill: { success: true, status: 'complete', seasonsDiscovered: 1, seasonsImported: 1, seasonsSkipped: 0, tradesPersisted: 0 } },
    )
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, status: 'partial', leaguesRefreshed: 2, leaguesFailed: 1, rowsWritten: 2 })
    expect(body.errors).toEqual(['L2: backfill failed: sleeper 503'])

    const outcome = telemetry.outcomes[0] as { status: string; rowsWritten: number; errors: string[] }
    expect(outcome.status).toBe('partial')
    expect(outcome.rowsWritten).toBe(2)
    expect(outcome.errors).toEqual(['L2: backfill failed: sleeper 503'])
  })

  it('answers ok:true and success when every backfill succeeded', async () => {
    backfill.syncSleeperHistoricalBackfillAfterImport.mockResolvedValue({
      attempted: true,
      skipped: false,
      backfill: { success: true, status: 'complete', seasonsDiscovered: 1, seasonsImported: 0, seasonsSkipped: 1, tradesPersisted: 0 },
    })
    const body = await (await GET(request())).json()
    expect(body).toMatchObject({ ok: true, status: 'success', leaguesRefreshed: 3, leaguesFailed: 0 })
  })

  it('still refuses an unauthorised caller before doing any work', async () => {
    const res = await GET(request('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(backfill.syncSleeperHistoricalBackfillAfterImport).not.toHaveBeenCalled()
  })
})

describe('addMatchupSeasonCounters', () => {
  it('adds a summary and ignores a missing one', () => {
    const c = emptyMatchupSeasonCounters()
    addMatchupSeasonCounters(c, undefined)
    addMatchupSeasonCounters(c, null)
    addMatchupSeasonCounters(c, { attempted: true, refreshed: true, skipped: false, seasonsProcessed: 1, completedSeasonsRefreshed: 1 })
    addMatchupSeasonCounters(c, { attempted: true, refreshed: true, skipped: false, seasonsSkippedComplete: 3 })
    expect(c).toEqual({ processed: 1, skippedComplete: 3, completedRefreshed: 1, leaguesWithError: 0 })
  })

  it('never adds a value that is not a positive count', () => {
    const c = emptyMatchupSeasonCounters()
    addMatchupSeasonCounters(c, {
      attempted: true,
      refreshed: true,
      skipped: false,
      seasonsProcessed: Number.NaN,
      seasonsSkippedComplete: -2,
      completedSeasonsRefreshed: Number.POSITIVE_INFINITY,
    })
    expect(c).toEqual(emptyMatchupSeasonCounters())
  })

  it('counts a league whose matchup sync reported an error once', () => {
    const c = emptyMatchupSeasonCounters()
    addMatchupSeasonCounters(c, { attempted: true, refreshed: false, skipped: false, error: 'rate limited' })
    addMatchupSeasonCounters(c, { attempted: true, refreshed: false, skipped: false, error: 'rate limited' })
    expect(c.leaguesWithError).toBe(2)
  })
})
