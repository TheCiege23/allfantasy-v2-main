import { describe, expect, it } from 'vitest'
import { canAddPlayerToSlot, validateRoster } from '@/lib/roster-defaults/RosterValidationEngine'

describe('League-level roster validation context', () => {
  it('supports NFL DYNASTY_IDP slot eligibility in lineup/waiver validation', () => {
    const validIdpRoster = validateRoster(
      'NFL',
      [
        { playerId: '1', position: 'QB', slotName: 'QB' },
        { playerId: '2', position: 'RB', slotName: 'RB' },
        { playerId: '3', position: 'WR', slotName: 'WR' },
        { playerId: '4', position: 'DE', slotName: 'DL' },
        { playerId: '5', position: 'S', slotName: 'DB' },
        { playerId: '6', position: 'LB', slotName: 'IDP_FLEX' },
      ],
      'DYNASTY_IDP'
    )

    expect(validIdpRoster.valid).toBe(true)

    const invalidIdpRoster = validateRoster(
      'NFL',
      [{ playerId: '7', position: 'WR', slotName: 'DE' }],
      'DYNASTY_IDP'
    )
    expect(invalidIdpRoster.valid).toBe(false)
    expect(invalidIdpRoster.errors.some((e) => e.includes('not allowed'))).toBe(true)

    const canAddLbToIdpFlex = canAddPlayerToSlot(
      'NFL',
      'IDP_FLEX',
      'LB',
      [],
      'DYNASTY_IDP'
    )
    expect(canAddLbToIdpFlex.allowed).toBe(true)
  })

  it('keeps standard NFL redraft from accepting IDP-only slots', () => {
    const standardWithIdpSlot = validateRoster(
      'NFL',
      [{ playerId: '8', position: 'LB', slotName: 'IDP_FLEX' }],
      'standard'
    )

    expect(standardWithIdpSlot.valid).toBe(false)
    expect(standardWithIdpSlot.errors).toContain('Unknown slot: IDP_FLEX')

    const canAddLbToStandardIdpFlex = canAddPlayerToSlot(
      'NFL',
      'IDP_FLEX',
      'LB',
      [],
      'standard'
    )
    expect(canAddLbToStandardIdpFlex.allowed).toBe(false)
  })

  it('enforces NCAAB sport-aware slot eligibility', () => {
    const validNcaabRoster = validateRoster('NCAAB', [
      { playerId: '10', position: 'G', slotName: 'G' },
      { playerId: '11', position: 'F', slotName: 'F' },
      { playerId: '12', position: 'C', slotName: 'C' },
      { playerId: '13', position: 'C', slotName: 'UTIL' },
    ])
    expect(validNcaabRoster.valid).toBe(true)

    const invalidNcaabRoster = validateRoster('NCAAB', [
      { playerId: '14', position: 'C', slotName: 'F' },
    ])
    expect(invalidNcaabRoster.valid).toBe(false)

    const canAddGuardToUtil = canAddPlayerToSlot('NCAAB', 'UTIL', 'G', [])
    expect(canAddGuardToUtil.allowed).toBe(true)
  })
})
