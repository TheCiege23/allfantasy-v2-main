// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), board: vi.fn(), leagues: vi.fn(), scores: vi.fn(), top: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/standingsBoard', () => ({ getTournamentStandingsBoard: mocks.board }))
vi.mock('@/lib/tournament/topPerformers', () => ({ getTournamentTopPerformers: mocks.top }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: mocks.leagues }, weeklyMatchup: { findMany: mocks.scores } } }))
import { GET } from '@/app/api/tournament/[tournamentId]/weekly-report/route'
import { GET as topGet } from '@/app/api/tournament/[tournamentId]/top-performers/route'
const ctx = { params: Promise.resolve({ tournamentId: 'cup' }) }
beforeEach(() => { vi.resetAllMocks() })
describe('weekly report access and period', () => {
  it('requires login and commissioner access before reading scores', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://example.com?season=2026&week=2'), ctx)).status).toBe(401)
    mocks.session.mockResolvedValue({ user: { id: 'other' } })
    mocks.board.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://example.com?season=2026&week=2'), ctx)).status).toBe(404)
    expect(mocks.scores).not.toHaveBeenCalled()
    expect(mocks.board).toHaveBeenCalledWith('cup', 'other')
  })
  it('rejects missing weekly period rather than querying week zero', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.board.mockResolvedValue({ conferences: [] })
    expect((await GET(new NextRequest('https://example.com'), ctx)).status).toBe(400)
    expect(mocks.scores).not.toHaveBeenCalled()
  })
  it('defaults player leaders to this season and the latest collected week', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.top.mockResolvedValue({ week: 2 })
    await topGet(new NextRequest('https://example.com'), ctx)
    expect(mocks.top).toHaveBeenCalledWith({ tournamentId: 'cup', commissionerUserId: 'owner', season: new Date().getFullYear(), week: undefined })
  })
})
