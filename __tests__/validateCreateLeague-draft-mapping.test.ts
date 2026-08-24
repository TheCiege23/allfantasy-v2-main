import { describe, expect, it } from 'vitest'

import {
  COLLEGE_FORMATS_NOT_OPEN_CODE,
  COLLEGE_FORMATS_NOT_OPEN_MESSAGE,
  validateCreatePayload,
} from '@/lib/league-creation/canonical/validateCreateLeague'

const base = {
  sport: 'NFL' as const,
  teamCount: 12,
  scoringPreset: 'fb_half_ppr',
  leagueName: 'Mapped Draft Test',
}

/**
 * Option B launch gate: devy/c2c payloads must clear every structural and
 * draft-type check and be stopped ONLY by the college-formats creation gate —
 * a draftType error here would mean the id normalization under test regressed.
 */
function expectBlockedByCollegeGateOnly(r: ReturnType<typeof validateCreatePayload>) {
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.errors.some((e) => e.code === COLLEGE_FORMATS_NOT_OPEN_CODE)).toBe(true)
    expect(r.errors.some((e) => e.path === 'draftType')).toBe(false)
  }
}

describe('validateCreatePayload — devy/c2c draft id normalization', () => {
  it('devy + snake clears draft checks (maps to devy_snake for format check)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'snake',
    })
    expectBlockedByCollegeGateOnly(r)
  })

  it('devy + auction clears draft checks (maps to devy_auction)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'auction',
    })
    expectBlockedByCollegeGateOnly(r)
  })

  it('devy + offline clears draft checks (execution mode; maps via normalizeDraftTypeForEngine to devy_snake)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'offline',
    })
    expectBlockedByCollegeGateOnly(r)
  })

  it('c2c + snake clears draft checks (maps to c2c_snake)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'c2c',
      draftType: 'snake',
    })
    expectBlockedByCollegeGateOnly(r)
  })

  it('c2c + auction clears draft checks (maps to c2c_auction)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'c2c',
      draftType: 'auction',
    })
    expectBlockedByCollegeGateOnly(r)
  })

  it('canonical devy_snake / devy_auction clear draft checks when sent explicitly', () => {
    expectBlockedByCollegeGateOnly(
      validateCreatePayload({
        ...base,
        concept: 'devy',
        draftType: 'devy_snake',
      }),
    )
    expectBlockedByCollegeGateOnly(
      validateCreatePayload({
        ...base,
        concept: 'devy',
        draftType: 'devy_auction',
      }),
    )
  })

  it('redraft + snake unchanged (no devy/c2c mapping)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'redraft',
      draftType: 'snake',
    })
    expect(r.ok).toBe(true)
  })

  it('dynasty + snake unchanged', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'dynasty',
      draftType: 'snake',
    })
    expect(r.ok).toBe(true)
  })

  it('devy/c2c creation returns the labeled college-formats 400 (Option B)', () => {
    for (const concept of ['devy', 'c2c', 'DEVY', 'C2C']) {
      const r = validateCreatePayload({ ...base, concept, draftType: 'snake' })
      expect(r.ok, concept).toBe(false)
      if (!r.ok) {
        expect(r.status, concept).toBe(400)
        expect(r.error, concept).toBe(COLLEGE_FORMATS_NOT_OPEN_MESSAGE)
      }
    }
  })
})
