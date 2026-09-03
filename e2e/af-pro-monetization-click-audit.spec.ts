import { expect, test, type Page } from '@playwright/test'

function featureFromRequestUrl(url: string): string {
  const parsed = new URL(url)
  return String(parsed.searchParams.get('feature') ?? '')
}

async function mockAfProMonetization(page: Page) {
  await page.route('**/api/monetization/context**', async (route) => {
    const reqUrl = route.request().url()
    const parsed = new URL(reqUrl)
    const featureId = featureFromRequestUrl(reqUrl) || 'ai_chat'
    const ruleCodes = parsed.searchParams.getAll('ruleCode')
    const primaryRuleCode = ruleCodes[0] ?? 'ai_chimmy_chat_message'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: {
          plans: [],
          status: 'none',
          currentPeriodEnd: null,
          gracePeriodEnd: null,
        },
        entitlementMessage: 'Upgrade to AF Pro to unlock player-specific AI.',
        feature: {
          featureId,
          hasAccess: false,
          requiredPlan: 'AF Pro',
          upgradePath: `/upgrade?plan=pro&feature=${encodeURIComponent(featureId)}`,
          message: 'AF Pro is required for this AI workflow.',
        },
        tokenBalance: {
          balance: 0,
          lifetimePurchased: 0,
          lifetimeSpent: 0,
          lifetimeRefunded: 0,
          updatedAt: new Date().toISOString(),
        },
        tokenPreviews: [
          {
            ruleCode: primaryRuleCode,
            preview: {
              ruleCode: primaryRuleCode,
              featureLabel: 'AF Pro AI action',
              tokenCost: 2,
              currentBalance: 0,
              canSpend: false,
              requiresConfirmation: true,
            },
            error: null,
          },
        ],
      }),
    })
  })
}

test.describe('@monetization af pro monetization click audit', () => {
  test('af pro spotlight and in-context upgrade/token routes are wired', async ({ page }) => {
    await mockAfProMonetization(page)
    await page.goto('/e2e/af-pro-monetization', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /e2e af pro monetization harness/i })).toBeVisible()

    await expect(page.getByTestId('af-pro-spotlight')).toBeVisible()
    await expect(page.getByTestId('af-pro-upgrade-link')).toHaveAttribute('href', /\/upgrade\?plan=pro/)
    await expect(page.getByTestId('af-pro-token-link')).toHaveAttribute('href', /\/tokens/)

    await expect(page.getByTestId('af-plan-diff-af-pro')).toBeVisible()
    await expect(page.getByTestId('af-plan-diff-af-commissioner')).toBeVisible()
    await expect(page.getByTestId('af-plan-diff-af-legacy')).toBeVisible()

    const cardPrefixes = ['afpro-trade', 'afpro-matchup', 'afpro-planning', 'afpro-player-ai']
    for (const prefix of cardPrefixes) {
      await expect(page.getByTestId(`${prefix}-upgrade-cta`)).toHaveAttribute(
        'href',
        /\/upgrade\?plan=pro&feature=/
      )
      await expect(page.getByTestId(`${prefix}-buy-tokens-cta`)).toHaveAttribute(
        'href',
        /\/tokens\?ruleCode=/
      )
    }
  })
})

