import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: mockFindMany } } }))

import { resolveNflAges, ageOf, pickAgreedAge, __clearPlayerAgeCacheForTest } from '@/lib/player-age'

/*
 * The tier list in `lib/dynasty-tiers.ts` carries ages that were measured 0-of-64 correct on
 * 2026-09-07, median +2 years. These feed `getAgeCurveWithCliffs` on ~40 entry points.
 */
/*
 * ⚠ THE MOCK FILTERS ON `where.name.in`, AND IT HAD TO. Returning every row regardless of the
 * query made the "unknown player" case pass a populated map back — a double that answers a
 * question the real database would not, which is the mock-that-stops-doubling-anything shape.
 */
type Row = { name: string; age: number; position?: string; sleeperId?: string | null }
const ROWS: Row[] = [
  { name: 'Puka Nacua', age: 25, position: 'WR', sleeperId: '9493' },
  { name: "Ja'Marr Chase", age: 26, position: 'WR' },
  { name: 'Josh Allen', age: 30, position: 'QB', sleeperId: '4984' },
  /*
   * 🛑 Production rows, 2026-10-11: two Justin Jeffersons, four years apart. The old resolver
   * kept whichever came back LAST, so the receiver's age depended on row order.
   */
  { name: 'Justin Jefferson', age: 27, position: 'WR', sleeperId: '6794' },
  { name: 'Justin Jefferson', age: 23, position: 'LB', sleeperId: '13524' },
  // Same Eagle, two feeds, one DOB — a birthday-stale age one year apart.
  { name: 'Byron Young', age: 25, position: 'DL', sleeperId: '10925' },
  { name: 'Byron Young', age: 26, position: 'DT', sleeperId: null },
  { name: 'Byron Young', age: 28, position: 'LB', sleeperId: '10917' },
  { name: 'Byron Young', age: 28, position: 'OLB', sleeperId: null },
]

type Where = {
  name?: { in: string[] }
  OR?: Array<{ name?: { in: string[] }; sleeperId?: { in: string[] } }>
}
beforeEach(() => {
  __clearPlayerAgeCacheForTest()
  mockFindMany.mockReset().mockImplementation(async (args: { where: Where }) => {
    const clauses = args.where.OR ?? [{ name: args.where.name }]
    return ROWS.filter((r) =>
      clauses.some(
        (c) => (c.name && c.name.in.includes(r.name)) || (c.sleeperId && !!r.sleeperId && c.sleeperId.in.includes(r.sleeperId)),
      ),
    )
  })
})

describe('resolveNflAges', () => {
  it('returns the real age, keyed so the caller’s spelling still finds it', async () => {
    const ages = await resolveNflAges(['Puka Nacua', "Ja'Marr Chase", 'Josh Allen'])
    expect(ageOf(ages, 'Puka Nacua')).toBe(25)
    // 🛑 The tier list writes this man three ways; a lookup must survive all of them.
    expect(ageOf(ages, "Ja'Marr Chase")).toBe(26)
    expect(ageOf(ages, 'JaMarr Chase')).toBe(26)
    expect(ageOf(ages, 'jamarr chase')).toBe(26)
  })

  it('🛑 returns ABSENCE for an unknown player, never a default', async () => {
    /* Every consuming function takes `number | undefined` and treats undefined as "no age
     * opinion". Substituting an average would invent the input that decides the answer. */
    const ages = await resolveNflAges(['Nobody At All'])
    expect(ageOf(ages, 'Nobody At All')).toBeUndefined()
    expect(ages.size).toBe(0)
  })

  it('⚠ caches MISSES too, or a name we do not carry is re-queried forever', async () => {
    await resolveNflAges(['Nobody At All'])
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    await resolveNflAges(['Nobody At All'])
    // ~7% of NFL rows carry no age, so the miss is the common case, not an exotic one.
    expect(mockFindMany).toHaveBeenCalledTimes(1)
  })

  it('does not re-query a name it already resolved', async () => {
    await resolveNflAges(['Puka Nacua'])
    await resolveNflAges(['Puka Nacua'])
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(mockFindMany.mock.calls[0][0].where.name.in).toEqual(['Puka Nacua'])
  })

  it('🛑 an unreachable database yields an empty map, never a throw', async () => {
    /* This sits on AI request paths. A dead lookup must degrade to "no age", not 500 the route. */
    mockFindMany.mockImplementation(async () => { throw new Error("db down") })
    const ages = await resolveNflAges(['Puka Nacua'])
    expect(ages.size).toBe(0)
  })

  it('[control] asks only for NFL rows that actually have an age', async () => {
    await resolveNflAges(['Puka Nacua'])
    const where = mockFindMany.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.age).toEqual({ not: null })
  })

  it('skips empty and unusable names rather than querying for them', async () => {
    await resolveNflAges(['', '   ', 'Puka Nacua'])
    expect(mockFindMany.mock.calls[0][0].where.name.in).toEqual(['Puka Nacua'])
  })
})

describe('🛑 namesakes: an age belongs to ONE player, never to a name', () => {
  it('a bare name whose rows disagree resolves to NOTHING (Justin Jefferson 27 WR / 23 LB)', async () => {
    const ages = await resolveNflAges(['Justin Jefferson'])
    expect(ageOf(ages, 'Justin Jefferson')).toBeUndefined()
  })

  it('[control] the old last-row-wins answer is unreachable whatever the row order', async () => {
    mockFindMany.mockImplementation(async () => [...ROWS].reverse())
    const ages = await resolveNflAges(['Justin Jefferson'])
    expect(ageOf(ages, 'Justin Jefferson')).toBeUndefined()
  })

  it('position binds each namesake to his own age', async () => {
    const ages = await resolveNflAges([
      { name: 'Justin Jefferson', position: 'WR' },
      { name: 'Justin Jefferson', position: 'LB' },
    ])
    expect(ageOf(ages, { name: 'Justin Jefferson', position: 'WR' })).toBe(27)
    expect(ageOf(ages, { name: 'Justin Jefferson', position: 'LB' })).toBe(23)
  })

  it('a Sleeper id outranks the name and position entirely', async () => {
    const ages = await resolveNflAges([{ name: 'Justin Jefferson', sleeperId: '13524' }])
    expect(ageOf(ages, { name: 'Justin Jefferson', sleeperId: '13524' })).toBe(23)
  })

  it('position GROUPS absorb feed labels (LB/OLB, DL/DT); one-year staleness takes the higher age', async () => {
    const ages = await resolveNflAges([
      { name: 'Byron Young', position: 'OLB' },
      { name: 'Byron Young', position: 'DT' },
      'Byron Young',
    ])
    expect(ageOf(ages, { name: 'Byron Young', position: 'OLB' })).toBe(28)
    expect(ageOf(ages, { name: 'Byron Young', position: 'DT' })).toBe(26)
    // Name alone spans 25..28 — two people. Refused.
    expect(ageOf(ages, 'Byron Young')).toBeUndefined()
  })

  it('a position no row carries is absence, not the nearest namesake', async () => {
    const ages = await resolveNflAges([{ name: 'Justin Jefferson', position: 'TE' }])
    expect(ages.size).toBe(0)
  })
})

describe('pickAgreedAge (pure)', () => {
  it('refuses a two-year spread and accepts a one-year one', () => {
    expect(pickAgreedAge([{ name: 'A B', age: 25 }, { name: 'A B', age: 27 }], 'A B')).toBeNull()
    expect(pickAgreedAge([{ name: 'A B', age: 25 }, { name: 'A B', age: 26 }], 'A B')).toBe(26)
  })
})
