// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), board: vi.fn(), leagues: vi.fn(), scores: vi.fn(), latest: vi.fn(), top: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/standingsBoard', () => ({ getTournamentStandingsBoard: mocks.board }))
vi.mock('@/lib/tournament/topPerformers', () => ({ getTournamentTopPerformers: mocks.top }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: mocks.leagues }, weeklyMatchup: { findMany: mocks.scores, findFirst: mocks.latest } } }))
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
  it('rejects explicit week zero', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.board.mockResolvedValue({ conferences: [] })
    expect((await GET(new NextRequest('https://example.com?week=0'), ctx)).status).toBe(400)
    expect(mocks.scores).not.toHaveBeenCalled()
  })
  it('chooses the latest collected week within the tournament and selected season', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.board.mockResolvedValue({ name: 'Cup', roundNumber: 1, conferences: [{ name: 'Black', leagues: [{ leagueId: 'local', name: 'A', rows: [] }] }] })
    mocks.leagues.mockResolvedValue([{ id: 'local', platformLeagueId: 'source' }])
    mocks.latest.mockResolvedValue({ week: 2 })
    mocks.scores.mockResolvedValue([])
    const response = await GET(new NextRequest('https://example.com?season=2026'), ctx)
    expect(response.status).toBe(200)
    expect((await response.json()).week).toBe(2)
    expect(mocks.latest).toHaveBeenCalledWith({ where: { leagueId: { in: ['source'] }, seasonYear: 2026, pointsFor: { not: 0 } }, orderBy: { week: 'desc' }, select: { week: true } })
    expect(mocks.scores).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: { in: ['source'] }, seasonYear: 2026, week: 2 } }))
  })
  it('explains unavailable automatic weeks without inventing scores', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.board.mockResolvedValue({ conferences: [] })
    mocks.leagues.mockResolvedValue([])
    mocks.latest.mockResolvedValue(null)
    const response = await GET(new NextRequest('https://example.com?season=2026&week='), ctx)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('Choose a week')
    expect(mocks.scores).not.toHaveBeenCalled()
  })
  it('honors an explicit week even when automatic selection has no scoring activity', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.board.mockResolvedValue({ name: 'Cup', roundNumber: 1, conferences: [] })
    mocks.leagues.mockResolvedValue([])
    mocks.scores.mockResolvedValue([])
    const response = await GET(new NextRequest('https://example.com?season=2026&week=1'), ctx)
    expect(response.status).toBe(200)
    expect((await response.json()).week).toBe(1)
    expect(mocks.latest).not.toHaveBeenCalled()
  })
  it('defaults player leaders to this season and the latest collected week', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.top.mockResolvedValue({ week: 2 })
    await topGet(new NextRequest('https://example.com'), ctx)
    expect(mocks.top).toHaveBeenCalledWith({ tournamentId: 'cup', commissionerUserId: 'owner', season: new Date().getFullYear(), week: undefined })
  })
})
