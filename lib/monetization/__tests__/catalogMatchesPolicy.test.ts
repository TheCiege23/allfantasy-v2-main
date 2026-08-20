import { describe, expect, it } from 'vitest'
import { getMonetizationCatalog, PLANNED_PRICE_USD } from '../catalog'
import { SUBSCRIPTION_TOKEN_POLICY_CONFIG } from '@/lib/tokens/subscription-policy'
import { SUPREME_INCLUDED_PLAN_IDS } from '@/lib/subscription/feature-access'

/**
 * Guards for the monetization numbers customers actually read.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE SAME CLASS OF BUG HAS NOW HAPPENED THREE TIMES.
 * Two files hold one truth, only one of them is load-bearing, and the one
 * customers READ is the one that is not. It was tokens (the catalog advertised up
 * to 10.3x what Stripe credited), then tier descriptions (Legacy claimed to
 * include Supreme when Supreme included Legacy). Comments saying "must match" did
 * not prevent either — there were three such comments.
 */

const PLAN_FAMILY_TO_POLICY: Record<string, keyof typeof SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans> = {
  af_pro: 'pro',
  af_commissioner: 'commissioner',
  af_war_room: 'war_room',
  af_supreme: 'supreme',
}

const subscriptions = getMonetizationCatalog().subscriptions

describe('subscriptions do not deal in tokens', () => {
  it('has subscriptions to check (guards against a vacuous pass)', () => {
    // An empty catalog would make every assertion below trivially true — the
    // exact way a green suite can prove nothing at all.
    expect(subscriptions.length).toBeGreaterThan(0)
  })

  /*
   * ⚠ THE MODEL CHANGED: subscriptions unlock features, tokens are the
   * pay-per-use path for people who do not subscribe. A subscription advertising
   * a token grant is now wrong by design, not merely inaccurate.
   */
  it.each(subscriptions.map((s) => [s.sku, s] as const))(
    '%s advertises no token grant',
    (_sku, item) => {
      expect(
        item.tokenAmount,
        `${item.sku} advertises ${item.tokenAmount} tokens. Subscriptions no longer grant tokens — ` +
          `tokens are the pay-per-use path for non-subscribers. Use null, not 0.`
      ).toBeNull()
    }
  )

  it.each(subscriptions.map((s) => [s.sku, s] as const))(
    '%s grants nothing in the policy either',
    (_sku, item) => {
      const policyKey = PLAN_FAMILY_TO_POLICY[item.planFamily as string]
      // A new plan family with no mapping must fail loudly rather than skip:
      // silently not-checking a tier is how the earlier drift got through.
      expect(policyKey, `no policy mapping for planFamily "${item.planFamily}"`).toBeTruthy()
      const policy = SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans[policyKey]
      expect(policy, `no policy entry for "${policyKey}"`).toBeTruthy()

      /*
       * The policy is what invoice.payment_succeeded credits. These zeroes are
       * what actually stop the grant — grantMonthlyCreditsFromInvoice bails on
       * `!tokenAmount || tokenAmount <= 0`.
       */
      expect(policy.monthlyIncludedPremiumCredits, `${policyKey} monthly grant`).toBe(0)
      expect(policy.yearlyIncludedPremiumCredits, `${policyKey} yearly grant`).toBe(0)
      // Dropped with the grant: a spend discount only matters to someone who
      // spends tokens, and a subscriber has no reason to.
      expect(policy.discountedTokenSpendPct, `${policyKey} token spend discount`).toBe(0)
    }
  )
})

describe('token packs still carry tokens', () => {
  /*
   * ⚠ THE COUNTERPART ASSERTION, AND IT IS NOT REDUNDANT. A careless sweep that
   * nulled `tokenAmount` across the whole catalog would satisfy every test above
   * and quietly sell token packs that grant nothing.
   */
  const packs = getMonetizationCatalog().tokenPacks
  it('has token packs to check', () => {
    expect(packs.length).toBeGreaterThan(0)
  })
  it.each(packs.map((p) => [p.sku, p] as const))('%s grants tokens', (_sku, pack) => {
    expect(pack.tokenAmount, `${pack.sku} must grant tokens — it is a token pack`).toBeGreaterThan(0)
  })
})

describe('yearly plans are cheaper than paying monthly', () => {
  /*
   * ⚠ THE HOOK IS THE PRODUCT PROMISE, SO IT GETS AN ASSERTION. The pricing page
   * tells people they save by paying yearly. A yearly price that crept above 12x
   * the monthly one would make the page's central claim false while every number
   * on it stayed internally consistent.
   */
  const byFamily = new Map<string, { monthly?: number; yearly?: number }>()
  for (const item of subscriptions) {
    const entry = byFamily.get(item.planFamily as string) ?? {}
    if (item.interval === 'month') entry.monthly = item.amountUsd
    if (item.interval === 'year') entry.yearly = item.amountUsd
    byFamily.set(item.planFamily as string, entry)
  }

  it.each([...byFamily.entries()])('%s yearly beats 12 x monthly', (family, prices) => {
    if (prices.monthly == null || prices.yearly == null) return
    const twelve = Number((prices.monthly * 12).toFixed(2))
    expect(
      prices.yearly,
      `${family}: yearly $${prices.yearly} is not cheaper than 12 x $${prices.monthly} = $${twelve}`
    ).toBeLessThan(twelve)
  })
})

describe('tier descriptions vs entitlement inheritance', () => {
  /*
   * ⚠ THE ORIGINAL COPY WAS INVERTED, NOT MERELY VAGUE. Legacy advertised
   * "Everything in Supreme plus …" while Supreme was the tier that included
   * Legacy. Someone buying on that sentence finds features locked that they paid
   * for. Only a family Supreme actually inherits may make an inclusion claim.
   */
  const BUNDLING_FAMILIES = new Set(['af_supreme'])

  it('SUPREME_INCLUDED_PLAN_IDS still describes a real bundle', () => {
    expect(SUPREME_INCLUDED_PLAN_IDS.length).toBeGreaterThan(0)
  })

  it('Supreme no longer claims to include Legacy', () => {
    // Legacy now stands alone at $9.99 beside Pro and Commissioner. If war_room
    // reappears here, the pricing page's four-lane story is wrong again.
    expect(SUPREME_INCLUDED_PLAN_IDS).not.toContain('war_room')
  })

  it.each(subscriptions.map((s) => [s.sku, s] as const))(
    '%s does not claim to include another tier unless it does',
    (_sku, item) => {
      if (!/everything in /i.test(item.description)) return
      expect(
        BUNDLING_FAMILIES.has(item.planFamily as string),
        `${item.sku} says "${item.description}" but only Supreme bundles other tiers ` +
          `(SUPREME_INCLUDED_PLAN_IDS = [${SUPREME_INCLUDED_PLAN_IDS.join(', ')}]). ` +
          `Describe what this tier ADDS, not what it contains.`
      ).toBe(true)
    }
  )
})

describe('planned prices are valid before we ever switch to them', () => {
  /*
   * ⚠ THE PLANNED PRICES ARE CHECKED NOW SO THE FLIP IS BORING LATER. They sit in
   * PLANNED_PRICE_USD waiting on Stripe Price objects; the day someone moves them
   * into amountUsd should not be the day we discover one of them breaks the
   * yearly-is-cheaper promise. Validating a value before it goes live is the
   * whole point of having written it down.
   */
  const subs = getMonetizationCatalog().subscriptions
  const bySku = new Map(subs.map((s) => [s.sku, s]))

  it('every planned sku exists in the catalog', () => {
    for (const sku of Object.keys(PLANNED_PRICE_USD)) {
      expect(bySku.has(sku as never), `PLANNED_PRICE_USD names "${sku}", which is not a catalog SKU`).toBe(true)
    }
  })

  it('planned yearly prices still beat 12 x the effective monthly price', () => {
    for (const [sku, planned] of Object.entries(PLANNED_PRICE_USD)) {
      const item = bySku.get(sku as never)
      if (!item || item.interval !== 'year') continue
      const monthly = subs.find((s) => s.planFamily === item.planFamily && s.interval === 'month')
      if (!monthly) continue
      // Use the planned monthly price when there is one — Legacy's monthly moves too.
      const monthlyAmount = PLANNED_PRICE_USD[monthly.sku] ?? monthly.amountUsd
      const twelve = Number((monthlyAmount * 12).toFixed(2))
      expect(
        planned,
        `${sku}: planned yearly $${planned} is not cheaper than 12 x $${monthlyAmount} = $${twelve}`
      ).toBeLessThan(twelve)
    }
  })
})
