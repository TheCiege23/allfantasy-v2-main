import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

type RuntimeSeed = {
  leagueId: string
  memberLogin: string
  commissionerLogin: string
  password: string
  opponentRosterId: string
  opponentIncomingPlayerId: string
}

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.DIRECT_URL ??
  process.env.POSTGRES_URL_NON_POOLING

const hasRuntimeEnv = Boolean(databaseUrl && (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET))

const seed: RuntimeSeed = {
  leagueId: 'kwr-runtime-nfl-keeper-league',
  memberLogin: 'kwr_runtime_member',
  commissionerLogin: 'kwr_runtime_commish',
  password: 'Password123!',
  opponentRosterId: 'kwr-runtime-opponent-roster',
  opponentIncomingPlayerId: 'kwr-opp-wr-steal',
}

async function loginAs(page: Page, username: string) {
  const csrfResponse = await page.request.get('/api/auth/csrf')
  expect(csrfResponse.status()).toBe(200)
  const csrfPayload = (await csrfResponse.json()) as { csrfToken?: string }
  const csrfToken = csrfPayload.csrfToken
  expect(csrfToken).toBeTruthy()

  const signInResponse = await page.request.post('/api/auth/callback/credentials?json=true', {
    form: { csrfToken: csrfToken ?? '', login: username, password: seed.password, callbackUrl: `/league/${seed.leagueId}?view=war_room`, json: 'true' },
  })
  expect(signInResponse.status()).toBeLessThan(400)

  await expect
    .poll(async () => {
      const sessionResponse = await page.request.get('/api/auth/session')
      const session = (await sessionResponse.json().catch(() => null)) as { user?: { id?: string } } | null
      return Boolean(session?.user?.id)
    })
    .toBe(true)
}

async function waitForAction(page: Page, action: string, run: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes(`/api/leagues/${seed.leagueId}/keeper-war-room/${action}`),
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
  await page.request.get(`/api/leagues/${seed.leagueId}/keeper-war-room`).catch(() => undefined)
  await page.request.post(`/api/leagues/${seed.leagueId}/keeper-war-room/cut-list`, { data: {} }).catch(() => undefined)
  const stateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes(`/api/leagues/${seed.leagueId}/keeper-war-room`),
  )
  await page.goto(`/league/${seed.leagueId}`, { waitUntil: 'domcontentloaded' })
  const warRoomTab = page.getByTestId('league-tab-war_room')
  await warRoomTab.waitFor({ state: 'visible', timeout: 30_000 })
  await warRoomTab.click()
  const panel = page.getByTestId('keeper-war-room-panel')
  const errorBox = page.getByTestId('keeper-war-room-error')
  try {
    await Promise.race([panel.waitFor({ state: 'visible', timeout: 60_000 }), errorBox.waitFor({ state: 'visible', timeout: 60_000 })])
  } catch {
    throw new Error('Keeper War Room panel never resolved.')
  }
  return stateResponsePromise
}

test.describe('@db Keeper War Room runtime', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!hasRuntimeEnv, 'Keeper War Room runtime E2E requires DATABASE_URL and NEXTAUTH_SECRET/AUTH_SECRET.')

  test.beforeAll(() => {
    if (databaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl
    if (databaseUrl && !process.env.DIRECT_URL) process.env.DIRECT_URL = databaseUrl
    execFileSync(process.execPath, ['--import', 'tsx', resolve(__dirname, '../scripts/seed-keeper-war-room-runtime.ts')], { stdio: 'inherit', env: process.env })
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 2400 })
    await applyWarRoomNetworkGuards(page)
  })

  test('keeper-war-room routes enforce auth/privacy/scope and return grounded keeper context (DB-backed)', async ({ page, request }) => {
    const unauthorized = await request.get(`/api/leagues/${seed.leagueId}/keeper-war-room`)
    expect(unauthorized.status()).toBe(401)

    await loginAs(page, seed.memberLogin)
    const memberRes = await page.request.get(`/api/leagues/${seed.leagueId}/keeper-war-room`)
    expect(memberRes.status()).toBe(200)
    const memberBody = (await memberRes.json()) as {
      recommendations: { needsMoreData: boolean; recommended: { playerId: string }[] } | null
      needs: { draftTargetPositions: string[] } | null
      context: {
        userRosterId: string | null
        keeper: { maxKeepers: number; costSystem: string }
        teams: { isUserTeam: boolean; players: { keeperCostRound: number | null; surplusRounds: number | null }[] }[]
        availability: { playerValues: string; keeperCosts: string; eligibility: string }
        featureAvailability: { keeperRecommendations: boolean }
      }
    }
    // Real keeper data path: ADP values + keeper costs + eligibility all resolved.
    expect(memberBody.context.availability.playerValues).toBe('available')
    expect(memberBody.context.availability.keeperCosts).toBe('available')
    expect(memberBody.context.availability.eligibility).toBe('available')
    expect(memberBody.context.featureAvailability.keeperRecommendations).toBe(true)
    expect(memberBody.context.keeper.maxKeepers).toBe(3)
    expect(memberBody.context.keeper.costSystem).toBe('round_based')
    // Member gets grounded keeper recommendations for THEIR team (value surplus computed).
    expect(memberBody.context.userRosterId).toBeTruthy()
    expect(memberBody.recommendations?.needsMoreData).toBe(false)
    expect((memberBody.recommendations?.recommended.length ?? 0)).toBeGreaterThan(0)
    expect(memberBody.needs).toBeTruthy()
    const own = memberBody.context.teams.find((t) => t.isUserTeam)
    expect(own?.players.some((p) => p.surplusRounds != null)).toBe(true)
    // No cross-roster leak for members.
    const other = memberBody.context.teams.find((t) => !t.isUserTeam)
    expect(other?.players).toHaveLength(0)

    // All action routes respond 200 for the member's own team.
    for (const action of ['keeper-recommendations', 'cut-list', 'draft-plan', 'roster-needs', 'waivers', 'lineup', 'trade-find']) {
      const res = await page.request.post(`/api/leagues/${seed.leagueId}/keeper-war-room/${action}`, { data: {} })
      expect(res.status(), `action ${action}`).toBe(200)
    }
    const tradeAnalyzeRes = await page.request.post(`/api/leagues/${seed.leagueId}/keeper-war-room/trade-analyze`, {
      data: { incomingPlayerIds: [seed.opponentIncomingPlayerId], outgoingPlayerIds: [] },
    })
    expect(tradeAnalyzeRes.status()).toBe(200)

    // Ask is gated on the war_room_draft_strategy entitlement; the member lacks it.
    const askRes = await page.request.post(`/api/leagues/${seed.leagueId}/keeper-war-room/ask`, { data: { question: 'Who should I keep?' } })
    expect(askRes.status()).toBe(402)

    // Member cannot target another roster.
    const forbidden = await page.request.post(`/api/leagues/${seed.leagueId}/keeper-war-room/cut-list`, { data: { rosterId: seed.opponentRosterId } })
    expect(forbidden.status()).toBe(403)

    // Commissioner sees league-wide rosters.
    const commissioner = await page.context().browser()?.newPage()
    expect(commissioner).toBeTruthy()
    const commissionerPage = commissioner!
    await applyWarRoomNetworkGuards(commissionerPage)
    await loginAs(commissionerPage, seed.commissionerLogin)
    const commissionerRes = await commissionerPage.request.get(`/api/leagues/${seed.leagueId}/keeper-war-room`)
    expect(commissionerRes.status()).toBe(200)
    const commissionerBody = (await commissionerRes.json()) as { context: { teams: { isUserTeam: boolean; players: unknown[] }[] } }
    const commissionerOther = commissionerBody.context.teams.find((t) => !t.isUserTeam)
    expect(commissionerOther?.players.length ?? 0).toBeGreaterThan(0)
    await commissionerPage.close()
  })

  test('member opens keeper War Room and real UI buttons call consolidated routes', async ({ page }) => {
    test.setTimeout(300_000)
    await loginAs(page, seed.memberLogin)
    const stateResponse = await openWarRoom(page)
    expect(stateResponse.status()).toBe(200)

    await expect(page.getByTestId('league-war-room-tab')).toBeVisible()
    await shown(page.getByTestId('keeper-war-room-panel'))
    await rendered(page.getByTestId('keeper-war-room-rules-card'))
    await rendered(page.getByTestId('keeper-war-room-recommendations'))

    await waitForAction(page, 'cut-list', async () => { await page.getByTestId('keeper-war-room-tool-cut-list').click() })
    await rendered(page.getByTestId('keeper-war-room-cut-list-result'))

    await waitForAction(page, 'draft-plan', async () => { await page.getByTestId('keeper-war-room-tool-draft-plan').click() })
    await rendered(page.getByTestId('keeper-war-room-draft-plan-result'))

    // Opening the analyzer sends nothing; it grades once the incoming player is picked.
    await page.getByTestId('keeper-war-room-tool-trade-analyze').click()
    await page.getByTestId('keeper-war-room-trade-incoming-select').selectOption(seed.opponentIncomingPlayerId)
    await waitForAction(page, 'trade-analyze', async () => { await page.getByTestId('keeper-war-room-trade-analyze-submit').click() })
    await rendered(page.getByTestId('keeper-war-room-trade-analyze-result'))

    await waitForAction(page, 'trade-find', async () => { await page.getByTestId('keeper-war-room-tool-trade-find').click() })
    await rendered(page.getByTestId('keeper-war-room-trade-find-result'))

    await page.getByTestId('keeper-war-room-ask-input').fill('Who should I keep and who should I cut?')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('keeper-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(402)
    await rendered(page.getByTestId('keeper-war-room-ask-note'))
    await expect(page.getByTestId('keeper-war-room-ask-note')).toContainText(/upgrade|access/i)
  })

  test('entitled commissioner ask route degrades safely when AI is unavailable', async ({ page }) => {
    await loginAs(page, seed.commissionerLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('keeper-war-room-panel'))
    await page.getByTestId('keeper-war-room-ask-input').fill('Give me a grounded keeper strategy note.')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('keeper-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(200)
    const body = (await askResponse.json()) as { aiUnavailable?: boolean }
    if (body.aiUnavailable) {
      await rendered(page.getByTestId('keeper-war-room-ask-note'))
      await expect(page.getByTestId('keeper-war-room-ask-note')).toContainText(/temporarily unavailable|grounded/i)
    } else {
      await rendered(page.getByTestId('keeper-war-room-answer'))
    }
  })

  test('mobile dark-mode smoke does not break the keeper War Room panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, seed.memberLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('keeper-war-room-panel'))
    await shown(page.getByTestId('keeper-war-room-tool-cut-list'))
    const htmlState = await page.locator('html').evaluate((node) => ({ lang: node.getAttribute('lang') ?? node.getAttribute('data-lang'), mode: node.getAttribute('data-mode') }))
    expect(['en', 'es']).toContain(String(htmlState.lang ?? ''))
    expect(String(htmlState.mode ?? '').length).toBeGreaterThan(0)
  })
})
