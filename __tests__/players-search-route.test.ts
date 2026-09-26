import { beforeEach, describe, expect, it, vi } from 'vitest'

const sportsPlayerFindManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: sportsPlayerFindManyMock,
    },
  },
}))

describe('GET /api/players/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sportsPlayerFindManyMock.mockResolvedValue([])
  })

  it('filters by sport when sport query is provided', async () => {
    const { GET } = await import('@/app/api/players/search/route')
    const req = new Request('http://localhost/api/players/search?q=LeBron&sport=nba&limit=5')

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(sportsPlayerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sport: 'NBA',
          OR: expect.any(Array),
        }),
        // Over-fetched: a person is one row per provider, collapsed after the query.
        take: 20,
      })
    )
  })

  it('keeps cross-sport search behavior when sport is omitted', async () => {
    const { GET } = await import('@/app/api/players/search/route')
    const req = new Request('http://localhost/api/players/search?q=Mahomes&limit=7')

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(sportsPlayerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ sport: expect.anything() }),
        take: 28,
      })
    )
  })

  it('rejects too-short search queries', async () => {
    const { GET } = await import('@/app/api/players/search/route')
    const req = new Request('http://localhost/api/players/search?q=a')

    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid query')
  })

  it('requires a sleeperId in the query, and returns a slug every result can link with', async () => {
    sportsPlayerFindManyMock.mockResolvedValue([
      { id: '1', name: "Ja'Marr Chase", sport: 'NFL', position: 'WR', team: 'CIN', imageUrl: null, sleeperId: '7564', age: 25, number: 1, college: 'LSU' },
    ])
    const { GET } = await import('@/app/api/players/search/route')
    const req = new Request('http://localhost/api/players/search?q=chase')

    const res = await GET(req)
    expect(sportsPlayerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sleeperId: { not: null } }),
      })
    )
    const body = await res.json()
    expect(body).toEqual([expect.objectContaining({ slug: 'jamarr-chase-nfl-7564' })])
  })

  it('drops a row the search filter should have excluded but that has no addressable slug', async () => {
    // Belt-and-suspenders: even if the where-clause guard were ever loosened,
    // a row missing sleeperId must never reach the client with slug: null.
    sportsPlayerFindManyMock.mockResolvedValue([
      { id: '2', name: 'No Slug Guy', sport: 'NFL', position: 'WR', team: 'CIN', imageUrl: null, sleeperId: null, age: 25, number: 1, college: 'LSU' },
    ])
    const { GET } = await import('@/app/api/players/search/route')
    const req = new Request('http://localhost/api/players/search?q=noslug')

    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual([])
  })
  it('returns one result per person when several providers hold the same sleeperId', async () => {
    // Measured on production 2026-09-26: "Caleb Williams" rendered three times.
    sportsPlayerFindManyMock.mockResolvedValue([
      { id: 'a', externalId: 'sleeper:11560', name: 'Caleb Williams', sport: 'NFL', position: 'QB', team: 'Chicago Bears', imageUrl: 'https://r2.thesportsdb.com/x.png', sleeperId: '11560', age: 24, number: null, college: 'USC' },
      { id: 'b', externalId: '8390', name: 'Caleb Williams', sport: 'NFL', position: 'QB', team: 'Chicago Bears', imageUrl: null, sleeperId: '11560', age: 25, number: 18, college: 'USC' },
      { id: 'c', externalId: 'tsdb_34249077', name: 'Caleb Williams', sport: 'NFL', position: 'QB', team: 'Chicago Bears', imageUrl: 'https://r2.thesportsdb.com/x.png', sleeperId: '11560', age: 25, number: null, college: null },
    ])
    const { GET } = await import('@/app/api/players/search/route')
    const body = await (await GET(new Request('http://localhost/api/players/search?q=caleb'))).json()

    expect(body).toHaveLength(1)
    // The row with a headshot leads; a field it lacks is filled from a sibling.
    expect(body[0]).toMatchObject({ id: 'a', externalId: 'sleeper:11560', number: 18, slug: 'caleb-williams-nfl-11560' })
  })

  it('never collapses on name: same name, different sleeperId stays two people', async () => {
    sportsPlayerFindManyMock.mockResolvedValue([
      { id: '1', externalId: 'x1', name: 'Kyle Williams', sport: 'NFL', position: 'WR', team: 'NE', imageUrl: null, sleeperId: '1001', age: 23, number: null, college: null },
      { id: '2', externalId: 'x2', name: 'Kyle Williams', sport: 'NFL', position: 'WR', team: 'NE', imageUrl: null, sleeperId: '1002', age: 37, number: null, college: null },
    ])
    const { GET } = await import('@/app/api/players/search/route')
    const body = await (await GET(new Request('http://localhost/api/players/search?q=kyle'))).json()
    expect(body.map((p: { sleeperId: string }) => p.sleeperId)).toEqual(['1001', '1002'])
  })

  it('keeps the same sleeperId in different sports apart, and caps the output at limit', async () => {
    const row = (id: string, sport: string, sleeperId: string) => ({ id, externalId: id, name: 'Same Name', sport, position: 'G', team: null, imageUrl: null, sleeperId, age: null, number: null, college: null })
    sportsPlayerFindManyMock.mockResolvedValue([row('1', 'NBA', '77'), row('2', 'NFL', '77'), row('3', 'NFL', '78')])
    const { GET } = await import('@/app/api/players/search/route')
    const body = await (await GET(new Request('http://localhost/api/players/search?q=same&limit=2'))).json()
    expect(body.map((p: { id: string }) => p.id)).toEqual(['1', '2'])
  })
})
