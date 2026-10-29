// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    exileIsland: { findUnique: vi.fn() },
    survivorPlayer: { findFirst: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorAuditEntry: { findFirst: vi.fn() },
    exileWeeklyEntry: { findFirst: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => false }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })), assertLeagueCommissioner: vi.fn() }))
vi.mock('@/lib/survivor/exileRosterService', () => ({ getExileWaivers: vi.fn(), mutateExileRoster: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn(), scoreExileWeek: vi.fn() }))
vi.mock('@/lib/survivor/survivorExileRollover', () => ({ runExileRosterRollover: vi.fn() }))
vi.mock('@/lib/survivor/exileTeamDraft', () => ({ submitExileTeamClaim: vi.fn(), getExileTeamDraftStatus: vi.fn() }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: vi.fn() }))
import { GET } from '@/app/api/survivor/exile/route'

const get = () => GET(new NextRequest('http://localhost/api/survivor/exile?leagueId=l1'))

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'me' } })
  m.db.exileIsland.findUnique.mockResolvedValue({ id: 'island', isActive: true, bossWinsEnabled: false, currentWeek: 7 })
  m.db.survivorPlayer.findFirst.mockResolvedValue({ userId: 'me', playerState: 'exile', tokenBalance: 2 })
  m.db.league.findUnique.mockResolvedValue({ settings: {}, sport: 'NFL', season: 2026, survivorTokenCap: 5 })
  m.db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }: { where: { action: string } }) => where.action === 'exile_week_scored' ? { week: 6 } : null)
})

describe('GET /api/survivor/exile latest result', () => {
  it('reads only the session user\'s entry for the latest scored week and returns the cap', async () => {
    m.db.exileWeeklyEntry.findFirst.mockResolvedValue({ id: 'e6', week: 6, weeklyScore: 131.2, bossScore: 118.4, tokenEarned: 1, tokenWiped: false })
    const body = await (await get()).json()
    expect(m.db.exileWeeklyEntry.findFirst.mock.calls[0][0].where).toEqual({ exileId: 'island', userId: 'me', week: 6 })
    expect(body.latestResult).toEqual({ id: 'e6', week: 6, weeklyScore: 131.2, bossScore: 118.4, tokenEarned: 1, tokenWiped: false })
    expect(body.tokenCap).toBe(5)
  })

  it('sends no toast for a scored week without a token change', async () => {
    m.db.exileWeeklyEntry.findFirst.mockResolvedValue({ id: 'e6', week: 6, weeklyScore: 90, bossScore: 80, tokenEarned: 0, tokenWiped: false })
    expect((await (await get()).json()).latestResult).toBeNull()
  })

  it('sends no toast before any Exile week is scored', async () => {
    m.db.survivorAuditEntry.findFirst.mockResolvedValue(null)
    const body = await (await get()).json()
    expect(body.latestResult).toBeNull()
    expect(m.db.exileWeeklyEntry.findFirst).not.toHaveBeenCalled()
  })
})
