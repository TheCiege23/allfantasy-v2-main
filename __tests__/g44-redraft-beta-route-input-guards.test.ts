import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMockNextRequest } from './helpers/createMockNextRequest'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const assertLeagueCommissionerMock = vi.fn()
const resolvePlayoffRuntimeMock = vi.fn()
const generatePlayoffBracketMock = vi.fn()
const advancePlayoffRoundMock = vi.fn()
const resolveWaiverRuntimeMock = vi.fn()
const resolveTradeRuntimeMock = vi.fn()
const resolveScheduleRuntimeMock = vi.fn()
const advanceScheduleWeekMock = vi.fn()
const generateScheduleMock = vi.fn()
const updateStandingsMock = vi.fn()

const prismaMock = {
  redraftSeason: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
}

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
  assertLeagueCommissioner: assertLeagueCommissionerMock,
}))

vi.mock('@/lib/playoff-runtime', () => ({
  resolveNflRedraftPlayoffRuntime: resolvePlayoffRuntimeMock,
  generateNflRedraftPlayoffRuntimeBracket: generatePlayoffBracketMock,
  advanceNflRedraftPlayoffRuntimeRound: advancePlayoffRoundMock,
  finalizeNflRedraftPlayoffRuntimeSeason: vi.fn(),
  overrideNflRedraftPlayoffMatchup: vi.fn(),
}))

vi.mock('@/lib/waiver-runtime', () => ({
  resolveNflRedraftWaiverRuntime: resolveWaiverRuntimeMock,
  processNflRedraftWaiverWindow: vi.fn(),
  submitNflRedraftWaiverClaim: vi.fn(),
  editNflRedraftWaiverClaim: vi.fn(),
  cancelNflRedraftWaiverClaim: vi.fn(),
  addNflRedraftFreeAgent: vi.fn(),
}))

vi.mock('@/lib/trade-runtime', () => ({
  resolveNflRedraftTradeRuntime: resolveTradeRuntimeMock,
  createNflRedraftTradeProposal: vi.fn(),
  actOnNflRedraftTradeProposal: vi.fn(),
  castNflRedraftTradeVote: vi.fn(),
}))

vi.mock('@/lib/schedule-runtime', () => ({
  resolveNflRedraftScheduleRuntime: resolveScheduleRuntimeMock,
  advanceNflRedraftScheduleWeek: advanceScheduleWeekMock,
  generateNflRedraftScheduleForSeason: generateScheduleMock,
  buildScheduleRuntimeEvent: vi.fn(() => ({ type: 'standings.recalculated' })),
}))

vi.mock('@/lib/redraft/standingsEngine', () => ({
  updateStandings: updateStandingsMock,
}))

describe('G44 redraft beta route input guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    assertLeagueCommissionerMock.mockResolvedValue({ ok: true, status: 200 })
    prismaMock.redraftSeason.findFirst.mockResolvedValue({
      id: 'season-1',
      leagueId: 'league-1',
      currentWeek: 3,
    })
    prismaMock.redraftSeason.findUnique.mockResolvedValue({
      id: 'season-1',
      leagueId: 'league-1',
      currentWeek: 3,
    })
  })

  it('parses optional positive integer fields for beta route boundaries', () => {
    expect(parseOptionalRedraftPositiveInteger(undefined, 'week')).toEqual({ ok: true, value: null })
    expect(parseOptionalRedraftPositiveInteger('4', 'week')).toEqual({ ok: true, value: 4 })
    expect(parseOptionalRedraftPositiveInteger(17, 'week')).toEqual({ ok: true, value: 17 })
    expect(parseOptionalRedraftPositiveInteger('2.5', 'week')).toEqual({ ok: false, error: 'week must be a positive integer' })
    expect(parseOptionalRedraftPositiveInteger(0, 'playoffTeams')).toEqual({ ok: false, error: 'playoffTeams must be a positive integer' })
  })

  it('rejects invalid playoff GET week before resolving the playoff runtime', async () => {
    const { GET } = await import('../app/api/redraft/playoff-runtime/route')
    const req = createMockNextRequest('http://localhost/api/redraft/playoff-runtime?leagueId=league-1&week=abc')

    const res = await GET(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(resolvePlayoffRuntimeMock).not.toHaveBeenCalled()
  })

  it('rejects invalid playoff team counts before generating a bracket', async () => {
    const { POST } = await import('../app/api/redraft/playoff-runtime/route')
    const req = createMockNextRequest('http://localhost/api/redraft/playoff-runtime', {
      method: 'POST',
      body: {
        action: 'generate_bracket',
        leagueId: 'league-1',
        seasonId: 'season-1',
        playoffTeams: 0,
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'playoffTeams must be a positive integer' })
    expect(generatePlayoffBracketMock).not.toHaveBeenCalled()
  })

  it('rejects invalid waiver runtime week before resolving waivers', async () => {
    const { GET } = await import('../app/api/redraft/waiver-runtime/route')
    const req = createMockNextRequest('http://localhost/api/redraft/waiver-runtime?leagueId=league-1&week=NaN')

    const res = await GET(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(resolveWaiverRuntimeMock).not.toHaveBeenCalled()
  })

  it('rejects invalid trade runtime week before resolving trades', async () => {
    const { GET } = await import('../app/api/redraft/trade-runtime/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trade-runtime?leagueId=league-1&week=2.5')

    const res = await GET(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(resolveTradeRuntimeMock).not.toHaveBeenCalled()
  })

  it('rejects invalid schedule action week before advancing the schedule', async () => {
    const { POST } = await import('../app/api/redraft/schedule/route')
    const req = createMockNextRequest('http://localhost/api/redraft/schedule', {
      method: 'POST',
      body: {
        action: 'advance_week',
        seasonId: 'season-1',
        week: 'next',
      },
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(advanceScheduleWeekMock).not.toHaveBeenCalled()
  })

  it('keeps the real redraft tab copy user-facing for beta managers', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/tabs/RedraftTab.tsx'), 'utf8')

    expect(source).toContain('Season Hub')
    expect(source).toContain('Track matchups, rosters, waivers, trades, standings, and playoffs from one place.')
    expect(source).not.toContain('PlayerWeeklyScore')
    expect(source).not.toContain('cached weekly stats')
  })
})
