import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

type RuntimeSeed = {
  leagueId: string
  memberLogin: string
  commissionerLogin: string
  password: string
  opponentRosterId: string
}

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.DIRECT_URL ??
  process.env.POSTGRES_URL_NON_POOLING

const hasRuntimeEnv = Boolean(databaseUrl && (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET))

const seed: RuntimeSeed = {
  leagueId: 'bbwr-runtime-nfl-best-ball-league',
  memberLogin: 'bbwr_runtime_member',
  commissionerLogin: 'bbwr_runtime_commish',
  password: 'Password123!',
  opponentRosterId: 'bbwr-runtime-opponent-roster',
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
    .poll(async () => {
      const sessionResponse = await page.request.get('/api/auth/session')
      const session = (await sessionResponse.json().catch(() => null)) as { user?: { id?: string } } | null
      return Boolean(session?.user?.id)
    })
    .toBe(true)
}

async function waitForAction(page: Page, action: string, run: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes(`/api/leagues/${seed.leagueId}/best-ball-war-room/${action}`),
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
  await page.request.get(`/api/leagues/${seed.leagueId}/best-ball-war-room`).catch(() => undefined)
  await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/upside`, { data: {} }).catch(() => undefined)
  const stateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes(`/api/leagues/${seed.leagueId}/best-ball-war-room`),
  )
  await page.goto(`/league/${seed.leagueId}`, { waitUntil: 'domcontentloaded' })
  const warRoomTab = page.getByTestId('league-tab-war_room')
  await warRoomTab.waitFor({ state: 'visible', timeout: 30_000 })
  await warRoomTab.click()
  const panel = page.getByTestId('best-ball-war-room-panel')
  const errorBox = page.getByTestId('best-ball-war-room-error')
  try {
    await Promise.race([panel.waitFor({ state: 'visible', timeout: 60_000 }), errorBox.waitFor({ state: 'visible', timeout: 60_000 })])
  } catch {
    throw new Error('Best Ball War Room panel never resolved.')
  }
  return stateResponsePromise
}

test.describe('@db Best Ball War Room runtime', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!hasRuntimeEnv, 'Best Ball War Room runtime E2E requires DATABASE_URL and NEXTAUTH_SECRET/AUTH_SECRET.')

  test.beforeAll(() => {
    if (databaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl
    if (databaseUrl && !process.env.DIRECT_URL) process.env.DIRECT_URL = databaseUrl
    execFileSync(process.execPath, ['--import', 'tsx', resolve(__dirname, '../scripts/seed-best-ball-war-room-runtime.ts')], { stdio: 'inherit', env: process.env })
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 2400 })
    await applyWarRoomNetworkGuards(page)
  })

  test('best-ball-war-room routes enforce auth/privacy/scope and return grounded best-ball context (DB-backed)', async ({ page, request }) => {
    const unauthorized = await request.get(`/api/leagues/${seed.leagueId}/best-ball-war-room`)
    expect(unauthorized.status()).toBe(401)

    await loginAs(page, seed.memberLogin)
    const memberRes = await page.request.get(`/api/leagues/${seed.leagueId}/best-ball-war-room`)
    expect(memberRes.status()).toBe(200)
    const memberBody = (await memberRes.json()) as {
      construction: { grade: string; underInvested: string[] } | null
      depth: { fragilePositions: string[] } | null
      context: {
        userRosterId: string | null
        bestBall: { waiversEnabled: boolean; tradesEnabled: boolean }
        teams: { isUserTeam: boolean; players: { team: string | null; maxPoints: number | null }[] }[]
        availability: { playerValues: string; weeklyScores: string; teamData: string }
        featureAvailability: { upside: boolean; stacks: boolean; waivers: boolean; tradeAnalyze: boolean }
      }
    }
    expect(memberBody.context.availability.playerValues).toBe('available')
    expect(memberBody.context.availability.weeklyScores).toBe('available')
    expect(memberBody.context.availability.teamData).toBe('available')
    // Draft-only: waivers/trades disabled.
    expect(memberBody.context.bestBall.waiversEnabled).toBe(false)
    expect(memberBody.context.bestBall.tradesEnabled).toBe(false)
    expect(memberBody.context.featureAvailability.waivers).toBe(false)
    expect(memberBody.context.featureAvailability.tradeAnalyze).toBe(false)
    expect(memberBody.context.featureAvailability.upside).toBe(true)
    expect(memberBody.context.featureAvailability.stacks).toBe(true)
    expect(memberBody.context.userRosterId).toBeTruthy()
    expect(memberBody.construction?.underInvested).toContain('QB')
    expect((memberBody.depth?.fragilePositions.length ?? 0)).toBeGreaterThan(0)
    const own = memberBody.context.teams.find((t) => t.isUserTeam)
    expect(own?.players.some((p) => p.team)).toBe(true)
    const other = memberBody.context.teams.find((t) => !t.isUserTeam)
    expect(other?.players).toHaveLength(0)

    // Construction-focused action routes respond 200.
    for (const action of ['roster-construction', 'depth', 'upside', 'draft-plan', 'stacks', 'risk']) {
      const res = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/${action}`, { data: {} })
      expect(res.status(), `action ${action}`).toBe(200)
    }
    // Waivers/trades still return 200 with a truthful disabled state (not a crash).
    const waiversRes = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/waivers`, { data: {} })
    expect(waiversRes.status()).toBe(200)
    expect(((await waiversRes.json()) as { waivers: { enabled: boolean } }).waivers.enabled).toBe(false)
    const tradeRes = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/trade-analyze`, { data: { incomingPlayerIds: [], outgoingPlayerIds: [] } })
    expect(tradeRes.status()).toBe(200)
    expect(((await tradeRes.json()) as { tradeGrade: { graded: boolean; reason: string } }).tradeGrade)
      .toEqual({ graded: false, reason: 'Trades are disabled in this league.' })

    // There is NO start/sit / lineup action — it 404s.
    const noLineup = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/lineup`, { data: {} })
    expect(noLineup.status()).toBe(404)

    // Ask gated; member lacks entitlement.
    const askRes = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/ask`, { data: { question: 'What position am I weak at?' } })
    expect(askRes.status()).toBe(402)

    // Member cannot target another roster.
    const forbidden = await page.request.post(`/api/leagues/${seed.leagueId}/best-ball-war-room/upside`, { data: { rosterId: seed.opponentRosterId } })
    expect(forbidden.status()).toBe(403)

    // Commissioner sees league-wide rosters.
    const commissioner = await page.context().browser()?.newPage()
    expect(commissioner).toBeTruthy()
    const commissionerPage = commissioner!
    await applyWarRoomNetworkGuards(commissionerPage)
    await loginAs(commissionerPage, seed.commissionerLogin)
    const commissionerRes = await commissionerPage.request.get(`/api/leagues/${seed.leagueId}/best-ball-war-room`)
    expect(commissionerRes.status()).toBe(200)
    const commissionerBody = (await commissionerRes.json()) as { context: { teams: { isUserTeam: boolean; players: unknown[] }[] } }
    expect((commissionerBody.context.teams.find((t) => !t.isUserTeam)?.players.length ?? 0)).toBeGreaterThan(0)
    await commissionerPage.close()
  })

  test('member opens best-ball War Room — auto-lineup explained, no start/sit button, tools call routes', async ({ page }) => {
    test.setTimeout(300_000)
    await loginAs(page, seed.memberLogin)
    const stateResponse = await openWarRoom(page)
    expect(stateResponse.status()).toBe(200)

    await expect(page.getByTestId('league-war-room-tab')).toBeVisible()
    await shown(page.getByTestId('best-ball-war-room-panel'))
    // Automatic lineup explanation present; NO start/sit button anywhere.
    await rendered(page.getByTestId('best-ball-war-room-auto-lineup'))
    await rendered(page.getByTestId('best-ball-war-room-construction'))
    expect(await page.getByTestId('best-ball-war-room-tool-lineup').count()).toBe(0)
    expect(await page.getByTestId('best-ball-war-room-tool-start-sit').count()).toBe(0)

    await waitForAction(page, 'upside', async () => { await page.getByTestId('best-ball-war-room-tool-upside').click() })
    await rendered(page.getByTestId('best-ball-war-room-upside-result'))

    await waitForAction(page, 'draft-plan', async () => { await page.getByTestId('best-ball-war-room-tool-draft-plan').click() })
    await rendered(page.getByTestId('best-ball-war-room-draft-plan-result'))

    await waitForAction(page, 'stacks', async () => { await page.getByTestId('best-ball-war-room-tool-stacks').click() })
    await rendered(page.getByTestId('best-ball-war-room-stacks-result'))

    await waitForAction(page, 'risk', async () => { await page.getByTestId('best-ball-war-room-tool-risk').click() })
    await rendered(page.getByTestId('best-ball-war-room-risk-result'))

    // Waivers/trades buttons are disabled (draft-only) — truthful, not dead.
    await expect(page.getByTestId('best-ball-war-room-tool-waivers')).toBeDisabled()
    await expect(page.getByTestId('best-ball-war-room-tool-trade-analyze')).toBeDisabled()

    await page.getByTestId('best-ball-war-room-ask-input').fill('What position am I weak at and do I have upside?')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('best-ball-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(402)
    await rendered(page.getByTestId('best-ball-war-room-ask-note'))
    await expect(page.getByTestId('best-ball-war-room-ask-note')).toContainText(/upgrade|access/i)
  })

  test('entitled commissioner ask route degrades safely when AI is unavailable', async ({ page }) => {
    await loginAs(page, seed.commissionerLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('best-ball-war-room-panel'))
    await page.getByTestId('best-ball-war-room-ask-input').fill('Grade my best-ball construction.')
    const askResponse = await waitForAction(page, 'ask', async () => { await page.getByTestId('best-ball-war-room-ask-submit').click() })
    expect(askResponse.status()).toBe(200)
    const body = (await askResponse.json()) as { aiUnavailable?: boolean }
    if (body.aiUnavailable) {
      await rendered(page.getByTestId('best-ball-war-room-ask-note'))
      await expect(page.getByTestId('best-ball-war-room-ask-note')).toContainText(/temporarily unavailable|grounded/i)
    } else {
      await rendered(page.getByTestId('best-ball-war-room-answer'))
    }
  })

  test('mobile dark-mode smoke does not break the best-ball War Room panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, seed.memberLogin)
    await openWarRoom(page)
    await shown(page.getByTestId('best-ball-war-room-panel'))
    await shown(page.getByTestId('best-ball-war-room-auto-lineup'))
    const htmlState = await page.locator('html').evaluate((node) => ({ lang: node.getAttribute('lang') ?? node.getAttribute('data-lang'), mode: node.getAttribute('data-mode') }))
    expect(['en', 'es']).toContain(String(htmlState.lang ?? ''))
    expect(String(htmlState.mode ?? '').length).toBeGreaterThan(0)
  })
})
