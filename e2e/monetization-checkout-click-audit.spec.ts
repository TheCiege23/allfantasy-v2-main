import { expect, test, type Page } from '@playwright/test'
import { clickHydrated, waitForHydrated } from './helpers/hydration'

test.describe.configure({ timeout: 180_000 })

function buildCatalogPayload() {
  const subscriptions = [
    {
      sku: 'af_pro_monthly',
      type: 'subscription',
      title: 'AF Pro Monthly',
      description: 'Player-specific AI features for active fantasy managers.',
      amountUsd: 9.99,
      currency: 'usd',
      interval: 'month',
      tokenAmount: null,
      planFamily: 'af_pro',
      stripePriceId: 'price_af_pro_monthly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_pro_yearly',
      type: 'subscription',
      title: 'AF Pro Yearly',
      description: 'Player-specific AI features for active fantasy managers.',
      amountUsd: 99.99,
      currency: 'usd',
      interval: 'year',
      tokenAmount: null,
      planFamily: 'af_pro',
      stripePriceId: 'price_af_pro_yearly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_commissioner_monthly',
      type: 'subscription',
      title: 'AF Commissioner Monthly',
      description: 'League-specific commissioner tools and automation controls.',
      amountUsd: 4.99,
      currency: 'usd',
      interval: 'month',
      tokenAmount: null,
      planFamily: 'af_commissioner',
      stripePriceId: 'price_af_commissioner_monthly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_commissioner_yearly',
      type: 'subscription',
      title: 'AF Commissioner Yearly',
      description: 'League-specific commissioner tools and automation controls.',
      amountUsd: 49.99,
      currency: 'usd',
      interval: 'year',
      tokenAmount: null,
      planFamily: 'af_commissioner',
      stripePriceId: 'price_af_commissioner_yearly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_war_room_monthly',
      type: 'subscription',
      title: 'AF War Room Monthly',
      description: 'Draft strategy and long-term planning tools for one user.',
      amountUsd: 9.99,
      currency: 'usd',
      interval: 'month',
      tokenAmount: null,
      planFamily: 'af_war_room',
      stripePriceId: 'price_af_war_room_monthly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_war_room_yearly',
      type: 'subscription',
      title: 'AF War Room Yearly',
      description: 'Draft strategy and long-term planning tools for one user.',
      amountUsd: 99.99,
      currency: 'usd',
      interval: 'year',
      tokenAmount: null,
      planFamily: 'af_war_room',
      stripePriceId: 'price_af_war_room_yearly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_supreme_monthly',
      type: 'subscription',
      title: 'AF Supreme Monthly',
      description:
        'Everything in All-Access plus the highest token allowances and platform-wide premium priority.',
      amountUsd: 29.99,
      currency: 'usd',
      interval: 'month',
      tokenAmount: null,
      planFamily: 'af_supreme',
      stripePriceId: 'price_af_supreme_monthly',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_supreme_yearly',
      type: 'subscription',
      title: 'AF Supreme Yearly',
      description:
        'Everything in All-Access plus the highest token allowances and platform-wide premium priority.',
      amountUsd: 299.99,
      currency: 'usd',
      interval: 'year',
      tokenAmount: null,
      planFamily: 'af_supreme',
      stripePriceId: 'price_af_supreme_yearly',
      stripePriceConfigured: true,
    },
  ]

  const tokenPacks = [
    {
      sku: 'af_tokens_5',
      type: 'token_pack',
      title: 'AllFantasy AI Tokens (5)',
      description: '5 AI tokens for metered premium AI actions.',
      amountUsd: 4.99,
      currency: 'usd',
      interval: null,
      tokenAmount: 5,
      planFamily: null,
      stripePriceId: 'price_af_tokens_5',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_tokens_10',
      type: 'token_pack',
      title: 'AllFantasy AI Tokens (10)',
      description: '10 AI tokens for metered premium AI actions.',
      amountUsd: 8.99,
      currency: 'usd',
      interval: null,
      tokenAmount: 10,
      planFamily: null,
      stripePriceId: 'price_af_tokens_10',
      stripePriceConfigured: true,
    },
    {
      sku: 'af_tokens_25',
      type: 'token_pack',
      title: 'AllFantasy AI Tokens (25)',
      description: '25 AI tokens for metered premium AI actions.',
      amountUsd: 19.99,
      currency: 'usd',
      interval: null,
      tokenAmount: 25,
      planFamily: null,
      stripePriceId: 'price_af_tokens_25',
      stripePriceConfigured: true,
    },
  ]

  return {
    catalog: {
      subscriptions,
      tokenPacks,
      all: [...subscriptions, ...tokenPacks],
    },
    fancredBoundary: {
      version: '2026-03-28',
      short:
        'Paid league dues and payouts are handled externally via FanCred. AllFantasy does not process league dues, hold funds, or distribute winnings.',
      long:
        'AllFantasy league creation and league operation are free. If your league uses paid dues, commissioners must manage dues and payouts externally through FanCred.',
      checklist: [],
    },
  }
}

async function mockPricingApis(page: Page) {
  await page.route('**/api/monetization/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCatalogPayload()),
    })
  })

  await page.route('**/api/subscription/entitlements**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
        hasAccess: false,
        message: 'Upgrade to access this feature.',
      }),
    })
  })

  await page.route('**/api/tokens/balance', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balance: 0, updatedAt: new Date().toISOString() }),
    })
  })
}

async function waitForPricingReady(page: Page) {
  await expect(page.getByText('Loading pricing catalog...')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByTestId('pricing-subscription-cta-af_pro_monthly')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('pricing-token-cta-af_tokens_10')).toBeVisible({ timeout: 20_000 })
  /*
   * ⚠ VISIBLE IS NOT CLICKABLE. Both assertions above pass on the server-rendered
   * markup, before React attaches onClick — measured at 65ms early on a cold dev
   * server. Every test in this file treats this function as "the page is ready to
   * drive", so the hydration wait belongs here rather than at each call site.
   * See e2e/helpers/hydration.ts.
   */
  await waitForHydrated(page.getByTestId('pricing-subscription-cta-af_pro_monthly'))
}

test.describe('@monetization checkout click audit', () => {
  test('desktop subscription CTA dispatches checkout payload and redirects', async ({ page }) => {
    await mockPricingApis(page)
    let checkoutBody: unknown = null

    await page.route('**/api/monetization/checkout/subscription', async (route) => {
      checkoutBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'http://localhost:3000/e2e/subscription-checkout-success',
          sessionId: 'cs_sub_1',
          sku: 'af_pro_monthly',
        }),
      })
    })

    await page.route('**/e2e/subscription-checkout-success', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>subscription success</body></html>',
      })
    })

    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    await waitForPricingReady(page)
    await expect(page.getByTestId('pricing-subscription-cta-af_pro_monthly')).toBeVisible()

    await clickHydrated(page.getByTestId('pricing-subscription-cta-af_pro_monthly'))
    await page.waitForURL('**/e2e/subscription-checkout-success')

    expect(checkoutBody).toMatchObject({
      sku: 'af_pro_monthly',
      returnPath: '/pricing',
    })
  })

  test('mobile token CTA dispatches checkout payload and redirects', async ({ page }) => {
    await mockPricingApis(page)
    let checkoutBody: unknown = null

    await page.route('**/api/monetization/checkout/tokens', async (route) => {
      checkoutBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'http://localhost:3000/e2e/token-checkout-success',
          sessionId: 'cs_tok_1',
          sku: 'af_tokens_10',
          tokenAmount: 10,
        }),
      })
    })

    await page.route('**/e2e/token-checkout-success', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>token success</body></html>',
      })
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    await waitForPricingReady(page)
    await expect(page.getByTestId('pricing-token-cta-af_tokens_10')).toBeVisible()

    await clickHydrated(page.getByTestId('pricing-token-cta-af_tokens_10'))
    await page.waitForURL('**/e2e/token-checkout-success')

    expect(checkoutBody).toMatchObject({
      sku: 'af_tokens_10',
      returnPath: '/pricing',
    })
  })

  test('checkout API failure shows actionable fallback message (no dead end)', async ({ page }) => {
    await mockPricingApis(page)

    await page.route('**/api/monetization/checkout/subscription', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Checkout is temporarily unavailable for this plan.' }),
      })
    })

    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    await waitForPricingReady(page)
    await clickHydrated(page.getByTestId('pricing-subscription-cta-af_pro_monthly'))

    await expect(page.getByText('Checkout is temporarily unavailable for this plan.')).toBeVisible()
    await expect(page).toHaveURL(/\/pricing/)
    await expect(page.getByTestId('pricing-token-cta-af_tokens_10')).toBeVisible()
  })

  /*
   * ⚠ THIS TEST'S REAL BUG WAS HYDRATION, NOT ANY OF ITS ASSERTIONS.
   *
   * It stalled on `waitForURL` partway through its eleven SKUs and looked like a
   * navigation problem. It was not: the click landed on a CTA that was visible
   * and enabled but not yet wired up, so nothing happened and the wait ran to
   * the timeout. With clickHydrated it completes in about 90 seconds.
   *
   * The assertions were separately wrong and are also fixed: the testids
   * (restored on PricingV4), the plan label (the af_war_room_* plan renders as
   * "AF Legacy"), and the billing-interval toggle — the only route to a yearly
   * SKU, because the "Yearly, if you'd rather pay once" section carries no CTA.
   */
  test('full product matrix CTAs map to correct checkout routes', async ({ page }) => {
    /*
     * The heaviest test in this file by a wide margin: eleven checkout round
     * trips (eight subscription SKUs, three token packs), each one a full
     * navigation to the mocked success page and back through page.goto —
     * eleven cold compiles of /pricing on the dev server the suite runs
     * against. Measured locally, it clears the first few SKUs comfortably and
     * then runs out of the 180s the describe block sets for every test here.
     *
     * Raised for THIS test only rather than for the file, so the other tests
     * keep a tight bound and a genuine hang still fails fast.
     */
    test.setTimeout(600_000)
    await mockPricingApis(page)
    const seenSubscriptionSkus = new Set<string>()
    const seenTokenSkus = new Set<string>()

    await page.route('**/api/monetization/checkout/subscription', async (route) => {
      const body = route.request().postDataJSON() as { sku?: string; returnPath?: string }
      if (body?.sku) seenSubscriptionSkus.add(body.sku)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `http://localhost:3000/e2e/checkout-success?sku=${encodeURIComponent(String(body?.sku ?? ''))}`,
          sku: body?.sku,
          purchaseType: 'subscription',
        }),
      })
    })

    await page.route('**/api/monetization/checkout/tokens', async (route) => {
      const body = route.request().postDataJSON() as { sku?: string; returnPath?: string }
      if (body?.sku) seenTokenSkus.add(body.sku)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `http://localhost:3000/e2e/checkout-success?sku=${encodeURIComponent(String(body?.sku ?? ''))}`,
          sku: body?.sku,
          purchaseType: 'tokens',
        }),
      })
    })

    await page.route('**/e2e/checkout-success**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>checkout success</body></html>',
      })
    })

    const subscriptionSkus = [
      'af_pro_monthly',
      'af_pro_yearly',
      'af_commissioner_monthly',
      'af_commissioner_yearly',
      'af_war_room_monthly',
      'af_war_room_yearly',
      'af_supreme_monthly',
      'af_supreme_yearly',
    ]
    const tokenSkus = ['af_tokens_5', 'af_tokens_10', 'af_tokens_25']

    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    await waitForPricingReady(page)
    await expect(page.getByRole('heading', { name: 'AF Pro' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AF Commissioner' })).toBeVisible()
    /*
     * ⚠ "AF Legacy" IS THE af_war_room_* PLAN. The display name was rebranded and
     * the SKU was not, so the catalog still says `af_war_room_monthly` while the
     * card says AF Legacy. This asserted the old label and could never match.
     * Do not "correct" the SKUs below to af_legacy_* — they are the real ones.
     */
    await expect(page.getByRole('heading', { name: 'AF Legacy' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AF Supreme' })).toBeVisible()
    /*
     * ⚠ REWRITTEN FOR THE SHIPPED /pricing, WHICH IS A TOGGLE, NOT A MATRIX.
     *
     * This asserted eight always-visible buttons labelled "Continue with Stripe
     * — Monthly/Yearly", which is what the previous surface
     * (components/monetization/MonetizationPurchaseSurface.tsx) rendered.
     * PricingV4 shows FOUR plan cards at a time behind a billing-interval
     * toggle, labelled "Choose AF Pro" and so on, and its "Yearly, if you'd
     * rather pay once" section is display-only — it prints annual prices and
     * carries no CTA. So the toggle is the ONLY route to a yearly SKU, and a
     * test that never touches it cannot reach half the product matrix.
     */
    const billingInterval = page.getByRole('group', { name: 'Billing interval' })
    await expect(billingInterval.getByRole('button', { name: 'Monthly' })).toBeVisible()
    await expect(billingInterval.getByRole('button', { name: 'Yearly' })).toBeVisible()
    for (const sku of tokenSkus) {
      await expect(page.getByTestId(`pricing-token-cta-${sku}`)).toBeVisible()
    }

    for (const sku of subscriptionSkus) {
      /*
       * Re-selected every iteration on purpose: each CTA navigates to checkout
       * and the test comes back through page.goto, which remounts the screen at
       * its 'month' default. Toggling once outside the loop would silently buy
       * four monthly plans and report a pass.
       */
      if (sku.endsWith('_yearly')) {
        await billingInterval.getByRole('button', { name: 'Yearly' }).click()
      }
      const cta = page.getByTestId(`pricing-subscription-cta-${sku}`)
      await expect(cta).toBeEnabled()
      await clickHydrated(cta)
      await page.waitForURL('**/e2e/checkout-success?sku=*')
      await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
      await waitForPricingReady(page)
    }

    for (const sku of tokenSkus) {
      const cta = page.getByTestId(`pricing-token-cta-${sku}`)
      await expect(cta).toBeEnabled()
      await clickHydrated(cta)
      await page.waitForURL('**/e2e/checkout-success?sku=*')
      await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
      await waitForPricingReady(page)
    }

    expect(Array.from(seenSubscriptionSkus).sort()).toEqual(subscriptionSkus.slice().sort())
    expect(Array.from(seenTokenSkus).sort()).toEqual(tokenSkus.slice().sort())
  })

  test('purchase entry pages render and checkout CTAs remain wired', async ({ page }) => {
    /*
     * Four separate entry pages, each a first-visit compile on the dev server the
     * suite runs against, each followed by waitForPricingReady. Measured: this
     * cleared /upgrade, /commissioner-upgrade and /pro and then timed out
     * NAVIGATING to /all-access — `waiting until "domcontentloaded"` never
     * resolved — rather than failing an assertion on it. That is compile time,
     * not a missing CTA, so the bound is raised instead of the page being
     * dropped from the list.
     */
    test.setTimeout(420_000)
    await mockPricingApis(page)
    const recordedReturnPaths: string[] = []

    await page.route('**/api/monetization/checkout/subscription', async (route) => {
      const body = route.request().postDataJSON() as { sku?: string; returnPath?: string }
      if (body?.returnPath) recordedReturnPaths.push(body.returnPath)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'http://localhost:3000/e2e/entry-checkout-success',
          sku: body?.sku,
          purchaseType: 'subscription',
        }),
      })
    })
    await page.route('**/api/monetization/checkout/tokens', async (route) => {
      const body = route.request().postDataJSON() as { sku?: string; returnPath?: string }
      if (body?.returnPath) recordedReturnPaths.push(body.returnPath)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'http://localhost:3000/e2e/entry-checkout-success',
          sku: body?.sku,
          purchaseType: 'tokens',
        }),
      })
    })
    await page.route('**/e2e/entry-checkout-success', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>ok</body></html>',
      })
    })

    /*
     * ⚠ /war-room WAS REMOVED FROM THIS LIST BECAUSE IT STOPPED BEING A PURCHASE
     * PAGE, AND THAT IS WORTH KNOWING RATHER THAN JUST DELETING.
     *
     * It rendered components/monetization/MonetizationPurchaseSurface once
     * (added by a7292d5ba, changed by 26e635b7c) and now renders a marketing
     * page with no checkout CTA on it at all — so the AF Legacy / af_war_room_*
     * plan has no dedicated purchase entry page any more, only /pricing. The
     * assertions below are a real contract for the four that remain, all of
     * which still render that surface; keeping a fifth that cannot satisfy them
     * made the whole test red and hid the other four.
     */
    const entryPages = [
      { url: '/upgrade?plan=pro', returnPath: '/upgrade' },
      { url: '/commissioner-upgrade', returnPath: '/commissioner-upgrade' },
      { url: '/pro', returnPath: '/pro' },
      { url: '/all-access', returnPath: '/all-access' },
    ]

    for (const entry of entryPages) {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded' })
      await waitForPricingReady(page)
      await expect(page.getByTestId('monetization-fancred-link')).toBeVisible()
      await expect(page.getByTestId('monetization-fancred-link')).toHaveAttribute(
        'href',
        /fancred\.app/
      )
      await expect(page.getByTestId('pricing-subscription-cta-af_pro_monthly')).toBeVisible()
      await expect(page.getByTestId('pricing-subscription-cta-af_pro_monthly')).toBeEnabled()
      await expect(page.getByTestId('pricing-token-cta-af_tokens_10')).toBeVisible()
      await expect(page.getByTestId('pricing-token-cta-af_tokens_10')).toBeEnabled()

      await clickHydrated(page.getByTestId('pricing-subscription-cta-af_pro_monthly'))
      await page.waitForURL('**/e2e/entry-checkout-success')
    }

    for (const expected of entryPages.map((entry) => entry.returnPath)) {
      expect(recordedReturnPaths).toContain(expected)
    }
  })
})
