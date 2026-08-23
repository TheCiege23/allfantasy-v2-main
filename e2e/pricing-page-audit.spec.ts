import { expect, test } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

/**
 * Pricing page audit — the counterpart to landing-page-click-audit.spec.ts, and
 * the way to check /pricing without a production deploy.
 *
 * ⚠ EVERY ASSERTION HERE READS RENDERED MARKUP OR REAL BEHAVIOUR, because each
 * defect it guards was invisible to a passing build:
 *
 *  - Clicking "Choose AF Pro" signed out printed the checkout endpoint's raw
 *    `Unauthorized` in a full-width error bar and left the visitor there. The
 *    page's whole purpose, failing in developer language, for exactly the
 *    audience the landing page sends here.
 *  - The page took card details while linking to neither Terms nor Privacy. It
 *    had five links in total and not one of them was legal.
 *  - It rendered four FAQs and four priced plans and emitted no structured data
 *    of its own — the only JSON-LD in the response came from the root layout.
 *  - The Spanish landing linked into the English pricing page, so choosing
 *    Spanish on screen one hit English at the moment of deciding to pay.
 *
 * Kept deliberately separate from monetization-checkout-click-audit.spec.ts:
 * that suite mocks the checkout endpoint to drive the PURCHASE paths, while this
 * one exercises the real signed-out response and the page's chrome.
 */

test.describe('@growth pricing page audit', () => {
  test.describe.configure({ timeout: 240_000 })

  /*
   * ⚠ WARM THE CHECKOUT ROUTE BEFORE ANY TEST CLICKS A CTA, OR THIS SUITE FAILS
   * FOR A REASON THAT HAS NOTHING TO DO WITH WHAT IT CHECKS.
   *
   * `resolveCheckoutUrl` aborts its fetch after 12s. That is a sane production
   * timeout — the route is prebuilt there and answers in well under a second —
   * but against a dev server compiling on demand it is not enough: measured
   * here, /pricing takes ~30s to compile cold and the checkout route another
   * ~7.5s, so the POST is aborted before any response exists.
   *
   * The failure that produces is genuinely misleading. An abort yields no HTTP
   * status, so `startCheckout` cannot see a 401, falls through to the generic
   * branch, and renders "Unable to start checkout" — which looks exactly like
   * the dead-end defect this suite was written to prevent. It reported the fix
   * as broken while the fix was working; verified separately at 6/6 against a
   * warm route, and 0/1 against a cold one.
   *
   * A plain POST compiles the route. The 401 it returns is the expected
   * signed-out answer and is deliberately not asserted on here — this is a
   * warmup, not a test.
   */
  test.beforeEach(async ({ request }) => {
    await request
      .post('/api/monetization/checkout/subscription', {
        data: { sku: 'af_pro_monthly', returnPath: '/pricing' },
        failOnStatusCode: false,
        timeout: 180_000,
      })
      .catch(() => {
        /* Warmup only: a failure here is not this suite's concern. */
      })
  })

  test('signed-out plan click carries intent to signup instead of dead-ending', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    const cta = page.locator('[data-testid^="pricing-subscription-cta-"]').first()
    await expect(cta).toBeVisible({ timeout: 30_000 })
    await clickHydrated(cta)

    /*
     * The 401 is answered with a redirect, not a message. Waiting on the URL
     * rather than on an absence proves the visitor was actually moved on.
     */
    await page.waitForURL(/\/signup/, { timeout: 60_000 })

    const url = new URL(page.url())
    const callback = url.searchParams.get('callbackUrl')
    expect(callback, 'signup should know where to send them back').toBeTruthy()
    expect(callback, 'should return to the pricing page').toContain('/pricing')
    expect(callback, 'the chosen plan should survive the round trip').toContain('plan=')

    // The raw endpoint string must never be what the visitor is left looking at.
    await expect(page.locator('body')).not.toContainText('Unauthorized')
  })

  test('returning from signup marks the plan that was chosen', async ({ page }) => {
    await page.goto('/pricing?plan=af_pro_monthly', { waitUntil: 'domcontentloaded' })
    const picked = page.locator('[data-testid="pricing-picked-card"]')
    await expect(picked, 'the chosen lane should be marked on return').toHaveCount(1)
    await expect(picked).toContainText('AF Pro')
  })

  test('a page that takes payment links to its legal terms', async ({ page, request }) => {
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    for (const path of ['/terms', '/privacy']) {
      const link = page.locator(`a[href^="${path}"]`)
      await expect(link.first(), `pricing must link to ${path}`).toBeVisible()
      const res = await request.get(path)
      expect(res.status(), `${path} should be reachable`).toBeLessThan(400)
    }
  })

  test('declares its own FAQ and offer structured data', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    const raw = await page.locator('script#json-ld-page').first().textContent()
    expect(raw, 'pricing should emit page-level JSON-LD').toBeTruthy()

    const parsed = JSON.parse(raw as string)
    const nodes: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [parsed]
    const types = nodes.map((n) => n['@type'])
    expect(types, 'FAQPage should be declared').toContain('FAQPage')
    expect(types, 'the priced plans should be declared').toContain('Product')

    /*
     * The offers must carry real prices. An empty offers array would still be
     * valid JSON-LD and would still pass a "Product is present" check, while
     * telling a crawler nothing about what anything costs.
     */
    const product = nodes.find((n) => n['@type'] === 'Product') as
      | { offers?: Array<{ price?: string }> }
      | undefined
    expect(product?.offers?.length ?? 0).toBeGreaterThanOrEqual(1)
    for (const offer of product?.offers ?? []) {
      expect(Number(offer.price), 'every offer needs a real price').toBeGreaterThan(0)
    }
  })

  test('Spanish pricing is its own document and keeps its language through checkout', async ({
    page,
  }) => {
    const canonicalOf = () => page.locator('link[rel="canonical"]').first().getAttribute('href')
    const altOf = (lang: string) =>
      page.locator(`link[rel="alternate"][hreflang="${lang}"]`).first().getAttribute('href')

    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    const enCanonical = await canonicalOf()
    const enAltEn = await altOf('en')
    const enAltEs = await altOf('es')

    await page.goto('/es/pricing', { waitUntil: 'domcontentloaded' })
    const esCanonical = await canonicalOf()

    expect(esCanonical, '/es/pricing must not claim the English canonical').not.toBe(enCanonical)
    expect(esCanonical).toMatch(/\/es\/pricing$/)
    expect(enAltEs, "en page's es alternate should point at /es/pricing").toMatch(/\/es\/pricing$/)
    expect(await altOf('es'), 'hreflang=es must agree across both documents').toBe(enAltEs)
    expect(await altOf('en'), 'hreflang=en must agree across both documents').toBe(enAltEn)

    // Actually Spanish, not just correctly labelled.
    await expect(page.locator('body')).toContainText(/Precios|Gana más/i)

    /*
     * ⚠ THE RETURN PATH IS THE EASY HALF TO GET WRONG. Sending a Spanish reader
     * to signup and landing them back on the ENGLISH pricing page would undo
     * this route at the last step of the funnel, and the bug reads as correct
     * code because the literal `/pricing` is right in the English case.
     */
    const cta = page.locator('[data-testid^="pricing-subscription-cta-"]').first()
    await expect(cta).toBeVisible({ timeout: 30_000 })
    await clickHydrated(cta)
    await page.waitForURL(/\/signup/, { timeout: 60_000 })
    const callback = new URL(page.url()).searchParams.get('callbackUrl') ?? ''
    expect(callback, 'a Spanish reader must return to the Spanish pricing page').toContain(
      '/es/pricing',
    )
  })
})
