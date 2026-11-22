import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const assertCommissionerMock = vi.fn()
const getRosterPlayerIdsMock = vi.fn()
const getFormatTypeForVariantMock = vi.fn()
const getRosterTemplateForLeagueMock = vi.fn()
const validateRosterSectionsAgainstTemplateMock = vi.fn()
const autoCorrectPlayerDataToTemplateMock = vi.fn()

const leagueFindUniqueMock = vi.fn()
const leagueUpdateMock = vi.fn()
const rosterFindFirstMock = vi.fn()
const rosterUpdateMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: assertCommissionerMock,
}))

vi.mock('@/lib/waiver-wire/roster-utils', () => ({
  getRosterPlayerIds: getRosterPlayerIdsMock,
}))

vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({
  getFormatTypeForVariant: getFormatTypeForVariantMock,
}))

vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: getRosterTemplateForLeagueMock,
}))

vi.mock('@/lib/roster/LineupTemplateValidation', () => ({
  validateRosterSectionsAgainstTemplate: validateRosterSectionsAgainstTemplateMock,
  autoCorrectPlayerDataToTemplate: autoCorrectPlayerDataToTemplateMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    roster: {
      findFirst: rosterFindFirstMock,
      update: rosterUpdateMock,
    },
  },
}))
vi.mock('@/lib/league/commissionerAccess', async () => (await import('./helpers/commissionerAccessMock')).accessFromAssert(() => assertCommissionerMock))

describe('/api/commissioner/leagues/[leagueId]/lineup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commissioner' } })
    assertCommissionerMock.mockResolvedValue(undefined)
    getFormatTypeForVariantMock.mockReturnValue('IDP')
    getRosterTemplateForLeagueMock.mockResolvedValue({
      templateId: 'default-NFL-IDP',
      sportType: 'NFL',
      name: 'Default NFL IDP',
      formatType: 'IDP',
      slots: [],
    })
    getRosterPlayerIdsMock.mockReturnValue(['p1', 'p2'])
  })

  it('GET returns invalid rosters based on template validation', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      settings: { lineupLockRule: 'first_game' },
      sport: 'NFL',
      leagueVariant: 'DYNASTY_IDP',
      rosters: [
        { id: 'r-1', platformUserId: 'u-1', playerData: { any: 'data' } },
        { id: 'r-2', platformUserId: 'u-2', playerData: { any: 'data2' } },
      ],
    })
    validateRosterSectionsAgainstTemplateMock
      .mockReturnValueOnce('STARTERS has 12 players, max 10.')
      .mockReturnValueOnce(null)

    const { GET } = await import('@/app/api/commissioner/leagues/[leagueId]/lineup/route')
    const res = await GET(new Request('http://localhost/api/commissioner/leagues/l1/lineup') as any, {
      params: { leagueId: 'l1' },
    })

    expect(res.status).toBe(200)
    expect(getFormatTypeForVariantMock).toHaveBeenCalledWith('NFL', 'DYNASTY_IDP')
    expect(getRosterTemplateForLeagueMock).toHaveBeenCalledWith('NFL', 'IDP', 'l1')
    const body = await res.json()
    expect(body.lineupLockRule).toBe('first_game')
    expect(body.invalidRosters).toEqual([
      {
        rosterId: 'r-1',
        platformUserId: 'u-1',
        reason: 'STARTERS has 12 players, max 10.',
      },
    ])
  })

  it('POST forceCorrect returns no-op when roster is already valid', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'l1',
      settings: { lineupLockRule: null },
      sport: 'NFL',
      leagueVariant: 'IDP',
    })
    rosterFindFirstMock.mockResolvedValue({
      id: 'r-1',
      playerData: { lineup_sections: { starters: [], bench: [] } },
    })
    validateRosterSectionsAgainstTemplateMock.mockReturnValue(null)

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/lineup/route')
    const res = await POST(
      new Request('http://localhost/api/commissioner/leagues/l1/lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceCorrectRosterId: 'r-1' }),
      }) as any,
      { params: { leagueId: 'l1' } }
    )

    expect(res.status).toBe(200)
    expect(rosterUpdateMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.message).toContain('already matches the active sport template')
  })

  it('POST forceCorrect applies correction and persists normalized data', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'l1',
      settings: { lineupLockRule: null },
      sport: 'NFL',
      leagueVariant: 'IDP',
    })
    rosterFindFirstMock.mockResolvedValue({
      id: 'r-1',
      playerData: { lineup_sections: { starters: [{ id: 'p1', position: 'DE' }] } },
    })
    validateRosterSectionsAgainstTemplateMock
      .mockReturnValueOnce('Starter position DE is not eligible for this league template.')
      .mockReturnValueOnce(null)
    autoCorrectPlayerDataToTemplateMock.mockReturnValue({
      correctedPlayerData: { players: ['p1', 'p2'], lineup_sections: { starters: [], bench: [] } },
      droppedPlayerIds: ['p3'],
    })
    getRosterPlayerIdsMock.mockReturnValue(['p1', 'p2'])

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/lineup/route')
    const res = await POST(
      new Request('http://localhost/api/commissioner/leagues/l1/lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceCorrectRosterId: 'r-1' }),
      }) as any,
      { params: { leagueId: 'l1' } }
    )

    expect(res.status).toBe(200)
    expect(autoCorrectPlayerDataToTemplateMock).toHaveBeenCalledTimes(1)
    expect(rosterUpdateMock).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: { playerData: { players: ['p1', 'p2'], lineup_sections: { starters: [], bench: [] } } },
    })
    const body = await res.json()
    expect(body.removedPlayerIds).toEqual(['p3'])
    expect(body.remainingPlayerCount).toBe(2)
  })

  it('POST updates lineupLockRule when no force-correct id is provided', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'l1',
      settings: { lineupLockRule: null, other: true },
      sport: 'NFL',
      leagueVariant: null,
    })
    leagueUpdateMock.mockResolvedValue({
      id: 'l1',
      settings: { lineupLockRule: 'first_game', other: true },
    })

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/lineup/route')
    const res = await POST(
      new Request('http://localhost/api/commissioner/leagues/l1/lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineupLockRule: 'first_game' }),
      }) as any,
      { params: { leagueId: 'l1' } }
    )

    expect(res.status).toBe(200)
    expect(leagueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: {
        settings: { lineupLockRule: 'first_game', other: true },
      },
      select: { id: true, settings: true },
    })
  })
})
