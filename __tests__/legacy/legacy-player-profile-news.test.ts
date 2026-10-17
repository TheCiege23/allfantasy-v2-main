import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/legacy/player-profile — the legacy player modal's bio + news.
 *
 * Measured on production 2026-10-11: for WR DeVonta Smith (PHI) four of the five news items were
 * other Smiths, because the route matched `title contains last_name` in any sport. And a request
 * carrying only a name bound the FIRST Sleeper entry with that name, so a namesake's bio could load.
 */

const getAllPlayersMock = vi.hoisted(() => vi.fn())
const findManyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: getAllPlayersMock }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsNews: { findMany: findManyMock } } }))

const WR_SMITH = { full_name: 'DeVonta Smith', first_name: 'DeVonta', last_name: 'Smith', position: 'WR', team: 'PHI' }
const CB_SMITH = { full_name: 'DeVonta Smith', first_name: 'DeVonta', last_name: 'Smith', position: 'CB', team: 'CAR' }

function newsRow(id: string, over: Record<string, unknown>) {
  return {
    id,
    title: `title-${id}`,
    content: null,
    source: 'test',
    publishedAt: new Date('2026-10-10T00:00:00Z'),
    sourceUrl: null,
    playerName: null,
    playerNames: [],
    team: null,
    teams: [],
    ...over,
  }
}

/*
 * The mock IGNORES the where clause and returns every row, as a broad query would. So what the
 * route shows is decided by the route's own per-row check — which is the thing under test.
 */
const PROD_SHAPED_ROWS = [
  newsRow('wr-own', { title: 'Saquon Barkley, DeVonta Smith among 5 Eagles ruled out vs. Jags', playerName: 'DeVonta Smith', playerNames: ['DeVonta Smith', 'Drew Kendall'], team: 'PHI', teams: ['JAX', 'PHI'] }),
  newsRow('wr-listed', { title: 'NFL Week 5 injury report', playerName: 'Caleb Williams', playerNames: ['Caleb Williams', 'DeVonta Smith'], team: 'PHI', teams: ['PHI', 'CHI'] }),
  newsRow('wr-opp-scalar', { title: 'Eagles stars ruled out of London game against Jaguars', playerName: 'DeVonta Smith', playerNames: ['DeVonta Smith'], team: 'JAX', teams: ['JAX', 'PHI'] }),
  newsRow('ncaaf-jeremiah', { sport: 'NCAAF', title: 'Jeremiah Smith passes Arch Manning', playerName: 'Jeremiah Smith', playerNames: ['Jeremiah Smith'], team: 'OHIO STATE BUCKEYES' }),
  newsRow('stephen-a', { title: 'Stephen A. Smith Makes Stance Clear on Bryce Young', playerName: 'Is That', playerNames: ['Is That', 'Smith Makes', 'Bryce Young'], team: 'CAR', teams: ['CAR', 'DET'] }),
  newsRow('cb-namesake', { title: 'Panthers CB DeVonta Smith signs', playerName: 'DeVonta Smith', playerNames: ['DeVonta Smith'], team: 'CAR', teams: ['CAR'] }),
]

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/server/api-route-modules/legacy/player-profile/route')
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/legacy/player-profile', { method: 'POST', body: JSON.stringify(body) }),
  )
  return { status: res.status, json: (await res.json()) as any }
}

beforeEach(() => {
  vi.clearAllMocks()
  getAllPlayersMock.mockResolvedValue({ '7525': WR_SMITH, '9999': CB_SMITH })
  findManyMock.mockResolvedValue(PROD_SHAPED_ROWS)
})

describe('legacy player-profile news', () => {
  it("shows only the player's own news: other Smiths, other sports and a CAR namesake are excluded", async () => {
    const { status, json } = await post({ player_name: 'DeVonta Smith', player_id: '7525' })
    expect(status).toBe(200)
    expect(json.bio.sleeperId).toBe('7525')
    expect(json.news.map((n: { id: string }) => n.id)).toEqual(['wr-own', 'wr-listed', 'wr-opp-scalar'])
  })

  it('queries by sport and player fields, never a last-name substring of the title', async () => {
    await post({ player_name: 'DeVonta Smith', player_id: '7525' })
    expect(findManyMock).toHaveBeenCalledTimes(1)
    const where = findManyMock.mock.calls[0]![0].where
    expect(where.sport).toBe('NFL')
    expect(JSON.stringify(where)).not.toContain('"title"')
    expect(JSON.stringify(where)).not.toContain('"content"')
  })
})

describe('legacy player-profile bio name fallback', () => {
  it('binds the namesake that position/team verify, not the first entry with that name', async () => {
    const { status, json } = await post({ player_name: 'DeVonta Smith', position: 'CB', team: 'CAR' })
    expect(status).toBe(200)
    expect(json.bio.sleeperId).toBe('9999')
    expect(json.bio.position).toBe('CB')
  })

  it('refuses an ambiguous name with nothing to verify it, instead of taking row 0', async () => {
    const { status, json } = await post({ player_name: 'DeVonta Smith' })
    expect(status).toBe(409)
    expect(json.bio).toBeUndefined()
  })

  it("refuses a lone same-name entry whose team and side of the ball contradict the caller's", async () => {
    getAllPlayersMock.mockResolvedValue({ '9999': CB_SMITH })
    const { status, json } = await post({ player_name: 'DeVonta Smith', position: 'WR', team: 'PHI' })
    expect(status).toBe(404)
    expect(json.bio).toBeUndefined()
  })
})
