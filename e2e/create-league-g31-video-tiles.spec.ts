import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })
test.use({ serviceWorkers: 'block' })

function watchRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return errors
}

function relevantRuntimeErrors(errors: string[]) {
  return errors.filter((entry) => !/favicon|ResizeObserver|FB\.getLoginStatus/i.test(entry))
}

async function stubEntitlements(page: Page, hasCommissioner = false) {
  await page.route('**/api/subscription/entitlements**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlement: {
          plans: hasCommissioner ? ['commissioner'] : [],
          status: hasCommissioner ? 'active' : 'none',
          currentPeriodEnd: null,
          gracePeriodEnd: null,
        },
        hasAccess: hasCommissioner,
        message: hasCommissioner ? 'Access granted.' : 'Upgrade to access this feature.',
        requiredPlan: 'AF Commissioner',
        upgradePath: '/pricing?plan=commissioner',
      }),
    })
  })
}

async function openCreate(page: Page) {
  await page.goto('/create-league?e2eAuth=1')
  await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible({ timeout: 30_000 })
}

async function expectVideoPlaying(page: Page, testId: string) {
  await expect.poll(
    async () =>
      page.getByTestId(testId).evaluate((video) => {
        const element = video as HTMLVideoElement
        return {
          currentSrc: element.currentSrc || element.getAttribute('src') || '',
          muted: element.muted,
          paused: element.paused,
          playsInline: element.playsInline,
          readyState: element.readyState,
        }
      }),
    { timeout: 15_000 },
  ).toMatchObject({
    muted: true,
    paused: false,
    playsInline: true,
  })
}

test('Create League sport video tile previews play on hover and focus without blocking selection', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await stubEntitlements(page)
  await openCreate(page)

  const nflTile = page.getByTestId('g30-sport-NFL')
  const nflVideo = page.getByTestId('g30-sport-NFL-video')
  await expect(nflTile).toBeVisible()
  await expect(nflVideo).toHaveAttribute('preload', 'metadata')
  await expect(nflVideo).toHaveAttribute('muted', '')
  await expect(nflVideo).toHaveAttribute('loop', '')

  await nflTile.hover()
  await expect(nflTile).toHaveAttribute('data-video-preview', 'playing')
  await expectVideoPlaying(page, 'g30-sport-NFL-video')

  await page.getByTestId('g30-step-basics').hover()
  await expect(nflTile).toHaveAttribute('data-video-preview', 'paused')

  await nflTile.focus()
  await expect(nflTile).toHaveAttribute('data-video-preview', 'playing')
  await expectVideoPlaying(page, 'g30-sport-NFL-video')

  const nbaTile = page.getByTestId('g30-sport-NBA')
  await nbaTile.hover()
  await nbaTile.click()
  await expect(nbaTile).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('g30-league-preview')).toContainText('NBA')

  expect(relevantRuntimeErrors(errors)).toEqual([])
})

test('reduced-motion disables Create League video autoplay previews', async ({ page }) => {
  const errors = watchRuntimeErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubEntitlements(page)
  await openCreate(page)

  const nflTile = page.getByTestId('g30-sport-NFL')
  const pausedBefore = await page.getByTestId('g30-sport-NFL-video').evaluate((video) => (video as HTMLVideoElement).paused)
  expect(pausedBefore).toBe(true)

  await nflTile.hover()
  await expect(nflTile).toHaveAttribute('data-video-disabled', 'true')
  await expect(nflTile).toHaveAttribute('data-video-preview', 'paused')
  const pausedAfter = await page.getByTestId('g30-sport-NFL-video').evaluate((video) => (video as HTMLVideoElement).paused)
  expect(pausedAfter).toBe(true)
  expect(relevantRuntimeErrors(errors)).toEqual([])
})

test('mobile tap selection, dark cookie rendering, and import modal remain usable', async ({ page, baseURL }) => {
  const errors = watchRuntimeErrors(page)
  await stubEntitlements(page)
  await page.context().addCookies([
    {
      name: 'af_mode',
      value: 'dark',
      url: baseURL ?? 'http://127.0.0.1:3111',
    },
  ])
  await page.setViewportSize({ width: 390, height: 844 })
  await openCreate(page)

  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible()
  await page.getByTestId('g30-sport-NBA').dispatchEvent('pointerdown', { pointerType: 'touch' })
  await page.getByTestId('g30-sport-NBA').click()
  await expect(page.getByTestId('g30-sport-NBA')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('g30-league-preview')).toContainText('NBA')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)

  await page.getByTestId('g30-import-league-button').click()
  await expect(page.getByTestId('g30-import-modal')).toBeVisible()
  await expect(page.getByTestId('g30-import-provider-sleeper')).toContainText('Available')
  expect(relevantRuntimeErrors(errors)).toEqual([])
})
