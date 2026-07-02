import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/g32-nfl-redraft-league-home'

async function routeEntitlements(page: Page, plans: string[]) {
  await page.route('**/api/subscription/entitlements', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: {
          plans,
          status: plans.length > 0 ? 'active' : 'none',
          currentPeriodEnd: null,
          gracePeriodEnd: null,
        },
      }),
    })
  })
}

async function gotoHarness(page: Page, query = '') {
  await page.goto(`${HARNESS_PATH}${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g32-league-home-harness').waitFor({ state: 'visible', timeout: 120_000 })
}

test.describe('@g32 @nfl-redraft league home overhaul', () => {
  test('commissioner command center renders tabs, intro video, settings labels, chat, and dark shell', async ({ page }) => {
    await routeEntitlements(page, ['supreme'])
    await gotoHarness(page, '?playIntro=1')

    await expect(page.locator('[data-mode="dark"]')).toBeVisible()
    await expect(page.getByTestId('concept-intro-video')).toBeVisible()
    await expect(page.getByTestId('concept-intro-video')).toHaveAttribute('src', '/media/league-intros/redraft-league-intro.mp4')
    await page.getByTestId('concept-intro-skip').click()

    const tabNav = page.getByRole('navigation', { name: 'G32 league tabs' })
    for (const tab of ['Home', 'Draft', 'Roster', 'Matchups', 'Waivers', 'Trades', 'Standings', 'League Chat', 'Commissioner']) {
      await expect(tabNav.getByRole('button', { name: tab, exact: true })).toBeVisible()
    }
    await expect(page.getByText('AI Coaching')).toHaveCount(0)

    await expect(page.getByRole('heading', { name: 'Commissioner Command Center' })).toBeVisible()
    await expect(page.getByTestId('g32-commissioner-intelligence-section')).toContainText('League Intelligence')
    await expect(page.getByTestId('g32-commissioner-intelligence-section')).toContainText('Weekly League Report')

    await page.getByTestId('g32-home-card-draft-setup').click()
    await expect(page.getByTestId('g32-settings-modal')).toBeVisible()
    for (const label of ['General', 'Draft', 'Roster', 'Scoring', 'Waivers', 'Trades', 'Playoffs', 'Members', 'Notifications', 'Permissions']) {
      await expect(page.getByTestId('g32-settings-modal')).toContainText(label)
    }
    for (const premium of ['Commissioner Intelligence', 'Decision OS', 'League Health', 'Trade Health', 'Fair Play Monitoring', 'Draft Readiness', 'Weekly League Report']) {
      await expect(page.getByTestId('g32-settings-modal')).toContainText(premium)
    }
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByTestId('g32-chat-visibility-card').getByRole('button', { name: 'Open League Chat' }).click()
    await expect(page.getByTestId('g32-active-tab')).toContainText('league_chat')
  })

  test('free manager mobile view keeps Commissioner hidden and Manager Intelligence locked', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await routeEntitlements(page, [])
    await gotoHarness(page, '?role=manager')

    await expect(page.getByTestId('g32-nfl-redraft-home')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'G32 league tabs' }).getByRole('button', { name: 'Commissioner' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Draft HQ' }).first()).toBeVisible()
    await expect(page.getByTestId('g32-manager-intelligence-section')).toContainText('Locked Manager Intelligence preview')
    await expect(page.getByTestId('g32-manager-intelligence-section')).toContainText('AF Pro preview')
    await expect(page.getByTestId('g32-chat-visibility-card')).toBeVisible()
  })

  test('AF Pro manager light-mode view unlocks Manager Intelligence and keeps tabs usable', async ({ page }) => {
    await routeEntitlements(page, ['pro'])
    await gotoHarness(page, '?role=manager&mode=light')

    await expect(page.locator('[data-mode="light"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Manager Intelligence' }).first()).toBeVisible()
    await expect(page.getByTestId('g32-manager-intelligence-section')).toContainText('Unlocked')

    const tabNav = page.getByRole('navigation', { name: 'G32 league tabs' })
    for (const tab of ['Draft', 'Roster', 'Matchups', 'Waivers', 'Trades', 'Standings', 'League Chat']) {
      await tabNav.getByRole('button', { name: tab, exact: true }).click()
      await expect(page.getByTestId('g32-active-tab')).toContainText(tab.toLowerCase().replace(/\s+/g, '_'))
    }
  })

  test('reduced-motion mode shows a static intro preview instead of autoplay video', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await routeEntitlements(page, ['commissioner'])
    await gotoHarness(page, '?playIntro=1')

    await expect(page.getByTestId('concept-intro-reduced-motion')).toBeVisible()
    await expect(page.getByTestId('concept-intro-video')).toHaveCount(0)
  })
})
