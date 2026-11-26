/**
 * "Chopped players stop hitting waivers after week N" (owner's list, 2026-11-25): lib/guillotine/freeAgencyFromWeek.ts,
 * saved through the rules (lib/guillotine/guillotineRules.ts). The hold itself is in chop-release-waiver-hold.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { choppedPlayersAreFreeAgents, effectiveReleaseTiming, readFreeAgencyFromWeek } from '@/lib/guillotine/freeAgencyFromWeek'
import { normalizeGuillotineRulesPatch } from '@/lib/guillotine/guillotineRules'
import { chopResultAlert } from '@/lib/guillotine/chopAlertCopy'

describe('skip waivers from week N', () => {
  it('week N and later, not before; and never when it is off', () => {
    expect([10, 11, 12, 15].map((w) => choppedPlayersAreFreeAgents(12, w))).toEqual([false, false, true, true])
    expect(choppedPlayersAreFreeAgents(null, 17)).toBe(false)
  })

  it('the timing every reader shows: the league choice before week N, "immediate" from it', () => {
    expect(effectiveReleaseTiming('next_waiver_run', 12, 11)).toBe('next_waiver_run')
    expect(effectiveReleaseTiming('next_waiver_run', 12, 12)).toBe('immediate')
    expect(effectiveReleaseTiming('next_waiver_run', null, 16)).toBe('next_waiver_run')
  })

  it('so the survivors’ alert says "free agents now" from week N', () => {
    const at = (week: number) =>
      chopResultAlert({ leagueName: 'L', week, choppedNames: ['Team X'], youWereChopped: false, rosterReleaseTiming: effectiveReleaseTiming('next_waiver_run', 12, week) }).body
    expect(at(11)).toContain('hit waivers at the next waiver run')
    expect(at(12)).toContain('are free agents now')
  })

  it('read from the league settings; anything but a whole week from 1 to 30 reads as off', () => {
    expect(readFreeAgencyFromWeek({ guillotineFreeAgencyFromWeek: 12 })).toBe(12)
    for (const bad of [0, 31, 2.5, '12', null]) expect(readFreeAgencyFromWeek({ guillotineFreeAgencyFromWeek: bad })).toBeNull()
    expect(readFreeAgencyFromWeek(null)).toBeNull()
  })

  it('saved through the rules: a week, or null for never; anything else refused', () => {
    expect(normalizeGuillotineRulesPatch({ freeAgencyFromWeek: 12 })).toEqual({ ok: true, value: { freeAgencyFromWeek: 12 } })
    expect(normalizeGuillotineRulesPatch({ freeAgencyFromWeek: null })).toEqual({ ok: true, value: { freeAgencyFromWeek: null } })
    expect(normalizeGuillotineRulesPatch({ freeAgencyFromWeek: 0 })).toMatchObject({ ok: false, error: { field: 'freeAgencyFromWeek' } })
    expect(normalizeGuillotineRulesPatch({ freeAgencyFromWeek: '12' })).toMatchObject({ ok: false, error: { field: 'freeAgencyFromWeek' } })
  })
})
