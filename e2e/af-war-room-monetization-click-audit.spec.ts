import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

function featureFromRequestUrl(url: string): string {
  const parsed = new URL(url)
  return String(parsed.searchParams.get('feature') ?? '')
}

async function mockAfWarRoomMonetization(page: Page) {
  /*
   * ⚠ UNMOCKED, AND IT STALLS THE GATE RATHER THAN FAILING IT.
   *
   * FeatureGate renders "Checking premium access..." while `loading || accessTier.loading`,
   * and useAccessTier's only input is GET /api/guest-mode/status. Left unmocked it goes to
   * the real dev server, which reads a cookie and hits the database; until it answers the
   * gate renders neither the children nor LockedFeatureCard, so the locked region this
   * test asserts simply never exists. Same shape as the unmocked bootstrap routes in the
   * draft-room specs: the failure surfaces as a missing element one gate downstream.
   */
  await page.route('**/api/guest-mode/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isGuest: false, sleeperUsername: null, displayName: null }),
    })
  })

  await page.route('**/api/config/features', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features: { aiAssistant: true } }),
    })
  })

  await page.route('**/api/subscription/entitlements**', async (route) => {
    const reqUrl = route.request().url()
    const featureId = featureFromRequestUrl(reqUrl) || 'future_planning'
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
        hasAccess: false,
        message: 'Upgrade to AF War Room to unlock this strategy workflow.',
        requiredPlan: 'AF War Room',
        upgradePath: `/upgrade?plan=war_room&feature=${encodeURIComponent(featureId)}`,
      }),
    })
  })

  await page.route('**/api/tokens/spend/preview**', async (route) => {
    const parsed = new URL(route.request().url())
    const ruleCode = String(parsed.searchParams.get('ruleCode') ?? 'ai_war_room_multi_step_planning')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          ruleCode,
          featureLabel: 'AF War Room AI action',
          tokenCost: 6,
          currentBalance: 0,
          canSpend: false,
          requiresConfirmation: true,
        },
      }),
    })
  })

  await page.route('**/api/monetization/context**', async (route) => {
    const reqUrl = route.request().url()
    const parsed = new URL(reqUrl)
    const featureId = featureFromRequestUrl(reqUrl) || 'future_planning'
    const ruleCodes = parsed.searchParams.getAll('ruleCode')
    const primaryRuleCode = ruleCodes[0] ?? 'ai_war_room_multi_step_planning'
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
        entitlementMessage: 'Upgrade to AF War Room for premium strategy and drafting tools.',
        feature: {
          featureId,
          hasAccess: false,
          requiredPlan: 'AF War Room',
          upgradePath: `/upgrade?plan=war_room&feature=${encodeURIComponent(featureId)}`,
          message: 'AF War Room is required for this strategy workflow.',
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
              featureLabel: 'AF War Room AI action',
              tokenCost: 6,
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

test.describe('@monetization af war room monetization click audit', () => {
  test('war room spotlight plus draft and strategy upgrade routes are wired', async ({ page }) => {
    await mockAfWarRoomMonetization(page)
    /*
     * ⚠ SIGN IN — A GUEST IS SHOWN "Sign up free", NEVER AN UPGRADE CTA, BY DESIGN.
     * FeatureGate branches on `accessTier.isGuest` and its own comment says why: "Guests
     * (no account) never get an 'upgrade' CTA — there's nothing to upgrade yet." It then
     * renders LockedFeatureCard with `isGuestLocked`, which emits
     * locked-feature-signup-link instead of locked-feature-upgrade-link.
     *
     * lib/access/accessTier.ts:38 returns isGuest:true for an unauthenticated visitor, so
     * this spec — which asserts UPGRADE hrefs — was reading the guest surface and failing
     * on a link the product deliberately does not render for guests. Mocking
     * /api/guest-mode/status to `isGuest:false` does not help: LockedFeatureCard takes
     * isGuestLocked as a PROP from FeatureGate, which reads the session, not that route.
     *
     * A session makes this a signed-in, unentitled user — the state whose upgrade routes
     * this test exists to audit.
     */
    await signInAs(page, { id: 'e2e-af-war-room-user' })
    await page.goto('/e2e/af-war-room-monetization', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /e2e af war room monetization harness/i })).toBeVisible()

    await expect(page.getByTestId('af-war-room-spotlight')).toBeVisible()
    await expect(page.getByTestId('af-war-room-upgrade-link')).toHaveAttribute('href', /\/upgrade\?plan=war_room/)
    await expect(page.getByTestId('af-war-room-token-link')).toHaveAttribute(
      'href',
      /\/tokens\?ruleCode=ai_war_room_multi_step_planning/
    )

    await expect(page.getByTestId('af-war-room-plan-diff-af-legacy')).toBeVisible()
    await expect(page.getByTestId('af-war-room-plan-diff-af-pro')).toBeVisible()
    await expect(page.getByTestId('af-war-room-plan-diff-af-commissioner')).toBeVisible()

    const cardPrefixes = ['draft-prep-monetization', 'draft-helper-monetization', 'legacy-war-room-monetization']
    for (const prefix of cardPrefixes) {
      await expect(page.getByTestId(`${prefix}-upgrade-cta`)).toHaveAttribute(
        'href',
        /\/upgrade\?plan=war_room&feature=/
      )
      await expect(page.getByTestId(`${prefix}-buy-tokens-cta`)).toHaveAttribute(
        'href',
        /\/tokens\?ruleCode=/
      )
    }

    /*
     * ⚠ DISPLAY RENAME, NOT A MISSING CARD: "AF War Room" became "AF Legacy" in
     * 55c822df6 (display only — the war_room entitlement and the Stripe plan are
     * unchanged, which is why the /upgrade?plan=war_room assertion below still holds).
     * LockedFeatureCard builds its region label from featureName, and
     * LegacyStrategyTab now passes featureNameOverride="AF Legacy future planning".
     */
    const futurePlanningLockCard = page.getByRole('region', { name: /af legacy future planning is locked/i })
    await expect(futurePlanningLockCard).toBeVisible()
    await expect(futurePlanningLockCard.getByTestId('locked-feature-upgrade-link')).toHaveAttribute(
      'href',
      /\/upgrade\?plan=war_room&feature=future_planning/
    )
  })
})
