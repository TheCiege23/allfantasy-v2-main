import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `runSportsDataImporter` keyed seeds, ADP, season stats, projections, dynasty values and news by
 * NAME, first row wins. Measured on production 2026-10-11: LB Justin Jefferson (CLE) carried the WR's
 * ADP, guard Josh Allen carried 12.6, DB DJ Moore the WR's 47.5, and one of every pair of namesakes
 * stopped being written at all. Stats were the newest FETCH, not the newest season.
 *
 * The prisma double serves fixed rows per model and records every upserted row.
 */

const h = vi.hoisted(() => ({
  identity: [] as any[],
  owners: [] as any[],
  stats: [] as any[],
  adp: [] as any[],
  news: [] as any[],
  teams: [] as any[],
  statsArgs: [] as any[],
  written: new Map<string, any>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/api-chain', () => ({
  apiChain: { fetch: vi.fn(async () => ({ data: [], source: 'cache', latency: 0, cached: false })) },
}))
vi.mock('@/lib/prisma', () => {
  const empty = { findMany: async () => [] }
  return {
    prisma: {
      sportsTeam: { findMany: async () => h.teams },
      sportsPlayer: {
        findMany: async ({ where }: any) => (where?.source === 'sleeper' ? h.owners : []),
      },
      playerSeasonStats: {
        findMany: async (args: any) => {
          h.statsArgs.push(args)
          return h.stats
        },
      },
      injuryReportRecord: empty,
      playerNewsRecord: { findMany: async () => h.news },
      adpDataRecord: { findMany: async () => h.adp },
      playerMetaTrend: empty,
      sportsInjury: empty,
      syncJobRun: { findFirst: async () => null },
      playerIdentityMap: {
        findMany: async ({ where }: any) =>
          where?.rollingInsightsId
            ? h.identity.filter((r) => r.rollingInsightsId && r.sleeperId)
            : h.identity,
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      sportsPlayerRecord: {
        upsert: async ({ where, create }: any) => {
          h.written.set(where.id, create)
          return create
        },
        updateMany: async () => ({ count: 0 }),
        groupBy: async () => [],
      },
      $executeRaw: async () => 0,
    },
  }
})

const identity = (canonicalName: string, position: string, currentTeam: string, sleeperId: string, rollingInsightsId: string | null = null) => ({
  sport: 'NFL',
  canonicalName,
  position,
  currentTeam,
  sleeperId,
  rollingInsightsId,
  clearSportsId: null,
  status: null,
})
const owner = (sleeperId: string, name: string, position: string) => ({ sleeperId, name, position })
const adp = (playerName: string, position: string, team: string, value: number) => ({
  playerId: `NFL:${playerName.toLowerCase().replace(/\s+/g, '-')}:${position}:${team}`,
  playerName,
  position,
  team,
  adp: value,
  source: 'consensus',
})
const stat = (playerId: string, playerName: string, position: string, team: string, season: string, fetchedAt: Date, stats: object, source = 'rolling_insights') => ({
  playerId,
  playerName,
  position,
  team,
  season,
  source,
  fetchedAt,
  stats,
})

async function run() {
  const { runSportsDataImporter } = await import('@/lib/workers/sports-data-importer')
  return runSportsDataImporter({ sports: ['NFL'] })
}
const row = (id: string) => h.written.get(id)

beforeEach(() => {
  h.identity = []
  h.owners = []
  h.stats = []
  h.adp = []
  h.news = []
  h.teams = []
  h.statsArgs = []
  h.written.clear()
})

describe('namesakes are two athletes, each with his own values', () => {
  it('writes BOTH Justin Jeffersons, each with his own ADP', async () => {
    h.identity = [identity('Justin Jefferson', 'WR', 'MIN', '6794'), identity('Justin Jefferson', 'LB', 'CLE', '13524')]
    h.owners = [owner('6794', 'Justin Jefferson', 'WR'), owner('13524', 'Justin Jefferson', 'LB')]
    h.adp = [adp('Justin Jefferson', 'WR', 'MIN', 12.4), adp('Justin Jefferson', 'LB', 'CLE', 214.5)]

    await run()

    expect(row('NFL:6794')).toMatchObject({ name: 'Justin Jefferson', position: 'WR', team: 'MIN', adp: 12.4 })
    expect(row('NFL:13524')).toMatchObject({ name: 'Justin Jefferson', position: 'LB', team: 'CLE', adp: 214.5 })
  })

  it('a defensive namesake does not take the offensive player’s ADP or stats', async () => {
    // Only the DB is a seed this run; every value row with the name belongs to the WR.
    h.identity = [identity('DJ Moore', 'DB', 'FA', '4961')]
    h.owners = [owner('4983', 'DJ Moore', 'WR'), owner('4961', 'DJ Moore', 'DB')]
    h.adp = [adp('DJ Moore', 'WR', 'BUF', 47.5)]
    h.stats = [stat('3453', 'DJ Moore', 'WR', 'BUF', '2026', new Date(), { receivingYards: 610 })]

    await run()

    expect(row('NFL:4961')).toMatchObject({ position: 'DB', adp: null, stats: {} })
  })

  it('guard Josh Allen does not take the quarterback’s ADP', async () => {
    h.identity = [identity('Josh Allen', 'G', 'FA', '2212')]
    h.owners = [owner('4984', 'Josh Allen', 'QB'), owner('2212', 'Josh Allen', 'G')]
    h.adp = [adp('Josh Allen', 'QB', 'BUF', 12.6)]

    await run()

    expect(row('NFL:2212')).toMatchObject({ adp: null })
  })
})

describe('an ambiguous name binds to nobody', () => {
  it('two same-position candidates the seed cannot tell apart → no ADP, not the first one', async () => {
    h.identity = [identity('Mike Williams', 'WR', 'FA', '4068')]
    h.owners = [owner('4068', 'Mike Williams', 'WR')]
    h.adp = [adp('Mike Williams', 'WR', 'NYJ', 80.2), adp('Mike Williams', 'WR', 'PIT', 151.9)]

    await run()

    expect(row('NFL:4068')).toMatchObject({ adp: null })
  })
})

describe('a row that cannot tell two namesakes apart binds to neither', () => {
  it('teamless news for "DeVonta Smith" reaches neither the WR nor the CB; team-stated news reaches its own', async () => {
    h.identity = [identity('DeVonta Smith', 'WR', 'PHI', '7525'), identity('Devonta Smith', 'DB', 'CAR', '10048')]
    h.owners = [owner('7525', 'DeVonta Smith', 'WR'), owner('10048', 'Devonta Smith', 'DB')]
    h.news = [
      { playerName: 'DeVonta Smith', team: null, headline: 'Smith questionable', impact: 'high', source: 'cache', publishedAt: new Date('2026-10-10T12:00:00Z') },
      { playerName: 'Devonta Smith', team: 'CAR', headline: 'Panthers sign Smith', impact: 'low', source: 'espn', publishedAt: new Date('2026-10-09T12:00:00Z') },
    ]

    await run()

    expect(row('NFL:7525')?.news).toEqual([])
    expect(row('NFL:10048')?.news).toEqual([
      { headline: 'Panthers sign Smith', impact: 'low', source: 'espn', publishedAt: '2026-10-09T12:00:00.000Z' },
    ])
  })
})

describe('season stats are the newest SEASON, not the newest fetch', () => {
  it('a back-season line fetched this morning does not beat the current season fetched yesterday', async () => {
    h.identity = [identity("Ja'Marr Chase", 'WR', 'CIN', '7564', '6000')]
    h.owners = [owner('7564', "Ja'Marr Chase", 'WR')]
    const now = Date.now()
    // The order the old query returned them in: newest FETCH first.
    h.stats = [
      stat('6000', "Ja'Marr Chase", 'WR', 'CIN', '2023', new Date(now - 60_000), { season: 2023, receivingYards: 1216 }),
      stat('6000', "Ja'Marr Chase", 'WR', 'CIN', '2026', new Date(now - 86_400_000), { season: 2026, receivingYards: 402 }),
      stat('6000', "Ja'Marr Chase", 'WR', 'CIN', '2025', new Date(now - 3_600_000), { season: 2025, receivingYards: 1412 }),
    ]

    await run()

    expect(row('NFL:7564')?.stats).toEqual({ season: 2026, receivingYards: 402 })
  })

  it('reads stats newest SEASON first with no fetch-ordered 4,000-row cut', async () => {
    await run()
    const [args] = h.statsArgs
    expect(args.where).toEqual({ sport: 'NFL' })
    expect(args.orderBy).toEqual([{ season: 'desc' }, { fetchedAt: 'desc' }])
    // Production holds 11,869 NFL rows; the cap must clear them so every player's newest season is read.
    expect(args.take).toBeGreaterThanOrEqual(11_869)
    expect(args.select).toMatchObject({ season: true, source: true, position: true, team: true })
  })
})

describe('controls: an unambiguous player keeps every value', () => {
  it('a unique name binds ADP, news and stats exactly as before', async () => {
    h.identity = [identity('Puka Nacua', 'WR', 'LAR', '9493')]
    h.owners = [owner('9493', 'Puka Nacua', 'WR')]
    h.adp = [adp('Puka Nacua', 'WR', 'LAR', 9.1)]
    h.stats = [stat('tsdb_1', 'Puka Nacua', 'Wide Receiver', 'Los Angeles Rams', '2026', new Date(), { receivingYards: 700 }, 'thesportsdb')]
    h.news = [
      { playerName: 'Puka Nacua', team: null, headline: 'Nacua limited', impact: 'medium', source: 'cache', publishedAt: new Date('2026-10-10T12:00:00Z') },
    ]

    await run()

    expect(row('NFL:9493')).toMatchObject({ adp: 9.1, stats: { receivingYards: 700 } })
    expect(row('NFL:9493')?.news).toEqual([
      { headline: 'Nacua limited', impact: 'medium', source: 'cache', publishedAt: '2026-10-10T12:00:00.000Z' },
    ])
  })

  it('outside the NFL a full team name is an untranslatable spelling, not a contradiction', async () => {
    // Production MLB/NBA stats and news carry "Arizona Diamondbacks"; the seed carries a code, and MLB
    // records hold 65 codes for 30 clubs — here SportsTeam says "AZ" while the seed says "ARI".
    h.teams = [{ name: 'Arizona Diamondbacks', shortName: 'AZ' }]
    h.identity = [{ ...identity('Corbin Carroll', 'OF', 'ARI', '9001'), sport: 'MLB' }]
    h.stats = [stat('rp-1', 'Corbin Carroll', 'OF', 'Arizona Diamondbacks', '2025', new Date(), { homeRuns: 31 }, 'api_sports')]

    const { runSportsDataImporter } = await import('@/lib/workers/sports-data-importer')
    await runSportsDataImporter({ sports: ['MLB'] })

    expect(row('MLB:9001')?.stats).toEqual({ homeRuns: 31 })
  })

  it('a stat row binds BY ID through the Rolling Insights crosswalk even when its name differs', async () => {
    // The identity map files Josh Hines-Allen under "Josh Allen"; RI calls him Josh Hines-Allen.
    h.identity = [identity('Josh Allen', 'DL', 'JAX', '5840', '4321')]
    h.owners = [owner('5840', 'Josh Allen', 'DL')]
    h.stats = [stat('4321', 'Josh Hines-Allen', 'DL', 'JAX', '2026', new Date(), { sacks: 4 })]

    await run()

    expect(row('NFL:5840')?.stats).toEqual({ sacks: 4 })
  })
})
