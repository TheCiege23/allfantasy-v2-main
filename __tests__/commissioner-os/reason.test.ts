/**
 * Commissioner OS · T-004 — "valid reason" is defined, not left to judgement.
 *
 * HANDOFF.md: ">= 12 characters, not equal to the action name, not in a
 * stoplist (`test`, `fix`, `asdf`, `n/a`)."
 */

import { describe, it, expect } from 'vitest'
import { REASON_MIN_LENGTH, REASON_STOPLIST, validateReason } from '@/lib/domain/reason'

const ACTION = 'league.rollbackWeek'

function problemOf(reason: string | undefined | null) {
  const r = validateReason(ACTION, reason)
  if (r.ok) return null
  return r.error.problem
}

describe('T-004 · validateReason', () => {
  it('accepts a real reason', () => {
    const r = validateReason(ACTION, 'Week 4 scoring was corrected by the provider.')
    expect(r.ok).toBe(true)
  })

  it.each([undefined, null, '', '   ', '\n\t '])('reports MISSING for %j', (input) => {
    expect(problemOf(input as string | undefined | null)).toBe('MISSING')
  })

  it('reports TOO_SHORT below the minimum', () => {
    expect(problemOf('too short')).toBe('TOO_SHORT')
  })

  it('measures length on the trimmed text, not the raw string', () => {
    // Otherwise the rule is satisfiable by holding down the space bar.
    expect(problemOf('  short   ')).toBe('TOO_SHORT')
  })

  it('accepts exactly the minimum length', () => {
    const twelve = 'abcdefghijkl'
    expect(twelve).toHaveLength(REASON_MIN_LENGTH)
    expect(validateReason(ACTION, twelve).ok).toBe(true)
  })

  describe('the stoplist, which is only reachable because it is checked first', () => {
    // ⚠ Every literal stoplist entry is shorter than 12 characters. Checked
    // after the length rule, the stoplist could NEVER fire — it would be dead
    // code that reads as a control, and `fix` would be reported as TOO_SHORT,
    // inviting someone to pad it to twelve characters rather than write a
    // reason. These tests pin the ordering.
    it.each([...REASON_STOPLIST])('reports STOPLISTED for %j, not TOO_SHORT', (entry) => {
      expect(problemOf(entry)).toBe('STOPLISTED')
    })

    it('catches a stoplist word padded past the length rule', () => {
      // 14 characters, passes every other rule, and is exactly what the
      // stoplist exists to refuse.
      expect('test test test').toHaveLength(14)
      expect(problemOf('test test test')).toBe('STOPLISTED')
    })

    it('is case-insensitive', () => {
      expect(problemOf('N/A')).toBe('STOPLISTED')
      expect(problemOf('ASDF')).toBe('STOPLISTED')
    })

    it('ignores trailing punctuation', () => {
      expect(problemOf('n/a.')).toBe('STOPLISTED')
    })

    it('does NOT reject a real reason that merely contains a stoplist word', () => {
      // "fix" appears in most honest reasons. Matching on containment rather
      // than on the whole reason would reject the sentences we want.
      const r = validateReason(ACTION, 'Rolling back to fix a provider scoring error.')
      expect(r.ok).toBe(true)
    })
  })

  describe('echoing the action', () => {
    it('rejects the raw action key', () => {
      expect(problemOf('league.rollbackWeek')).toBe('ECHOES_ACTION')
    })

    it('rejects the action key written as prose', () => {
      // Someone will type what the button said. That is not a reason.
      expect(problemOf('league rollbackWeek')).toBe('ECHOES_ACTION')
    })

    it('is checked before length, so the message names the real problem', () => {
      // A short echo reported as TOO_SHORT sends someone padding it instead of
      // writing why.
      expect(problemOf('league.rename')).not.toBe('TOO_SHORT')
    })

    it('accepts a reason that mentions the action but says more', () => {
      const r = validateReason(ACTION, 'Rollback week 4: the provider restated two games.')
      expect(r.ok).toBe(true)
    })
  })

  it('returns the reason with whitespace collapsed and casing preserved', () => {
    const r = validateReason(ACTION, '  Provider   restated\n two games.  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('Provider restated two games.')
  })

  it('carries the threshold on the error so the caller need not know it', () => {
    const r = validateReason(ACTION, 'nope')
    if (r.ok) throw new Error('expected failure')
    expect(r.error.minLength).toBe(REASON_MIN_LENGTH)
    expect(r.error.action).toBe(ACTION)
  })
})
