// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  ensureStart: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: h.findMany, count: h.count },
  },
}))
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({
  ensureDailySportSeasonStart: h.ensureStart,
}))

import { trustedZombieWeekStart } from '@/lib/zombie/zombieWeekGameStart'

beforeEach(() => {
  vi.clearAllMocks()
  h.count.mockResolvedValue(0)
  h.ensureStart.mockResolvedValue({ opener: 'curated' })
})

describe('trusted four-sport week lock', () => {
  it('uses regular-season NFL periods, excluding preseason week one', async () => {
    const start = new Date('2026-09-10T00:20:00.000Z')
    h.findMany.mockResolvedValue([{ startTime: start }, { startTime: new Date('2026-09-13T17:00:00.000Z') }])
    expect(await trustedZombieWeekStart('NFL', 2026, 1)).toEqual(start)
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: 'api_sports', seasonType: 'regular', week: 1 }),
    }))
  })

  it.each([
    ['NBA', '2026-10-20T23:30:00.000Z'],
    ['NHL', '2026-09-29T23:00:00.000Z'],
    ['MLB', '2026-03-25T23:05:00.000Z'],
  ])('locates the first Eastern-day game in %s week one', async (sport, iso) => {
    const start = new Date(iso)
    h.findMany.mockResolvedValue([{ startTime: start }])
    expect(await trustedZombieWeekStart(sport, 2026, 1)).toEqual(start)
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: 'thesportsdb' }),
    }))
  })

  it('closes the power window when a trusted season contains undated games', async () => {
    h.count.mockResolvedValue(1)
    h.findMany.mockResolvedValue([{ startTime: new Date('2026-10-20T23:30:00.000Z') }])
    expect(await trustedZombieWeekStart('NBA', 2026, 1)).toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('keeps powers closed when the trusted regular-season feed is absent', async () => {
    h.findMany.mockResolvedValue([])
    expect(await trustedZombieWeekStart('NFL', 2026, 1)).toBeNull()
  })
})
