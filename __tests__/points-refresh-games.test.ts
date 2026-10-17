// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: h.findMany } } }))
import { pointsRefreshGameIds, POINTS_CORRECTION_WINDOW_MS } from '@/lib/live/pointsRefreshGames'
describe('bounded final score corrections', () => {
  it('includes final and live games from either source and excludes pregame', async () => {
    const now = new Date('2026-10-04T23:00:00Z')
    h.findMany.mockResolvedValue([{ externalId: 'live', status: 'in_progress' }, { externalId: 'final', status: 'final' }, { externalId: 'pre', status: 'scheduled' }])
    expect(await pointsRefreshGameIds(now)).toEqual(['live', 'final'])
    expect(h.findMany).toHaveBeenCalledWith({ where: { sport: 'NFL', startTime: { gte: new Date(now.getTime() - POINTS_CORRECTION_WINDOW_MS), lte: now } }, select: { externalId: true, status: true }, take: 100 })
  })
  it('fails closed if stored game state cannot be read', async () => {
    h.findMany.mockRejectedValue(new Error('offline'))
    expect(await pointsRefreshGameIds()).toEqual([])
  })
})
