import { describe, expect, it } from 'vitest'
import { positionTintHex } from '@/lib/draft-room/positionTint'

const SLEEPER = ['#ff2a6d', '#00ceb8', '#58a7ff', '#ffae58']

describe('AF position palette (room v2)', () => {
  it('uses AF colors for the football positions, none of them Sleeper\'s', () => {
    expect(positionTintHex('QB')).toBe('#9b7bff')
    expect(positionTintHex('RB')).toBe('#74d65a')
    expect(positionTintHex('WR')).toBe('#ffc857')
    expect(positionTintHex('TE')).toBe('#ff7a59')
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'PG', 'SG', 'SF', 'PF', 'C', 'LW', 'RW', 'D', 'G', 'SP', 'RP', 'SS', 'OF', 'GK', 'DEF', 'MID', 'FWD']) {
      expect(SLEEPER).not.toContain(positionTintHex(pos))
    }
  })

  it('reads a shared letter by sport: C is a center in the NHL and a catcher in MLB', () => {
    expect(positionTintHex('C', 'NHL')).toBe('#9b7bff')
    expect(positionTintHex('C', 'MLB')).toBe('#ff7a59')
    expect(positionTintHex('C', 'NBA')).toBe('#ff7a59')
    expect(positionTintHex('G', 'NHL')).not.toBe(positionTintHex('G', 'NBA'))
    expect(positionTintHex('DEF', 'SOCCER')).not.toBe(positionTintHex('DEF', 'NFL'))
    expect(positionTintHex('F', 'SOCCER')).toBe(positionTintHex('FWD', 'SOCCER'))
  })

  it('gives every position in all seven sports a color, sport case-insensitive', () => {
    const bySport: Record<string, string[]> = {
      NFL: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
      NCAAF: ['QB', 'RB', 'WR', 'TE', 'K'],
      NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
      NCAAB: ['G', 'F', 'C'],
      MLB: ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'],
      NHL: ['C', 'LW', 'RW', 'D', 'G'],
      SOCCER: ['GK', 'DEF', 'MID', 'FWD'],
    }
    for (const [sport, positions] of Object.entries(bySport)) {
      for (const pos of positions) expect(positionTintHex(pos, sport.toLowerCase())).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(positionTintHex(null, 'NFL')).toBeNull()
  })
})
