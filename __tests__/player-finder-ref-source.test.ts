/**
 * A player reference names a ROW: (sport, source, externalId). Rows are production rows
 * measured 2026-10-12.
 *
 *   - SOCCER `1100` is api_football's Haaland AND rolling_insights' James Daly; the newest
 *     (Daly) used to win, so Haaland's link opened Daly.
 *   - TheSportsDB's "Byron Murphy DT Seattle" carries 5864, the Vikings CB's Sleeper id;
 *     opening it attached the CB's leagues/projection/rank to the DT header.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const ROWS = [
  { sport: 'SOCCER', externalId: '1100', source: 'rolling_insights', name: 'James Daly', position: 'Forward', team: '7', sleeperId: null, fetchedAt: new Date('2026-10-09T09:10:02Z') },
  { sport: 'SOCCER', externalId: '1100', source: 'api_football', name: 'E. Haaland', position: 'FWD', team: 'MCI', sleeperId: null, fetchedAt: new Date('2026-04-25T15:33:16Z') },
  { sport: 'NFL', externalId: 'tsdb_34249738', source: 'thesportsdb', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', sleeperId: '5864', fetchedAt: new Date('2026-10-11T08:42:36Z') },
  { sport: 'NFL', externalId: 'sleeper:5864', source: 'sleeper', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings', sleeperId: '5864', fetchedAt: new Date('2026-10-10T12:06:58Z') },
  { sport: 'NFL', externalId: 'tsdb_34201869', source: 'thesportsdb', name: 'Byron Murphy Jr.', position: 'CB', team: 'Minnesota Vikings', sleeperId: '5864', fetchedAt: new Date('2026-10-11T08:42:36Z') },
].map((r) => ({ imageUrl: null, number: null, height: null, weight: null, age: null, college: null, ...r }))

/** Every model answers empty unless the test says otherwise; `sportsPlayer` reads ROWS. */
const db = vi.hoisted(() => {
  const empty = () => ({
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    aggregate: async () => ({ _max: {} }),
    groupBy: async () => [],
  })
  return new Proxy({} as Record<string, any>, {
    get(target, key: string) {
      if (key === '$queryRaw' || key === '$queryRawUnsafe') return async () => []
      target[key] ??= empty()
      return target[key]
    },
  })
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const matches = (row: AnyArgs, where: AnyArgs): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in v) return row[k] != null
    if (v && typeof v === 'object' && 'equals' in v) return String(row[k] ?? '').toLowerCase() === String(v.equals).toLowerCase()
    if (v && typeof v === 'object') return true
    return row[k] === v
  })

import { clearPlayerCardCache, getPlayerDetail } from '@/lib/core-app/playerFinder'
import { parsePlayerRef, playerRef } from '@/lib/core-app/playerRef'

beforeEach(() => {
  clearPlayerCardCache()
  db.sportsPlayer.findMany = vi.fn(async ({ where }: AnyArgs) => ROWS.filter((r) => matches(r, where)))
  db.sportsPlayer.findFirst = vi.fn(async ({ where }: AnyArgs) => ROWS.find((r) => matches(r, where)) ?? null)
})

describe('playerRef carries the source', () => {
  it('round-trips sport, source and an externalId that holds colons of its own', () => {
    const ref = playerRef('NFL', 'name:Josh Allen:QB:BUF', 'backfill')
    expect(ref).toBe('NFL~backfill:name:Josh Allen:QB:BUF')
    expect(parsePlayerRef(ref)).toEqual({ sport: 'NFL', source: 'backfill', externalId: 'name:Josh Allen:QB:BUF' })
  })
  it('still parses refs minted before the source existed', () => {
    expect(parsePlayerRef('SOCCER:1100')).toEqual({ sport: 'SOCCER', source: null, externalId: '1100' })
    expect(parsePlayerRef('sleeper:2212')).toEqual({ sport: null, source: null, externalId: 'sleeper:2212' })
    expect(playerRef('NFL', '2135')).toBe('NFL:2135')
  })
})

describe('getPlayerDetail resolves the row the ref names', () => {
  it("opens Haaland from api_football's ref, not the newer James Daly row sharing his id", async () => {
    const d = await getPlayerDetail(playerRef('SOCCER', '1100', 'api_football'), [], null)
    expect(d?.player).toMatchObject({ name: 'E. Haaland', source: 'api_football' })
  })
  it('refuses a source-less ref whose rows are different men instead of picking the newest', async () => {
    expect(await getPlayerDetail('SOCCER:1100', [], null)).toBeNull()
  })
  it('attaches nothing Sleeper-keyed to a vendor row whose Sleeper id names somebody else', async () => {
    const d = await getPlayerDetail(playerRef('NFL', 'tsdb_34249738', 'thesportsdb'), [], 'user-1')
    expect(d?.player).toMatchObject({ name: 'Byron Murphy', position: 'DT', sleeperId: null })
    expect(d?.identityResolved).toBe(false)
    expect(d?.leagues.available).toBe(false)
    expect(d?.impact.available).toBe(false)
  })
  it('keeps the Sleeper id on a vendor row that is the same man (Byron Murphy Jr., CB)', async () => {
    const d = await getPlayerDetail(playerRef('NFL', 'tsdb_34201869', 'thesportsdb'), [], null)
    expect(d?.player).toMatchObject({ name: 'Byron Murphy Jr.', sleeperId: '5864' })
    expect(d?.identityResolved).toBe(true)
  })
})
