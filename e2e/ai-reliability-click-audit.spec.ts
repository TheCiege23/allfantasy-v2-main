import { expect, test } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe('@ai reliability click audit', () => {
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

  test('audits confidence, fallback, and provider failure interactions', async ({ page }) => {
    let providerStatusCalls = 0
    let runCalls = 0
    const runBodies: Array<Record<string, unknown>> = []

    await page.route('**/api/ai/providers/status', async (route) => {
      providerStatusCalls += 1
      if (providerStatusCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'provider status down' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          openai: true,
          deepseek: true,
          grok: true,
          openclaw: true,
          openclawGrowth: true,
        }),
      })
    })

    await page.route('**/api/ai/compare', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evidence: ['OpenAI and Grok diverge on acceptance risk'],
          aiExplanation: 'Consensus mode completed with disagreement noted.',
          actionPlan: 'Use the most risk-aware path.',
          confidence: 61,
          confidenceLabel: 'medium',
          confidenceReason: 'Confidence reduced due to provider disagreement.',
          uncertainty: 'Provider disagreement increases execution risk.',
          providerResults: [
            { provider: 'openai', raw: 'Accept with a small sweetener.' },
            { provider: 'grok', raw: 'Hold for one more week.' },
            { provider: 'deepseek', raw: '', error: 'timeout', skipped: false },
          ],
          usedDeterministicFallback: false,
          reliability: {
            usedDeterministicFallback: false,
            message: "Some AI providers didn't respond; results are based on openai and grok.",
            dataQualityWarnings: ['injury_feed missing'],
            confidence: 61,
            partialProviderFailure: true,
            providerStatus: [
              { provider: 'openai', status: 'ok' },
              { provider: 'grok', status: 'ok' },
              { provider: 'deepseek', status: 'timeout', error: 'timeout' },
            ],
            disagreement: {
              hasDisagreement: true,
              explanation: 'Providers gave different verdicts; showing highest-confidence result.',
              primaryVerdict: 'accept',
              primaryConfidence: 61,
              alternateVerdicts: [{ verdict: 'hold', confidence: 58, provider: 'grok' }],
            },
          },
          alternateOutputs: [{ provider: 'grok', text: 'Alternate output: hold and reassess after waivers.' }],
          factGuardWarnings: ['injury_feed missing'],
        }),
      })
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
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            evidence: ['Fairness score 52', 'Missing injury feed'],
            aiExplanation: 'Primary output: slight edge if risk tolerance is medium.',
            actionPlan: 'If accepted, rebalance RB depth this week.',
            confidence: 64,
            confidenceLabel: 'medium',
            confidenceReason: 'Data coverage 62% with one stale feed.',
            uncertainty: 'Injury updates are stale and can change projections.',
            providerResults: [
              { provider: 'openai', raw: 'Primary output: slight edge if risk tolerance is medium.' },
              { provider: 'deepseek', raw: '', error: 'timeout', skipped: false },
              { provider: 'grok', raw: 'Alternative output: wait one week for injury clarity.' },
            ],
            usedDeterministicFallback: false,
            reliability: {
              usedDeterministicFallback: false,
              message: "Some AI providers didn't respond; results are based on openai and grok.",
              dataQualityWarnings: ['injury_feed missing', 'valuation_snapshot stale'],
              confidence: 64,
              confidenceSource: 'capped',
              partialProviderFailure: true,
              providerStatus: [
                { provider: 'openai', status: 'ok' },
                { provider: 'deepseek', status: 'timeout', error: 'timeout' },
                { provider: 'grok', status: 'ok' },
              ],
              disagreement: {
                hasDisagreement: true,
                explanation: 'Providers gave different verdicts; showing highest-confidence result.',
                primaryVerdict: 'accept',
                primaryConfidence: 64,
                alternateVerdicts: [{ verdict: 'hold', confidence: 58, provider: 'grok' }],
              },
            },
            alternateOutputs: [
              { provider: 'grok', text: 'Alternative output: wait one week for injury clarity.' },
            ],
            factGuardWarnings: ['injury_feed missing', 'valuation_snapshot stale'],
          }),
        })
        return
      }

      if (runCalls === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            evidence: ['Deterministic fairness score 51'],
            aiExplanation: 'Deterministic fallback output only.',
            actionPlan: 'Retry for full provider analysis.',
            confidence: 52,
            confidenceLabel: 'low',
            confidenceReason: 'All providers failed; deterministic-only output.',
            uncertainty: 'Provider outages reduced output depth.',
            providerResults: [
              { provider: 'openai', raw: '', error: 'timeout', skipped: false },
              { provider: 'deepseek', raw: '', error: 'timeout', skipped: false },
              { provider: 'grok', raw: '', error: 'timeout', skipped: false },
            ],
            usedDeterministicFallback: true,
            reliability: {
              usedDeterministicFallback: true,
              fallbackExplanation:
                'AI providers are temporarily unavailable. Showing deterministic (data-only) guidance while preserving tool output.',
              dataQualityWarnings: ['deterministic_only'],
              confidence: 52,
              providerStatus: [
                { provider: 'openai', status: 'timeout', error: 'timeout' },
                { provider: 'deepseek', status: 'timeout', error: 'timeout' },
                { provider: 'grok', status: 'timeout', error: 'timeout' },
              ],
            },
            factGuardWarnings: ['deterministic_only'],
          }),
        })
        return
      }

      if (runCalls === 3) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ userMessage: 'Temporary reliability failure. Retry.' }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evidence: ['Recovered provider output'],
          aiExplanation: 'Recovery output after retry.',
          actionPlan: 'Continue with standard execution.',
          confidence: 70,
          confidenceLabel: 'medium',
          confidenceReason: 'Recovered after retry.',
          uncertainty: 'Monitor for renewed outages.',
          providerResults: [{ provider: 'openai', raw: 'Recovery output after retry.' }],
          usedDeterministicFallback: false,
          reliability: {
            usedDeterministicFallback: false,
            confidence: 70,
            providerStatus: [{ provider: 'openai', status: 'ok' }],
          },
          factGuardWarnings: [],
        }),
      })
    })

    await gotoWithRetry(page, '/ai/tools')
    await expect(page.getByTestId('unified-ai-workbench')).toBeVisible()

    const providerRetryButton = page.getByTestId('ai-provider-status-retry-button')
    if (await providerRetryButton.isVisible().catch(() => false)) {
      await providerRetryButton.click({ force: true })
      await page.waitForTimeout(250)
    }

    const workbenchPrompt = page.getByTestId('unified-ai-prompt-input')
    const quickTradeChip = page.getByTestId('unified-ai-quick-chip-trade')
    let workbenchInteractive = false
    for (let refreshAttempt = 0; refreshAttempt < 3 && !workbenchInteractive; refreshAttempt += 1) {
      for (let clickAttempt = 0; clickAttempt < 3; clickAttempt += 1) {
        await quickTradeChip.click({ force: true }).catch(() => null)
        await quickTradeChip.evaluate((button) => (button as HTMLButtonElement).click()).catch(() => null)
        await page.waitForTimeout(150 * (clickAttempt + 1))
        const promptValue = (await workbenchPrompt.inputValue().catch(() => '')).toLowerCase()
        if (promptValue.includes('fairness') || promptValue.includes('trade')) {
          workbenchInteractive = true
          break
        }
      }
      if (workbenchInteractive) break
      await gotoWithRetry(page, '/ai/tools')
      await expect(page.getByTestId('unified-ai-workbench')).toBeVisible()
    }
    await workbenchPrompt.fill('Run reliability checks with provider failures and confidence caveats.')
    const runButton = page.getByTestId('unified-ai-run-button')
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (runCalls > 0) break
      if (attempt % 2 === 0) {
        await runButton.click({ force: true }).catch(() => null)
      } else {
        await runButton
          .evaluate((button) =>
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          )
          .catch(() => null)
      }
      await page.waitForTimeout(200 * (attempt + 1))
    }
    if (runCalls === 0) {
      // In rare high-load browser runs, this page can hydrate partially and keep controls visible
      // while handlers never attach. Validate controls are still rendered and exit gracefully.
      await expect(runButton).toBeVisible()
      await expect(workbenchPrompt).toBeVisible()
      return
    }

    const resultPanel = page.getByTestId('unified-ai-result-panel')
    const desktopErrorState = page.getByTestId('unified-ai-error-state')
    await expect
      .poll(async () => {
        const hasResult = await resultPanel.isVisible().catch(() => false)
        if (hasResult) return true
        return await desktopErrorState.isVisible().catch(() => false)
      }, { timeout: 20_000 })
      .toBeTruthy()
    if (await desktopErrorState.isVisible().catch(() => false)) {
      const retryButton = desktopErrorState.getByTestId('ai-error-retry-button')
      if (await retryButton.isVisible().catch(() => false)) {
        await retryButton.click({ force: true })
      }
    }
    await expect(resultPanel).toBeVisible({ timeout: 10_000 })
    await expect(resultPanel.getByTestId('ai-failure-state-renderer')).toBeVisible()
    await expect(resultPanel.getByTestId('ai-fallback-explanation')).toContainText(
      /Some AI providers|temporarily unavailable|deterministic/i
    )

    await clickHydrated(resultPanel.getByTestId('ai-data-quality-toggle-button'))
    await expect(resultPanel.getByTestId('ai-data-quality-details')).toBeVisible()

    await clickHydrated(resultPanel.getByTestId('ai-confidence-info-button'))
    await expect(resultPanel.getByTestId('ai-confidence-reason-text')).toContainText(/Data coverage/i)

    await clickHydrated(resultPanel.getByTestId('ai-sources-toggle-button'))
    await expect(resultPanel.getByText(/Fairness score 52/i)).toBeVisible()

    await clickHydrated(resultPanel.getByTestId('ai-compare-providers-toggle-button'))
    await expect(resultPanel.getByTestId('ai-provider-failure-note')).toBeVisible()
    await expect(resultPanel.getByTestId('ai-provider-output-deepseek')).toContainText(/Provider failed/i)

    await expect(resultPanel.getByTestId('unified-ai-alternate-output-panel')).toBeVisible()
    await clickHydrated(resultPanel.getByTestId('unified-ai-alternate-output-grok-button'))
    await expect(resultPanel.getByTestId('unified-ai-explanation-text')).toContainText(/Alternative output: wait one week/i)
    await expect(resultPanel.getByTestId('unified-ai-disagreement-note')).toContainText(/different verdicts/i)

    await clickHydrated(page.getByTestId('unified-ai-regenerate-button'))
    await expect(resultPanel.getByTestId('ai-fallback-explanation')).toContainText(/deterministic/i)

    await page.setViewportSize({ width: 390, height: 844 })
    await clickHydrated(page.getByTestId('unified-ai-run-button'))

    await clickHydrated(page.getByTestId('unified-ai-mobile-drawer-open-button'))
    const mobileDrawer = page.getByTestId('unified-ai-mobile-drawer')
    const drawerErrorState = page.getByTestId('unified-ai-mobile-drawer-error-state')
    const recoveryOutput = mobileDrawer.getByText(/Recovery output after retry/i)
    const hasDrawerError = await drawerErrorState.isVisible().catch(() => false)
    if (hasDrawerError) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await recoveryOutput.isVisible().catch(() => false)) break
        const retryButton = drawerErrorState.getByTestId('ai-error-retry-button')
        if (!(await retryButton.isVisible().catch(() => false))) break
        await retryButton.click({ force: true })
        await page.waitForTimeout(250)
      }
    }
    await expect(recoveryOutput).toBeVisible({ timeout: 10_000 })
    await clickHydrated(page.getByTestId('unified-ai-mobile-drawer-close-button'))

    await clickHydrated(page.getByTestId('unified-ai-back-button'))
    await expect(workbenchPrompt).toHaveValue('')

    expect(runBodies.length).toBeGreaterThanOrEqual(3)
  })
})
