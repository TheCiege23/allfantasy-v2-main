import { describe, expect, it } from 'vitest'
import { buildSeasonBlueprint, buildSeededBracket, defaultSeasonBlueprint, distributeSeeds } from '@/lib/tournament/seasonBlueprint'

const config = (participants = 64) => ({
  ...defaultSeasonBlueprint(), name: 'NBA Championship', participants,
  secondCutWeek: 24 - Math.ceil(Math.log2(participants / 4)),
})
describe('season tournament blueprint', () => {
  it.each([64, 68, 96, 128, 160, 192])('preserves every entrant and halves leagues for %i', n => {
    const p = buildSeasonBlueprint(config(n))
    expect(p.stages.map(s => s.participants)).toEqual([n, n / 2, n / 4])
    expect(p.stages[0]!.leagueCount / p.stages[2]!.leagueCount).toBe(4)
    for (const s of p.stages) {
      expect(s.sizes.reduce((a, b) => a + b, 0)).toBe(s.participants)
      expect(Math.max(...s.sizes) - Math.min(...s.sizes)).toBeLessThanOrEqual(1)
    }
    expect(p.stages[2]!.endWeek - p.stages[2]!.startWeek + 1).toBe(p.bracketWeeks)
  })
  it('supports NFL defaults', () => expect(buildSeasonBlueprint({ ...defaultSeasonBlueprint('NFL'), name: 'NFL Cup' }).stages[2]!.endWeek).toBe(17))
  it.each([62, 66, 194, 65, NaN])('rejects nonviable field %i', n => expect(() => buildSeasonBlueprint(config(n))).toThrow())
  it('reserves six weeks and sixteen top-seed byes for 48 finalists', () => {
    const p = buildSeasonBlueprint(config(192))
    expect(p.bracketWeeks).toBe(6); expect(p.byes).toBe(16)
  })
  it('rejects too few or too many bracket periods', () => {
    for (const secondCutWeek of [19, 21]) expect(() => buildSeasonBlueprint({ ...config(), secondCutWeek })).toThrow()
  })
  it('rejects overlapping qualifiers, fractional periods, wrong scoring and duplicate names', () => {
    for (const update of [{ firstCutWeek: 21 }, { startWeek: 1.5 }, { scoring: 'ppr' }, { leagueNames: Array(8).fill('Same') }, { divisions: ['East', 'east'] }]) {
      expect(() => buildSeasonBlueprint({ ...config(), ...update })).toThrow()
    }
  })
  it('rejects NFL periods beyond the season', () => expect(() => buildSeasonBlueprint({ ...config(), sport: 'NFL', scoring: 'ppr' })).toThrow())
  it('uses balanced serpentine placement without dropping seeds', () => {
    expect(distributeSeeds(['1', '2', '3', '4', '5', '6', '7', '8'], 2)).toEqual([['1', '4', '5', '8'], ['2', '3', '6', '7']])
    expect(() => distributeSeeds(['a', 'a'], 2)).toThrow()
  })
  it.each([16, 17, 24, 32, 40, 48])('brackets %i finalists with unique top-seed byes', n => {
    const entrants = Array.from({ length: n }, (_, i) => 'team-' + (i + 1))
    const bracket = buildSeededBracket(entrants)
    expect(bracket.flatMap(m => [m.teamA, m.teamB]).filter(Boolean).sort()).toEqual([...entrants].sort())
    const byes = bracket.filter(m => !m.teamA || !m.teamB)
    const count = 2 ** Math.ceil(Math.log2(n)) - n
    expect(byes).toHaveLength(count)
    expect(byes.map(m => m.teamA ? m.seedA : m.seedB).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1))
    expect(bracket[0]!.teamA).toBe('team-1')
  })
})
