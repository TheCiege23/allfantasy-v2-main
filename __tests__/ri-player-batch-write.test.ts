import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE WRITE, NOT THE FETCH, WAS THE UNBOUNDED HALF.
 *
 * `syncRollingInsightsPlayersToDb` clamped each `player-info` request to `deadlineAt`, then wrote
 * every row with its own awaited upsert and no deadline at all. NCAAF is ~69,600 players: the
 * `?riProfiles=1` NCAAF fire ran a median 722s on production (sync_job_runs 2026-10-11..17, 9 of 10
 * runs past 5 minutes, max 1,180s) against a 240s route budget and the edge's 5-minute cut.
 */

const { riFetchRowsMock, executeRawMock } = vi.hoisted(() => ({
  riFetchRowsMock: vi.fn(),
  executeRawMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workers/providers/rollingInsightsRest')>()
  return { ...actual, riFetchRows: riFetchRowsMock }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsTeam: { upsert: vi.fn().mockResolvedValue({}) },
    sportsPlayer: { upsert: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: executeRawMock,
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.resetModules()
})

const players = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ player_id: String(from + i), player: `Player ${from + i}` }))

/** Every value bound into the batched statements, flattened. */
function bound(callIndex: number): unknown[] {
  const out: unknown[] = []
  const walk = (v: unknown) => {
    if (v && typeof v === 'object' && 'values' in (v as object)) for (const x of (v as { values: unknown[] }).values) walk(x)
    else out.push(v)
  }
  for (const arg of executeRawMock.mock.calls[callIndex]!.slice(1)) walk(arg)
  return out
}

async function sync(opts: { deadlineAt?: number } = {}) {
  const { syncRollingInsightsPlayersToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
  return syncRollingInsightsPlayersToDb({ sport: 'NCAAF', ...opts })
}

describe('syncRollingInsightsPlayersToDb writes in batches', () => {
  it('1,201 players are three statements, not 1,201 round trips', async () => {
    riFetchRowsMock.mockResolvedValue({ rows: players(1201), notModified: false, error: null })
    executeRawMock.mockResolvedValue(0)
    const res = await sync()
    expect(executeRawMock).toHaveBeenCalledTimes(3)
    expect(res.written).toBe(1201)
    expect(res.fetched).toBe(1201)
  })

  it('a vendor duplicate is written once, with its LAST row — as the per-row upsert left it', async () => {
    riFetchRowsMock.mockResolvedValue({
      rows: [
        { player_id: '9', player: 'First Spelling' },
        { player_id: '9', player: 'Second Spelling' },
      ],
      notModified: false,
      error: null,
    })
    executeRawMock.mockResolvedValue(0)
    const res = await sync()
    expect(res.written).toBe(1)
    const values = bound(0)
    expect(values).toContain('Second Spelling')
    expect(values).not.toContain('First Spelling')
  })

  it('stops between batches at the deadline and reports what it left, instead of running on', async () => {
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    riFetchRowsMock.mockResolvedValue({ rows: players(1500), notModified: false, error: null })
    // Each statement costs 10s of the 25s left: the third must not start.
    executeRawMock.mockImplementation(async () => {
      clock += 10_000
      return 500
    })
    const res = await sync({ deadlineAt: clock + 25_000 })
    expect(executeRawMock).toHaveBeenCalledTimes(3 - 0) // 0s, 10s, 20s all start before 25s
    clock = 1_000_000
    executeRawMock.mockClear()
    executeRawMock.mockImplementation(async () => {
      clock += 15_000
      return 500
    })
    const res2 = await sync({ deadlineAt: clock + 25_000 })
    expect(executeRawMock).toHaveBeenCalledTimes(2) // 0s and 15s start; 30s is past the deadline
    expect(res2.written).toBe(1000)
    expect(res2.deferredLeagues).toEqual(['all (500 players unwritten)'])
    expect(res.deferredLeagues).toEqual([])
  })

  it('a failed batch is reported and the next batch still runs', async () => {
    riFetchRowsMock.mockResolvedValue({ rows: players(700), notModified: false, error: null })
    executeRawMock.mockRejectedValueOnce(new Error('deadlock detected')).mockResolvedValue(0)
    const res = await sync()
    expect(executeRawMock).toHaveBeenCalledTimes(2)
    expect(res.written).toBe(200)
    expect(res.errors.some((e) => e.includes('batch 0') && e.includes('deadlock'))).toBe(true)
  })

  it('a missing headshot binds NULL, so the statement keeps the stored image', async () => {
    riFetchRowsMock.mockResolvedValue({
      rows: [{ player_id: '1', player: 'No Photo', img: 'contact_support' }],
      notModified: false,
      error: null,
    })
    executeRawMock.mockResolvedValue(0)
    await sync()
    const sql = (executeRawMock.mock.calls[0]![0] as readonly string[]).join('?')
    expect(sql).toContain('COALESCE(EXCLUDED."imageUrl", "SportsPlayer"."imageUrl")')
    expect(bound(0)).not.toContain('contact_support')
  })
})
