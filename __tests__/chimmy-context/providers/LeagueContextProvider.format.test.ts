import { describe, expect, it } from 'vitest'
import { resolveFormat } from '@/lib/chimmy-context/providers/LeagueContextProvider'

describe('Chimmy league summary format', () => {
  it('uses the confirmed concept ahead of stale importer and mode fields', () => {
    expect(resolveFormat({
      leagueType: 'redraft', isDynasty: true, bestBallMode: true, guillotineMode: true,
      settings: { leagueTypeConfirmation: { type: 'zombie' } },
    })).toBe('zombie')
    expect(resolveFormat({
      leagueType: 'guillotine', guillotineMode: true,
      settings: { leagueTypeConfirmation: { type: 'survivor_guillotine' } },
    })).toBe('survivor_guillotine')
  })

  it('keeps provider facts when nobody has confirmed a type', () => {
    expect(resolveFormat({ leagueType: 'redraft', settings: {}, guillotineMode: true })).toBe('guillotine')
    expect(resolveFormat({ leagueType: 'redraft', settings: {}, bestBallMode: true })).toBe('best_ball')
    expect(resolveFormat({ leagueType: 'redraft', settings: {}, isDynasty: true })).toBe('dynasty')
  })
})
