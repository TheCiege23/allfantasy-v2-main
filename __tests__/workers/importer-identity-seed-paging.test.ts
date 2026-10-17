import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `loadIdentitySeeds` read `take: 5000` of the sport's identity-map rows with NO `orderBy`. Production
 * holds 9,567 NFL rows (and 62,751 NCAAF), so on every run 4,567 NFL athletes were never seeded, and
 * WHICH ones was Postgres heap order. These pin: a sport above one page is read whole, in `id` order,
 * whatever order the table stores; a college sport rotates one page per run and wraps.
 *
 * The prisma double implements the parts of `findMany` the loader relies on — `where.sport`,
 * `where.id.gt`, `orderBy: { id: 'asc' }` and `take` — and returns storage order when no `orderBy` is
 * given, the way Postgres does.
 */

const h = vi.hoisted(() => ({
  identity: [] as any[],
  identityCalls: [] as any[],
  checkpoint: null as Record<string, string> | null,
  written: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/api-chain', () => ({
  apiChain: { fetch: vi.fn(async () => ({ data: [], source: 'cache', latency: 0, cached: false })) },
}))
vi.mock('@/lib/prisma', () => {
  const empty = { findMany: async () => [] }
  return {
    prisma: {
      sportsTeam: empty,
      sportsPlayer: empty,
      playerSeasonStats: empty,
      injuryReportRecord: empty,
      playerNewsRecord: empty,
      adpDataRecord: empty,
      playerMetaTrend: empty,
      sportsInjury: empty,
      syncJobRun: {
        findFirst: async () => (h.checkpoint ? { metadata: { seedCursors: h.checkpoint } } : null),
      },
      playerIdentityMap: {
        findMany: async (args: any) => {
          const where = args?.where ?? {}
          if (where.rollingInsightsId) return [] // the stats crosswalk read
          h.identityCalls.push(args)
          let rows = h.identity.filter((r) => r.sport === where.sport)
          if (where.id?.gt) rows = rows.filter((r) => r.id > where.id.gt)
          if (args.orderBy?.id === 'asc') rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          return typeof args.take === 'number' ? rows.slice(0, args.take) : rows
        },
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      sportsPlayerRecord: {
        upsert: async ({ where, create }: any) => {
          h.written.push(where.id)
          return create
        },
        updateMany: async () => ({ count: 0 }),
        groupBy: async () => [],
      },
      $executeRaw: async () => 0,
    },
  }
})

const pad = (n: number) => String(n).padStart(6, '0')
/** `count` distinct athletes; ids sort in index order, sleeper ids are distinct, names are unique. */
function athletes(sport: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `pim-${pad(i)}`,
    sport,
    canonicalName: `Player ${pad(i)}`,
    currentTeam: 'BUF',
    position: 'WR',
    sleeperId: sport === 'NFL' ? `s${pad(i)}` : null,
    clearSportsId: null,
    status: null,
  }))
}
/** Deterministic shuffle — a storage order unlike `id` order. */
function shuffled<T>(rows: T[], seed: number): T[] {
  const out = [...rows]
  let x = seed
  for (let i = out.length - 1; i > 0; i -= 1) {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
    const j = x % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

async function run(sport: string) {
  const { runSportsDataImporter } = await import('@/lib/workers/sports-data-importer')
  return runSportsDataImporter({ sports: [sport] })
}

beforeEach(() => {
  h.identity = []
  h.identityCalls = []
  h.checkpoint = null
  h.written = []
})

describe('a sport above one page is seeded whole, in a stable order', () => {
  it('seeds every one of 5,200 NFL identity athletes (the old read stopped at 5,000)', async () => {
    h.identity = shuffled(athletes('NFL', 5_200), 7)

    const result = await run('NFL')

    const written = new Set(h.written)
    expect(written.size).toBe(5_200)
    for (const row of h.identity) expect(written.has(`NFL:${row.sleeperId}`)).toBe(true)
    expect(result.identitySeeds.NFL).toMatchObject({ count: 5_200, exhausted: true, cursorEnd: null })
    // Paged by id, in id order — not one capped read.
    expect(h.identityCalls.map((c) => [c.orderBy, c.take, c.where.id?.gt ?? null])).toEqual([
      [{ id: 'asc' }, 5_000, null],
      [{ id: 'asc' }, 5_000, 'pim-004999'],
    ])
  })

  it('writes the same athletes in the same order whatever order the table stores them in', async () => {
    h.identity = shuffled(athletes('NFL', 5_200), 7)
    await run('NFL')
    const first = [...h.written]

    h.written = []
    h.identity = shuffled(athletes('NFL', 5_200), 99)
    await run('NFL')

    expect(h.written).toEqual(first)
    expect(first.slice(0, 3)).toEqual(['NFL:s000000', 'NFL:s000001', 'NFL:s000002'])
  })
})

describe('a college sport rotates one page per run and wraps', () => {
  it('NCAAF: page 1, then the rest from the saved cursor, then back to the start', async () => {
    h.identity = shuffled(athletes('NCAAF', 5_200), 3)

    const one = await run('NCAAF')
    expect(new Set(h.written).size).toBe(5_000)
    expect(one.identitySeeds.NCAAF).toMatchObject({ count: 5_000, exhausted: false, cursorStart: null, cursorEnd: 'pim-004999' })
    expect(one.seedCursors['identity:NCAAF']).toBe('pim-004999')

    h.written = []
    h.checkpoint = one.seedCursors
    const two = await run('NCAAF')
    expect(new Set(h.written).size).toBe(200)
    expect(two.identitySeeds.NCAAF).toMatchObject({ count: 200, exhausted: true, cursorStart: 'pim-004999', cursorEnd: null })
    expect(two.seedCursors['identity:NCAAF']).toBeUndefined()

    // Together the two runs seeded every athlete exactly once.
    expect(one.identitySeeds.NCAAF!.count + two.identitySeeds.NCAAF!.count).toBe(5_200)
  })
})
