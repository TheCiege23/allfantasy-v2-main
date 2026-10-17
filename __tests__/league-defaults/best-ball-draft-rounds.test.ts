/**
 * Best ball drafts its whole roster: every drafted player is a lineup candidate and there is no bench
 * (lib/league-concepts/bestBallDefaults.ts), so the draft length must be the contract's roster size.
 * Foundation defaults had no best ball branch, so creation fell to the sport's generic registry
 * default — NCAAF drafted 14 rounds into a 16-player roster, NFL 12 into 18.
 */
import { describe, expect, it } from 'vitest'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { getBestBallDefaultContract } from '@/lib/league-concepts/bestBallDefaults'
import { getBestBallSportProfile } from '@/lib/bestball/rules'
import { NCAAF_ROSTER_TEMPLATES } from '@/lib/ncaaf-roster/NcaafRosterTemplates'

describe('best ball draft length', () => {
  for (const [sport, roster] of [['NCAAF', 16], ['NFL', 18]] as const) {
    it(`${sport}: drafts the contract's ${roster}-player roster`, () => {
      const contract = getBestBallDefaultContract({ sport })!
      expect(contract.rosterTemplate.totalRosterSlots).toBe(roster)
      const defaults = getLeagueDefaults({ sport, format: 'best_ball', draftType: 'snake', managerCount: 12, scoringPreset: '' })
      expect(defaults.draftSettings.rounds).toBe(roster)
    })
  }

  it('[control] redraft keeps its own contract length (NCAAF 16), untouched by the best ball branch', () => {
    const defaults = getLeagueDefaults({ sport: 'NCAAF', format: 'redraft', draftType: 'snake', managerCount: 12, scoringPreset: '' })
    expect(defaults.draftSettings.rounds).toBe(16)
  })
})

describe('NCAAF best ball roster template', () => {
  const template = NCAAF_ROSTER_TEMPLATES.find((t) => t.key === 'best_ball')!.slots as Record<string, number>

  it('its lineup is exactly what the best ball optimizer scores', () => {
    const lineup = Object.fromEntries(Object.entries(template).filter(([k]) => k !== 'BN' && k !== 'IR'))
    const scored = Object.fromEntries(getBestBallSportProfile('NCAAF').lineupSlots.map((s) => [s.code, s.count]))
    expect(lineup).toEqual(scored)
  })

  it('its roster holds the 16 players the draft takes', () => {
    const total = Object.values(template).reduce((a, b) => a + b, 0)
    expect(total).toBe(getBestBallDefaultContract({ sport: 'NCAAF' })!.rosterTemplate.totalRosterSlots)
  })
})
