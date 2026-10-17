import { describe, expect, it } from 'vitest'
import { betterCasedName, displayPlayName, repairHyphenCasing } from '@/lib/player-match/displayNameCasing'
import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'

describe('repairHyphenCasing', () => {
  it('capitalises the letter after a hyphen', () => {
    expect(repairHyphenCasing('Jaxon Smith-njigba')).toBe('Jaxon Smith-Njigba')
    expect(repairHyphenCasing('Amon-ra St. Brown')).toBe('Amon-Ra St. Brown')
  })
  it('control: leaves correct names and lowercase particles after a SPACE alone', () => {
    expect(repairHyphenCasing('Jaxon Smith-Njigba')).toBe('Jaxon Smith-Njigba')
    expect(repairHyphenCasing('Kenneth van Lier')).toBe('Kenneth van Lier')
  })
})

describe('betterCasedName / displayPlayName', () => {
  it('prefers the better-cased spelling of the same name, keeping the first on a tie', () => {
    expect(betterCasedName('Jaxon Smith-njigba', 'Jaxon Smith-Njigba')).toBe('Jaxon Smith-Njigba')
    expect(betterCasedName('Jaxon Smith-Njigba', 'Jaxon Smith-njigba')).toBe('Jaxon Smith-Njigba')
    expect(betterCasedName('A B', 'C D')).toBe('A B')
  })
  it('uses the canonical name only for a short form of the same person', () => {
    expect(displayPlayName('A.St', 'Amon-Ra St. Brown')).toBe('Amon-Ra St. Brown')
    expect(displayPlayName('Myers', 'Jason Myers')).toBe('Jason Myers')
    expect(displayPlayName('Courtland Sutton', 'Courtland Sutton')).toBe('Courtland Sutton')
    // Two different names: the play is the primary record.
    expect(displayPlayName('Josh Jobe', 'Somebody Else')).toBe('Josh Jobe')
    expect(displayPlayName('S.La', null)).toBe('S.La')
  })
})

describe('composePlayerIdentities — name no longer first-row-wins', () => {
  const row = (name: string) => ({ sleeperId: '9493', name, position: 'WR', team: 'SEA', sport: 'NFL', imageUrl: null })
  it('the better-cased spelling wins in either order', () => {
    expect(composePlayerIdentities([row('Jaxon Smith-njigba'), row('Jaxon Smith-Njigba')]).get('9493')!.name).toBe('Jaxon Smith-Njigba')
    expect(composePlayerIdentities([row('Jaxon Smith-Njigba'), row('Jaxon Smith-njigba')]).get('9493')!.name).toBe('Jaxon Smith-Njigba')
  })
  it('a lone mis-cased row is repaired too', () => {
    expect(composePlayerIdentities([row('Jaxon Smith-njigba')]).get('9493')!.name).toBe('Jaxon Smith-Njigba')
  })
})
