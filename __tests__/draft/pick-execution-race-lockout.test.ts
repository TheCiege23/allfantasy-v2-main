/**
 * Pick execution race & lockout — unit tests (Commit M).
 *
 * Pure logic tests on `validatePickSubmission` and the
 * `pickAuthorityCodes` mapping. No Prisma, no fetch, no JSDOM. The race
 * inside `submitPick` (transaction-level picks.length re-check + P2002
 * catch) is locked at the source level by
 * `nfl-redraft-pick-execution-hardening.test.ts`; this file pins the
 * behavioural contract of the validator and the route status mapping.
 */

import { describe, expect, it } from 'vitest'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'
import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_NOT_LIVE,
  DRAFT_PICK_NOT_ON_CLOCK,
  DRAFT_PICK_RACE_RETRY,
  DRAFT_PICK_STALE_OVERALL,
  httpStatusForPickAuthorityCode,
} from '@/lib/live-draft-engine/pickAuthorityCodes'

const baseInput = {
  playerName: 'Justin Jefferson',
  position: 'WR',
  rosterId: 'roster-A',
  currentOnClockRosterId: 'roster-A',
  existingPicks: [] as { playerName: string; position: string }[],
  sessionStatus: 'in_progress',
}

describe('validatePickSubmission — Commit M structured codes', () => {
  it('passes a clean pick with no code', () => {
    const r = validatePickSubmission(baseInput)
    expect(r.valid).toBe(true)
    expect(r.code).toBeUndefined()
  })

  it('refuses with DRAFT_PICK_NOT_LIVE when session is not in progress / paused', () => {
    for (const status of ['pending', 'complete', 'cancelled', 'unknown']) {
      const r = validatePickSubmission({ ...baseInput, sessionStatus: status })
      expect(r.valid).toBe(false)
      expect(r.code).toBe(DRAFT_PICK_NOT_LIVE)
    }
  })

  it('accepts `in_progress`, and `paused` ONLY for a commissioner override', () => {
    expect(validatePickSubmission({ ...baseInput, sessionStatus: 'in_progress' }).valid).toBe(true)
    // A manager cannot pick into a paused draft — that is what the pause is for.
    expect(validatePickSubmission({ ...baseInput, sessionStatus: 'paused' }).valid).toBe(false)
    // The commissioner can, because corrections are made while paused.
    expect(
      validatePickSubmission({ ...baseInput, sessionStatus: 'paused', commissionerOverride: true })
        .valid,
    ).toBe(true)
  })

  it('refuses with DRAFT_PICK_NOT_ON_CLOCK when roster is not on the clock', () => {
    const r = validatePickSubmission({
      ...baseInput,
      rosterId: 'roster-B',
      currentOnClockRosterId: 'roster-A',
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)
  })

  it('skips the on-clock check when commissionerOverride is true', () => {
    const r = validatePickSubmission({
      ...baseInput,
      rosterId: 'roster-B',
      currentOnClockRosterId: 'roster-A',
      commissionerOverride: true,
    })
    expect(r.valid).toBe(true)
  })

  it('still refuses commissioner pick with DRAFT_PICK_NOT_LIVE if session is complete', () => {
    const r = validatePickSubmission({
      ...baseInput,
      sessionStatus: 'complete',
      commissionerOverride: true,
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_NOT_LIVE)
  })

  it('refuses with DRAFT_PICK_DUPLICATE_PLAYER when the player is already drafted', () => {
    const r = validatePickSubmission({
      ...baseInput,
      existingPicks: [{ playerName: 'Justin Jefferson', position: 'WR' }],
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })

  it('still refuses duplicate picks even with commissionerOverride (commissioner cannot draft a player twice)', () => {
    const r = validatePickSubmission({
      ...baseInput,
      existingPicks: [{ playerName: 'Justin Jefferson', position: 'WR' }],
      commissionerOverride: true,
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })

  it('SKIP positions bypass the duplicate check (commissioner skip-pick path)', () => {
    const r = validatePickSubmission({
      ...baseInput,
      position: 'SKIP',
      existingPicks: [{ playerName: 'Justin Jefferson', position: 'WR' }],
    })
    expect(r.valid).toBe(true)
  })
})

describe('httpStatusForPickAuthorityCode — central status mapper', () => {
  it('maps NOT_ON_CLOCK to 403', () => {
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_NOT_ON_CLOCK)).toBe(403)
  })

  it('maps STALE_OVERALL and RACE_RETRY to 409 (in-place recovery via Commit J handler)', () => {
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_STALE_OVERALL)).toBe(409)
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_RACE_RETRY)).toBe(409)
  })

  it('maps NOT_LIVE and DUPLICATE_PLAYER to 400', () => {
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_NOT_LIVE)).toBe(400)
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_DUPLICATE_PLAYER)).toBe(400)
  })
})
