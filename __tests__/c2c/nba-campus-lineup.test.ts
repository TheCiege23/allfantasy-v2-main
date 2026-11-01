import { describe, expect, it } from 'vitest'
import { seatCampusPlayers, validateCampusLineup, campusToggles } from '@/lib/c2c/campusLineup'

describe('basketball campus lineup seating', () => {
  it('fits general and specific positions to basketball seats without guessing specific positions', () => {
    expect(seatCampusPlayers(['G', 'F', 'C', 'FLEX'], ['PG', 'F', 'C', 'SG'], 'basketball')).toBe(true)
    expect(seatCampusPlayers(['PG'], ['G'], 'basketball')).toBe(false)
    expect(seatCampusPlayers(['F'], ['G'], 'basketball')).toBe(false)
    expect(seatCampusPlayers(['FLEX'], ['QB'], 'basketball')).toBe(false)
    expect(seatCampusPlayers(['FLEX'], ['RB'])).toBe(true)
  })
  it('checks that basketball starters belong to the college roster and fit seats', () => {
    const data = { lineup_sections: { devy: ['guard', 'center'], campus: ['guard', 'center'] } }
    const positions: Record<string, string> = { guard: 'SG', center: 'C' }
    expect(validateCampusLineup({ before: data, after: data, slots: { G: 1, C: 1 }, positionOf: id => positions[id], sport: 'basketball' })).toEqual([])
    expect(validateCampusLineup({ before: { lineup_sections: { devy: ['guard'] } }, after: data, slots: { G: 1, C: 1 }, positionOf: id => positions[id], sport: 'basketball' })[0]?.code).toBe('campus_not_college')
    expect(campusToggles(['G'], [], [{ id: 'g', position: 'SG' }, { id: 'c', position: 'C' }], 'basketball').map(x => x.canStart)).toEqual([true, false])
  })
})
