import { describe, it, expect } from 'vitest'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'

/**
 * The commissioner-correction rule, as confirmed for the product:
 *
 *   A commissioner can submit a correction pick, assign a player, or move a pick to a different
 *   manager whether or not the draft is paused. A manager cannot pick into a paused draft.
 *   If the commissioner reassigns a pick or removes a player, the timer resets.
 *
 * These are BEHAVIOURAL assertions — they call the validator with real inputs. The draft suite
 * used to cover this area with source-text greps (readFileSync + regex over
 * DraftSessionService.ts), which passed whether or not the rule held and broke whenever the code
 * was reformatted. Those were deleted; this replaces the part that can be tested without a
 * database.
 *
 * The other half of the rule — a correction resetting the clock WITHOUT resuming a paused draft —
 * lives in PickSubmissionService's session update and needs a Prisma double to exercise. It is
 * asserted here only at the boundary this pure validator owns; the pause-preservation itself is
 * documented at the write site.
 */

const baseInput = {
  playerName: 'Justin Jefferson',
  position: 'WR',
  rosterId: 'roster-A',
  currentOnClockRosterId: 'roster-A',
  existingPicks: [] as { playerName: string; position: string }[],
  sessionStatus: 'in_progress',
}

describe('commissioner correction — pause does not block the commissioner', () => {
  it('a manager cannot pick into a paused draft', () => {
    const result = validatePickSubmission({ ...baseInput, sessionStatus: 'paused' })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/paused/i)
  })

  it('a commissioner CAN pick into a paused draft — corrections are why you pause', () => {
    const result = validatePickSubmission({
      ...baseInput,
      sessionStatus: 'paused',
      commissionerOverride: true,
    })
    expect(result.valid).toBe(true)
  })

  it('a commissioner can also pick while the draft is running', () => {
    const result = validatePickSubmission({ ...baseInput, commissionerOverride: true })
    expect(result.valid).toBe(true)
  })

  it('reassigning to a roster that is NOT on the clock is allowed for the commissioner', () => {
    /*
     * This is "change a pick to a different manager". A manager submitting for someone else's
     * roster is refused (covered in pick-execution-race-lockout); the commissioner doing it is the
     * correction path, and it must work in both session states.
     */
    for (const sessionStatus of ['in_progress', 'paused'] as const) {
      const result = validatePickSubmission({
        ...baseInput,
        sessionStatus,
        rosterId: 'roster-B',
        currentOnClockRosterId: 'roster-A',
        commissionerOverride: true,
      })
      expect(result.valid).toBe(true)
    }
  })

  it('a non-commissioner still cannot pick for another roster', () => {
    const result = validatePickSubmission({
      ...baseInput,
      rosterId: 'roster-B',
      currentOnClockRosterId: 'roster-A',
    })
    expect(result.valid).toBe(false)
  })
})
