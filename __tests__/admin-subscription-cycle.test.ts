/**
 * Regression tests for the Command Center's billing-cycle classifier.
 *
 * 🛑 THE BUG THIS PINS SHUT. `_` is a word character, so `\b` never fires inside
 * a snake_case string — and every plan code this app issues is snake_case. The
 * original `/\bmonthly\b/` therefore matched NOTHING it would ever be shown, and
 * the Money card reported production's real subscriptions as
 * "0 monthly · 0 annual · 2 unknown". That reads as absent data. It was a broken
 * matcher, and nothing failed, because "unknown" is a legitimate-looking answer.
 *
 * ⚠ THE FIX HAD AN OBVIOUS WRONG VERSION: drop `\b` and use substring matching.
 * That is worse. Bare `mo` then matches "promo", "moment", "mode" — a matcher
 * wrong in the confident direction rather than the blank one, and far harder to
 * spot on a dashboard. So the separators are normalised and the boundaries kept,
 * and the false-positive cases below are what stop anyone "simplifying" it back.
 */

import { describe, it, expect } from 'vitest'
import { classifySubscriptionCycle } from '@/lib/admin-dashboard/AdminCommandCenterService'

describe('classifySubscriptionCycle — snake_case, the format actually used', () => {
  // These are the codes this repo really issues; every one returned "unknown".
  it.each([
    ['af_pro_monthly', 'monthly'],
    ['af_pro_annual', 'annual'],
    ['af_plus_yearly', 'annual'],
    ['pro_monthly', 'monthly'],
    ['af_pro_mo', 'monthly'],
    ['af_pro_yr', 'annual'],
  ])('classifies %s as %s', (code, expected) => {
    expect(classifySubscriptionCycle(code, code)).toBe(expected)
    // Either field alone must work — sku and plan.code are populated independently.
    expect(classifySubscriptionCycle(code, null)).toBe(expected)
    expect(classifySubscriptionCycle(null, code)).toBe(expected)
  })

  it('still handles hyphen, dot, colon, slash and space separators', () => {
    expect(classifySubscriptionCycle('af-pro-monthly', null)).toBe('monthly')
    expect(classifySubscriptionCycle('af.pro.annual', null)).toBe('annual')
    expect(classifySubscriptionCycle('af:pro:monthly', null)).toBe('monthly')
    expect(classifySubscriptionCycle('af/pro/yearly', null)).toBe('annual')
    expect(classifySubscriptionCycle('AF Pro Monthly', null)).toBe('monthly')
  })
})

describe('classifySubscriptionCycle — must NOT match on a substring', () => {
  /*
   * ⚠ These are the reason `\b` survives the fix. A substring matcher passes
   * every test above and fails every one of these, while looking simpler.
   */
  it.each(['af_promo_code', 'af_moment_pass', 'af_mode_switch', 'af_promotional'])(
    'does not read %s as monthly',
    (code) => {
      expect(classifySubscriptionCycle(code, code)).toBe('unknown')
    }
  )

  it('does not read a bare Stripe price id as a cycle', () => {
    // Opaque ids carry no cycle information; guessing one would be inventing data.
    expect(classifySubscriptionCycle('price_1OaBcDeFgHiJkLmN', null)).toBe('unknown')
  })
})

describe('classifySubscriptionCycle — degenerate input', () => {
  it('returns unknown rather than throwing on null/undefined/empty', () => {
    expect(classifySubscriptionCycle(null, null)).toBe('unknown')
    expect(classifySubscriptionCycle(undefined, undefined)).toBe('unknown')
    expect(classifySubscriptionCycle('', '')).toBe('unknown')
  })

  it('prefers annual when a code somehow names both', () => {
    // Pins the existing precedence rather than leaving it to statement order.
    expect(classifySubscriptionCycle('af_annual_billed_monthly', null)).toBe('annual')
  })
})
