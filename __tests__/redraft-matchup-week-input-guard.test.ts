/**
 * Beta guardrail: the redraft matchup route (`GET /api/redraft/matchup`) is a
 * core-loop surface a manager hits every week (`?seasonId=…&week=…`). It used to
 * do `Number(week)` with no validation, so a malformed `week` (`abc` -> NaN,
 * `2.5` -> float) flowed straight into a Prisma Int query / the Devy scorer and
 * could surface as a 500. This locks the shared beta input guard
 * (`parseOptionalRedraftPositiveInteger`) so bad input returns a clean 400 before
 * any DB work, matching the guard the G44 suite locks for the other redraft routes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

const prismaMock = {
  redraftSeason: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  c2CMatchupScore: { findUnique: vi.fn() },
}

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: assertLeagueMemberMock }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  calculateOfficialTeamScore: vi.fn(),
  leagueUsesDevyEngine: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({
  leagueUsesC2CEngine: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/nfl-data-foundation/nflDataFoundationService', () => ({
  getCanonicalNflMatchupContext: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({
  serializeUnifiedPlayerForApi: vi.fn((row: unknown) => row),
}))
vi.mock('@/lib/player-data/adapters/matchupPlayerAdapter', () => ({
  matchupContextFromUnifiedWire: vi.fn((wire: unknown) => wire),
}))

const url = (qs: string) => `http://localhost/api/redraft/matchup${qs}`

describe('redraft matchup route — week input guard (beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    prismaMock.redraftSeason.findFirst.mockResolvedValue({
      id: 'season-1',
      leagueId: 'league-1',
      sport: 'NBA',
      season: 2026,
    })
    prismaMock.redraftMatchup.findMany.mockResolvedValue([])
  })

  it('rejects a non-numeric week with 400 before any DB query', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=abc')))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(prismaMock.redraftSeason.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.redraftMatchup.findMany).not.toHaveBeenCalled()
  })

  it('rejects a fractional week with 400', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=2.5')))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(prismaMock.redraftMatchup.findMany).not.toHaveBeenCalled()
  })

  it('rejects a non-positive week (0) with 400', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=0')))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
  })

  it('treats an empty week as missing input (400 seasonId+week required), not a week:0 query', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=')))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'matchupId or seasonId+week required' })
    expect(prismaMock.redraftMatchup.findMany).not.toHaveBeenCalled()
  })

  it('accepts a valid week and queries matchups with the coerced integer', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=3')))

    expect(res.status).toBe(200)
    expect(prismaMock.redraftMatchup.findMany).toHaveBeenCalledTimes(1)
    const arg = prismaMock.redraftMatchup.findMany.mock.calls[0][0] as { where: unknown }
    expect(arg.where).toEqual({ seasonId: 'season-1', week: 3 })
  })

  it('preserves 401 for unauthenticated requests (auth unchanged)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('?seasonId=season-1&week=abc')))

    expect(res.status).toBe(401)
  })

  it('preserves the 400 for requests missing matchupId and seasonId+week', async () => {
    const { GET } = await import('@/app/api/redraft/matchup/route')

    const res = await GET(createMockNextRequest(url('')))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'matchupId or seasonId+week required' })
  })
})
