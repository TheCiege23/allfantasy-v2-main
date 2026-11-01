import { describe, expect, it } from 'vitest'
import { compactDraftPlayerStats } from '@/lib/draft-room/compactDraftPlayerStats'

describe('compact draft stats use the sport and player position', () => {
  it('omits missing stats without manufacturing zeros', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB']) expect(compactDraftPlayerStats({}, sport, '')).toBe('')
  })
  it('uses basketball per-game rates', () => {
    expect(compactDraftPlayerStats({ display: { stats: { pointsPerGame: 24, reboundsPerGame: 8, minutesPerGame: 32 } } }, 'NBA', 'C')).toMatch(/PPG 24.*RPG 8.*MPG 32/)
  })
  it('uses pitching columns for MLB pitchers and batting for hitters', () => {
    const player = { display: { stats: { wins: 12, strikeouts: 190, homeRuns: 30 } } }
    expect(compactDraftPlayerStats(player, 'MLB', 'SP')).toMatch(/W 12.*K 190/)
    expect(compactDraftPlayerStats(player, 'MLB', 'OF')).toBe('HR 30')
  })
  it('uses goaltending columns for NHL goalies and preserves real zero values', () => {
    const player = { display: { stats: { saves: 800, wins: 0, goals: 20 } } }
    expect(compactDraftPlayerStats(player, 'NHL', 'G')).toMatch(/SV 800.*W 0/)
    expect(compactDraftPlayerStats(player, 'NHL', 'C')).toBe('G 20')
  })
})
