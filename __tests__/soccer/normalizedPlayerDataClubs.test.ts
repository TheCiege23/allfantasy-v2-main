/** Rosters and the waiver wire name a soccer player's club (getNormalizedPlayerData, 2026-11-27). */
import { describe, expect, it, vi } from 'vitest'

const rows = vi.fn()
vi.mock('@/lib/player-data/getPlayerDataForSurface', () => ({ getPlayerDataForSurface: (...a: unknown[]) => rows(...a) }))
vi.mock('@/lib/soccer/soccerClubNames', async (orig) => ({
  ...(await orig<typeof import('@/lib/soccer/soccerClubNames')>()),
  loadSoccerClubNames: async () => new Map([['17', { name: 'Tottenham Hotspur', shortName: 'TOT' }]]),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'

describe('getNormalizedPlayerData soccer clubs', () => {
  it('names a soccer row\'s numeric club, reading the sport from the row\'s display', async () => {
    rows.mockResolvedValue([
      { team: '17', display: { sport: 'SOCCER', team: { displayName: '17', abbreviation: '17' } } },
      { team: '17', display: { sport: 'NBA', team: { displayName: '17', abbreviation: '17' } } },
    ])
    const [soccer, nba] = await getNormalizedPlayerData({ surface: 'roster' } as never)
    expect(soccer.team).toBe('TOT')
    expect(soccer.display?.team).toMatchObject({ displayName: 'Tottenham Hotspur', abbreviation: 'TOT' })
    expect(nba.team).toBe('17')
  })
})
