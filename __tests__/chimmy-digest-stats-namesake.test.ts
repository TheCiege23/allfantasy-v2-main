import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chimmy's player-stats digest read `player_season_stats` with `contains` per mention and one shared
 * take. Production rows, 2026-10-12: "Michael Carter" is RB 7607 (TEN) and CB 7835 (PHI) in
 * SportsPlayer, and the stats table holds the RB as "Michael Carter" and the CB as "Michael Carter II"
 * — so one mention pulled both men's seasons into one list. A longer name that merely CONTAINS the
 * mention ("Josh Allen" in "Josh Allenby") was another man entirely.
 */

const playerSeasonStats = vi.fn()
const sportsPlayer = vi.fn()
const fantasyStatLine = vi.fn()

vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: async () => ({ facts: [], newestFetchedAt: null, feedStale: true }),
}))
vi.mock('@/lib/data/news', () => ({ getLatestNews: async () => [] }))
vi.mock('@/lib/news/newsapi-cache', () => ({ getNewsApiEverythingDbFirst: async () => ({ articles: [] }) }))
vi.mock('@/lib/prisma', () => {
  const empty = new Proxy({}, { get: () => async () => [] })
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, model: string) => {
          if (model === 'playerSeasonStats') return { findMany: (...a: unknown[]) => playerSeasonStats(...a) }
          if (model === 'sportsPlayer') return { findMany: (...a: unknown[]) => sportsPlayer(...a) }
          if (model === 'fantasyStatLine') return { findMany: (...a: unknown[]) => fantasyStatLine(...a) }
          return empty
        },
      },
    ),
  }
})

const row = (playerName: string, team: string, season: number, pts: number) => ({
  playerName,
  team,
  season,
  updatedAt: new Date('2026-10-01'),
  stats: { DK_fantasy_points: pts },
})

async function digest(question: string) {
  const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
  return buildChimmySportDataDigest({ sport: 'NFL', question, includeNewsApi: false })
}

beforeEach(() => {
  vi.resetModules()
  playerSeasonStats.mockReset().mockResolvedValue([])
  sportsPlayer.mockReset().mockResolvedValue([])
  fantasyStatLine.mockReset().mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('Chimmy player stats bind a name exactly, and refuse a shared one', () => {
  it('withholds Michael Carter: two Sleeper ids hold the name, and neither man’s seasons are shown', async () => {
    sportsPlayer.mockResolvedValue([
      { name: 'Michael Carter', sleeperId: '7607' },
      { name: 'Michael Carter', sleeperId: '7835' },
    ])
    playerSeasonStats.mockResolvedValue([
      row('Michael Carter', 'TEN', 2025, 80),
      row('Michael Carter II', 'PHI', 2025, 40),
    ])
    const d = await digest('Michael Carter stats')
    expect(d.text).not.toContain('Pts: 80')
    expect(d.text).not.toContain('Pts: 40')
    expect(d.text).toContain('more than one NFL player has this name')
    expect(fantasyStatLine).not.toHaveBeenCalled()
  })

  it('binds a unique name exactly — a longer name that merely contains it is another man', async () => {
    sportsPlayer.mockResolvedValue([{ name: 'Josh Allen', sleeperId: '4984' }])
    playerSeasonStats.mockResolvedValue([row('Josh Allenby', 'NYJ', 2025, 3), row('Josh Allen', 'BUF', 2025, 384)])
    const d = await digest('Josh Allen stats')
    expect(d.text).toContain('Pts: 384')
    expect(d.text).not.toContain('Josh Allenby')
  })

  it('gives each mention its own share of the cap', async () => {
    sportsPlayer.mockResolvedValue([
      { name: 'Josh Allen', sleeperId: '4984' },
      { name: 'Nico Collins', sleeperId: '7569' },
    ])
    playerSeasonStats.mockResolvedValue([
      ...Array.from({ length: 10 }, (_, i) => row('Josh Allen', 'BUF', 2025 - i, 300 + i)),
      row('Nico Collins', 'HOU', 2025, 222),
    ])
    const d = await digest('Josh Allen vs Nico Collins stats')
    expect(d.text).toContain('Pts: 222')
  })
})
