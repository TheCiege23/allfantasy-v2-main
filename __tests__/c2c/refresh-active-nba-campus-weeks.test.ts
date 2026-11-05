import { describe, expect, it, vi } from 'vitest'
import { refreshActiveNbaCampusWeeks } from '@/lib/c2c/refreshActiveNbaCampusWeeks'

describe('active NBA campus worker refresh', () => {
  it('deduplicates current and previous weeks and ignores imported and non-C2C leagues', async () => {
    const league = { platform: 'af', sport: 'NBA', leagueVariant: 'c2c' }
    const db = { redraftSeason: { findMany: vi.fn().mockResolvedValue([
      { season: 2026, currentWeek: 3, league }, { season: 2026, currentWeek: 3, league },
      { season: 2026, currentWeek: 4, league: { ...league, platform: 'sleeper' } },
      { season: 2026, currentWeek: 5, league: { ...league, leagueVariant: 'dynasty' } },
    ]) } } as any
    const refresh = vi.fn().mockResolvedValue({ boxesStored: 1, blocked: false })
    const result = await refreshActiveNbaCampusWeeks(db, { now: new Date(), deadlineAt: Date.now() + 10000, maxEvents: 5, refresh: refresh as any })
    expect(result.periods).toBe(2)
    expect(db.redraftSeason.findMany.mock.calls[0][0].where.status.in).toContain('playoffs')
    expect(refresh.mock.calls.map(c => c[1].week).sort()).toEqual([2, 3])
  })
  it('counts attempted boxes, including failed requests, against the shared limit', async () => {
    const db = { redraftSeason: { findMany: vi.fn().mockResolvedValue([{ season: 2026, currentWeek: 3, league: { platform: 'af', sport: 'NBA', leagueVariant: 'c2c' } }]) } } as any
    const refresh = vi.fn().mockResolvedValue({ boxesAttempted: 2, boxesStored: 0, blocked: false })
    const result = await refreshActiveNbaCampusWeeks(db, { now: new Date(), deadlineAt: Date.now() + 10000, maxEvents: 2, refresh: refresh as any })
    expect(result.processed).toBe(1)
  })
  it('stops the whole pass when ESPN refuses access', async () => {
    const db = { redraftSeason: { findMany: vi.fn().mockResolvedValue([{ season: 2026, currentWeek: 3, league: { platform: 'af', sport: 'NBA', leagueVariant: 'c2c' } }]) } } as any
    const refresh = vi.fn().mockResolvedValue({ blocked: true })
    const result = await refreshActiveNbaCampusWeeks(db, { now: new Date(), deadlineAt: Date.now() + 10000, maxEvents: 5, refresh: refresh as any })
    expect(refresh).toHaveBeenCalledOnce()
    expect(result.processed).toBe(1)
  })
})
