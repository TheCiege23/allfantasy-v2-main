import { beforeEach, describe, expect, it, vi } from 'vitest'

const runSeasonSimulationMock = vi.fn()
const runPlayoffSimulationMock = vi.fn()
const runDynastySimulationMock = vi.fn()

vi.mock('@/lib/simulation-lab', () => ({
  runSeasonSimulation: runSeasonSimulationMock,
  runPlayoffSimulation: runPlayoffSimulationMock,
  runDynastySimulation: runDynastySimulationMock,
}))

// The restored routes require a signed-in session (the originals did not). These contract
// tests describe a signed-in caller; denial is covered in simulation-lab-routes-guards.test.ts.
const requireAuthMock = vi.fn()
vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))

describe('Simulation lab route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'user-contract', session: null })
  })

  it('season route validates required fields', async () => {
    const { POST } = await import('@/app/api/simulation-lab/season/route')

    const res = await POST(
      new Request('http://localhost/api/simulation-lab/season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }) as any
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'team and opponents (array) required',
    })
  })

  it('season route forwards sport and normalized fields to service', async () => {
    const { POST } = await import('@/app/api/simulation-lab/season/route')
    runSeasonSimulationMock.mockReturnValueOnce({
      sport: 'NHL',
      expectedWins: 7.5,
      playoffProbability: 0.6,
      byeWeekProbability: 0.2,
      iterations: 2000,
    })

    const res = await POST(
      new Request('http://localhost/api/simulation-lab/season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: 'nhl',
          team: { mean: 102 },
          opponents: [{ mean: 99 }, { mean: 97 }],
          playoffSpots: 2,
          iterations: 1500,
        }),
      }) as any
    )

    expect(res.status).toBe(200)
    expect(runSeasonSimulationMock).toHaveBeenCalledWith({
      sport: 'nhl',
      team: { mean: 102 },
      opponents: [{ mean: 99 }, { mean: 97 }],
      playoffSpots: 2,
      byeSpots: 0,
      iterations: 1500,
    })
  })

  it('playoffs route validates target index and forwards sport', async () => {
    const { POST } = await import('@/app/api/simulation-lab/playoffs/route')

    const badRes = await POST(
      new Request('http://localhost/api/simulation-lab/playoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teams: [{ mean: 100 }, { mean: 99 }],
          targetTeamIndex: 2,
        }),
      }) as any
    )
    expect(badRes.status).toBe(400)

    runPlayoffSimulationMock.mockReturnValueOnce({
      sport: 'NCAAB',
      championshipProbability: 0.25,
      finalistProbability: 0.5,
      iterations: 2000,
    })

    const okRes = await POST(
      new Request('http://localhost/api/simulation-lab/playoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: 'ncaab',
          teams: [{ mean: 108 }, { mean: 104 }, { mean: 100 }, { mean: 97 }],
          targetTeamIndex: 1,
          iterations: 3000,
        }),
      }) as any
    )

    expect(okRes.status).toBe(200)
    expect(runPlayoffSimulationMock).toHaveBeenCalledWith({
      sport: 'ncaab',
      teams: [{ mean: 108 }, { mean: 104 }, { mean: 100 }, { mean: 97 }],
      targetTeamIndex: 1,
      iterations: 3000,
    })
  })

  it('dynasty route forwards sport and clamps playoff spots to team count', async () => {
    const { POST } = await import('@/app/api/simulation-lab/dynasty/route')
    runDynastySimulationMock.mockReturnValueOnce({
      sport: 'MLB',
      seasonsRun: 40,
      outcomes: [],
      iterationsPerSeason: 2,
    })

    const res = await POST(
      new Request('http://localhost/api/simulation-lab/dynasty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: 'mlb',
          teams: [{ mean: 100 }, { mean: 98 }, { mean: 97 }],
          seasons: 40,
          playoffSpots: 10,
          iterationsPerSeason: 2,
        }),
      }) as any
    )

    expect(res.status).toBe(200)
    expect(runDynastySimulationMock).toHaveBeenCalledWith({
      sport: 'mlb',
      teams: [{ mean: 100 }, { mean: 98 }, { mean: 97 }],
      seasons: 40,
      playoffSpots: 3,
      iterationsPerSeason: 2,
    })
  })
})
