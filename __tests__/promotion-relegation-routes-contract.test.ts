import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const assertCommissionerMock = vi.fn()

const listDivisionsByLeagueMock = vi.fn()
const getStandingsWithZonesMock = vi.fn()
const getStandingsForDivisionMock = vi.fn()
const runPromotionRelegationMock = vi.fn()

const leagueDivisionFindFirstMock = vi.fn()
const promotionRuleFindFirstMock = vi.fn()
const promotionRuleFindManyMock = vi.fn()
const promotionRuleUpsertMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: assertCommissionerMock,
}))

vi.mock('@/lib/promotion-relegation', () => ({
  listDivisionsByLeague: listDivisionsByLeagueMock,
  getStandingsWithZones: getStandingsWithZonesMock,
  getStandingsForDivision: getStandingsForDivisionMock,
  runPromotionRelegation: runPromotionRelegationMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueDivision: {
      findFirst: leagueDivisionFindFirstMock,
    },
    promotionRule: {
      findFirst: promotionRuleFindFirstMock,
      findMany: promotionRuleFindManyMock,
      upsert: promotionRuleUpsertMock,
    },
  },
}))

describe('Promotion/Relegation route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValue({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: false,
      isMember: true,
    })
    assertCommissionerMock.mockResolvedValue({
      league: { id: 'lg-1', userId: 'u-1' },
    })
  })

  it('enforces auth/membership and validates sport on divisions list', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/divisions/handler')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthRes = await GET(new Request('http://localhost/api/leagues/lg-1/divisions'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-2' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const forbiddenRes = await GET(new Request('http://localhost/api/leagues/lg-1/divisions'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(forbiddenRes.status).toBe(403)

    const invalidSportRes = await GET(new Request('http://localhost/api/leagues/lg-1/divisions?sport=bad'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(invalidSportRes.status).toBe(400)
    await expect(invalidSportRes.json()).resolves.toEqual({ error: 'Invalid sport' })

    listDivisionsByLeagueMock.mockResolvedValueOnce([])
    const okRes = await GET(new Request('http://localhost/api/leagues/lg-1/divisions?sport=nba'), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(okRes.status).toBe(200)
    expect(listDivisionsByLeagueMock).toHaveBeenCalledWith('lg-1', { sport: 'NBA' })
  })

  it('returns zone-aware standings when a tier rule exists', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/divisions/[divisionId]/standings/route')

    leagueDivisionFindFirstMock.mockResolvedValueOnce({
      id: 'div-2',
      leagueId: 'lg-1',
      tierLevel: 2,
      name: 'Tier 2',
    })
    promotionRuleFindFirstMock.mockResolvedValueOnce({
      id: 'r-1',
      leagueId: 'lg-1',
      fromTierLevel: 1,
      toTierLevel: 2,
      promoteCount: 2,
      relegateCount: 1,
    })
    getStandingsWithZonesMock.mockResolvedValueOnce([])

    const res = await GET(new Request('http://localhost/api/leagues/lg-1/divisions/div-2/standings'), {
      params: Promise.resolve({ leagueId: 'lg-1', divisionId: 'div-2' }),
    })

    expect(res.status).toBe(200)
    expect(getStandingsWithZonesMock).toHaveBeenCalledWith({
      divisionId: 'div-2',
      promoteCount: 2,
      relegateCount: 0,
    })
    expect(getStandingsForDivisionMock).not.toHaveBeenCalled()
  })

  it('falls back to plain standings when no rule exists', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/divisions/[divisionId]/standings/route')

    leagueDivisionFindFirstMock.mockResolvedValueOnce({
      id: 'div-1',
      leagueId: 'lg-1',
      tierLevel: 1,
      name: 'Tier 1',
    })
    promotionRuleFindFirstMock.mockResolvedValueOnce(null)
    getStandingsForDivisionMock.mockResolvedValueOnce([])

    const res = await GET(new Request('http://localhost/api/leagues/lg-1/divisions/div-1/standings'), {
      params: Promise.resolve({ leagueId: 'lg-1', divisionId: 'div-1' }),
    })

    expect(res.status).toBe(200)
    expect(getStandingsForDivisionMock).toHaveBeenCalledWith('div-1')
  })

  it('requires commissioner and validates promotion rule payload', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/promotion/rules/create/route')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/rules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    assertCommissionerMock.mockRejectedValueOnce(new Error('Forbidden'))
    const memberRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/rules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromTierLevel: 1, toTierLevel: 2, promoteCount: 1, relegateCount: 1 }),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(memberRes.status).toBe(403)

    const invalidRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/rules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromTierLevel: 2, toTierLevel: 1, promoteCount: 0, relegateCount: 0 }),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(invalidRes.status).toBe(400)

    promotionRuleUpsertMock.mockResolvedValueOnce({
      id: 'r-1',
      leagueId: 'lg-1',
      fromTierLevel: 1,
      toTierLevel: 2,
      promoteCount: 2,
      relegateCount: 1,
    })
    const okRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/rules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromTierLevel: 1, toTierLevel: 2, promoteCount: 2, relegateCount: 1 }),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(okRes.status).toBe(200)
    expect(promotionRuleUpsertMock).toHaveBeenCalled()
  })

  it('requires commissioner for promotion run and forwards dryRun', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/promotion/run/route')

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    assertCommissionerMock.mockRejectedValueOnce(new Error('Forbidden'))
    const forbiddenRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(forbiddenRes.status).toBe(403)
    await expect(forbiddenRes.json()).resolves.toEqual({ error: 'Forbidden: commissioner only' })

    runPromotionRelegationMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      applied: false,
      transitions: [],
    })
    const okRes = await POST(new Request('http://localhost/api/leagues/lg-1/promotion/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    }), { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(okRes.status).toBe(200)
    expect(runPromotionRelegationMock).toHaveBeenCalledWith({ leagueId: 'lg-1', dryRun: true })
  })
})

