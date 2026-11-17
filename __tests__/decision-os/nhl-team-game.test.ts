/**
 * Hockey goalies on the team-game scale (NHL values, 2026-11-16). A goalie's projection is per game he
 * PLAYED, and the board multiplies by the team's games left — so before this a backup was valued as if he
 * started every night. Skaters are untouched.
 */
import { describe, expect, it } from 'vitest'
import { isGoalie, NHL_REGULAR_SEASON_GAMES, toNhlTeamGameLines } from '@/lib/decision-os/trade/nhlTeamGame'

const skater = { id: 'skater', position: 'C', sampleGames: 82, sourceSeason: 2025, stats: { g: 0.5, a: 0.7, sog: 3.2 } }
const starter = { id: 'starter', position: 'G', sampleGames: 62, sourceSeason: 2025, stats: { g_win: 0.55, g_sv: 26, g_ga: 2.5 } }
const backup = { id: 'backup', position: 'G', sampleGames: 24, sourceSeason: 2025, stats: { g_win: 0.5, g_sv: 25, g_ga: 2.4 } }
const byId = (lines: ReturnType<typeof toNhlTeamGameLines>) => new Map(lines.map((l) => [l.id, l]))

describe('toNhlTeamGameLines', () => {
  it('🛑 a backup counts for his share of team games, not every night', () => {
    const out = byId(toNhlTeamGameLines([skater, starter, backup]))
    expect(out.get('backup')!.share).toBeCloseTo(24 / 82, 9)
    expect(out.get('backup')!.stats.g_sv).toBeCloseTo(25 * (24 / 82), 9)
    expect(out.get('starter')!.share).toBeCloseTo(62 / 82, 9)
    // Per game played the backup is nearly the starter; per TEAM game he is well under half.
    expect(out.get('backup')!.stats.g_win).toBeLessThan(out.get('starter')!.stats.g_win / 2)
  })

  it('skaters are unscaled, injured or not', () => {
    const out = byId(toNhlTeamGameLines([{ ...skater, sampleGames: 40 }, starter]))
    expect(out.get('skater')!.share).toBe(1)
    expect(out.get('skater')!.stats.g).toBe(0.5)
  })

  it('reads team games off the board — a season in progress is not 82', () => {
    const out = byId(toNhlTeamGameLines([{ ...skater, sampleGames: 20, sourceSeason: 2026 }, { ...starter, sampleGames: 15, sourceSeason: 2026 }]))
    expect(out.get('starter')!.share).toBeCloseTo(15 / 20, 9)
    expect(NHL_REGULAR_SEASON_GAMES).toBe(82)
  })

  it('a blended skater never inflates this season’s team games; a blended goalie weights each season’s share', () => {
    const vet = { ...skater, id: 'vet', sampleGames: 92, sourceSeason: 2026, seasonBlend: { currentGames: 10, previousGames: 82, currentWeight: 0.333 } }
    const rookieG = { ...starter, id: 'rookie-g', sampleGames: 8, sourceSeason: 2026 }
    const blendedG = { ...starter, id: 'blended-g', sampleGames: 68, sourceSeason: 2026, seasonBlend: { currentGames: 6, previousGames: 62, currentWeight: 0.231 } }
    const out = byId(toNhlTeamGameLines([vet, rookieG, blendedG]))
    expect(out.get('rookie-g')!.share).toBeCloseTo(8 / 10, 9)
    expect(out.get('blended-g')!.share).toBeCloseTo(0.231 * (6 / 10) + 0.769 * (62 / 82), 9)
  })

  it('a goalie with no games on file is dropped, never scaled by a guess', () => {
    expect(toNhlTeamGameLines([skater, { ...backup, sampleGames: null }]).map((l) => l.id)).toEqual(['skater'])
    expect(isGoalie('g')).toBe(true)
    expect(isGoalie('D')).toBe(false)
  })
})
