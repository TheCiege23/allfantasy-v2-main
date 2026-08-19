import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { registerAndLoginTo } from './helpers/auth-flow'

const E2E_HEADERS = { 'x-allfantasy-e2e': '1' }

type SeededLeague = {
  leagueId: string
  season: number
  seededScoreIds: string[]
}

let seeded: SeededLeague | null = null

async function cleanupSeeded(request: APIRequestContext): Promise<void> {
  if (!seeded) return
  await request
    .delete('/api/e2e/decision-os-proof-league', {
      headers: E2E_HEADERS,
      data: seeded,
    })
    .catch(() => undefined)
  seeded = null
}

function currentOrigin(page: Page): string {
  if (!page.url().startsWith('about:')) {
    return new URL(page.url()).origin
  }
  return process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '3101'}`
}

async function setSsrMode(page: Page, mode: 'light' | 'dark'): Promise<void> {
  const origin = currentOrigin(page)
  if (!page.url().startsWith('about:')) {
    const profileResponse = await page.request.patch('/api/user/profile', {
      data: { themePreference: mode },
    })
    expect(profileResponse.ok(), `Theme profile sync failed (${profileResponse.status()})`).toBeTruthy()
  }
  await page.context().addCookies([
    {
      name: 'af_mode',
      value: mode,
      url: origin,
      sameSite: 'Lax',
    },
  ])
  if (page.url().startsWith('about:')) return
  await page.evaluate((nextMode) => {
    window.localStorage.setItem('af_mode', nextMode)
    document.cookie = `af_mode=${nextMode}; path=/; max-age=31536000; samesite=lax`
  }, mode)
}

async function expectSsrModeNavigation(
  page: Page,
  path: string,
  mode: 'light' | 'dark',
): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response, `${path} should return a document response`).toBeTruthy()
  expect(response?.ok(), `${path} should load successfully (${response?.status()})`).toBeTruthy()
  const html = await response!.text()
  expect(html, `${path} SSR document should carry data-mode=${mode}`).toMatch(
    new RegExp(`<html[^>]*data-mode="${mode}"`),
  )
  await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
}

async function openLeagueHome(
  page: Page,
  leagueId: string,
  browserEvents: string[],
  mode: 'light' | 'dark',
): Promise<void> {
  await expectSsrModeNavigation(page, `/league/${leagueId}?view=league`, mode)
  const leagueTab = page.getByTestId('league-tab-league')
  const visible = await leagueTab.isVisible({ timeout: 45_000 }).catch(() => false)
  if (!visible) {
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    throw new Error(
      `League Home shell did not render. url=${page.url()} browser=${browserEvents.slice(-12).join(' | ')} body=${bodyText.slice(0, 1200)}`,
    )
  }
  await page.getByTestId('league-tab-league').click()
  await expect(page.getByTestId('league-pulse-card-league')).toBeVisible({ timeout: 45_000 })
}

function expectNoRootRuntimeCrashes(browserEvents: string[]): void {
  const rootCrashes = browserEvents.filter((event) =>
    /pageerror|hydration|HierarchyRequestError|NotFoundError|insertBefore|appendChild|Minified React error #(?:418|423)|root layout/i.test(
      event,
    ),
  )
  expect(rootCrashes).toEqual([])
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })
  expect(hasOverflow).toBeFalsy()
}

async function expectDecisionOsCards(page: Page, variant: 'league' | 'commissioner'): Promise<void> {
  const pulse = page.getByTestId(`league-pulse-card-${variant}`)
  const manager = page.getByTestId(`manager-dna-card-${variant}`)
  const moves = page.getByTestId(`decision-recommendations-card-${variant}`)

  await expect(pulse).toBeVisible({ timeout: 45_000 })
  await expect(manager).toBeVisible({ timeout: 45_000 })
  await expect(moves).toBeVisible({ timeout: 45_000 })

  await expect(pulse.getByText(/confidence/i).first()).toBeVisible()
  await expect(pulse.getByText('Why am I seeing this?')).toBeVisible()
  await expect(pulse.getByText('Based on')).toBeVisible()
  await expect(pulse.getByText('Decision path')).toBeVisible()

  await expect(manager.getByText(/confidence/i).first()).toBeVisible()
  await expect(manager.getByText('Why am I seeing this?')).toBeVisible()
  await expect(manager.getByText('Supporting evidence')).toBeVisible()

  await expect(moves.getByText(/confidence/i).first()).toBeVisible()
  await expect(moves.getByText('Why am I seeing this?')).toBeVisible()
  await expect(moves.getByText('Evidence checked')).toBeVisible()
}

test.describe('G29 Decision OS authenticated theme SSR proof', () => {
  test.describe.configure({ mode: 'serial', timeout: 480_000 })

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000)
    await cleanupSeeded(request)
  })

  test('proves League Home and Commissioner Hub Decision OS surfaces with scoped seeded data', async ({ page }) => {
    const browserEvents: string[] = []
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        browserEvents.push(`console:${message.type()}:${message.text().slice(0, 180)}`)
      }
    })
    page.on('pageerror', (error) => {
      browserEvents.push(`pageerror:${String(error.message ?? error).slice(0, 180)}`)
    })
    page.on('requestfailed', (request) => {
      browserEvents.push(`requestfailed:${request.url().slice(0, 180)}:${request.failure()?.errorText ?? 'unknown'}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        browserEvents.push(`response:${response.status()}:${response.url().slice(0, 180)}`)
      }
    })

    await registerAndLoginTo(page, null)

    const seedResponse = await page.request.post('/api/e2e/decision-os-proof-league', {
      headers: E2E_HEADERS,
      data: { team: 'KC', season: 2098, week: 1 },
    })
    expect(seedResponse.ok(), `Decision OS seed failed (${seedResponse.status()})`).toBeTruthy()
    const seedBody = (await seedResponse.json()) as SeededLeague
    seeded = {
      leagueId: seedBody.leagueId,
      season: seedBody.season,
      seededScoreIds: seedBody.seededScoreIds,
    }
    expect(seeded.leagueId).toBeTruthy()

    await setSsrMode(page, 'light')
    await openLeagueHome(page, seeded.leagueId, browserEvents, 'light')
    await expectDecisionOsCards(page, 'league')

    const intelligenceResponse = await page.request.get(
      `/api/decision-os/manager-intelligence?leagueId=${encodeURIComponent(seeded.leagueId)}`,
    )
    expect(intelligenceResponse.ok(), `Manager intelligence API failed (${intelligenceResponse.status()})`).toBeTruthy()
    const intelligence = (await intelligenceResponse.json()) as {
      managerDna?: unknown
      recommendations?: { recommendations?: unknown[] } | null
    }
    expect(intelligence).toHaveProperty('managerDna')
    expect(intelligence).toHaveProperty('recommendations')

    await setSsrMode(page, 'dark')
    await openLeagueHome(page, seeded.leagueId, browserEvents, 'dark')
    await expectDecisionOsCards(page, 'league')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectDecisionOsCards(page, 'league')
    await expectNoHorizontalOverflow(page)

    await page.setViewportSize({ width: 1280, height: 900 })
    await expectSsrModeNavigation(page, '/dashboard', 'dark')
    await expect(page.getByTestId('dashboard-right-create-league')).toBeVisible({ timeout: 45_000 })

    await expectSsrModeNavigation(page, '/commissioner-hub', 'dark')
    await expectDecisionOsCards(page, 'commissioner')
    await expect(page.getByTestId('manager-dna-card-commissioner').getByText('Commissioner use')).toBeVisible()
    await expect(
      page.getByTestId('decision-recommendations-card-commissioner').getByText('No grounded moves are ready yet.', {
        exact: true,
      }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expectNoRootRuntimeCrashes(browserEvents)
  })
})
