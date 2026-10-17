import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/legacy/player-game-logs — the legacy player modal's game-log table.
 *
 * Two wrong-data bugs pinned here:
 *  - the season defaulted to a hard-coded '2025', so the 2026 season could not be the default;
 *  - every week's opponent was built from the player's CURRENT team, so a past season for a
 *    player who has since moved showed the new team's schedule.
 */

const findUniqueMock = vi.hoisted(() => vi.fn())
const upsertMock = vi.hoisted(() => vi.fn())
const canonicalMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { playerGameLogCache: { findUnique: findUniqueMock, upsert: upsertMock } },
}))
// The player's CURRENT team. If the route consults it for opponents, the MIA schedule leaks in.
vi.mock('@/lib/canonical/getCanonicalPlayer', () => ({
  getCanonicalPlayersBySleeperIds: canonicalMock,
}))

const SCHEDULE_2024 = [
  { week: 1, home: 'KC', away: 'BAL' },
  { week: 1, home: 'MIA', away: 'JAX' },
  { week: 2, home: 'CIN', away: 'KC' },
  { week: 2, home: 'BUF', away: 'MIA' },
  { week: 3, home: 'ATL', away: 'KC' },
  { week: 3, home: 'MIA', away: 'SEA' },
]

/** Keyed by week; the stat line nested under `stats`, game facts on the row (bye week = null). */
const STATS_2024 = {
  '1': { week: 1, team: 'KC', opponent: 'BAL', stats: { pts_ppr: 21.5, rec: 6, rec_yd: 88 } },
  '2': { week: 2, team: 'KC', stats: { pts_ppr: 9.1, rec: 3 } },
  '3': { week: 3, stats: { pts_ppr: 4.2 } },
  '4': null,
}

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/schedule/nfl/regular/')) return { ok: true, json: async () => SCHEDULE_2024 }
  if (url.includes('/stats/nfl/player/')) return { ok: true, json: async () => STATS_2024 }
  return { ok: false, json: async () => null }
})

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/server/api-route-modules/legacy/player-game-logs/route')
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/legacy/player-game-logs', { method: 'POST', body: JSON.stringify(body) }),
  )
  return { status: res.status, json: (await res.json()) as any }
}

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueMock.mockResolvedValue(null)
  upsertMock.mockResolvedValue({})
  canonicalMock.mockResolvedValue(new Map([['4866', { team: 'MIA' }]]))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('legacy player-game-logs default season', () => {
  it('defaults to the current NFL season (2026 in October 2026), not a hard-coded 2025', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
    const { status, json } = await post({ player_id: '4866' })
    expect(status).toBe(200)
    expect(json.season).toBe('2026')
    const statsCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/stats/nfl/player/'))
    expect(String(statsCall?.[0])).toContain('season=2026')
  })

  it('still honours an explicitly requested season', async () => {
    const { json } = await post({ player_id: '4866', season: '2024' })
    expect(json.season).toBe('2024')
  })
})

describe('legacy player-game-logs opponents', () => {
  it("takes each opponent from the game row or that week's team, never from the current team", async () => {
    const { status, json } = await post({ player_id: '4866', season: '2024' })
    expect(status).toBe(200)
    const byWeek = new Map(json.gameLogs.map((g: { week: number }) => [g.week, g]))
    // Row states its opponent -> used as stated.
    expect((byWeek.get(1) as any).opponent).toBe('BAL')
    // Row states its team (KC) but not the opponent -> KC's game that week, not MIA's (@BUF).
    expect((byWeek.get(2) as any).opponent).toBe('@CIN')
    // Row states neither -> omitted, NOT invented from the current team (MIA vs SEA).
    expect((byWeek.get(3) as any).opponent).toBeUndefined()
    expect(byWeek.has(4)).toBe(false)
  })

  it('reads the stat line when Sleeper nests it under `stats`', async () => {
    const { json } = await post({ player_id: '4866', season: '2024' })
    const week1 = json.gameLogs.find((g: { week: number }) => g.week === 1)
    expect(week1.pts_ppr).toBe(21.5)
    expect(week1.rec_yd).toBe(88)
  })
})
