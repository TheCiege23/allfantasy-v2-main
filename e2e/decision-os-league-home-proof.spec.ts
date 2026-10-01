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
  /*
   * ⚠ `?view=league` CANNOT REACH A DECISION OS CARD FOR THIS LEAGUE, AND THE GUARD HID IT.
   *
   * The seed is an NFL redraft league, so `LeagueShell` uses its `nflRedraftCore` tab list,
   * which has had no `league` tab since `aed9b1977`. The `?view=` effect only switches to a tab
   * that `tabDefs` holds, so `?view=league` was ignored and the page stayed on `home`.
   * `LeagueTab` — the only renderer of `league-pulse-card-league` — never mounted. The old
   * guard passed anyway, because `league-tab-group-league` is a group that always exists.
   *
   * `decide` is the Decision OS surface this league type renders (`DecideHome`). The guard now
   * asserts that the TAB is selected, not only that a button exists, so a deep link that is
   * ignored fails here with a clear message instead of as a card timeout.
   */
  await expectSsrModeNavigation(page, `/league/${leagueId}?view=decide`, mode)
  const decideTab = page.getByTestId('league-tab-decide')
  const selected = await expect(decideTab)
    .toHaveAttribute('aria-selected', 'true', { timeout: 45_000 })
    .then(() => true)
    .catch(() => false)
  if (!selected) {
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    const tabCount = await decideTab.count().catch(() => -1)
    const renderedTabIds = await page
      .locator('[data-testid^="league-tab-"]')
      .evaluateAll((els) =>
        els
          .map((el) => `${el.getAttribute('data-testid')}${el.getAttribute('aria-selected') === 'true' ? '*' : ''}`)
          .slice(0, 30),
      )
      .catch(() => [] as string[])
    throw new Error(
      `?view=decide did not select the Decide tab. url=${page.url()} ` +
        `decideTabInDom=${tabCount} renderedTabTestIds(*=selected)=[${renderedTabIds.join(',')}] ` +
        `browser=${browserEvents.slice(-12).join(' | ')} body=${bodyText.slice(0, 1200)}`,
    )
  }
  await expect(page.getByTestId('decide-home')).toBeVisible({ timeout: 45_000 })
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

/*
 * `DecideHome` renders the Decision OS engines as its own cards, not as `LeaguePulseCard` /
 * `DecisionRecommendationsCard`, so the "Why am I seeing this?" copy does not apply here. Its
 * honesty contract does: the pulse shows either a verdict with its confidence or the engine's
 * insufficient-data state, and the move queue shows either grounded moves or an explicit empty
 * state. It has no Manager DNA card; the manager-intelligence API check below still covers that
 * payload.
 */
async function expectDecisionOsCards(page: Page): Promise<void> {
  const pulse = page.getByTestId('decide-league-pulse')
  await expect(pulse).toBeVisible({ timeout: 45_000 })
  await expect(pulse.getByText(/\d+% · /).or(pulse.locator('.bdx-empty')).first()).toBeVisible()

  const moves = page.getByTestId('decide-recommendation').or(page.getByTestId('decide-recommendations-empty'))
  await expect(moves.first()).toBeVisible({ timeout: 45_000 })
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
    /*
     * Read the body BEFORE asserting. `Decision OS seed failed (500)` was all this
     * reported for weeks, which is a status code rather than a cause — and the seed
     * route is the only place that knows why. It now returns a `detail`, so put it in
     * the assertion message where CI will show it.
     */
    const seedText = await seedResponse.text()
    expect(
      seedResponse.ok(),
      `Decision OS seed failed (${seedResponse.status()}): ${seedText.slice(0, 500)}`,
    ).toBeTruthy()
    // Parsed from the text already read above rather than re-reading the response.
    const seedBody = JSON.parse(seedText) as SeededLeague
    seeded = {
      leagueId: seedBody.leagueId,
      season: seedBody.season,
      seededScoreIds: seedBody.seededScoreIds,
    }
    expect(seeded.leagueId).toBeTruthy()

    await setSsrMode(page, 'light')
    await openLeagueHome(page, seeded.leagueId, browserEvents, 'light')
    await expectDecisionOsCards(page)

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
    await expectDecisionOsCards(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectDecisionOsCards(page)
    await expectNoHorizontalOverflow(page)

    await page.setViewportSize({ width: 1280, height: 900 })
    await expectSsrModeNavigation(page, '/dashboard', 'dark')
    await expect(page.getByTestId('dashboard-right-create-league')).toBeVisible({ timeout: 45_000 })

    /*
     * Five-doors restyle (2026-09-17): the all-leagues Commissioner Hub is /core/commissioner,
     * and /commissioner-hub only forwards there. Its Decision OS commissioner cards moved to
     * Commissioner OS with the rest of the analytics, so this checks the hub's SSR theme only.
     */
    await expectSsrModeNavigation(page, '/core/commissioner', 'dark')
    await expect(page.getByTestId('commissioner-overview')).toBeVisible({ timeout: 45_000 })
    await expectNoHorizontalOverflow(page)
    expectNoRootRuntimeCrashes(browserEvents)
  })
})
