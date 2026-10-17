// @vitest-environment node
/**
 * `eliminationFormat` — the one rule the rail, the all-leagues matchup board and the one-league
 * matchup page share for "this league has no weekly opponent".
 */
import { describe, expect, it } from 'vitest'
import { eliminationFormat } from '@/lib/core-app/railMatchupMode'

describe('eliminationFormat', () => {
  it('reads the column', () => {
    expect(eliminationFormat({ leagueType: 'guillotine' })).toBe('guillotine')
    expect(eliminationFormat({ leagueType: 'Survivor Guillotine' })).toBe('survivor_guillotine')
    expect(eliminationFormat({ leagueType: 'survivor_guillotine' })).toBe('survivor_guillotine')
  })

  it('🛑 reads guillotineMode independently of the type — a best-ball guillotine is type best_ball', () => {
    expect(eliminationFormat({ leagueType: 'best_ball', guillotineMode: true })).toBe('guillotine')
  })

  it('🛑 reads the flag older leagues carry only in settings', () => {
    expect(eliminationFormat({ leagueType: null, settings: { guillotine_mode: true } })).toBe('guillotine')
    expect(eliminationFormat({ settings: { guillotineMode: true } })).toBe('guillotine')
    expect(eliminationFormat({ settings: { league_type: 'guillotine' } })).toBe('guillotine')
  })

  it('the confirmed type wins over the column, as the rail has always read it', () => {
    expect(eliminationFormat({ leagueType: 'guillotine', confirmedType: 'redraft' })).toBeNull()
    expect(
      eliminationFormat({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'survivor_guillotine' } } }),
    ).toBe('survivor_guillotine')
  })

  it('CONTROL: ordinary formats are not elimination', () => {
    expect(eliminationFormat({ leagueType: 'redraft' })).toBeNull()
    expect(eliminationFormat({ leagueType: 'dynasty', guillotineMode: false, settings: {} })).toBeNull()
    expect(eliminationFormat({ leagueType: 'survivor' })).toBeNull()
    expect(eliminationFormat({})).toBeNull()
  })
})
