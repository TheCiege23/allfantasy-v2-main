/**
 * @vitest-environment node
 *
 * `/api/cron/sleeper-historical-refresh` picks leagues that exist.
 *
 * Production 2026-11-20: 93 `dynasty_backfill_status` rows belonged to deleted leagues. They were
 * the oldest rows, so they filled the 15 reserved slots on every fire and were then dropped by the
 * league lookup. Each fire refreshed 10 leagues instead of 25, always the most recently viewed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  dynastyBackfillStatus: { findMany: vi.fn(), updateMany: vi.fn() },
  league: { findMany: vi.fn() },
}))
const backfill = vi.hoisted(() => ({ syncSleeperHistoricalBackfillAfterImport: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalBackfillService', () => backfill)
vi.mock('@/lib/league-import/sleeper/followRenewedLeagues', () => ({
  followRenewedSleeperLeagues: async () => ({}),
}))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))

const { GET } = await import('@/app/api/cron/sleeper-historical-refresh/route')
const { orderByStaleness } = await import('@/lib/league-import/rotationPolicy')

const SECRET = 'test-cron-secret'
const fire = async () =>
  (await GET(new Request('http://localhost/api/cron/sleeper-historical-refresh', { headers: { authorization: `Bearer ${SECRET}` } }))).json()

const day = (n: number) => new Date(Date.UTC(2026, 8, n))
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const refreshed = () => backfill.syncSleeperHistoricalBackfillAfterImport.mock.calls.map((c) => (c[0] as { leagueId: string }).leagueId)

function seed(args: { live: string[]; viewed: string[]; statuses: Array<{ leagueId: string; updatedAt: Date }> }) {
  db.league.findMany.mockImplementation(async (q: { where?: Record<string, unknown> }) =>
    q?.where && 'lastViewedAt' in q.where
      ? args.viewed.map((id) => ({ id }))
      : args.live.map((id) => ({ id, isDynasty: true })),
  )
  db.dynastyBackfillStatus.findMany.mockResolvedValue(args.statuses)
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  db.league.findMany.mockReset()
  db.dynastyBackfillStatus.findMany.mockReset()
  db.dynastyBackfillStatus.updateMany.mockReset().mockResolvedValue({ count: 1 })
  backfill.syncSleeperHistoricalBackfillAfterImport.mockReset().mockResolvedValue({ attempted: true, skipped: false })
})

describe('sleeper-historical-refresh rotation', () => {
  it('status rows of deleted leagues take no slots: a full fire of real leagues is refreshed', async () => {
    const live = ids('L', 40)
    const gone = ids('GONE', 30)
    seed({
      live,
      viewed: live.slice(30),
      statuses: [
        // The deleted leagues are the OLDEST rows, exactly as in production.
        ...gone.map((leagueId, i) => ({ leagueId, updatedAt: new Date(Date.UTC(2026, 5, 1 + i)) })),
        ...live.map((leagueId, i) => ({ leagueId, updatedAt: new Date(Date.UTC(2026, 8, 1, i)) })),
      ],
    })

    const body = await fire()

    expect(body.leaguesConsidered).toBe(25)
    expect(refreshed()).toHaveLength(25)
    expect(refreshed().some((id) => id.startsWith('GONE'))).toBe(false)
    // The reserved floor went to starved leagues, oldest first; the rest to the viewed ones.
    expect(refreshed().slice(0, 15)).toEqual(ids('L', 15))
    expect(refreshed().slice(15)).toEqual(live.slice(30))
    expect(body.metadata).toMatchObject({ leaguesSelected: 25, statusRowsWithoutLeague: 30 })
  })

  it('a league with no status row has never been refreshed and goes first', async () => {
    seed({ live: ['A', 'B', 'NEW'], viewed: [], statuses: [{ leagueId: 'A', updatedAt: day(2) }, { leagueId: 'B', updatedAt: day(1) }] })
    await fire()
    expect(refreshed()).toEqual(['NEW', 'B', 'A'])
  })

  it('a league that throws is sent to the back of the queue instead of holding its slot', async () => {
    seed({ live: ['A'], viewed: [], statuses: [{ leagueId: 'A', updatedAt: day(1) }] })
    backfill.syncSleeperHistoricalBackfillAfterImport.mockRejectedValue(new Error('boom'))
    const body = await fire()
    expect(body.leaguesFailed).toBe(1)
    expect(db.dynastyBackfillStatus.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'A', provider: 'sleeper' } }),
    )
  })

  it('orderByStaleness: only existing leagues, never-refreshed first, and the cut-off is honoured', () => {
    const refreshedAtByLeagueId = new Map([['A', day(10)], ['B', day(1)], ['GONE', day(0)]])
    expect(orderByStaleness({ eligibleLeagueIds: ['A', 'B', 'C'], refreshedAtByLeagueId }).map((r) => r.leagueId)).toEqual(['C', 'B', 'A'])
    expect(
      orderByStaleness({ eligibleLeagueIds: ['A', 'B', 'C'], refreshedAtByLeagueId, olderThan: day(5) }).map((r) => r.leagueId),
    ).toEqual(['C', 'B'])
  })
})
