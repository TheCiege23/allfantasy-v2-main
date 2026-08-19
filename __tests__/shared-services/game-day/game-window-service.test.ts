import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFantasyScheduleGameFindMany } = vi.hoisted(() => ({ mockFantasyScheduleGameFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { fantasyScheduleGame: { findMany: mockFantasyScheduleGameFindMany } } }))

import { computeGameWindows } from '@/lib/shared-services/game-day/GameWindowService'

describe('computeGameWindows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns no windows when no games have a kickoff time', async () => {
    mockFantasyScheduleGameFindMany.mockResolvedValue([{ kickoffTime: null }, { kickoffTime: null }])
    const windows = await computeGameWindows({ sport: 'NFL', season: '2026', week: 5 })
    expect(windows).toEqual([])
  })

  it('groups NFL games into real day-part windows', async () => {
    mockFantasyScheduleGameFindMany.mockResolvedValue([
      { kickoffTime: new Date('2026-11-05T20:20:00.000Z') }, // Thursday, ET day=4
      { kickoffTime: new Date('2026-11-08T16:00:00.000Z') }, // Sunday 11am ET (hour<13) -> sunday_early
      { kickoffTime: new Date('2026-11-08T19:00:00.000Z') }, // Sunday 2pm ET (13<=hour<17) -> sunday_late
      { kickoffTime: new Date('2026-11-09T05:30:00.000Z') }, // Monday 12am ET, ET day=1 -> monday
    ])

    const windows = await computeGameWindows({ sport: 'NFL', season: '2026', week: 10 })
    const ids = windows.map((w) => w.id).sort()
    expect(ids).toEqual(['monday', 'sunday_early', 'sunday_late', 'thursday'])
    expect(windows.every((w) => w.gameCount >= 1)).toBe(true)
  })

  it('groups non-NFL sports into a single daily-slate window per calendar date', async () => {
    mockFantasyScheduleGameFindMany.mockResolvedValue([
      { kickoffTime: new Date('2026-11-05T00:00:00.000Z') },
      { kickoffTime: new Date('2026-11-05T02:00:00.000Z') },
    ])

    const windows = await computeGameWindows({ sport: 'NBA', season: '2026', week: 10 })
    expect(windows).toHaveLength(1)
    expect(windows[0].gameCount).toBe(2)
    expect(windows[0].sport).toBe('NBA')
  })

  it('sets startTime/endTime from the earliest/latest kickoff in the window', async () => {
    const early = new Date('2026-11-08T15:00:00.000Z')
    const late = new Date('2026-11-08T16:30:00.000Z')
    mockFantasyScheduleGameFindMany.mockResolvedValue([{ kickoffTime: late }, { kickoffTime: early }])

    const windows = await computeGameWindows({ sport: 'NFL', season: '2026', week: 10 })
    const sundayEarly = windows.find((w) => w.id === 'sunday_early')
    expect(sundayEarly?.startTime).toBe(early.toISOString())
    expect(sundayEarly?.endTime).toBe(late.toISOString())
  })

  it('queries FantasyScheduleGame scoped to sport/season/week', async () => {
    mockFantasyScheduleGameFindMany.mockResolvedValue([])
    await computeGameWindows({ sport: 'NFL', season: '2026', week: 7 })
    expect(mockFantasyScheduleGameFindMany).toHaveBeenCalledWith({
      where: { sport: 'NFL', season: '2026', week: 7 },
      select: { kickoffTime: true },
    })
  })
})
