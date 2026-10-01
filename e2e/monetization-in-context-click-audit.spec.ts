import { expect, test, type Page } from '@playwright/test'

type ContextMockInput = {
  hasAccess: boolean
  balance: number
  canSpend: boolean
  upgradePath?: string
}

async function mockMonetizationContext(
  page: Page,
  input: ContextMockInput | (() => ContextMockInput)
) {
  await page.route('**/api/monetization/context**', async (route) => {
    const value = typeof input === 'function' ? input() : input
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: {
          plans: value.hasAccess ? ['pro'] : [],
          status: value.hasAccess ? 'active' : 'none',
          currentPeriodEnd: null,
          gracePeriodEnd: null,
        },
        entitlementMessage: value.hasAccess ? 'Access granted.' : 'Upgrade to access this feature.',
        feature: {
          featureId: 'ai_chat',
          hasAccess: value.hasAccess,
          requiredPlan: 'AF Pro',
          upgradePath: value.upgradePath ?? '/upgrade?plan=pro&feature=ai_chat',
          message: value.hasAccess ? 'Access granted.' : 'AF Pro is required to access this feature.',
        },
        tokenBalance: {
          balance: value.balance,
          lifetimePurchased: 0,
          lifetimeSpent: 0,
          lifetimeRefunded: 0,
          updatedAt: '2026-03-30T12:00:00.000Z',
        },
        tokenPreviews: [
          {
            ruleCode: 'ai_chimmy_chat_message',
            preview: {
              ruleCode: 'ai_chimmy_chat_message',
              featureLabel: 'Chimmy chat message',
              tokenCost: 1,
              currentBalance: value.balance,
              canSpend: value.canSpend,
              requiresConfirmation: true,
            },
            error: null,
          },
        ],
      }),
    })
  })
}

async function mockSpendPreview(page: Page, canSpend: boolean, balance: number) {
  await page.route('**/api/tokens/spend/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          ruleCode: 'ai_chimmy_chat_message',
          featureLabel: 'Chimmy chat message',
          tokenCost: 1,
          currentBalance: balance,
          canSpend,
          requiresConfirmation: true,
        },
      }),
    })
  })
}

test.describe('@monetization in-context click audit', () => {
  test('locked state shows wired upgrade and buy tokens CTAs', async ({ page }) => {
    await mockMonetizationContext(page, {
      hasAccess: false,
      balance: 0,
      canSpend: false,
      upgradePath: '/upgrade?plan=pro&feature=ai_chat',
    })
    await mockSpendPreview(page, false, 0)
    await page.route('**/upgrade?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>upgrade</body></html>' })
    })
    await page.route('**/tokens?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>tokens</body></html>' })
    })

    await page.goto('/e2e/monetization-in-context', { waitUntil: 'domcontentloaded' })
    const upgradeCta = page.getByTestId('harness-monetization-upgrade-cta')
    const buyTokensCta = page.getByTestId('harness-monetization-buy-tokens-cta')
    await expect(upgradeCta).toBeVisible()
    await expect(buyTokensCta).toBeVisible()
    await expect(upgradeCta).toHaveAttribute('href', /\/upgrade\?plan=pro&feature=ai_chat/)
    await expect(buyTokensCta).toHaveAttribute('href', /\/tokens\?ruleCode=ai_chimmy_chat_message/)
  })

  test('token balance refresh button updates context state', async ({ page }) => {
    /*
     * The mock answers by PHASE, not by request count. The previous version returned 3 for the
     * first two requests and 9 from the third, which encoded how many times the card fetched on
     * mount under the old dev server (React 18 StrictMode ran the mount effect twice). After the
     * Next 15.5 / React 19.3 upgrade the mount effect runs once — measured: one
     * /api/monetization/context request on load — so the refresh click was the SECOND request,
     * still answered 3, and the test failed on "9 tokens" while the button worked. Flipping a flag
     * right before the click asserts what the test is about: the refresh refetches and the card
     * shows the new balance, however many requests the mount cost.
     */
    let refreshed = false
    await mockMonetizationContext(page, () => ({ hasAccess: false, balance: refreshed ? 9 : 3, canSpend: true }))
    await mockSpendPreview(page, true, 9)

    await page.goto('/e2e/monetization-in-context', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('harness-monetization-token-balance')).toContainText('3 tokens')
    refreshed = true
    await page.getByTestId('harness-monetization-refresh').click()
    await expect(page.getByTestId('harness-monetization-token-balance')).toContainText('9 tokens')
  })

  test('entitled state softens upsell and hides purchase CTAs', async ({ page }) => {
    await mockMonetizationContext(page, {
      hasAccess: true,
      balance: 6,
      canSpend: true,
    })
    await mockSpendPreview(page, true, 6)

    await page.goto('/e2e/monetization-in-context', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('harness-monetization-entitlement-state')).toContainText('Included with your plan')
    await expect(page.getByTestId('harness-monetization-upgrade-cta')).toHaveCount(0)
    await expect(page.getByTestId('harness-monetization-buy-tokens-cta')).toHaveCount(0)
  })

  test('insufficient balance flow routes to buy tokens', async ({ page }) => {
    await mockMonetizationContext(page, {
      hasAccess: false,
      balance: 0,
      canSpend: false,
    })
    await mockSpendPreview(page, false, 0)
    await page.route('**/tokens?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>tokens</body></html>' })
    })

    await page.goto('/e2e/monetization-in-context', { waitUntil: 'domcontentloaded' })
    const buyTokensCta = page.getByTestId('harness-monetization-buy-tokens-cta')
    await expect(buyTokensCta).toBeVisible()
    await buyTokensCta.click()
    await expect(page).toHaveURL(/\/tokens\?ruleCode=ai_chimmy_chat_message/)
  })
})

