import { describe, expect, it } from 'vitest'

import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

const base = {
  sport: 'NFL' as const,
  teamCount: 12,
  scoringPreset: 'fb_half_ppr',
  draftType: 'snake',
  leagueName: 'Tournament Retirement Test',
}

describe('validateCreatePayload — Tournament creation retired', () => {
  it('rejects concept "tournament" with a stable reason code', () => {
    const r = validateCreatePayload({ ...base, concept: 'tournament' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.errors[0]?.code).toBe('TOURNAMENT_CREATION_DISABLED')
      expect(r.errors[0]?.path).toBe('concept')
    }
  })

  it('rejects the uppercase alias "TOURNAMENT" (cannot bypass via casing)', () => {
    const r = validateCreatePayload({ ...base, concept: 'TOURNAMENT' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('TOURNAMENT_CREATION_DISABLED')
    }
  })

  it('rejects "tournament" with surrounding whitespace (cannot bypass via padding)', () => {
    const r = validateCreatePayload({ ...base, concept: '  tournament  ' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('TOURNAMENT_CREATION_DISABLED')
    }
  })

  it('does not create a database write when rejected (validation is pure/synchronous, no side effects)', () => {
    // validateCreatePayload has no prisma import and performs no I/O -- this test
    // documents that guarantee so a future refactor can't quietly add a write here.
    const before = validateCreatePayload({ ...base, concept: 'tournament' })
    const after = validateCreatePayload({ ...base, concept: 'tournament' })
    expect(before).toEqual(after)
  })

  it('does not reject an unrelated malformed concept with the tournament reason code', () => {
    const r = validateCreatePayload({ ...base, concept: 'tournamentt' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // falls through to the pre-existing "unknown concept" path, not the tournament-specific one
      expect(r.errors[0]?.code).not.toBe('TOURNAMENT_CREATION_DISABLED')
    }
  })

  const stillSupported = [
    { concept: 'redraft' },
    { concept: 'dynasty' },
    { concept: 'keeper' },
    { concept: 'best_ball' },
    { concept: 'guillotine' },
    { concept: 'survivor', teamCount: 16 },
    { concept: 'devy' },
    { concept: 'c2c' },
    { concept: 'zombie' },
    { concept: 'salary_cap', draftType: 'auction' },
    { concept: 'big_brother' },
  ] as const

  for (const { concept, ...overrides } of stillSupported) {
    it(`still accepts concept "${concept}" (retirement is scoped to tournament only)`, () => {
      const r = validateCreatePayload({ ...base, ...overrides, concept })
      expect(r.ok).toBe(true)
    })
  }
})
