import { describe, expect, it } from 'vitest'
import { buildSeasonLeagueLayout } from '@/lib/tournament/seasonLeagueLayout'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'

const config = (participants = 64) => ({ ...defaultSeasonBlueprint(), name: 'NBA Cup', participants, secondCutWeek: 24 - Math.ceil(Math.log2(participants / 4)) })
describe('league structure and seed preview', () => {
  it.each(Array.from({ length: 33 }, (_, i) => 64 + i * 4))('assigns all seeds within planned capacity for %i entrants', participants => {
    const layout = buildSeasonLeagueLayout(config(participants))
    expect(layout).toHaveLength(3)
    for (const stage of layout) {
      const count = participants / 2 ** (stage.stage - 1)
      expect(stage.leagues.reduce((sum, league) => sum + league.slots, 0)).toBe(count)
      if (stage.stage === 1) expect(stage.leagues.every(league => league.seeds.length === 0)).toBe(true)
      else {
        expect(stage.leagues.every(league => league.slots === league.seeds.length)).toBe(true)
        expect(stage.leagues.flatMap(league => league.seeds).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1))
      }
    }
    expect(new Set(layout.flatMap(s => s.leagues.map(l => l.key))).size).toBe(layout.flatMap(s => s.leagues).length)
  })
  it('preserves custom opening names and cosmetic division labels', () => {
    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
    const layout = buildSeasonLeagueLayout({ ...config(), leagueNames: names, divisions: ['East', 'West'] })
    expect(layout[0]!.leagues.map(league => league.name)).toEqual(names)
    expect(layout[0]!.leagues.slice(0, 2).map(league => league.division)).toEqual(['East', 'West'])
    expect(layout[1]!.leagues.every(league => league.division === null)).toBe(true)
  })
})
