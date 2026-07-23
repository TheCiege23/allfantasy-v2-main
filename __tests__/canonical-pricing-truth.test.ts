import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMonetizationCatalog, getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { SUBSCRIPTION_TOKEN_POLICY_CONFIG, getIncludedPremiumCreditsForSubscription } from '@/lib/tokens/subscription-policy'
import { PLAN_FAMILY_INCLUDES } from '@/lib/monetization/planIncludes'
import { getDisplayPlanName, resolveHighestPlanId, getDisplayPlanNameForPlans } from '@/lib/subscription/feature-access'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/**
 * Canonical Pricing Truth. Before this, lib/monetization/catalog.ts's tokenAmount was correct
 * for AF Supreme only — Pro-yearly, Commissioner, and War Room/Legacy were all still wrong
 * (Commissioner up to 5x too high, War Room up to 10x), and a second file
 * (planIncludes.ts) independently hardcoded the same wrong numbers with zero mechanism keeping
 * either in sync with subscription-policy.ts (what the Stripe webhook actually grants). These
 * tests assert the structural fix — catalog.ts derives from subscription-policy.ts rather than
 * duplicating it — rather than re-testing one specific number that happened to be wrong.
 */

describe('Canonical Pricing Truth — catalog.ts token amounts equal subscription-policy.ts for every tier', () => {
  const CASES: Array<{ sku: Parameters<typeof getMonetizationCatalogItemBySku>[0]; planId: keyof typeof SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans; interval: 'month' | 'year' }> = [
    { sku: 'af_pro_monthly', planId: 'pro', interval: 'month' },
    { sku: 'af_pro_yearly', planId: 'pro', interval: 'year' },
    { sku: 'af_commissioner_monthly', planId: 'commissioner', interval: 'month' },
    { sku: 'af_commissioner_yearly', planId: 'commissioner', interval: 'year' },
    { sku: 'af_war_room_monthly', planId: 'war_room', interval: 'month' },
    { sku: 'af_war_room_yearly', planId: 'war_room', interval: 'year' },
    { sku: 'af_supreme_monthly', planId: 'supreme', interval: 'month' },
    { sku: 'af_supreme_yearly', planId: 'supreme', interval: 'year' },
  ]

  it.each(CASES)('$sku matches the real grant policy', ({ sku, planId, interval }) => {
    const item = getMonetizationCatalogItemBySku(sku)
    const real = getIncludedPremiumCreditsForSubscription({ planId, interval })
    expect(item?.tokenAmount).toBe(real)
  })

  it('every subscription catalog item is computed, not a re-hardcoded literal that happens to match', () => {
    // Regression guard for the exact bug: reads the raw source text and fails if a subscription
    // tokenAmount field is ever a bare number literal again instead of a subscriptionTokenAmount(...) call.
    const src = read('lib/monetization/catalog.ts')
    const literalTokenAmount = /tokenAmount:\s*\d/g
    const matches = src.match(literalTokenAmount) ?? []
    // The 3 token-pack SKUs (af_tokens_5/10/25) are legitimately literal — they have no
    // subscription-policy.ts equivalent. Exactly 3 literal tokenAmount fields are expected.
    expect(matches.length).toBe(3)
  })
})

describe('Canonical Pricing Truth — planIncludes.ts no longer duplicates the token count', () => {
  it('no PLAN_FAMILY_INCLUDES bullet contains a hardcoded token-count number', () => {
    const tokenCountPattern = /\d[\d,]*\s+(monthly|yearly)\s+tokens?/i
    for (const [family, bullets] of Object.entries(PLAN_FAMILY_INCLUDES)) {
      for (const bullet of bullets) {
        expect(bullet, `${family} bullet "${bullet}" should not hardcode a token count`).not.toMatch(tokenCountPattern)
      }
    }
  })
})

describe('Canonical Pricing Truth — plan-name resolution is centralized', () => {
  it('resolveHighestPlanId applies supreme > commissioner > pro > war_room priority', () => {
    expect(resolveHighestPlanId(['pro', 'commissioner', 'war_room', 'supreme'])).toBe('supreme')
    expect(resolveHighestPlanId(['pro', 'commissioner', 'war_room'])).toBe('commissioner')
    expect(resolveHighestPlanId(['pro', 'war_room'])).toBe('pro')
    expect(resolveHighestPlanId(['war_room'])).toBe('war_room')
    expect(resolveHighestPlanId([])).toBeNull()
    expect(resolveHighestPlanId(undefined)).toBeNull()
  })

  it('getDisplayPlanNameForPlans returns the canonical display name for the highest plan', () => {
    expect(getDisplayPlanNameForPlans(['commissioner', 'pro'])).toBe(getDisplayPlanName('commissioner'))
    expect(getDisplayPlanNameForPlans([])).toBeNull()
  })

  it('no settings/dashboard plan-badge surface hardcodes its own supreme>commissioner>pro>war_room chain anymore', () => {
    const sites = [
      'app/settings/components/sections/AccountSettingsSection.tsx',
      'app/settings/components/sections/BillingSettingsSection.tsx',
      'app/settings/components/SettingsChrome.tsx',
      'app/dashboard/universal/components/SettingsMenu.tsx',
      'app/dashboard/components/DashboardHeaderControls.tsx',
      'app/dashboard/components/RightControlPanel.tsx',
      'components/dashboard/adaptive/hooks/useViewAsRole.ts',
      'components/dashboard/nocturne/NocturneDashboard.tsx',
      'app/dashboard/components/resolvePlanChip.ts',
    ]
    for (const file of sites) {
      const src = read(file)
      // The old anti-pattern: 4 chained ternary/if branches each hardcoding "AF <Tier>" literally.
      // A file that still does this will contain at least 3 of these literal tier strings.
      const literalTierCount = ['"AF Supreme"', "'AF Supreme'", '"AF Commissioner"', "'AF Commissioner'"]
        .filter((lit) => src.includes(lit)).length
      expect(literalTierCount, `${file} should resolve plan names via getDisplayPlanName, not hardcoded literals`).toBe(0)
    }
  })
})

describe('Canonical Pricing Truth — no forbidden internal codename in customer-facing copy', () => {
  it('the draft-war-room 403 response uses the customer-facing "AF Legacy" name', () => {
    const src = read('app/api/draft-war-room/route.ts')
    expect(src).not.toContain('AF War Room')
    expect(src).toContain('AF Legacy')
  })
})

describe('Canonical Pricing Truth — catalog is the single feed for all 5 primary pricing surfaces', () => {
  it('all 5 pricing/upgrade pages render the shared MonetizationPurchaseSurface (no page-local catalog copy)', () => {
    const pages = ['app/pricing/page.tsx', 'app/upgrade/page.tsx', 'app/pro/page.tsx', 'app/commissioner-upgrade/page.tsx', 'app/all-access/page.tsx']
    for (const page of pages) {
      const src = read(page)
      expect(src, `${page} should render the shared MonetizationPurchaseSurface`).toContain('MonetizationPurchaseSurface')
    }
  })

  it('getMonetizationCatalog exposes every subscription SKU with a computed, non-negative tokenAmount', () => {
    const { subscriptions } = getMonetizationCatalog()
    expect(subscriptions.length).toBe(8)
    for (const item of subscriptions) {
      expect(item.tokenAmount).not.toBeNull()
      expect(item.tokenAmount as number).toBeGreaterThan(0)
    }
  })
})
