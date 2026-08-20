import { expect, test } from "@playwright/test"

test.describe.configure({ timeout: 120_000 })

/*
 * ⚠ RETIRED, NOT FLAKY, AND NOT FIXABLE BY A SELECTOR. The panel this drives no
 * longer exists.
 *
 * `AdminCheckoutLinkMappingPanel.tsx` was removed on 2026-04-26 by 25db02263 —
 * an admin restructure that deleted 261 files and added 118, and which also
 * rewrote app/admin/page.tsx. The removal was clean (nothing imports the panel,
 * so there is no dangling reference to repair); the feature was dropped and this
 * spec was never retired with it. Verified: none of
 * `admin-checkout-link-mapping-panel`, `-missing-count`, `-row-*` or `-refresh`
 * appear anywhere under app/ or components/.
 *
 * ⚠ WHAT IS NO LONGER COVERED, WHICH IS THE PART THAT MATTERS. This was the only
 * automated check that every purchasable SKU maps to a valid Stripe checkout
 * link, and that the admin surface surfaces the ones that do not. Pricing
 * display-vs-charge drift is a problem this repo has had before. Nothing has
 * replaced that check in the UI; scripts/verify-stripe-price-parity is the
 * closest thing and it is not run from here.
 *
 * Skipped rather than deleted so the gap stays visible in the suite. Delete this
 * file only alongside a decision that the diagnostic is not coming back.
 */
test.describe.skip("@admin checkout-link mapping click audit", () => {
  test("providers tab renders checkout-link diagnostics and refreshes", async ({ page }) => {
    let mappingRequests = 0

    await page.route("**/api/admin/providers/diagnostics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: Date.now(),
          providers: [
            {
              id: "openai",
              state: "available",
              configured: true,
              available: true,
              healthy: true,
              degradedReasons: [],
              fallbackUsedCount: 0,
              recentFailureCount: 0,
              latencyTrend: "stable",
              avgLatencyMs: 180,
              lastLatencyMs: 170,
              lastFailureAt: null,
              error: null,
            },
          ],
          degradedMode: { active: false, recentEvents: [] },
          recentFailures: [],
          fallbackEvents: [],
        }),
      })
    })

    await page.route("**/api/admin/draft-automation/diagnostics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          providerStatus: {
            openai: true,
            deepseek: true,
            xai: false,
            clearsports: true,
            anyAi: true,
          },
          usage24h: {
            draftCalls: 100,
            draftErrors: 2,
            draftAiCalls: 20,
            deterministicSharePct: 80,
          },
          executionMatrix: [
            {
              feature: "draft_assistant",
              lane: "ai_optional",
              aiOptional: true,
              description: "AI optional draft recommendations.",
            },
          ],
        }),
      })
    })

    await page.route("**/api/admin/monetization/checkout-link-mapping", async (route) => {
      mappingRequests += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          summary: {
            totalProducts: 11,
            configuredProducts: 10,
            missingProducts: 1,
          },
          missingSkus: ["af_tokens_25"],
          products: [
            {
              sku: "af_pro_monthly",
              type: "subscription",
              title: "AF Pro Monthly",
              amountUsd: 9.99,
              interval: "month",
              tokenAmount: null,
              checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_PRO_MONTHLY",
              expectedPurchaseType: "subscription",
              mappedPurchaseType: "subscription",
              checkoutConfigured: true,
              checkoutDestination: "https://buy.stripe.com/test_pro_monthly",
              issue: null,
            },
            {
              sku: "af_tokens_25",
              type: "token_pack",
              title: "AllFantasy AI Tokens (25)",
              amountUsd: 19.99,
              interval: null,
              tokenAmount: 25,
              checkoutLinkEnvVar: "STRIPE_CHECKOUT_LINK_AF_TOKENS_25",
              expectedPurchaseType: "tokens",
              mappedPurchaseType: "tokens",
              checkoutConfigured: false,
              checkoutDestination: null,
              issue: "checkout_link_missing_or_invalid",
            },
          ],
        }),
      })
    })

    await page.goto("/e2e/admin-dashboard?tab=providers", { waitUntil: "domcontentloaded" })
    const openButton = page.getByTestId("admin-open-dashboard-button")
    const panel = page.getByTestId("admin-checkout-link-mapping-panel")

    for (let i = 0; i < 20; i += 1) {
      if (await panel.isVisible().catch(() => false)) break
      if (await openButton.isVisible().catch(() => false)) {
        await openButton.click().catch(() => {})
      }
      await page.waitForTimeout(250)
    }

    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("admin-checkout-link-mapping-missing-count")).toHaveText("1")
    await expect(page.getByTestId("admin-checkout-link-mapping-row-af_tokens_25")).toContainText(
      "Missing/invalid checkout link"
    )
    await expect.poll(() => mappingRequests).toBeGreaterThan(0)

    await page.getByTestId("admin-checkout-link-mapping-refresh").click()
    await expect.poll(() => mappingRequests).toBeGreaterThan(1)
  })
})
