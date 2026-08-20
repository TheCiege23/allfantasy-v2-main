import { describe, expect, it } from 'vitest'
import { PLAN_FAMILY_INCLUDES, PLAN_FAMILY_SHORT_TAGLINE } from '../planIncludes'
import { getMonetizationCatalog } from '../catalog'
import { SUPREME_INCLUDED_PLAN_IDS } from '@/lib/subscription/feature-access'

/**
 * ⚠ THIS EXISTS BECAUSE THE TOKEN NUMBERS LIVED IN THREE FILES AND I ONLY FIXED
 * TWO. The catalog advertised Legacy at 3,000 tokens against 300 granted; I
 * corrected that and the policy, and planIncludes.ts went on saying "3,000
 * monthly tokens or 36,000 yearly tokens included" on the actual pricing card.
 * Two of three is not a fix — it just moves which file is lying.
 *
 * Subscriptions no longer grant tokens at all, so the rule is now simple enough
 * to enforce mechanically: marketing copy for a PLAN may not quote a token
 * quantity. If a figure is ever genuinely needed, derive it at render time from
 * subscription-policy.ts rather than transcribing it into a fourth file.
 */

// "250 tokens", "3,000 monthly tokens", "15,000 yearly tokens" — a number
// followed by the word tokens. Deliberately does NOT match "token packs" or
// "token discounts", which are concepts rather than quantities.
const TOKEN_QUANTITY = /\d[\d,]*\s*(monthly |yearly )?tokens?\b/i

/*
 * ⚠ A SECOND PATTERN, BECAUSE THE FIRST MISSED A CLAIM THAT WENT LIVE. Supreme's
 * catalog description read "plus the largest token allowance" — no digit anywhere,
 * so TOKEN_QUANTITY did not match, and it rendered on the pricing page while 67
 * assertions passed. Subscriptions grant no tokens at all, so a QUALITATIVE token
 * promise is exactly as false as a numeric one.
 *
 * Deliberately does not match "token packs" or "buy tokens" — those describe the
 * pay-per-use product, which is real and is the thing we now sell.
 */
const TOKEN_PROMISE = /token\s+(allowance|allowances|grant|grants|discount|discounts)|(included|bonus|free)\s+tokens/i

describe('plan marketing copy quotes no token quantities', () => {
  const entries: Array<[string, string]> = [
    ...Object.entries(PLAN_FAMILY_SHORT_TAGLINE).map(([k, v]) => [`${k} tagline`, v] as [string, string]),
    ...Object.entries(PLAN_FAMILY_INCLUDES).flatMap(([k, lines]) =>
      lines.map((l, i) => [`${k} bullet ${i}`, l] as [string, string])
    ),
    ...getMonetizationCatalog().subscriptions.map((s) => [`${s.sku} description`, s.description] as [string, string]),
  ]

  it('has copy to check (guards against a vacuous pass)', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s — no token quantity', (_where, text) => {
    expect(
      TOKEN_QUANTITY.test(text),
      `"${text}" quotes a token quantity. Subscriptions grant no tokens — this is the third ` +
        `file this claim has appeared in, and each time it was a number nobody was crediting.`
    ).toBe(false)
  })

  it.each(entries)('%s — no qualitative token promise', (_where, text) => {
    expect(
      TOKEN_PROMISE.test(text),
      `"${text}" promises tokens without naming a number. Subscriptions grant none — ` +
        `a vague token promise is as false as a numeric one, and it slipped past the ` +
        `digit-based check onto the live pricing page.`
    ).toBe(false)
  })
})

describe('Supreme copy matches what Supreme actually bundles', () => {
  it('does not claim Legacy', () => {
    /*
     * The tagline said "Pro + Commissioner + AF Legacy in one tier" while
     * SUPREME_INCLUDED_PLAN_IDS no longer contains war_room. Anyone buying
     * Supreme for the draft room would not get it.
     */
    /*
     * ⚠ INCLUDES THE CATALOG DESCRIPTIONS. The first version of this test read
     * only planIncludes.ts, so Supreme's catalog description went on claiming
     * "Pro, Commissioner and Legacy" and rendered on the live page. Checking two
     * of the three files that hold this fact is how it survived.
     */
    const supremeCopy = [
      PLAN_FAMILY_SHORT_TAGLINE.af_supreme,
      ...PLAN_FAMILY_INCLUDES.af_supreme,
      ...getMonetizationCatalog()
        .subscriptions.filter((s) => s.planFamily === 'af_supreme')
        .map((s) => s.description),
    ].join(' ')
    const claimsLegacy = /legacy|war\s*room/i.test(supremeCopy)
    expect(
      claimsLegacy && !SUPREME_INCLUDED_PLAN_IDS.includes('war_room' as never),
      `Supreme copy mentions Legacy but SUPREME_INCLUDED_PLAN_IDS is [${SUPREME_INCLUDED_PLAN_IDS.join(', ')}]`
    ).toBe(false)
  })
})
