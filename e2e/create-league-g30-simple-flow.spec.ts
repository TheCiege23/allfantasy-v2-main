import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })
test.use({ serviceWorkers: 'block' })

type CreateBody = Record<string, unknown>

declare global {
  interface Window {
    __g30CreateBodies?: CreateBody[]
  }
}

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

async function stubEntitlements(page: Page, hasCommissioner: boolean) {
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

async function installCreateLeagueFetchStub(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.__g30CreateBodies = JSON.parse(window.sessionStorage.getItem('g30CreateBodies') ?? '[]') as CreateBody[]
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(rawUrl, window.location.origin)
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.pathname === '/api/leagues' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as CreateBody
        window.__g30CreateBodies?.push(body)
        window.sessionStorage.setItem('g30CreateBodies', JSON.stringify(window.__g30CreateBodies ?? []))
        return new Response(
          JSON.stringify({
            success: true,
            league: { id: `g30-${body.teamCount}`, leagueName: body.leagueName },
            homepageUrl: `/league/g30-${body.teamCount}?created=1`,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      return originalFetch(input, init)
    }
  })

  await page.route('**/league/g30-*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><main data-testid="g30-post-create-destination">League Home</main></body></html>',
    })
  })
}

async function openCreate(page: Page) {
  await page.goto('/create-league?e2eAuth=1')
  await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible({ timeout: 30_000 })
}

async function fillRequiredCreateFields(page: Page, teamCount: number, name: string) {
  await page.getByTestId('g30-step-basics').click()
  await page.getByTestId('g30-league-type-redraft').click()
  await page.getByTestId('g30-league-name').fill(name)
  await page.getByTestId('g30-team-count').fill(String(teamCount))
  await page.getByTestId('g30-privacy-private').click()

  await page.getByTestId('g30-step-draft').click()
  await page.getByTestId('g30-draft-type').selectOption('snake')
  await page.getByTestId('g30-draft-date').fill('2026-08-30')
  await page.getByTestId('g30-draft-time').fill('20:00')
  await page.getByTestId('g30-timezone').selectOption('America/New_York')
}

async function submitCreate(page: Page) {
  await page.getByTestId('g30-step-review').click()
  await expect(page.getByTestId('g30-review-issues')).toHaveCount(0)
  await page.getByTestId('g30-create-league-submit-primary').click()
}

test('creates NFL redraft with universal team counts 2 and 32', async ({ page }) => {
  await stubEntitlements(page, false)
  await installCreateLeagueFetchStub(page)

  for (const teamCount of [2, 32]) {
    await openCreate(page)
    await fillRequiredCreateFields(page, teamCount, `G30 ${teamCount} Team League`)
    await submitCreate(page)
    await expect(page).toHaveURL(new RegExp(`/league/g30-${teamCount}`), { timeout: 20_000 })
  }

  const bodies = await page.evaluate(() => window.__g30CreateBodies ?? [])
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toMatchObject({
    concept: 'redraft',
    sport: 'NFL',
    teamCount: 2,
    draftType: 'snake',
    leagueName: 'G30 2 Team League',
    timezone: 'America/New_York',
  })
  expect(bodies[1]).toMatchObject({ teamCount: 32 })
  expect(bodies[0].conceptSetup).toMatchObject({
    visibility: 'private',
    draftDate: '2026-08-30',
    draftTime: '20:00',
    draftTimezone: 'America/New_York',
  })
})

test('shows import provider states without broken unsupported actions', async ({ page }) => {
  await stubEntitlements(page, false)
  await openCreate(page)

  await page.getByTestId('g30-import-league-button').click()
  await expect(page.getByTestId('g30-import-modal')).toBeVisible()
  await expect(page.getByTestId('g30-import-provider-sleeper')).toContainText('Available')
  await expect(page.getByTestId('g30-import-provider-espn')).toContainText('Limited beta')
  await expect(page.getByTestId('g30-import-provider-fantrax')).toContainText('Limited beta')
  await expect(page.getByTestId('g30-import-provider-yahoo')).toContainText('Limited beta')
  await expect(page.getByTestId('g30-import-provider-mfl')).toContainText('Limited beta')
  await expect(page.getByTestId('g30-import-provider-manual')).toContainText('Coming soon')
  await expect(page.getByTestId('g30-import-provider-manual').getByRole('button')).toBeDisabled()
})

test('locks advanced setup for non-commissioner and enables it for AF Commissioner', async ({ page }) => {
  await stubEntitlements(page, false)
  await openCreate(page)
  await page.getByTestId('g30-step-summary').click()
  await expect(page.getByTestId('g30-commissioner-upsell')).toBeVisible()
  await expect(page.getByTestId('g30-advanced-superflex').locator('input')).toBeDisabled()

  await page.unroute('**/api/subscription/entitlements**')
  await stubEntitlements(page, true)
  await openCreate(page)
  await page.getByTestId('g30-step-summary').click()
  await expect(page.getByTestId('g30-commissioner-upsell')).toHaveCount(0)
  await expect(page.getByTestId('g30-advanced-superflex').locator('input')).toBeEnabled()
  await page.getByTestId('g30-advanced-superflex').locator('input').check()
  await expect(page.getByTestId('g30-league-preview')).toContainText('1')
})

test('renders from SSR dark cookie, Spanish language cookie, and mobile layout without runtime crashes', async ({ page, baseURL }) => {
  const errors = watchRuntimeErrors(page)
  await stubEntitlements(page, false)
  await page.context().addCookies([
    {
      name: 'af_mode',
      value: 'dark',
      url: baseURL ?? 'http://127.0.0.1:3101',
    },
    {
      name: 'af_lang',
      value: 'es',
      url: baseURL ?? 'http://127.0.0.1:3101',
    },
  ])
  await page.setViewportSize({ width: 390, height: 844 })
  const response = await page.goto('/create-league?e2eAuth=1')
  expect(response?.ok()).toBeTruthy()
  const html = await response!.text()
  expect(html).toMatch(/<html[^>]*data-mode="dark"/)
  expect(html).toMatch(/<html[^>]*lang="es"/)

  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible()
  await expect(page.getByRole('heading', { name: /create a league in minutes|crea una liga en minutos/i })).toBeVisible()
  await expect(page.getByTestId('g30-league-preview')).toBeVisible()
  await expect(page.getByText(/createLeague\.g30/)).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)
  expect(errors.filter((entry) => !/favicon|ResizeObserver/i.test(entry))).toEqual([])
})
