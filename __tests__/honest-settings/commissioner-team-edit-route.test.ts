// @vitest-environment node
/**
 * PATCH /api/commissioner/leagues/[leagueId]/teams (2026-11-15).
 *
 * 🛑 The settings window's Team tab saved team names and avatars to this path, and it did not exist, so every save
 * failed. It now renames the team in both tables the league reads, refuses imported leagues, and is logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: vi.fn(),
  league: vi.fn(),
  team: vi.fn(),
  season: vi.fn(),
  roster: vi.fn(),
  teamUpdate: vi.fn(async () => ({})),
  redraftUpdate: vi.fn(async () => ({ count: 1 })),
  log: vi.fn(async () => ({ id: 'a' })),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: h.role }))
vi.mock('@/server/services/auditService', () => ({ logAction: h.log }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    leagueTeam: { findFirst: h.team, update: h.teamUpdate },
    redraftSeason: { findFirst: h.season },
    roster: { findFirst: h.roster },
    redraftRoster: { updateMany: h.redraftUpdate },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}))
vi.mock('@/lib/league/commissionerAccess', async () => (await import('../helpers/commissionerAccessMock')).accessFromRole(() => h.role))

import { PATCH } from '@/app/api/commissioner/leagues/[leagueId]/teams/route'

const call = (body: unknown) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ leagueId: 'L1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.role.mockResolvedValue('commissioner')
  h.league.mockResolvedValue({ platform: 'allfantasy' })
  h.team.mockResolvedValue({ id: 'lt1', externalId: 'r1', teamName: 'Old Name', avatarUrl: null })
  h.season.mockResolvedValue({ id: 's26' })
  h.roster.mockResolvedValue({ redraftRosterId: 'rr1' })
})

describe('a commissioner editing a team', () => {
  it('renames it in the league and in the current season, and logs it', async () => {
    const res = await call({ leagueTeamId: 'lt1', teamName: '  Gridiron   Gang ' })
    expect(res.status).toBe(200)
    expect(h.teamUpdate).toHaveBeenCalledWith({ where: { id: 'lt1' }, data: { teamName: 'Gridiron Gang' } })
    expect(h.redraftUpdate).toHaveBeenCalledWith({ where: { id: 'rr1', leagueId: 'L1', seasonId: 's26' }, data: { teamName: 'Gridiron Gang' } })
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', userId: 'commish', beforeState: { teamName: 'Old Name', avatarUrl: null } }))
  })

  it('sets and clears an avatar, https only', async () => {
    expect((await call({ leagueTeamId: 'lt1', avatarUrl: 'https://img.example/logo.png' })).status).toBe(200)
    expect((await call({ leagueTeamId: 'lt1', avatarUrl: null })).status).toBe(200)
    expect(h.teamUpdate.mock.calls[1]![0]).toEqual({ where: { id: 'lt1' }, data: { avatarUrl: null } })
    expect((await call({ leagueTeamId: 'lt1', avatarUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await call({ leagueTeamId: 'lt1', avatarUrl: 'http://img.example/x.png' })).status).toBe(400)
  })

  it('refuses a blank name, a team from another league, and a non-commissioner', async () => {
    expect((await call({ leagueTeamId: 'lt1', teamName: '   ' })).status).toBe(400)
    h.team.mockResolvedValueOnce(null)
    expect((await call({ leagueTeamId: 'other', teamName: 'X' })).status).toBe(404)
    h.role.mockResolvedValueOnce('member')
    expect((await call({ leagueTeamId: 'lt1', teamName: 'X' })).status).toBe(403)
    expect(h.teamUpdate).not.toHaveBeenCalled()
  })

  it('an imported league is refused: its names come from the host platform', async () => {
    h.league.mockResolvedValue({ platform: 'sleeper' })
    const res = await call({ leagueTeamId: 'lt1', teamName: 'X' })
    expect(res.status).toBe(409)
    expect(h.teamUpdate).not.toHaveBeenCalled()
  })
})
