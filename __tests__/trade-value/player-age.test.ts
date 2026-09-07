import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: mockFindMany } } }))

import { resolveNflAges, ageOf, __clearPlayerAgeCacheForTest } from '@/lib/player-age'

/*
 * The tier list in `lib/dynasty-tiers.ts` carries ages that were measured 0-of-64 correct on
 * 2026-09-07, median +2 years. These feed `getAgeCurveWithCliffs` on ~40 entry points.
 */
/*
 * ⚠ THE MOCK FILTERS ON `where.name.in`, AND IT HAD TO. Returning every row regardless of the
 * query made the "unknown player" case pass a populated map back — a double that answers a
 * question the real database would not, which is the mock-that-stops-doubling-anything shape.
 */
const ROWS = [
  { name: 'Puka Nacua', age: 25 },
  { name: "Ja'Marr Chase", age: 26 },
  { name: 'Josh Allen', age: 30 },
]

beforeEach(() => {
  __clearPlayerAgeCacheForTest()
  mockFindMany.mockReset().mockImplementation(async (args: { where: { name: { in: string[] } } }) => {
    const want = new Set(args.where.name.in)
    return ROWS.filter((r) => want.has(r.name))
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
