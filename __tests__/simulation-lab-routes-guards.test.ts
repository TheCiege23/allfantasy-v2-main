import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guards on the restored Simulation Lab routes: session, input bounds, rate limit, and the
 * response shapes app/app/simulation-lab/page.tsx reads. Uses the REAL engine (no mock of
 * @/lib/simulation-lab) so the shape assertions describe what the page actually receives.
 */

const requireAuthMock = vi.fn()
vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))

type Mode = 'season' | 'playoffs' | 'dynasty'

async function post(mode: Mode, body: unknown) {
  const mod =
    mode === 'season'
      ? await import('@/app/api/simulation-lab/season/route')
      : mode === 'playoffs'
        ? await import('@/app/api/simulation-lab/playoffs/route')
        : await import('@/app/api/simulation-lab/dynasty/route')
  return mod.POST(
    new Request(`http://localhost/api/simulation-lab/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as any
  )
}

let userSeq = 0
function signIn() {
  // A fresh user per test so the in-memory per-user rate limit never leaks between tests.
  userSeq += 1
  requireAuthMock.mockResolvedValue({ ok: true, userId: `sim-lab-user-${userSeq}`, session: null })
}

const validSeason = {
  sport: 'NFL',
  team: { mean: 100, stdDev: 12 },
  opponents: [{ mean: 98 }, { mean: 95 }, { mean: 90 }],
  playoffSpots: 2,
  byeSpots: 0,
  iterations: 200,
}
const validPlayoffs = {
  sport: 'NFL',
  teams: [{ mean: 110, name: 'Team 1' }, { mean: 100, name: 'Team 2' }, { mean: 95, name: 'Team 3' }, { mean: 90, name: 'Team 4' }],
  targetTeamIndex: 0,
  iterations: 200,
}
const validDynasty = {
  sport: 'NFL',
  teams: [{ mean: 110, name: 'Team 1' }, { mean: 100, name: 'Team 2' }, { mean: 95, name: 'Team 3' }],
  seasons: 3,
  playoffSpots: 2,
  iterationsPerSeason: 2,
}
const VALID: Record<Mode, unknown> = { season: validSeason, playoffs: validPlayoffs, dynasty: validDynasty }

describe('Simulation Lab routes — auth', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['season', 'playoffs', 'dynasty'] as const)('%s returns 401 with a readable error when signed out', async (mode) => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const res = await post(mode, VALID[mode])
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Sign in to run simulations.' })
  })
})

describe('Simulation Lab routes — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn()
  })

  it('rejects a non-numeric team mean instead of simulating NaN', async () => {
    const res = await post('season', { ...validSeason, team: { mean: 'abc' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('team.mean must be a finite number')
  })

  it('rejects an opponent that is not an object', async () => {
    const res = await post('season', { ...validSeason, opponents: [{ mean: 90 }, 5] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/opponents\[1\]/)
  })

  it('rejects a fractional playoffSpots and an out-of-range byeSpots', async () => {
    const frac = await post('season', { ...validSeason, playoffSpots: 1.5 })
    expect(frac.status).toBe(400)
    const bye = await post('season', { ...validSeason, byeSpots: 3 })
    expect(bye.status).toBe(400)
    expect((await bye.json()).error).toMatch(/byeSpots/)
  })

  it('rejects iterations that are not a number', async () => {
    const res = await post('playoffs', { ...validPlayoffs, iterations: 'lots' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('iterations must be a number')
  })

  it('rejects a fractional targetTeamIndex', async () => {
    const res = await post('playoffs', { ...validPlayoffs, targetTeamIndex: 0.5 })
    expect(res.status).toBe(400)
  })

  it('caps league size (dynasty work grows with teams squared)', async () => {
    const teams = Array.from({ length: 33 }, (_, i) => ({ mean: 100 - i }))
    const res = await post('dynasty', { ...validDynasty, teams })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('teams must have at most 32 entries')

    const opponents = Array.from({ length: 32 }, (_, i) => ({ mean: 100 - i }))
    const seasonRes = await post('season', { ...validSeason, opponents })
    expect(seasonRes.status).toBe(400)
  })

  it('rejects a negative stdDev and an overlong name', async () => {
    const neg = await post('dynasty', { ...validDynasty, teams: [{ mean: 100, stdDev: -1 }, { mean: 90 }] })
    expect(neg.status).toBe(400)
    const long = await post('playoffs', { ...validPlayoffs, teams: [{ mean: 100, name: 'x'.repeat(61) }, { mean: 90 }] })
    expect(long.status).toBe(400)
  })

  it('treats a non-object or malformed JSON body as missing fields (400, not 500)', async () => {
    const arr = await post('dynasty', [1, 2, 3])
    expect(arr.status).toBe(400)
    const junk = await post('season', '{not json')
    expect(junk.status).toBe(400)
    await expect(junk.json()).resolves.toEqual({ error: 'team and opponents (array) required' })
  })
})

describe('Simulation Lab routes — rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn()
  })

  it('returns 429 with a readable error once a user exceeds 20 runs a minute', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await post('playoffs', { ...validPlayoffs, iterations: 100 })
      expect(ok.status).toBe(200)
    }
    const res = await post('playoffs', { ...validPlayoffs, iterations: 100 })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/Too many simulations/)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})

describe('Simulation Lab routes — response shapes the page reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn()
  })

  it('season returns sport, expectedWins, playoffProbability, byeWeekProbability, iterations', async () => {
    const res = await post('season', validSeason)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({
      sport: 'NFL',
      expectedWins: expect.any(Number),
      playoffProbability: expect.any(Number),
      byeWeekProbability: expect.any(Number),
      iterations: 200,
    })
  })

  it('playoffs returns sport, championshipProbability, finalistProbability, iterations', async () => {
    const res = await post('playoffs', validPlayoffs)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({
      sport: 'NFL',
      championshipProbability: expect.any(Number),
      finalistProbability: expect.any(Number),
      iterations: 200,
    })
  })

  it('dynasty returns outcomes rows with the fields the table renders', async () => {
    const res = await post('dynasty', validDynasty)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sport).toBe('NFL')
    expect(data.seasonsRun).toBe(3)
    expect(data.iterationsPerSeason).toBe(2)
    expect(data.outcomes).toHaveLength(3)
    for (const o of data.outcomes) {
      expect(o).toEqual({
        teamIndex: expect.any(Number),
        name: expect.any(String),
        championships: expect.any(Number),
        totalWins: expect.any(Number),
        avgFinish: expect.any(Number),
        playoffAppearances: expect.any(Number),
      })
    }
  })
})
