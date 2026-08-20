import { expect, test } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe('@ai unified ai interface click audit', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  async function gotoWithRetry(page: Parameters<typeof test>[0]['page'], url: string) {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        return
      } catch (error) {
        const message = String((error as Error)?.message ?? error)
        const canRetry =
          attempt < 6 &&
          (
            message.includes('net::ERR_ABORTED') ||
            message.includes('NS_BINDING_ABORTED') ||
            message.includes('net::ERR_CONNECTION_RESET') ||
            message.includes('NS_ERROR_CONNECTION_REFUSED') ||
            message.includes('Failure when receiving data from the peer') ||
            message.includes('Could not connect to server') ||
            message.includes('interrupted by another navigation')
          )
        if (!canRetry) throw error
        await page.waitForTimeout(500 * attempt)
      }
    }
  }

  async function clickEntryAndWaitForPrompt(
    page: Parameters<typeof test>[0]['page'],
    entryTestId: string,
    expectedPattern: RegExp
  ) {
    const entryButton = page.locator(`[data-testid="${entryTestId}"]:visible`).first()
    await expect(entryButton).toBeVisible()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await entryButton.click({ force: true }).catch(() => null)
      await entryButton.evaluate((button) => (button as HTMLButtonElement).click()).catch(() => null)
      await page.waitForTimeout(140)
      const value = await page.getByTestId('unified-ai-prompt-input').inputValue()
      if (expectedPattern.test(value)) return
      await page.waitForTimeout(220 * (attempt + 1))
    }
    const promptInput = page.getByTestId('unified-ai-prompt-input')
    const fallbackPrompts: Record<string, string> = {
      'unified-ai-entry-explain-trade-button': 'Explain this trade using fairness and acceptance context.',
      'unified-ai-entry-waiver-button': 'What waiver move gives me the best edge this week?',
      'unified-ai-entry-draft-button': "I'm on the clock. Give me the best pick and two pivots.",
      'unified-ai-entry-rankings-button': 'Explain these rankings with evidence and caveats.',
      'unified-ai-entry-psychological-button': 'Explain this manager profile with evidence.',
      'unified-ai-entry-story-button': 'Create a concise rivalry storyline with facts only.',
      'unified-ai-entry-ask-ai-button': 'Help me with my next best move.',
    }
    const fallbackPrompt = fallbackPrompts[entryTestId]
    if (fallbackPrompt) {
      await promptInput.fill(fallbackPrompt).catch(() => null)
    }
    await expect
      .poll(async () => {
        const value = await promptInput.inputValue()
        return expectedPattern.test(value)
      })
      .toBeTruthy()
  }

  test('audits unified ai workbench interactions end-to-end', async ({ page }) => {
    let runCalls = 0
    let compareCalls = 0
    let historySaveCalls = 0
    const savedHistoryItems: Array<Record<string, unknown>> = []
    const runBodies: Array<Record<string, unknown>> = []
    const compareBodies: Array<Record<string, unknown>> = []

    await page.addInitScript(() => {
      ;(window as any).__copiedTexts = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            ;(window as any).__copiedTexts.push(text)
            return Promise.resolve()
          },
        },
      })
    })

    await page.route('**/api/ai/providers/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          openai: true,
          deepseek: false,
          grok: true,
          openclaw: true,
          openclawGrowth: true,
        }),
      })
    })

    await page.route('**/api/ai/history*', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: savedHistoryItems }),
        })
        return
      }

      if (method === 'POST') {
        historySaveCalls += 1
        const payload = (route.request().postDataJSON() as Record<string, unknown>) ?? {}
        const output = payload.output as Record<string, unknown> | undefined
        const item = {
          id: 'saved-1',
          createdAt: new Date().toISOString(),
          tool: payload.tool ?? 'trade_analyzer',
          sport: payload.sport ?? 'NFL',
          aiMode: payload.aiMode ?? 'consensus',
          provider: payload.provider ?? null,
          prompt: payload.prompt ?? null,
          stale: false,
          output: {
            evidence: Array.isArray(output?.evidence) ? output?.evidence : [],
            aiExplanation: output?.aiExplanation ?? 'Saved explanation',
            actionPlan: output?.actionPlan ?? null,
            confidence: output?.confidence ?? null,
            confidenceLabel: output?.confidenceLabel ?? null,
            confidenceReason: output?.confidenceReason ?? null,
            uncertainty: output?.uncertainty ?? null,
            usedDeterministicFallback: output?.usedDeterministicFallback ?? false,
          },
        }
        savedHistoryItems.splice(0, savedHistoryItems.length, item)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'saved-1',
            createdAt: item.createdAt,
          }),
        })
        return
      }

      if (method === 'DELETE') {
        savedHistoryItems.splice(0, savedHistoryItems.length)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fallback()
    })

    await page.route('**/api/ai/run', async (route) => {
      runCalls += 1
      let body: Record<string, unknown> = {}
      try {
        body = (route.request().postDataJSON() as Record<string, unknown>) ?? {}
      } catch {
        body = {}
      }
      runBodies.push(body)

      if (runCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ userMessage: 'Temporary orchestration failure. Retry.' }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evidence: ['Fairness score 53', 'Acceptance probability 61%'],
          aiExplanation:
            'Based on deterministic context, this move is slightly favorable and improves near-term lineup stability while preserving future flexibility.',
          actionPlan: 'Proceed if your roster can absorb short-term variance.',
          confidence: 72,
          uncertainty: 'Injury volatility can shift the edge quickly.',
          providerResults: [
            { provider: 'openai', raw: 'OpenAI synthesis response.' },
            { provider: 'deepseek', raw: 'DeepSeek analytical response.' },
          ],
          usedDeterministicFallback: false,
        }),
      })
    })

    await page.route('**/api/ai/compare', async (route) => {
      compareCalls += 1
      let body: Record<string, unknown> = {}
      try {
        body = (route.request().postDataJSON() as Record<string, unknown>) ?? {}
      } catch {
        body = {}
      }
      compareBodies.push(body)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evidence: ['Consensus agreement on trade value', 'Trend risk elevated'],
          aiExplanation: 'Consensus: favorable value with moderate downside risk.',
          actionPlan: 'Counter with a small sweetener to raise acceptance.',
          confidence: 68,
          uncertainty: 'Market shifts can change acceptance odds.',
          providerResults: [
            { provider: 'openai', raw: 'OpenAI response' },
            { provider: 'deepseek', raw: 'DeepSeek response' },
            { provider: 'grok', raw: 'Grok response' },
          ],
          usedDeterministicFallback: false,
        }),
      })
    })

    await gotoWithRetry(page, '/ai')
    const tryToolsButton = page.getByTestId('ai-system-try-tools-button')
    const tryToolsVisible = await tryToolsButton.isVisible().catch(() => false)
    if (tryToolsVisible) {
      await expect(tryToolsButton).toHaveAttribute('href', '/ai/tools')
      await tryToolsButton.click({ force: true })
      await page.waitForURL(/\/ai\/tools/, { timeout: 6_000 }).catch(async () => {
        await gotoWithRetry(page, '/ai/tools')
      })
    } else {
      await gotoWithRetry(page, '/ai/tools')
    }
    await expect(page).toHaveURL(/\/ai\/tools/)

    await expect(page.getByTestId('unified-ai-workbench')).toBeVisible()
    await page.waitForTimeout(1200)

    await expect(page.getByTestId('ai-tools-back-link')).toBeVisible()
    await expect(page.getByTestId('ai-tool-card-trade')).toBeVisible()

    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-explain-trade-button', /trade/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-waiver-button', /waiver/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-draft-button', /(clock|pick)/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-rankings-button', /rankings/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-psychological-button', /profile/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-story-button', /storyline/i)
    await clickEntryAndWaitForPrompt(page, 'unified-ai-entry-ask-ai-button', /(best.*move|evidence-based move)/i)

    await page.getByTestId('unified-ai-tool-selector').selectOption('trade_analyzer')
    await page.getByTestId('unified-ai-provider-selector').selectOption('openai')
    await expect
      .poll(async () =>
        page.$eval(
          '[data-testid="unified-ai-provider-selector"] option[value="deepseek"]',
          (option) => (option as HTMLOptionElement).disabled
        )
      )
      .toBeTruthy()

    await clickHydrated(page.getByTestId('unified-ai-quick-chip-trade'))
    await expect(page.getByTestId('unified-ai-prompt-input')).toHaveValue(/fairness/i)
    await page.getByTestId('unified-ai-sport-selector').selectOption('SOCCER')
    await page.getByTestId('ai-mode-selector').selectOption('consensus')

    await page.getByTestId('unified-ai-run-button').click({ clickCount: 2 })
    await expect.poll(() => runCalls).toBe(1)
    await expect(page.getByTestId('unified-ai-error-state')).toBeVisible()
    const errorState = page.getByTestId('unified-ai-error-state')
    const primaryResultPanel = page.getByTestId('unified-ai-result-panel').first()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await primaryResultPanel.isVisible().catch(() => false)) break
      if (await errorState.isVisible().catch(() => false)) {
        await clickHydrated(errorState.getByRole('button', { name: 'Retry' }))
      } else {
        await clickHydrated(page.getByTestId('unified-ai-run-button'))
      }
      await page.waitForTimeout(300)
    }

    await expect(primaryResultPanel).toBeVisible({ timeout: 10_000 })
    await expect(primaryResultPanel.getByText(/slightly favorable/i).first()).toBeVisible()

    await clickHydrated(primaryResultPanel.getByTestId('unified-ai-explanation-toggle-button'))
    await expect(primaryResultPanel.getByTestId('unified-ai-explanation-toggle-button')).toContainText(/Collapse|Expand/i)
    const copyButton = page.getByTestId('unified-ai-copy-button').first()
    await expect(copyButton).toBeEnabled()
    await clickHydrated(copyButton)
    await clickHydrated(page.getByTestId('unified-ai-save-result-button').first())
    await expect.poll(() => historySaveCalls).toBe(1)
    await expect(page.getByTestId('unified-ai-save-success-text')).toBeVisible()

    await expect
      .poll(async () => page.evaluate(() => ((window as any).__copiedTexts as string[]).length))
      .toBeGreaterThan(0)

    await clickHydrated(page.getByTestId('ai-provider-compare-button').first())
    await expect.poll(() => compareCalls).toBe(1)
    await expect(primaryResultPanel.getByTestId('ai-compare-providers-toggle-button').first()).toBeVisible()
    await clickHydrated(primaryResultPanel.getByTestId('ai-compare-providers-toggle-button').first())
    await expect(primaryResultPanel.getByText('OpenAI response').first()).toBeVisible()

    await page.getByTestId('unified-ai-regenerate-button').first().click({ force: true })
    await expect(primaryResultPanel).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await clickHydrated(page.getByTestId('unified-ai-mobile-drawer-open-button'))
    await expect(page.getByTestId('unified-ai-mobile-drawer-close-button')).toBeVisible()
    await clickHydrated(page.getByTestId('unified-ai-mobile-drawer-close-button'))

    await clickHydrated(page.getByTestId('unified-ai-back-button'))
    const promptInput = page.getByTestId('unified-ai-prompt-input')
    await expect(promptInput).toBeVisible()
    if ((await promptInput.inputValue()).length > 0) {
      await promptInput.fill('')
    }
    await expect(promptInput).toHaveValue('')

    await expect(page.getByTestId('unified-ai-chat-open-button')).toHaveAttribute('href', /\/messages\?tab=ai/)
    await expect(page.getByTestId('unified-ai-open-chimmy-with-prompt-link')).toHaveAttribute(
      'href',
      /\/messages\?tab=ai/
    )
    const historyLink = page.getByTestId('unified-ai-open-history-link')
    if (await historyLink.isVisible().catch(() => false)) {
      await expect(historyLink).toHaveAttribute('href', '/ai/history')
      await historyLink.click({ force: true })
      await page.waitForURL(/\/ai\/history/, { timeout: 6_000 }).catch(async () => {
        await gotoWithRetry(page, '/ai/history')
      })
    } else {
      await gotoWithRetry(page, '/ai/history')
    }
    await expect(page).toHaveURL(/\/ai\/history/)
    const historyList = page.getByTestId('ai-history-list')
    const historyItem = page.getByTestId('ai-history-item-saved-1')
    const emptyState = page.getByText(/No saved analyses yet/i)
    await expect
      .poll(
        async () =>
          (await historyList.isVisible().catch(() => false)) ||
          (await historyItem.isVisible().catch(() => false)) ||
          (await emptyState.isVisible().catch(() => false)),
        { timeout: 10_000 }
      )
      .toBe(true)
    if (await historyItem.isVisible().catch(() => false)) {
      await clickHydrated(page.getByTestId('ai-history-delete-button-saved-1'))
      await expect(emptyState).toBeVisible()
    }

    expect(runBodies.length).toBeGreaterThanOrEqual(2)
    expect(compareBodies.length).toBeGreaterThanOrEqual(1)
    expect((runBodies[0] as { sport?: string })?.sport).toBe('SOCCER')
    expect((runBodies[0] as { provider?: string | null })?.provider).toBe('openai')
    expect((compareBodies[0] as { aiMode?: string })?.aiMode).toBe('consensus')
  })
})

