import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

type RuntimeSeed = {
  leagueId: string
  memberLogin: string
  commissionerLogin: string
  password: string
  eliminatedRosterId: string
}

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.DIRECT_URL ??
  process.env.POSTGRES_URL_NON_POOLING

const hasRuntimeEnv = Boolean(databaseUrl && (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET))

const seed: RuntimeSeed = {
  leagueId: 'gwr-runtime-nfl-guillotine-league',
  memberLogin: 'gwr_runtime_member',
  commissionerLogin: 'gwr_runtime_commish',
  password: 'Password123!',
  eliminatedRosterId: 'gwr-runtime-elim-roster',
}

async function loginAs(page: Page, username: string) {
  const csrfResponse = await page.request.get('/api/auth/csrf')
  expect(csrfResponse.status()).toBe(200)
  const csrfToken = ((await csrfResponse.json()) as { csrfToken?: string }).csrfToken
  expect(csrfToken).toBeTruthy()
  const signInResponse = await page.request.post('/api/auth/callback/credentials?json=true', {
    form: { csrfToken: csrfToken ?? '', login: username, password: seed.password, callbackUrl: `/league/${seed.leagueId}?view=war_room`, json: 'true' },
  })
  expect(signInResponse.status()).toBeLessThan(400)
  await expect
    .poll(
      async () => {
        const sessionResponse = await page.request.get('/api/auth/session')
        const session = (await sessionResponse.json().catch(() => null)) as { user?: { id?: string } } | null
        return Boolean(session?.user?.id)
      },
      // Cold dev-server route compilation can exceed a few seconds on first hit.
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true)
}

async function waitForAction(page: Page, action: string, run: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes(`/api/leagues/${seed.leagueId}/guillotine-war-room/${action}`),
  )
  await run()
  const response = await responsePromise
  expect(response.status()).toBeLessThan(500)
  return response
}

async function rendered(locator: Locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  await expect(locator).toBeAttached()
}
async function shown(locator: Locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  await expect(locator).toBeVisible()
}

const ABORTED_RESOURCE_TYPES = new Set(['image', 'media', 'font'])
const ABORTED_HOST_RE = /connect\.facebook|facebook\.com|fbcdn|google-analytics|googletagmanager|doubleclick|hotjar|segment\.io|mixpanel|sentry\.io|posthog/i
async function applyWarRoomNetworkGuards(page: Page) {
  await page.route('**/*', (route) => {
    const req = route.request()
    if (ABORTED_RESOURCE_TYPES.has(req.resourceType()) || ABORTED_HOST_RE.test(req.url())) return route.abort()
    return route.continue()
  })
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message))
}

async function openWarRoom(page: Page) {
  await page.request.get(`/api/leagues/${seed.leagueId}/guillotine-war-room`).catch(() => undefined)
  // Pre-warm every dynamic [action] route module so the UI clicks hit WARM routes
  // (dev compiles each route lazily on first hit; 6 sequential cold compiles can
  // otherwise blow the per-test timeout). Fire in parallel; ignore results.
  await Promise.all(
    ['roster-risk', 'lineup-safety', 'faab-plan', 'waivers', 'dropped-players', 'ask'].map((a) =>
      page.request.post(`/api/leagues/${seed.leagueId}/guillotine-war-room/${a}`, { data: {} }).catch(() => undefined),
    ),
  )
  const stateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes(`/api/leagues/${seed.leagueId}/guillotine-war-room`),
  )
  await page.goto(`/league/${seed.leagueId}`, { waitUntil: 'domcontentloaded' })
  const warRoomTab = page.getByTestId('league-tab-war_room')
  await warRoomTab.waitFor({ state: 'visible', timeout: 30_000 })
  await warRoomTab.click()
  const panel = page.getByTestId('guillotine-war-room-panel')
  const errorBox = page.getByTestId('guillotine-war-room-error')
  try {
    await Promise.race([panel.waitFor({ state: 'visible', timeout: 60_000 }), errorBox.waitFor({ state: 'visible', timeout: 60_000 })])
  } catch {
    throw new Error('Guillotine War Room panel never resolved.')
  }
  return stateResponsePromise
}

test.describe('@db Guillotine War Room runtime', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!hasRuntimeEnv, 'Guillotine War Room runtime E2E requires DATABASE_URL and NEXTAUTH_SECRET/AUTH_SECRET.')

  test.beforeAll(() => {
    if (databaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl
    if (databaseUrl && !process.env.DIRECT_URL) process.env.DIRECT_URL = databaseUrl
    execFileSync(process.execPath, ['--import', 'tsx', resolve(__dirname, '../scripts/seed-guillotine-war-room-runtime.ts')], { stdio: 'inherit', env: process.env })
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 2400 })
    await applyWarRoomNetworkGuards(page)
  })

  test('guillotine-war-room routes enforce auth/privacy/scope and return survival-first context (DB-backed)', async ({ page, request }) => {
    const unauthorized = await request.get(`/api/leagues/${seed.leagueId}/guillotine-war-room`)
    expect(unauthorized.status()).toBe(401)

    await loginAs(page, seed.memberLogin)
    const memberRes = await page.request.get(`/api/leagues/${seed.leagueId}/guillotine-war-room`)
    expect(memberRes.status()).toBe(200)
    const memberBody = (await memberRes.json()) as {
      survival: { riskLevel: string; safetyMargin: number | null } | null
      weeklyPlan: { riskLevel: string } | null
      context: {
        userRosterId: string | null
        activeTeamCount: number
        eliminatedTeamCount: number
        guillotine: { tradesEnabled: boolean }
        standings: { isUserTeam: boolean; tier: string; eliminated: boolean }[]
        teams: { isUserTeam: boolean; players: unknown[] }[]
        availability: { eliminationLine: string; periodScores: string; droppedPlayerPool: string; faab: string }
        featureAvailability: { survivalRisk: boolean; droppedPlayers: boolean; tradeAnalyze: boolean }
      }
    }
    expect(memberBody.context.availability.eliminationLine).toBe('available')
    expect(memberBody.context.availability.periodScores).toBe('available')
    expect(memberBody.context.availability.droppedPlayerPool).toBe('available')
    expect(memberBody.context.featureAvailability.survivalRisk).toBe(true)
    expect(memberBody.context.featureAvailability.droppedPlayers).toBe(true)
    expect(memberBody.context.featureAvailability.tradeAnalyze).toBe(false) // trades disabled
    expect(memberBody.context.activeTeamCount).toBeGreaterThan(0)
    expect(memberBody.context.eliminatedTeamCount).toBeGreaterThan(0)
    expect(memberBody.context.userRosterId).toBeTruthy()
    // Seeded member is the lowest team → chop zone / critical.
    expect(memberBody.survival?.riskLevel).toBe('critical')
    expect(memberBody.weeklyPlan?.riskLevel).toBe('critical')
    const own = memberBody.context.standings.find((s) => s.isUserTeam)
    expect(own?.tier).toBe('chop_zone')
    // Standings include an eliminated team (public to league).
    expect(memberBody.context.standings.some((s) => s.eliminated)).toBe(true)
    // No cross-roster player leak for members.
    const otherTeam = memberBody.context.teams.find((t) => !t.isUserTeam)
    expect(otherTeam?.players).toHaveLength(0)

    // All survival/action routes respond 200 for the member's own team.
    for (const action of ['survival-risk', 'roster-risk', 'lineup-safety', 'waivers', 'faab-plan', 'dropped-players', 'weekly-plan']) {
      const res = await page.request.post(`/api/leagues/${seed.leagueId}/guillotine-war-room/${action}`, { data: {} })
      expect(res.status(), `action ${action}`).toBe(200)
    }
    // Trades disabled → analyze returns a truthful disabled state (200, not crash).
    const tradeRes = await page.request.post(`/api/leagues/${seed.leagueId}/guillotine-war-room/trade-analyze`, { data: { incomingPlayerIds: [], outgoingPlayerIds: [] } })
    expect(tradeRes.status()).toBe(200)
    expect(((await tradeRes.json()) as { tradeGrade: { graded: boolean; reason: string } }).tradeGrade)
      .toEqual({ graded: false, reason: 'Trades are disabled in this league.' })

    // Ask gated; member lacks entitlement.
    const askRes = await page.request.post(`/api/leagues/${seed.leagueId}/guillotine-war-room/ask`, { data: { question: 'Am I at risk of elimination?' } })
    expect(askRes.status()).toBe(402)

    // Member cannot target another roster.
    const forbidden = await page.request.post(`/api/leagues/${seed.leagueId}/guillotine-war-room/survival-risk`, { data: { rosterId: seed.eliminatedRosterId } })
    expect(forbidden.status()).toBe(403)

    // Commissioner sees league-wide rosters and is the safe team.
    const commissioner = await page.context().browser()?.newPage()
    expect(commissioner).toBeTruthy()
    const commissionerPage = commissioner!
    await applyWarRoomNetworkGuards(commissionerPage)
    await loginAs(commissionerPage, seed.commissionerLogin)
    const commissionerRes = await commissionerPage.request.get(`/api/leagues/${seed.leagueId}/guillotine-war-room`)
    expect(commissionerRes.status()).toBe(200)
    const commissionerBody = (await commissionerRes.json()) as { survival: { riskLevel: string } | null }
    expect(commissionerBody.survival?.riskLevel).toBe('safe')
    await commissionerPage.close()
  })

  test('member opens guillotine War Room — survival hero, weekly plan, tools call routes', async ({ page }) => {
    test.setTimeout(300_000)
    await loginAs(page, seed.memberLogin)
    const stateResponse = await openWarRoom(page)
    expect(stateResponse.status()).toBe(200)

    await expect(page.getByTestId('league-war-room-tab')).toBeVisible()
    await shown(page.getByTestId('guillotine-war-room-panel'))
    await rendered(page.getByTestId('guillotine-war-room-survival-card'))
    await rendered(page.getByTestId('guillotine-war-room-weekly-plan'))
    await rendered(page.getByTestId('guillotine-war-room-standings'))

    await waitForAction(page, 'roster-risk', async () => { await page.getByTestId('guillotine-war-room-tool-roster-risk').click() })
    await rendered(page.getByTestId('guillotine-war-room-roster-risk-result'))

    await waitForAction(page, 'lineup-safety', async () => { await page.getByTestId('guillotine-war-room-tool-lineup-safety').click() })
    await rendered(page.getByTestId('guillotine-war-room-lineup-safety-result'))

    await waitForAction(page, 'faab-plan', async () => { await page.getByTestId('guillotine-war-room-tool-faab-plan').click() })
    await rendered(page.getByTestId('guillotine-war-room-faab-plan-result'))

    await waitForAction(page, 'waivers', async () => { await page.getByTestId('guillotine-war-room-tool-waivers').click() })
    await rendered(page.getByTestId('guillotine-war-room-waivers-result'))

    await waitForAction(page, 'dropped-players', async () => { await page.getByTestId('guillotine-war-room-tool-dropped-players').click() })
    await rendered(page.getByTestId('guillotine-war-room-dropped-players-result'))

    // Trade analyzer button is disabled (trades off) — truthful, not dead.
    await expect(page.getByTestId('guillotine-war-room-tool-trade-analyze')).toBeDisabled()

    await page.getByTestId('guillotine-war-room-ask-input').fill('Am I at risk and should I spend FAAB?')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('guillotine-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(402)
    await rendered(page.getByTestId('guillotine-war-room-ask-note'))
    await expect(page.getByTestId('guillotine-war-room-ask-note')).toContainText(/upgrade|access/i)
  })

  test('entitled commissioner ask route degrades safely when AI is unavailable', async ({ page }) => {
    await loginAs(page, seed.commissionerLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('guillotine-war-room-panel'))
    await page.getByTestId('guillotine-war-room-ask-input').fill('What is my survival plan this week?')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('guillotine-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(200)
    const body = (await askResponse.json()) as { aiUnavailable?: boolean }
    if (body.aiUnavailable) {
      await rendered(page.getByTestId('guillotine-war-room-ask-note'))
      await expect(page.getByTestId('guillotine-war-room-ask-note')).toContainText(/temporarily unavailable|grounded/i)
    } else {
      await rendered(page.getByTestId('guillotine-war-room-answer'))
    }
  })

  test('mobile dark-mode smoke does not break the guillotine War Room panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, seed.memberLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('guillotine-war-room-panel'))
    await shown(page.getByTestId('guillotine-war-room-survival-card'))
    const htmlState = await page.locator('html').evaluate((node) => ({ lang: node.getAttribute('lang') ?? node.getAttribute('data-lang'), mode: node.getAttribute('data-mode') }))
    expect(['en', 'es']).toContain(String(htmlState.lang ?? ''))
    expect(String(htmlState.mode ?? '').length).toBeGreaterThan(0)
  })
})
