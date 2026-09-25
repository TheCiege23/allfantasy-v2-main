// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { SubscriptionPlanFamily } from '@/lib/monetization/catalog'
import { ENTITLEMENTS, HIGHLIGHT_TO_PLAN_FAMILY, type EntitlementDef } from '@/lib/monetization/entitlements'
import {
  buildMonetizationUpgradePathForFeature,
  listFeatureMonetizationMatrix,
} from '@/lib/monetization/feature-monetization-matrix'
import {
  normalizePlanFamilyInput,
  pricingIntentRedirect,
  purchaseReturnPath,
  upgradePathForPlan,
} from '@/lib/monetization/upgradeDestination'
import { getUpgradeUrlWithHighlightForFeature } from '@/lib/subscription/featureGating'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

/*
 * Every "upgrade" click lands on checkout for the plan that unlocks the feature
 * (lib/monetization/upgradeDestination.ts). Before 2026-09-24:
 *  - every AF Legacy lock (4 entitlements, 13 matrix features) went to /war-room,
 *    a product page with no way to pay;
 *  - /pricing ignored `?plan=` / `?highlight=` and does not sell Legacy at all;
 *  - /upgrade rejected `af-pro`, the spelling the World Cup and waiver locks use;
 *  - a cancelled checkout or a sign-in came back to the bare page, a different plan.
 */

/** The plan a URL puts first on a purchase page, following /pricing's redirect; null when it is not a purchase page. */
function landingPlan(path: string): SubscriptionPlanFamily | null {
  const url = new URL(path, 'https://allfantasy.test')
  const params = Object.fromEntries(url.searchParams)
  switch (url.pathname) {
    case '/pro':
      return 'af_pro'
    case '/commissioner-upgrade':
      return 'af_commissioner'
    case '/upgrade':
      return normalizePlanFamilyInput(params.plan)
    case '/pricing': {
      const next = pricingIntentRedirect(params)
      return next ? landingPlan(next) : null
    }
    default:
      return null
  }
}

const PLAN_ID_FAMILY: Record<string, SubscriptionPlanFamily> = {
  pro: 'af_pro',
  commissioner: 'af_commissioner',
  war_room: 'af_war_room',
  supreme: 'af_supreme',
}

describe('normalizePlanFamilyInput', () => {
  it('reads every spelling links in this repo use', () => {
    for (const [input, family] of [
      ['pro', 'af_pro'],
      ['af_pro', 'af_pro'],
      ['af-pro', 'af_pro'],
      ['AF Pro', 'af_pro'],
      ['af-commissioner', 'af_commissioner'],
      ['commissioner', 'af_commissioner'],
      ['war_room', 'af_war_room'],
      ['af-war-room', 'af_war_room'],
      ['legacy', 'af_war_room'],
      ['af-legacy', 'af_war_room'],
      ['supreme', 'af_supreme'],
      ['af-supreme', 'af_supreme'],
      ['all-access', 'af_supreme'],
    ] as const) {
      expect(normalizePlanFamilyInput(input), input).toBe(family)
    }
  })

  it('anything else is no plan', () => {
    for (const input of ['', 'free', 'enterprise', 'dynasty_projections', 'af_pr0', null, undefined, 3, ['pro']]) {
      expect(normalizePlanFamilyInput(input)).toBeNull()
    }
  })
})

describe('pricingIntentRedirect', () => {
  it('a /pricing link that names a plan goes to that plan on /upgrade, keeping its other parameters', () => {
    expect(pricingIntentRedirect({ plan: 'commissioner' })).toBe('/upgrade?plan=commissioner')
    expect(pricingIntentRedirect({ plan: 'af-commissioner', feature: 'commissioner-waiver-ai' })).toBe(
      '/upgrade?plan=commissioner&feature=commissioner-waiver-ai',
    )
    expect(pricingIntentRedirect({ highlight: 'af-pro', intent: 'world-cup' })).toBe(
      '/upgrade?plan=pro&highlight=af-pro&intent=world-cup',
    )
    expect(pricingIntentRedirect({ highlight: 'supreme' })).toBe('/upgrade?plan=supreme&highlight=supreme')
  })

  it('a feature highlight goes to the plan that unlocks that feature, and still rings its card', () => {
    expect(pricingIntentRedirect({ highlight: 'dynasty_projections' })).toBe(
      '/upgrade?plan=war_room&highlight=dynasty_projections',
    )
    expect(pricingIntentRedirect({ highlight: 'trade_ai', from: 'x' })).toBe('/upgrade?plan=pro&highlight=trade_ai&from=x')
  })

  it('`plan` wins over `highlight`, and a repeated parameter uses its first value', () => {
    expect(pricingIntentRedirect({ plan: 'war_room', highlight: 'af-pro' })).toBe('/upgrade?plan=war_room&highlight=af-pro')
    expect(pricingIntentRedirect({ plan: ['supreme', 'pro'] })).toBe('/upgrade?plan=supreme')
  })

  it('🛑 a /pricing with no plan intent stays on the grid — including a checkout return and the billing-portal bounce', () => {
    for (const params of [
      undefined,
      null,
      {},
      { from: 'wc-chimmy' },
      { msg: 'no_subscription' },
      { checkout: 'success' },
      { highlight: 'not-a-plan-or-feature' },
      { plan: '' },
    ]) {
      expect(pricingIntentRedirect(params)).toBeNull()
    }
  })
})

describe('purchaseReturnPath', () => {
  it('comes back to the plan the buyer chose, without the last attempt’s result', () => {
    expect(
      purchaseReturnPath(
        '/upgrade',
        new URLSearchParams('plan=war_room&feature=draft_prep&checkout=cancelled&session_id=cs_1&status=x'),
      ),
    ).toBe('/upgrade?plan=war_room&feature=draft_prep')
  })

  it('a page with no query returns to itself', () => {
    expect(purchaseReturnPath('/pro', new URLSearchParams(''))).toBe('/pro')
    expect(purchaseReturnPath('/pro', null)).toBe('/pro')
    expect(purchaseReturnPath('/pro', new URLSearchParams('checkout=success'))).toBe('/pro')
  })
})

describe('upgradePathForPlan', () => {
  it('names the plan and drops empty context', () => {
    expect(upgradePathForPlan('af_war_room')).toBe('/upgrade?plan=war_room')
    expect(upgradePathForPlan('af_supreme', { feature: 'x', from: null, plan: 'pro' })).toBe('/upgrade?plan=supreme&feature=x')
  })
})

describe('🛑 every lock lands on checkout for a plan that unlocks it', () => {
  const entries = Object.values(ENTITLEMENTS) as EntitlementDef[]

  it('every entitlement’s upgrade link', () => {
    for (const def of entries) {
      const plan = landingPlan(def.upgradeUrl)
      expect(plan, `${def.key} → ${def.upgradeUrl}`).not.toBeNull()
      expect(def.requiredPlan, `${def.key} → ${def.upgradeUrl} lands on ${plan}`).toContain(plan)
    }
  })

  it('…and the same link with its highlight: one `?`, same plan, and the highlight rings a card that unlocks it', () => {
    for (const def of entries) {
      const url = getUpgradeUrlWithHighlightForFeature(def.key)
      expect(url.split('?').length, url).toBeLessThanOrEqual(2)
      expect(def.requiredPlan, `${def.key} → ${url}`).toContain(landingPlan(url))
      if (def.highlightParam) {
        expect(new URL(url, 'https://x.test').searchParams.get('highlight'), def.key).toBe(def.highlightParam)
        expect(def.requiredPlan, `${def.key} highlight ${def.highlightParam}`).toContain(
          HIGHLIGHT_TO_PLAN_FAMILY[def.highlightParam],
        )
      }
    }
  })

  it('every premium matrix feature', () => {
    const premium = listFeatureMonetizationMatrix().filter((e) => e.accessType !== 'free')
    expect(premium.filter((e) => e.requiredPlanId === 'war_room').length).toBeGreaterThan(0)
    for (const entry of premium) {
      const path = buildMonetizationUpgradePathForFeature(entry.key as SubscriptionFeatureId)
      expect(landingPlan(path), `${entry.key} → ${path}`).toBe(PLAN_ID_FAMILY[String(entry.requiredPlanId)])
    }
  })

  it('🛑 no lock points at the AF Legacy product page', () => {
    for (const def of entries) expect(def.upgradeUrl).not.toMatch(/^\/war-room/)
    for (const entry of listFeatureMonetizationMatrix()) {
      if (entry.accessType === 'free') continue
      expect(buildMonetizationUpgradePathForFeature(entry.key as SubscriptionFeatureId)).not.toMatch(/^\/war-room/)
    }
  })
})

describe('🛑 every literal /pricing link that names a plan resolves to one', () => {
  const root = resolve(__dirname, '..')
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) sourceFiles(full, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(full)
    }
    return out
  }

  it('app/, components/, lib/', () => {
    const links: string[] = []
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(join(root, dir))) {
        for (const m of readFileSync(file, 'utf8').matchAll(/["'`](\/pricing\?[^"'`$\s]*)["'`]/g)) links.push(m[1]!)
      }
    }
    // Positive control: the census must find the World Cup and create-league links this rule exists for.
    expect(links).toContain('/pricing?plan=commissioner')
    expect(links).toContain('/pricing?highlight=af-pro&intent=world-cup')

    const named = links.filter((l) => /[?&](plan|highlight)=/.test(l))
    expect(named.length).toBeGreaterThan(5)
    for (const link of named) {
      const params = Object.fromEntries(new URL(link, 'https://x.test').searchParams)
      expect(pricingIntentRedirect(params), link).not.toBeNull()
    }
  })
})
