/**
 * Baseball on one scale before a trade grade compares anyone: per TEAM game, pitchers split into SP and RP,
 * hitters and pitchers told apart by what they do per appearance (MLB trade grade, 2026-10-09).
 */
import { describe, expect, it } from 'vitest'
import { isPitchingCategory, isPitchingSlot, MLB_REGULAR_SEASON_GAMES, toTeamGameLines } from '@/lib/decision-os/trade/mlbTeamGame'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'

// Per-APPEARANCE lines in the engine's keys, shaped like `mlbPerGameRates` output (2025 production values).
const judge = { id: 'judge', position: 'RF', sampleGames: 152, sourceSeason: 2025, stats: { ab: 3.56, h: 1.18, hr: 0.349, r: 0.9 } }
const skenes = { id: 'skenes', position: 'P', sampleGames: 32, sourceSeason: 2025, stats: { ip: 5.86, outs: 17.6, so: 6.75, w: 0.31, er: 1.28 } }
const clase = { id: 'clase', position: 'P', sampleGames: 48, sourceSeason: 2025, stats: { ip: 0.99, outs: 2.96, so: 0.98, sv: 0.5 } }
const ohtani = { id: 'ohtani', position: 'TWP', sampleGames: 158, sourceSeason: 2025, stats: { ab: 3.87, hr: 0.348, ip: 0.3, outs: 0.89, so: 0.39 } }
const everyday = { id: 'everyday', position: 'SS', sampleGames: 162, sourceSeason: 2025, stats: { ab: 4.1, hr: 0.1 } }

const byId = (lines: ReturnType<typeof toTeamGameLines>) => new Map(lines.map((l) => [l.id, l]))

describe('toTeamGameLines', () => {
  it('scales a starter to his share of team games — his line is per start, about one game in five', () => {
    const out = byId(toTeamGameLines([judge, skenes, everyday]))
    const s = out.get('skenes')!
    expect(s.share).toBeCloseTo(32 / 162, 9)
    expect(s.stats.so).toBeCloseTo(6.75 * (32 / 162), 9)
    expect(s.stats.ip).toBeCloseTo(5.86 * (32 / 162), 9)
  })

  it('leaves hitters unscaled, injured or not, the same as every other sport', () => {
    const out = byId(toTeamGameLines([judge, everyday]))
    expect(out.get('judge')!.share).toBe(1)
    expect(out.get('judge')!.stats.hr).toBe(0.349)
  })

  it('reads team games off the board — a season in progress is not 162', () => {
    const midSeason = [
      { ...everyday, sampleGames: 60, sourceSeason: 2027 },
      { ...skenes, sampleGames: 12, sourceSeason: 2027 },
    ]
    expect(byId(toTeamGameLines(midSeason)).get('skenes')!.share).toBeCloseTo(12 / 60, 9)
  })

  it('falls back to the 162-game season when no hitter says how many games a season had', () => {
    expect(byId(toTeamGameLines([skenes])).get('skenes')!.share).toBeCloseTo(32 / MLB_REGULAR_SEASON_GAMES, 9)
  })

  it('files a pitcher by role: three innings an appearance or more is a starter', () => {
    const out = byId(toTeamGameLines([everyday, skenes, clase]))
    expect(out.get('skenes')!.position).toBe('SP')
    expect(out.get('clase')!.position).toBe('RP')
  })

  it('keeps a two-way player whole and in both groups, filed where he plays every day', () => {
    const o = byId(toTeamGameLines([everyday, ohtani])).get('ohtani')!
    // TWP fills no lineup slot and no free agent shares it, so he would have no replacement level.
    expect(o).toMatchObject({ hitter: true, pitcher: true, share: 1, position: 'DH' })
    expect(o.stats.so).toBe(0.39)
  })

  it('files every outfielder as OF — one outfield, one waiver wire', () => {
    const out = byId(toTeamGameLines([judge, { ...everyday, id: 'cf', position: 'CF' }, { ...everyday, id: 'of', position: 'OF' }, everyday]))
    expect(['judge', 'cf', 'of'].map((id) => out.get(id)!.position)).toEqual(['OF', 'OF', 'OF'])
    expect(out.get('everyday')!.position).toBe('SS')
  })

  it('prices a baseball projection on at-bats or innings, never on ten games', () => {
    const callUp = { id: 'callup', position: 'DH', sampleGames: 11, sourceSeason: 2025, stats: { ab: 2.8, hr: 0.09 } }
    const out = byId(toTeamGameLines([everyday, callUp, skenes, { ...clase, id: 'cup', sampleGames: 12 }]))
    expect(out.get('callup')!.sampleBar).toEqual({ ok: false, has: '31 at-bats', needs: '100 at-bats or 30 innings' })
    expect(out.get('everyday')!.sampleBar!.ok).toBe(true)
    expect(out.get('skenes')!.sampleBar).toMatchObject({ ok: true, has: '187.5 innings' })
    expect(out.get('cup')!.sampleBar).toMatchObject({ ok: false, has: '11.9 innings' })
  })

  it('does not make a starter a hitter for a stray at-bat, or a position player a pitcher for a mop-up inning', () => {
    const starterWhoBatted = { ...skenes, id: 'batted', stats: { ...skenes.stats, ab: 0.06 } }
    const mopUp = { ...everyday, id: 'mop', stats: { ...everyday.stats, outs: 0.02, ip: 0.007 } }
    const out = byId(toTeamGameLines([everyday, starterWhoBatted, mopUp]))
    expect(out.get('batted')).toMatchObject({ hitter: false, pitcher: true, position: 'SP' })
    expect(out.get('batted')!.share).toBeCloseTo(32 / 162, 9)
    expect(out.get('mop')).toMatchObject({ hitter: true, pitcher: false, share: 1 })
  })

  it('drops a line it cannot put on the scale rather than guessing', () => {
    const fieldingOnly = { id: 'glove', position: 'SS', sampleGames: 40, sourceSeason: 2025, stats: { E: 0.05, PO: 1.2 } }
    const unknownAppearances = { ...skenes, id: 'unknown', sampleGames: null }
    const out = byId(toTeamGameLines([everyday, fieldingOnly, unknownAppearances]))
    expect(out.has('glove')).toBe(false)
    expect(out.has('unknown')).toBe(false)
  })
})

describe('MLB groups', () => {
  it('tells pitching categories from hitting ones by the stats they read', () => {
    const six = getCategoryPresetDefinitions('mlb_6x6')!
    expect(six.filter(isPitchingCategory).map((c) => c.label).sort()).toEqual(['ERA', 'HLD', 'K', 'SV', 'W', 'WHIP'])
    expect(six.filter((c) => !isPitchingCategory(c)).map((c) => c.label).sort()).toEqual(['AVG', 'HR', 'R', 'RBI', 'SB', 'TB'])
  })

  it('tells pitching slots from hitting ones', () => {
    expect(isPitchingSlot(['SP'])).toBe(true)
    expect(isPitchingSlot(['SP', 'RP'])).toBe(true)
    expect(isPitchingSlot(['C', '1B', 'DH'])).toBe(false)
    expect(isPitchingSlot([])).toBe(false)
  })
})
