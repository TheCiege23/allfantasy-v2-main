import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), league: vi.fn(), teams: vi.fn(), results: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league }, leagueTeam: { findMany: mocks.teams }, teamPerformance: { findMany: mocks.results } } }))
vi.mock('@/lib/league-context-engine/resolveNormalizedLeagueContext', () => ({ resolveNormalizedLeagueContext: mocks.context }))
import { strategyEvidencePrismaPort } from '@/lib/decision-os/value-v2/strategyEvidencePrisma'
const scope = { userId: 'owner', leagueId: 'L', season: 2026 }
const context = { ...scope, team: { teamId: 'a' }, sport: 'NFL', flags: { isDynasty: true },
  matchupPeriod: { currentPeriod: 5, source: 'sleeper_state_nfl', verifiedRegularSeason: true }, importHealth: { lastSyncedAt: '2026-10-01T12:00:00Z' } }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, context })
  mocks.league.mockResolvedValue({ leagueSize: 2 })
  mocks.teams.mockResolvedValue([{ id: 'a', claimedByUserId: 'owner' }, { id: 'b', claimedByUserId: 'other' }])
  mocks.results.mockResolvedValue([])
})
it('restricts result reads to the authenticated leagues teams, recorded season and completed weeks', async () => {
  const facts = await strategyEvidencePrismaPort.load(scope)
  expect(mocks.context).toHaveBeenCalledWith({ userId: 'owner', leagueId: 'L' })
  expect(mocks.teams).toHaveBeenCalledWith({ where: { leagueId: 'L' }, select: { id: true, claimedByUserId: true } })
  expect(mocks.results.mock.calls[0][0].where).toEqual({ teamId: { in: ['a', 'b'] }, season: 2026, week: { gte: 1, lt: 5 } })
  expect(facts?.ownerTeamId).toBe('a')
  expect(facts?.teamCount).toBe(2)
})
it('refuses denied access, mismatched scope and a missing team without fetching results', async () => {
  for (const resolved of [{ ok: false }, { ok: true, context: { ...context, userId: 'victim' } },
    { ok: true, context: { ...context, season: 2025 } }, { ok: true, context: { ...context, team: null } }]) {
    mocks.context.mockResolvedValueOnce(resolved)
    expect(await strategyEvidencePrismaPort.load(scope)).toBeNull()
  }
  expect(mocks.results).not.toHaveBeenCalled()
})
it('refuses a Sleeper week that is not verified as this season\'s regular season', async () => {
  for (const verifiedRegularSeason of [false, undefined]) {
    mocks.context.mockResolvedValueOnce({ ok: true, context: { ...context, matchupPeriod: { ...context.matchupPeriod, verifiedRegularSeason } } })
    expect(await strategyEvidencePrismaPort.load(scope)).toBeNull()
  }
  expect(mocks.results).not.toHaveBeenCalled()
})
it('refuses lost or ambiguous team claims before loading results', async () => {
  for (const teams of [[{ id: 'a', claimedByUserId: 'other' }],
    [{ id: 'a', claimedByUserId: 'owner' }, { id: 'b', claimedByUserId: 'owner' }]]) {
    mocks.teams.mockResolvedValueOnce(teams)
    expect(await strategyEvidencePrismaPort.load(scope)).toBeNull()
  }
  expect(mocks.results).not.toHaveBeenCalled()
})
