import { expect, test, type Page } from '@playwright/test'
import { MOCK_DRAFT_ROSTER_HINT_DELAY_MS } from '@/lib/draft-room/mock-draft-ui-constants'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

/** Mock roster-config latency; must be > `MOCK_DRAFT_ROSTER_HINT_DELAY_MS` so the delayed hint becomes visible before the response resolves. */
const ROSTER_CONFIG_SLOW_MS = 5_000

if (ROSTER_CONFIG_SLOW_MS <= MOCK_DRAFT_ROSTER_HINT_DELAY_MS) {
  throw new Error(
    'ROSTER_CONFIG_SLOW_MS must be greater than MOCK_DRAFT_ROSTER_HINT_DELAY_MS so the delayed hint can appear before the response resolves.',
  )
}

async function mockMockDraftApis(page: Page) {
  const sentMessages: string[] = []

  const draftId = 'mock-e2e-1'
  const chatState = {
    messages: [
      {
        id: 'chat-1',
        userId: 'commissioner',
        displayName: 'Commissioner',
        content: 'Welcome to mock room.',
        createdAt: new Date().toISOString(),
      },
    ],
  }

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
  })
  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/api/user/profile', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  await page.route('**/api/mock-draft/create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        draftId,
        inviteLink: 'https://allfantasy.ai/mock-draft/join?invite=e2e',
        status: 'pre_draft',
      }),
    })
  })

  await page.route(`**/api/mock-draft/${draftId}/start`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route(`**/api/mock-draft/${draftId}/reset`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route(`**/api/mock-draft/${draftId}/chat`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: chatState.messages }),
      })
      return
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { content?: string }
      const message = {
        id: `chat-${chatState.messages.length + 1}`,
        userId: 'you',
        displayName: 'You',
        content: body.content ?? '',
        createdAt: new Date().toISOString(),
      }
      sentMessages.push(message.content)
      chatState.messages.push(message)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(message),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/mock-draft/adp**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          { name: 'Sky Runner', position: 'RB', team: 'NYJ', adp: 10.2, adpTrend: -1.3, value: 68 },
          { name: 'Nova Catch', position: 'WR', team: 'DAL', adp: 12.7, adpTrend: -0.4, value: 72 },
          { name: 'Orbit Arm', position: 'QB', team: 'KC', adp: 14.1, adpTrend: 0.1, value: 66 },
          { name: 'Pulse Tight', position: 'TE', team: 'SEA', adp: 16.5, adpTrend: -0.9, value: 71 },
          { name: 'Comet Flex', position: 'RB', team: 'MIA', adp: 18.3, adpTrend: 0.7, value: 63 },
        ],
      }),
    })
  })

  await page.route('**/api/mock-draft/simulate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        draftId,
        draftResults: [
          { round: 1, pick: 1, overall: 1, playerName: 'Sky Runner', position: 'RB', team: 'NYJ', manager: 'You', isUser: true, confidence: 90, value: 80, notes: 'Best value' },
          { round: 1, pick: 2, overall: 2, playerName: 'Nova Catch', position: 'WR', team: 'DAL', manager: 'Alpha', isUser: false, confidence: 88, value: 77, notes: '' },
          { round: 1, pick: 3, overall: 3, playerName: 'Orbit Arm', position: 'QB', team: 'KC', manager: 'Beta', isUser: false, confidence: 85, value: 74, notes: '' },
          { round: 1, pick: 4, overall: 4, playerName: 'Pulse Tight', position: 'TE', team: 'SEA', manager: 'Gamma', isUser: false, confidence: 83, value: 71, notes: '' },
          { round: 2, pick: 1, overall: 5, playerName: 'Comet Flex', position: 'RB', team: 'MIA', manager: 'You', isUser: true, confidence: 81, value: 69, notes: '' },
        ],
        proposals: [],
      }),
    })
  })

  await page.route('**/api/mock-draft/ai-pick', async (route) => {
    const body = route.request().postDataJSON() as { action?: string }
    if (body.action === 'predict-next') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          predictions: [
            { manager: 'Alpha', predictedPlayer: 'Nova Catch', position: 'WR', probability: 54, reason: 'ADP and roster fit' },
          ],
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          { player: 'Sky Runner', position: 'RB', reason: 'Best roster fit with strong value at this slot.' },
        ],
        aiInsight: 'Prioritize high-value RB before tier drop.',
        reachWarning: null,
        valueWarning: 'Strong value at this draft slot.',
        scarcityInsight: 'RB depth is thinning over the next tier.',
        stackInsight: null,
        correlationInsight: null,
        formatInsight: 'FLEX lineup structure supports this position.',
        byeNote: null,
        evidence: [
          'Context: Round 1, Pick 1 (overall 1).',
          'Need score (RB): 80/100.',
        ],
        caveats: ['Limited ADP sample for this mock board.'],
        uncertainty: 'Uncertainty: Limited ADP sample for this mock board.',
      }),
    })
  })

  await page.route('**/api/mock-draft/share', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shareId: 'share-e2e' }) })
  })

  return {
    getSentMessages: () => sentMessages,
  }
}

async function openMockDraftHarness(page: Page) {
  const button = page.getByTestId('mock-draft-enter-room-button')
  const exists = await button.isVisible().catch(() => false)
  if (!exists) return
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const visible = await button.isVisible().catch(() => false)
    if (!visible) {
      await page.waitForTimeout(150)
      continue
    }
    try {
      await button.click({ timeout: 1500 })
      break
    } catch {
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="mock-draft-enter-room-button"]') as HTMLButtonElement | null
        el?.click()
      })
    }
    await page.waitForTimeout(150)
  }
  await expect(page.getByTestId('mock-draft-wrapper-setup')).toBeVisible()
}

test.describe('@mock-draft-room click audit', () => {
  test('setup includes all required sports', async ({ page }) => {
    await mockMockDraftApis(page)

    await page.goto('/e2e/mock-draft-room?mode=setup')
    await openMockDraftHarness(page)

    await page.getByTestId('mock-draft-setup-sport-select').click()
    await expect(page.getByRole('option', { name: 'NFL' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'NHL' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'NBA' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'MLB' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'NCAA Basketball' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'NCAA Football' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Soccer' })).toBeVisible()
  })

  test('start, AI chat suggestion, ADP AI toggle, and back navigation are wired', async ({ page }) => {
    const mocks = await mockMockDraftApis(page)

    await page.goto('/e2e/mock-draft-room?mode=active')
    await expect(page.getByTestId('mock-draft-wrapper-active')).toBeVisible()
    await expect(page.getByTestId('mock-draft-session-start')).toBeVisible()
    await page.getByTestId('mock-draft-session-start').click()

    await expect(page.getByTestId('mock-draft-chat-panel')).toBeVisible()
    await page.getByTestId('mock-draft-league-select').click()
    await page.getByRole('option', { name: /E2E NFL League/i }).click()
    await page.getByTestId('mock-draft-run-button').click()

    await expect(page.getByTestId('mock-draft-board')).toBeVisible()
    const assistantRefresh = page.getByTestId('mock-draft-ai-assistant-refresh')
    if (await assistantRefresh.isVisible().catch(() => false)) {
      await assistantRefresh.click()
      await expect(page.getByTestId('mock-draft-ai-assistant-ask-chimmy')).toHaveAttribute('href', /insightType=draft/)
    }
    await expect(page.getByTestId('mock-draft-ai-adp-toggle')).toHaveText(/AI ADP On/i)
    await page.getByTestId('mock-draft-ai-adp-toggle').click()
    await expect(page.getByTestId('mock-draft-ai-adp-toggle')).toHaveText(/AI ADP Off/i)

    await expect(page.getByTestId('mock-draft-chat-ai-suggestion')).toContainText('Chimmy:')
    await page.getByTestId('mock-draft-chat-input').fill('Let us prioritize value.')
    await page.getByTestId('mock-draft-chat-send').click()
    expect(mocks.getSentMessages()).toContain('Let us prioritize value.')

    await page.getByTestId('mock-draft-back-button').click()
    await expect(page.getByTestId('mock-draft-wrapper-setup')).toBeVisible()
  })

  test('mobile mock draft back navigation remains available', async ({ page }) => {
    await mockMockDraftApis(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/e2e/mock-draft-room?mode=active')

    /*
     * 🛑 WAIT FOR THE SERVER-RENDERED SHELL FIRST, THEN FOR THE LAZY CHUNK — THIS TEST WAS THE ONLY
     * ONE HERE THAT DID NEITHER, AND IT IS THE ONLY ONE THAT WENT RED.
     *
     * `mock-draft-back-button` lives in `components/MockDraftSimulatorClient.tsx`, which
     * `MockDraftSimulatorWrapper` pulls in via `dynamic(() => import(...), { ssr: false })` — a chunk
     * the wrapper's own comment notes carries recharts and framer-motion. So the button is NOT in the
     * first paint; it arrives only once that chunk has been compiled (on a cold `next dev`), fetched
     * and mounted. Asserting it straight after `goto` on the default 5s expect timeout races all of
     * that.
     *
     * The two sibling tests that navigate to `?mode=active` (`start, AI chat suggestion, ADP AI
     * toggle, and back navigation are wired` and the roster-hint one) both gate on
     * `mock-draft-wrapper-active` first and then do further work before touching the button, so they
     * never pay the race. This one went from `goto` to the assertion in one step.
     *
     * ⚠ THE LONGER TIMEOUT IS A CORRECT BOUND, NOT A SUPPRESSION. If the button never renders the
     * test still fails — just after a wait that matches what it is actually waiting for. The gate
     * below is what keeps that honest: `mock-draft-wrapper-active` is server-rendered, so if the page
     * itself is broken this fails fast on the shell instead of blaming the chunk.
     *
     * Measured: the same commit failed this assertion on all three attempts in one CI job and passed
     * in another, with every file in the route's import closure byte-identical between them.
     */
    await expect(page.getByTestId('mock-draft-wrapper-active')).toBeVisible()
    await expect(page.getByTestId('mock-draft-back-button')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('mock-draft-back-button').click()
    const setupVisible = await page.getByTestId('mock-draft-wrapper-setup').isVisible().catch(() => false)
    if (!setupVisible) {
      await expect(page.getByTestId('mock-draft-wrapper-active')).toBeVisible()
    }
  })

  test('league roster loading hint: delayed until ~400ms, then clears after slow roster-config', async ({ page }) => {
    await mockMockDraftApis(page)
    let rosterConfigHits = 0
    await page.route('**/api/leagues/**/roster-config**', async (route) => {
      rosterConfigHits += 1
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ROSTER_CONFIG_SLOW_MS)
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orderedSlotLabels: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
        }),
      })
    })

    await page.goto('/e2e/mock-draft-room?mode=active')
    await expect(page.getByTestId('mock-draft-wrapper-active')).toBeVisible()
    await expect(page.getByTestId('mock-draft-session-start')).toBeVisible()
    await page.getByTestId('mock-draft-session-start').click()

    const hint = page.getByTestId('mock-draft-league-roster-loading-hint')
    await page.getByTestId('mock-draft-league-select').click()
    await page.getByRole('option', { name: /E2E NFL League/i }).click()
    await expect.poll(() => rosterConfigHits).toBeGreaterThan(0)

    await expect(hint).toHaveCount(0)
    await page.waitForTimeout(MOCK_DRAFT_ROSTER_HINT_DELAY_MS - 100)
    await expect(hint).toHaveCount(0)

    await expect(hint).toBeVisible({ timeout: ROSTER_CONFIG_SLOW_MS })

    await expect(hint).toHaveCount(0, { timeout: ROSTER_CONFIG_SLOW_MS + 5_000 })
  })
})
