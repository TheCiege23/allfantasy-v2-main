import { describe, expect, it } from 'vitest'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { commissionerFormatCards } from '@/lib/core-app/commissioner/formatCards'

describe('commissioner format cards', () => {
  it('uses the canonical profile to show keeper and guillotine operations', () => {
    const keeper = resolveCommissionerLeagueProfile({ league: { id: 'keeper-1', leagueType: 'keeper', sport: 'NFL' }, commissionerRole: 'commissioner' })
    expect(commissionerFormatCards(keeper).map((card) => card.key)).toContain('keeper')
    const guillotine = resolveCommissionerLeagueProfile({ league: { id: 'guillotine-1', leagueType: 'guillotine', sport: 'NFL' }, commissionerRole: 'commissioner' })
    expect(commissionerFormatCards(guillotine).map((card) => card.key)).toContain('guillotine')
  })

  it('does not invent a specialty card for a plain redraft league', () => {
    const profile = resolveCommissionerLeagueProfile({ league: { id: 'plain', leagueType: 'redraft', sport: 'NFL' }, commissionerRole: 'commissioner' })
    expect(commissionerFormatCards(profile)).toEqual([])
  })

  it.each([
    ['survivor', 'survivor'], ['big_brother', 'big_brother'], ['zombie', 'zombie'],
    ['devy', 'devy'], ['c2c', 'c2c'], ['tournament', 'tournament'],
  ])('provides a %s operation card', (leagueType, expected) => {
    const profile = resolveCommissionerLeagueProfile({ league: { id: leagueType, leagueType, sport: 'NFL' }, commissionerRole: 'commissioner' })
    expect(commissionerFormatCards(profile).map((card) => card.key)).toContain(expected)
  })

  it('shows a rules review for a named Four Horsemen league without inventing mechanics', () => {
    const profile = resolveCommissionerLeagueProfile({ league: { id: 'horsemen', leagueType: 'four_horsemen', sport: 'NFL' }, commissionerRole: 'commissioner' })
    expect(commissionerFormatCards(profile, 'four_horsemen')).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'four_horsemen', action: 'Open settings' }),
    ]))
  })
})
