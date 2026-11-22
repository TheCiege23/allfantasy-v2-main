// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { decideCareerJoin, leagueCareerLevel, savedLeagueCareerLevel } from '@/lib/league-join/careerJoinGate'

describe('league Career Level', () => {
  it('keeps the level saved at creation even when the owner levels up', () => {
    expect(leagueCareerLevel({ userId: 'host', settings: { league_finder_rank_window: { creatorRankLevel: 9 } } }, new Map([['host', 12]]))).toBe(9)
  })

  it('falls back to the owner for older leagues or Level 1 for a new manager', () => {
    expect(savedLeagueCareerLevel({ creatorRankLevel: 99 })).toBeNull()
    expect(leagueCareerLevel({ userId: 'host', settings: {} }, new Map([['host', 12]]))).toBe(12)
    expect(leagueCareerLevel({ userId: 'host', settings: null }, new Map())).toBe(1)
  })

  it('clamps the displayed join band at the edges of the ladder', () => {
    expect(decideCareerJoin(4, 1)).toMatchObject({ band: [1, 4], canJoin: true })
    expect(decideCareerJoin(21, 25)).toMatchObject({ band: [22, 25], canJoin: false })
    expect(decideCareerJoin(13, 9)).toMatchObject({ band: [6, 12], canJoin: false })
  })
})
