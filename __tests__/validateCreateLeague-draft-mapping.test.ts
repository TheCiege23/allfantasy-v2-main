import { describe, expect, it } from 'vitest'

import {
  validateCreatePayload,
} from '@/lib/league-creation/canonical/validateCreateLeague'

const base = {
  sport: 'NFL' as const,
  teamCount: 12,
  scoringPreset: 'fb_half_ppr',
  leagueName: 'Mapped Draft Test',
}

function expectCreatable(r: ReturnType<typeof validateCreatePayload>) {
  expect(r.ok, r.ok ? undefined : r.error).toBe(true)
}

describe('validateCreatePayload — devy/c2c draft id normalization', () => {
  it('devy + snake clears draft checks (maps to devy_snake for format check)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'snake',
    })
    expectCreatable(r)
  })

  it('devy + auction clears draft checks (maps to devy_auction)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'auction',
    })
    expectCreatable(r)
  })

  it('devy + offline clears draft checks (execution mode; maps via normalizeDraftTypeForEngine to devy_snake)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'devy',
      draftType: 'offline',
    })
    expectCreatable(r)
  })

  it('c2c + snake clears draft checks (maps to c2c_snake)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'c2c',
      draftType: 'snake',
    })
    expectCreatable(r)
  })

  it('c2c + auction clears draft checks (maps to c2c_auction)', () => {
    const r = validateCreatePayload({
      ...base,
      concept: 'c2c',
      draftType: 'auction',
    })
    expectCreatable(r)
  })

  it('canonical devy_snake / devy_auction clear draft checks when sent explicitly', () => {
    expectCreatable(
      validateCreatePayload({
        ...base,
        concept: 'devy',
        draftType: 'devy_snake',
      }),
    )
    expectCreatable(
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

  it('allows supported devy and C2C formats through canonical validation', () => {
    for (const concept of ['devy', 'c2c', 'DEVY', 'C2C']) {
      const r = validateCreatePayload({ ...base, concept, draftType: 'snake' })
      expect(r.ok, concept).toBe(true)
    }
  })
})
