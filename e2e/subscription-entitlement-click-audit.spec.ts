import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

type EntitlementMock = {
  plans: string[]
  status: 'active' | 'grace' | 'past_due' | 'expired' | 'none'
  hasAccess: boolean
  message: string
  requiredPlan?: string | null
  upgradePath?: string
}

async function waitForHarnessReady(page: Page) {
  await expect(page.getByTestId('subscription-entitlement-harness')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('harness-loading')).toHaveCount(0, { timeout: 25_000 })
}

async function mockEntitlements(page: Page, input: EntitlementMock) {
  await page.route(/\/api\/subscription\/entitlements/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: {
          plans: input.plans,
          status: input.status,
          currentPeriodEnd: null,
          gracePeriodEnd: null,
        },
        hasAccess: input.hasAccess,
        message: input.message,
        requiredPlan: input.requiredPlan ?? null,
        upgradePath: input.upgradePath ?? '/pricing',
      }),
    })
  })
}

test.describe('@monetization subscription entitlement click audit', () => {
  test('locked feature shows upgrade flow and backend gate denial (no dead buttons)', async ({ page }) => {
    await mockEntitlements(page, {
      plans: [],
      status: 'none',
      hasAccess: false,
      message: 'AF Pro is required to access this feature.',
      requiredPlan: 'AF Pro',
      upgradePath: '/upgrade?plan=pro&feature=ai_chat',
    })
    await page.route('**/api/subscription/feature-gate', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Feature locked',
          message: 'AF Pro is required to access this feature.',
        }),
      })
    })

    await page.goto('/e2e/subscription-entitlement', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    const upgradeLink = page.getByRole('link', { name: 'View plans' })
    await expect(upgradeLink).toBeVisible()
    await expect(upgradeLink).toHaveAttribute(
      'href',
      /\/upgrade\?plan=pro&feature=ai_chat/
    )
    await expect(page.getByTestId('locked-feature-status-message')).toContainText('AF Pro')

    await page.getByTestId('backend-feature-gate-check-button').click()
    await expect(page.getByTestId('backend-feature-gate-result')).toContainText('AF Pro is required')
    const upgradeHref = await upgradeLink.getAttribute('href')
    expect(upgradeHref).toBe('/upgrade?plan=pro&feature=ai_chat')
    await page.goto(String(upgradeHref), { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/upgrade\?plan=pro&feature=ai_chat/)
  })

  test('locked feature token fallback CTA routes to tokens page', async ({ page }) => {
    await mockEntitlements(page, {
      plans: [],
      status: 'none',
      hasAccess: false,
      message: 'AF Pro is required to access this feature.',
      requiredPlan: 'AF Pro',
      upgradePath: '/upgrade?plan=pro&feature=ai_chat',
    })

    await page.goto('/e2e/subscription-entitlement', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    const tokenFallbackLink = page.getByTestId('locked-feature-token-fallback-link')
    await expect(tokenFallbackLink).toBeVisible()
    await expect(tokenFallbackLink).toHaveAttribute(
      'href',
      /\/tokens\?ruleCode=ai_chimmy_chat_message/
    )

    /*
     * ⚠ /tokens IS SIGNED-IN-ONLY, SO ANONYMOUSLY THIS CLICK LANDS ON /login.
     *
     * The href assertion above passes and the click fires, but the browser ends up at
     * /login?callbackUrl=/tokens — which never matches this pattern, so the test
     * reported a 15s timeout on a CTA that was working exactly as designed. Signing in
     * is what makes the assertion describe the journey a real buyer takes.
     */
    await signInAs(page, { id: 'e2e-entitlement-user' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    const tokenFallbackAfterSignIn = page.getByTestId('locked-feature-token-fallback-link')
    await Promise.all([
      page.waitForURL(/\/tokens\?ruleCode=ai_chimmy_chat_message/, { timeout: 15_000 }),
      tokenFallbackAfterSignIn.click(),
    ])
  })

  test('entitled feature path is wired', async ({ page }) => {
    await mockEntitlements(page, {
      plans: ['pro'],
      status: 'active',
      hasAccess: true,
      message: 'Access granted.',
      requiredPlan: 'AF Pro',
      upgradePath: '/upgrade?plan=pro&feature=ai_chat',
    })
    await page.goto('/e2e/subscription-entitlement', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    await expect(page.getByTestId('entitled-feature-link')).toBeVisible()
    await expect(page.getByTestId('entitled-feature-link')).toHaveAttribute('href', /\/app\/home/)
  })

  test('expired status messaging is rendered in locked state', async ({ page }) => {
    await mockEntitlements(page, {
      plans: ['pro'],
      status: 'expired',
      hasAccess: false,
      message: 'Subscription expired. Renew to restore premium access.',
      requiredPlan: 'AF Pro',
      upgradePath: '/upgrade?plan=pro&feature=ai_chat',
    })
    await page.route('**/api/subscription/feature-gate', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Feature locked',
          message: 'Subscription expired. Renew to restore premium access.',
        }),
      })
    })

    await page.goto('/e2e/subscription-entitlement', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    await expect(page.getByTestId('entitlement-status')).toContainText('expired')
    await expect(page.getByTestId('locked-feature-status-message')).toContainText('expired')
  })

  test('bundle users inherit pro, commissioner, and war room access', async ({ page }) => {
    await mockEntitlements(page, {
      plans: ['all_access'],
      status: 'active',
      hasAccess: true,
      message: 'Access granted.',
      requiredPlan: 'AF Pro',
      upgradePath: '/all-access?feature=ai_chat',
    })
    await page.route('**/api/subscription/feature-gate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ allowed: true, message: 'Access granted.' }),
      })
    })

    await page.goto('/e2e/subscription-entitlement', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page)
    await expect(page.getByTestId('bundle-check-pro')).toContainText('granted')
    await expect(page.getByTestId('bundle-check-commissioner')).toContainText('granted')
    await expect(page.getByTestId('bundle-check-warroom')).toContainText('granted')
  })
})
