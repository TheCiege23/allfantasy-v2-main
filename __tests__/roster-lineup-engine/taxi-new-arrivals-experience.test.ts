/**
 * The taxi rookie / years rules on a lineup save. Lineup rows carry no `years_exp`, so before this
 * the rules could never fire and a veteran could be parked on the taxi squad. Experience now comes
 * from `SportsPlayer.yearsExp` for players the save ADDS to taxi; players already there are
 * grandfathered so a manager's ordinary save is never blocked by someone sitting on the squad.
 */
import { describe, expect, it } from 'vitest'
import { validateCanonicalRosterPayload, validateNewTaxiPlayersByKnownExperience } from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'

const league = (over: Partial<LineupValidationContext['league']> = {}) =>
  ({ taxiSlots: 4, taxiAllowNonRookies: false, taxiYearsLimit: null, ...over }) as LineupValidationContext['league']
const roster = (taxi: Array<{ id: string; name?: string; years_exp?: number }>) => ({ lineup_sections: { taxi } })
const known = new Map([['vet', 3], ['rookie', 0], ['second', 1]])

describe('validateNewTaxiPlayersByKnownExperience', () => {
  it('refuses a veteran moved onto a rookie-only taxi squad, by name', () => {
    const issues = validateNewTaxiPlayersByKnownExperience(
      { league: league(), previousPlayerData: roster([]), taxiYearsExpById: known },
      roster([{ id: 'vet', name: 'Vet Player' }]),
    )
    expect(issues).toEqual([expect.objectContaining({ code: 'taxi_non_rookie_disallowed', playerId: 'vet', message: 'Vet Player is not a rookie — taxi is rookie-only in this league.' })])
  })

  it('accepts a rookie', () => {
    expect(validateNewTaxiPlayersByKnownExperience({ league: league(), previousPlayerData: roster([]), taxiYearsExpById: known }, roster([{ id: 'rookie' }]))).toEqual([])
  })

  it('grandfathers a player who was already on the taxi squad', () => {
    const issues = validateNewTaxiPlayersByKnownExperience(
      { league: league(), previousPlayerData: roster([{ id: 'vet' }]), taxiYearsExpById: known },
      roster([{ id: 'vet' }, { id: 'rookie' }]),
    )
    expect(issues).toEqual([])
  })

  it('does not guess when experience is unknown', () => {
    expect(validateNewTaxiPlayersByKnownExperience({ league: league(), previousPlayerData: roster([]), taxiYearsExpById: known }, roster([{ id: 'nobody' }]))).toEqual([])
  })

  it('applies the years limit when non-rookies are allowed', () => {
    const ctx = { league: league({ taxiAllowNonRookies: true, taxiYearsLimit: 2 }), previousPlayerData: roster([]), taxiYearsExpById: known }
    expect(validateNewTaxiPlayersByKnownExperience(ctx, roster([{ id: 'second' }]))).toEqual([])
    expect(validateNewTaxiPlayersByKnownExperience(ctx, roster([{ id: 'vet' }]))).toEqual([expect.objectContaining({ code: 'taxi_too_experienced', playerId: 'vet' })])
  })

  it('leaves a row that carries its own years_exp to the existing check, so nothing is reported twice', () => {
    expect(validateNewTaxiPlayersByKnownExperience({ league: league(), previousPlayerData: roster([]), taxiYearsExpById: known }, roster([{ id: 'vet', years_exp: 3 }]))).toEqual([])
  })
})

describe('validateCanonicalRosterPayload runs the new-arrival taxi check', () => {
  it('reports a veteran added to taxi when the save supplies his experience', () => {
    const ctx = {
      league: { ...league(), id: 'L', sport: 'NFL', leagueVariant: null, settings: {}, lifecycleState: 'in_season', lockAllMoves: false },
      template: { templateId: 't', sportType: 'NFL', formatType: 'standard', slots: [{ slotName: 'TAXI', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 4, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 }] },
      season: 2026,
      week: 8,
      previousPlayerData: roster([]),
      taxiYearsExpById: known,
    } as unknown as LineupValidationContext
    const result = validateCanonicalRosterPayload(roster([{ id: 'vet', name: 'Vet Player' }]), ctx)
    expect(result.issues.map((i) => i.code)).toContain('taxi_non_rookie_disallowed')
  })
})
