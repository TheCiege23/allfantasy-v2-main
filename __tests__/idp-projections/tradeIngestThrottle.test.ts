import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Throttling the trade sweep.
 *
 * The politeness half is obvious: the old loop fired all eighteen weeks of a season with one
 * `Promise.all`, which is rude at one league and indefensible across eighty.
 *
 * The correctness half is not, and matters more. A 429 used to return null, exactly like a
 * week with no trades in it, so the caller's `anyFeed` check could record a perfectly healthy
 * league as having no trade feed. Under a sweep large enough to actually get throttled, that
 * writes silence into the warehouse and it looks like data.
 */

const prismaStub = {
  league: { findMany: vi.fn(async () => []) },
  transactionFact: { upsert: vi.fn(async () => ({})) },
}
vi.mock('@/lib/prisma', () => ({ prisma: prismaStub }))
vi.mock('@/lib/psychological-profiles/SportBehaviorResolver', () => ({
  normalizeSportForPsych: (s: string) => s,
}))

const LEAGUE = {
  id: 'lg1',
  platformLeagueId: '999',
  sport: 'NFL',
  season: 2026,
}

/** One completed trade, so a successful sweep has something to write. */
const TRADE = {
  transaction_id: 'tx1',
  type: 'trade',
  status: 'complete',
  roster_ids: [1, 2],
  adds: { '100': 1 },
  drops: { '100': 2 },
  draft_picks: [],
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  prismaStub.league.findMany.mockResolvedValue([LEAGUE] as never)
})

async function load() {
  return await import('@/lib/psychological-profiles/SleeperTradeFactIngest')
}

describe('trade ingest — rate limiting is reported, not mistaken for silence', () => {
  it('retries a 429 and succeeds without reporting a limit', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls += 1
      if (String(url).endsWith('/league/999')) {
        return res(200, { league_id: '999', season: '2026', previous_league_id: null })
      }
      // First transactions call is throttled, the retry succeeds.
      if (calls % 7 === 0) return res(429, null, { 'retry-after': '0' })
      return res(200, [TRADE])
    }))

    const { ingestSleeperTradeFacts } = await load()
    const out = await ingestSleeperTradeFacts({ leagueIds: ['lg1'] })

    expect(out.rateLimited).toBe(0)
    expect(out.tradesFound).toBeGreaterThan(0)
    expect(out.feedUnavailable).toBe(0)
  }, 60000)

  it('reports a week that stays throttled instead of calling it empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/league/999')) {
        return res(200, { league_id: '999', season: '2026', previous_league_id: null })
      }
      return res(429, null, { 'retry-after': '0' })
    }))

    const { ingestSleeperTradeFacts } = await load()
    const out = await ingestSleeperTradeFacts({ leagueIds: ['lg1'] })

    /*
     * The whole point: every week was throttled, so the sweep saw nothing — and it says so
     * rather than recording a league that trades regularly as having no trades.
     */
    expect(out.rateLimited).toBeGreaterThan(0)
    expect(out.tradesFound).toBe(0)
  }, 60000)

  it('does not retry a 404, which is a real answer', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/league/999')) {
        return res(200, { league_id: '999', season: '2026', previous_league_id: null })
      }
      return res(404, null)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ingestSleeperTradeFacts } = await load()
    const out = await ingestSleeperTradeFacts({ leagueIds: ['lg1'] })

    expect(out.rateLimited).toBe(0)
    // 1 league lookup + 18 weeks, each asked exactly once.
    expect(fetchMock.mock.calls.length).toBe(19)
  }, 60000)

  it('never has more than the configured number of requests in flight', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      if (String(url).endsWith('/league/999')) {
        return res(200, { league_id: '999', season: '2026', previous_league_id: null })
      }
      return res(200, [])
    }))

    const { ingestSleeperTradeFacts } = await load()
    await ingestSleeperTradeFacts({ leagueIds: ['lg1'] })

    // The old code fired all 18 weeks at once.
    expect(peak).toBeLessThanOrEqual(4)
  }, 60000)
})
