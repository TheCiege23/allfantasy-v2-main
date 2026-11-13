/**
 * Best ball NBA / NHL / MLB: the draft must fill every seat a team plays from (starters + bench) and
 * nothing it cannot (IL / IR / NA / taxi). The roster a best ball league is actually given is the
 * sport's `best_ball` template — `createDefaultLeagueRosterConfig(leagueId, sport, 'best_ball')`
 * installs it at bootstrap — so the expected count is computed from that template here, by the same
 * rule the draft room applies (lib/draft/draftSettingsPolicy.computeDraftRoundsFromSlots), not typed
 * in. Before the fix these sports fell to the generic registry: 13 / 17 / 24 rounds.
 */
import { describe, expect, it } from 'vitest'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { computeDraftRoundsFromSlots } from '@/lib/draft/draftSettingsPolicy'
import { NBA_SLOT_MAP, resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { NHL_SLOT_MAP, resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { MLB_SLOT_MAP, resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'

/** The template as the draft room sees it: one row per slot, bench/reserve by the slot's category. */
function draftRoomRounds(slots: Record<string, number>, map: ReadonlyMap<string, { category: string }>): number {
  const rows = Object.entries(slots).map(([slotName, count]) => {
    const category = map.get(slotName)?.category
    return {
      slotName,
      starterCount: category === 'bench' || category === 'reserve' ? 0 : count,
      benchCount: category === 'bench' ? count : 0,
      reserveCount: category === 'reserve' ? count : 0,
      taxiCount: 0,
      devyCount: 0,
    }
  })
  return computeDraftRoundsFromSlots(rows, false).rounds
}

const CASES = [
  ['NBA', resolveNbaRosterTemplate('best_ball'), NBA_SLOT_MAP, 17],
  ['NHL', resolveNhlRosterTemplate('best_ball'), NHL_SLOT_MAP, 22],
  ['MLB', resolveMlbRosterTemplate('best_ball'), MLB_SLOT_MAP, 33],
] as const

describe('best ball draft rounds — NBA / NHL / MLB', () => {
  for (const [sport, template, map, measured] of CASES) {
    it(`${sport}: the best ball template is the one installed, and its playable seats are ${measured}`, () => {
      expect(template.key).toBe('best_ball')
      expect(draftRoomRounds(template.slots, map)).toBe(measured)
    })

    it(`${sport}: a best ball league drafts exactly its starters + bench (${measured} rounds)`, () => {
      for (const draftType of ['snake', 'linear', 'auction'] as const) {
        const defaults = getLeagueDefaults({ sport, format: 'best_ball', draftType, managerCount: 12, scoringPreset: '' })
        expect(defaults.draftSettings.rounds).toBe(draftRoomRounds(template.slots, map))
      }
    })
  }

  it('[control] redraft in those sports keeps its own length (13 / 17 / 24)', () => {
    const rounds = (['NBA', 'NHL', 'MLB'] as const).map(
      (sport) => getLeagueDefaults({ sport, format: 'redraft', draftType: 'snake', managerCount: 12, scoringPreset: '' }).draftSettings.rounds,
    )
    expect(rounds).toEqual([13, 17, 24])
  })

  it('[control] NFL and NCAAF best ball are unchanged (18 / 16)', () => {
    expect(getLeagueDefaults({ sport: 'NFL', format: 'best_ball', draftType: 'snake', managerCount: 12, scoringPreset: '' }).draftSettings.rounds).toBe(18)
    expect(getLeagueDefaults({ sport: 'NCAAF', format: 'best_ball', draftType: 'snake', managerCount: 12, scoringPreset: '' }).draftSettings.rounds).toBe(16)
  })
})
