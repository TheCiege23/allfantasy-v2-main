import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy reported "no player stats" for college football while 5,530 NCAAF stat
 * lines sat in the database.
 *
 * The digest queried player_season_stats, which holds NFL only, by a playerName
 * COLUMN. College stats live in fantasy_stat_lines, where the player name is
 * inside the stats JSON — so the query could not match, returned nothing, and
 * the readiness map honestly reported the category missing. The data was there;
 * the reader was pointed at the wrong table.
 */

const playerSeasonStats = vi.fn()
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
          if (model === 'fantasyStatLine') return { findMany: (...a: unknown[]) => fantasyStatLine(...a) }
          return empty
        },
      }
    ),
  }
})

const NCAAF_ROW = {
  playerId: '550577',
  team: 'Fresno State',
  season: '2025',
  week: 0,
  updatedAt: new Date('2026-08-10'),
  stats: {
    name: 'Jordan Brown',
    riPlayerName: 'Jordan Brown',
    position: 'WR',
    regular_season: {
      games_played: 6,
      DK_fantasy_points: 25.2,
      DK_fantasy_points_per_game: 4.2,
      'receiving.YDS': 92,
    },
  },
}

async function digest(sport: 'NCAAF' | 'NFL', question: string) {
  const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
  return buildChimmySportDataDigest({ sport, question, includeNewsApi: false })
}

beforeEach(() => {
  vi.resetModules()
  playerSeasonStats.mockReset().mockResolvedValue([])
  fantasyStatLine.mockReset().mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('college stats reach Chimmy', () => {
  it('falls back to fantasy stat lines when the NFL-only table has nothing', async () => {
    fantasyStatLine.mockResolvedValue([NCAAF_ROW])
    const d = await digest('NCAAF', 'how did Jordan Brown do? stats')

    expect(d.text).toContain('Jordan Brown')
    expect(d.text).toContain('G: 6')
    expect(d.text).toContain('PPG: 4.2')
    expect(d.readiness.NCAAF?.hasPlayerStats).toBe(true)
    expect(d.readiness.NCAAF?.missingData).not.toContain('player stats')
  })

  it('states which season the totals cover', async () => {
    // These are completed-season aggregates. The 2026 college season has not
    // kicked off, so an unlabelled number reads as current-year form.
    fantasyStatLine.mockResolvedValue([NCAAF_ROW])
    const d = await digest('NCAAF', 'Jordan Brown stats')
    expect(d.text).toContain('[2025 season totals]')
  })

  it('matches an ALL-CAPS mention against the Title Case stored name', async () => {
    // The JSON filter is case-sensitive in Postgres, so a normalised variant is
    // tried alongside the raw mention.
    //
    // A fully lowercase mention is NOT covered here, and deliberately so: the
    // upstream extractor only treats capitalised token pairs as player names, so
    // "jordan brown" never becomes a mention in the first place. Asserting it
    // would be testing behaviour that cannot occur.
    fantasyStatLine.mockResolvedValue([NCAAF_ROW])
    await digest('NCAAF', 'JORDAN BROWN stats')
    const filters = fantasyStatLine.mock.calls[0]?.[0]?.where?.OR ?? []
    const names = filters.map((f: Record<string, any>) => f.stats?.string_contains)
    expect(names).toContain('Jordan Brown')
    expect(names).toContain('JORDAN BROWN')
  })

  it('reports the category missing when neither table has the player', async () => {
    // Absence still has to be reported as absence — the fallback must not
    // manufacture a section out of an empty result.
    const d = await digest('NCAAF', 'Nobody Here stats')
    expect(d.readiness.NCAAF?.missingData).toContain('player stats')
    expect(d.text).not.toContain('Player season stats')
  })
})

describe('the NFL path is untouched', () => {
  it('uses player_season_stats and never reaches the fallback', async () => {
    playerSeasonStats.mockResolvedValue([
      {
        playerName: 'Josh Allen',
        team: 'BUF',
        season: 2025,
        updatedAt: new Date('2026-08-10'),
        stats: { DK_fantasy_points: 384.62, DK_fantasy_points_per_game: 22.62 },
      },
    ])
    const d = await digest('NFL', 'Josh Allen stats')

    expect(d.text).toContain('Josh Allen')
    expect(fantasyStatLine).not.toHaveBeenCalled()
    expect(d.readiness.NFL?.hasPlayerStats).toBe(true)
  })
})
