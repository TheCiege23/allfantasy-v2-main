// @vitest-environment node
/**
 * /api/draft/players — the pool the draft board is built from.
 *
 * 🛑 THIS ROUTE USED TO FABRICATE AN ADP FROM THE ALPHABET.
 *
 *     orderBy: { name: 'asc' },  take: 400
 *     adp: i + 1
 *
 * `SportsPlayer` has no rank or ADP column, and there are 24,135 NFL rows, so the pool was an
 * A-to-roughly-C slice and every player's "ADP" was their position in the alphabet — rendered
 * by PlayerPool.tsx under a column headed ADP. Nothing tested this route at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const findManyMock = vi.fn()
const getLiveAdpByNameMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsPlayer: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}))
vi.mock('@/lib/adp/liveAdpFallback', () => ({
  getLiveAdpByName: (...a: unknown[]) => getLiveAdpByNameMock(...a),
}))

const player = (name: string, externalId: string) => ({
  externalId,
  name,
  position: 'WR',
  team: 'CIN',
  imageUrl: null,
  status: null,
})

const boardOf = (entries: Array<[string, number]>) =>
  new Map(
    entries.map(([name, adp]) => [
      name.toLowerCase(),
      { name, adp, position: 'WR', team: 'CIN', providerCount: 4, providers: [], adpSpread: null, season: 2026, week: 35, format: 'redraft', scoring: 'standard' },
    ]),
  )

async function callRoute(url = 'http://localhost/api/draft/players?sport=NFL') {
  const { GET } = await import('@/app/api/draft/players/route')
  const res = await GET(createMockNextRequest(url) as never)
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  getLiveAdpByNameMock.mockResolvedValue(new Map())
  findManyMock.mockResolvedValue([])
})

describe('GET /api/draft/players', () => {
  it('requires a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { GET } = await import('@/app/api/draft/players/route')
    const res = await GET(createMockNextRequest('http://localhost/api/draft/players') as never)
    expect(res.status).toBe(401)
  })

  it('reports the REAL consensus ADP, not a row index', async () => {
    getLiveAdpByNameMock.mockResolvedValue(boardOf([["Ja'Marr Chase", 1.7], ['Zay Flowers', 40.2]]))
    findManyMock.mockResolvedValue([player('Zay Flowers', 'z1'), player("Ja'Marr Chase", 'c1')])

    const body = await callRoute()
    const chase = body.players.find((p: { name: string }) => p.name === "Ja'Marr Chase")
    const flowers = body.players.find((p: { name: string }) => p.name === 'Zay Flowers')

    expect(chase.adp).toBe(1.7)
    expect(flowers.adp).toBe(40.2)
    // The old bug: index+1 would have made these 1 and 2 regardless of the real board.
    expect(flowers.adp).not.toBe(2)
  })

  it('orders the board by ADP, not alphabetically', async () => {
    // Alphabetically 'Aaron Last' sorts FIRST but is priced 300th — under the old route it
    // led the board and was reported as ADP 1.
    getLiveAdpByNameMock.mockResolvedValue(boardOf([['Aaron Last', 300], ['Zach First', 1.2]]))
    findManyMock.mockResolvedValue([player('Aaron Last', 'a1'), player('Zach First', 'z9')])

    const body = await callRoute()
    expect(body.players.map((p: { name: string }) => p.name)).toEqual(['Zach First', 'Aaron Last'])
  })

  it('drops an ADP entry with no player row, because it would have no id', async () => {
    // The UI keys drafted/queued state on `id`; an entry without one cannot be drafted.
    getLiveAdpByNameMock.mockResolvedValue(boardOf([['Ghost Player', 5], ['Real Player', 9]]))
    findManyMock.mockResolvedValue([player('Real Player', 'r1')])

    const body = await callRoute()
    expect(body.players).toHaveLength(1)
    expect(body.players[0].id).toBe('r1')
  })

  it('joins on the normalized name so punctuation and suffixes do not lose players', async () => {
    getLiveAdpByNameMock.mockResolvedValue(boardOf([['Aaron Jones Sr.', 33]]))
    findManyMock.mockResolvedValue([player('Aaron Jones', 'j1')])

    const body = await callRoute()
    expect(body.players).toHaveLength(1)
    expect(body.players[0].adp).toBe(33)
  })

  it('returns adp null — never a number — for a sport with no ADP board', async () => {
    getLiveAdpByNameMock.mockResolvedValue(new Map())
    findManyMock.mockResolvedValue([player('Some Skater', 's1'), player('Other Skater', 's2')])

    const body = await callRoute('http://localhost/api/draft/players?sport=NHL')
    expect(body.players).toHaveLength(2)
    for (const p of body.players) expect(p.adp).toBeNull()
  })

  it('degrades to adp null rather than failing when the board is unreadable', async () => {
    getLiveAdpByNameMock.mockRejectedValue(new Error('db down'))
    findManyMock.mockResolvedValue([player('Any Player', 'p1')])

    const body = await callRoute()
    expect(body.players[0].adp).toBeNull()
  })

  it('reports projections as null, never a fabricated 0', async () => {
    /*
     * `projPts: 0` / `proj: 0` asserted that every player in the pool projects to score
     * nothing. `fantasy_projections` does exist (1,001 NFL rows, 2026) but only at week 1 — a
     * weekly number is not a draft-board projection, so null is the honest value rather than
     * substituting a real number that answers a different question.
     */
    getLiveAdpByNameMock.mockResolvedValue(boardOf([['Real Player', 4]]))
    findManyMock.mockResolvedValue([player('Real Player', 'r1')])

    const body = await callRoute()
    expect(body.players[0].proj).toBeNull()
    expect(body.players[0].projPts).toBeNull()
    expect(body.players[0].proj).not.toBe(0)
  })

  it('honours the limit', async () => {
    getLiveAdpByNameMock.mockResolvedValue(
      boardOf(Array.from({ length: 10 }, (_, i) => [`Player ${i}`, i + 1] as [string, number])),
    )
    findManyMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => player(`Player ${i}`, `p${i}`)),
    )

    const body = await callRoute('http://localhost/api/draft/players?sport=NFL&limit=3')
    expect(body.players).toHaveLength(3)
    expect(body.players.map((p: { adp: number }) => p.adp)).toEqual([1, 2, 3])
  })
})
