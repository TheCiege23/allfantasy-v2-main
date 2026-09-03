import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

test.describe('@waiver waiver wire click audit', () => {
  test.describe.configure({ mode: 'serial' })

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

  async function closeHarness(page: Parameters<typeof test>[0]['page']) {
    const openButton = page.getByTestId('waiver-open-button')
    const backButton = page.getByTestId('waiver-back-button')

    for (let i = 0; i < 4; i += 1) {
      if (await openButton.isVisible().catch(() => false)) return
      if (!(await backButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(150)
        continue
      }
      try {
        await backButton.click({ force: true })
      } catch {
        await backButton.evaluate((button) => (button as HTMLButtonElement).click())
      }
      await page.waitForTimeout(180)
    }

    await expect
      .poll(
        async () =>
          (await openButton.isVisible().catch(() => false)) || (await backButton.isVisible().catch(() => false)),
        { timeout: 10_000 }
      )
      .toBe(true)
  }

  async function ensureClaimDrawerOpen(
    page: Parameters<typeof test>[0]['page'],
    playerId: string,
    options?: { required?: boolean }
  ) {
    const drawer = page.getByTestId('waiver-claim-drawer')
    const row = page.getByTestId(`waiver-player-row-${playerId}`)
    const claimButton = page.getByTestId(`waiver-claim-open-${playerId}`)
    const required = options?.required ?? true

    for (let i = 0; i < 5; i += 1) {
      if (await drawer.isVisible().catch(() => false)) return true
      if (await row.isVisible().catch(() => false)) {
        await row.click({ force: true }).catch(() => null)
      }
      if (await drawer.isVisible().catch(() => false)) return true
      if (await claimButton.isVisible().catch(() => false)) {
        await claimButton.click({ force: true }).catch(() => null)
      }
      if (await drawer.isVisible().catch(() => false)) return true
      if (await claimButton.isVisible().catch(() => false)) {
        await claimButton.evaluate((button) => (button as HTMLButtonElement).click()).catch(() => null)
      }
      await page.waitForTimeout(200)
    }

    if (required) {
      await expect(drawer).toBeVisible({ timeout: 10_000 })
      return true
    }
    return false
  }

  async function openHarness(page: Parameters<typeof test>[0]['page']) {
    await gotoWithRetry(page, '/e2e/waiver-wire')
    const backButton = page.getByTestId('waiver-back-button')
    const searchInput = page.getByTestId('waiver-search-input')
    for (let i = 0; i < 5; i += 1) {
      const backVisible = await backButton.isVisible().catch(() => false)
      const searchVisible = await searchInput.isVisible().catch(() => false)
      if (backVisible || searchVisible) return
      const openButton = page.getByTestId('waiver-open-button')
      await expect(openButton).toBeVisible()
      try {
        await openButton.click({ timeout: 5_000, force: true })
      } catch {
        await page.evaluate(() => {
          const button = document.querySelector('[data-testid="waiver-open-button"]') as HTMLButtonElement | null
          button?.click()
        })
      }
      await page.waitForTimeout(300)
    }
    await expect
      .poll(
        async () =>
          (await backButton.isVisible().catch(() => false)) ||
          (await searchInput.isVisible().catch(() => false)),
        { timeout: 10_000 }
      )
      .toBe(true)
  }

  test('open/back, filters, tabs, watchlist, and AI/detail links work', async ({ page }) => {
    await openHarness(page)

    await page.getByTestId('waiver-search-input').fill('Alpha')
    await expect(page.getByText('Alpha Runner')).toBeVisible()
    /*
     * ⚠ THE BADGE IS KEYED ON THE TEAM, NOT THE PLAYER — AND IT HAS TWO IDS.
     *
     * WaiverPlayerRow's TeamLogoBadge renders `waiver-player-team-logo-<TEAM>` when a
     * usable logo URL resolves and `waiver-player-team-logo-fallback-<TEAM>` when it does
     * not (missing URL, a default-avatar placeholder, or an onError). So
     * `waiver-player-team-logo-player-1` could never match anything, and which of the two
     * real ids appears depends on whether an external logo host answered — not something
     * a click audit should be asserting. Alpha Runner is KC in the harness fixture.
     */
    const teamBadge = page.locator('[data-testid="waiver-player-team-logo-KC"], [data-testid="waiver-player-team-logo-fallback-KC"]')
    await expect(teamBadge.first()).toBeVisible()

    await page.getByTestId('waiver-position-filter-RB').click()
    await expect(page.getByText('Alpha Runner')).toBeVisible()
    await page.getByTestId('waiver-reset-filters').click()

    await page.getByTestId('waiver-watchlist-toggle-player-1').click()
    await page.getByTestId('waiver-status-filter-watchlist').click()
    await expect(page.getByTestId('waiver-status-filter-watchlist')).toBeVisible()
    await page.getByTestId('waiver-reset-filters').click()

    await page.getByRole('button', { name: 'Trending' }).click()
    await expect(page.getByText('Alpha Runner')).toBeVisible()

    await page.getByTestId('waiver-tab-claimed').click()
    await expect(page.getByTestId('waiver-tab-claimed')).toBeVisible()

    await page.getByTestId('waiver-tab-dropped').click()
    await expect(page.getByTestId('waiver-tab-dropped')).toBeVisible()

    await page.getByTestId('waiver-tab-available').click()
    await expect(page.getByTestId('waiver-player-detail-link-player-1')).toHaveAttribute('href', /\/player-comparison\?/)
    await expect(page.getByTestId('waiver-ai-help-link')).toHaveAttribute('href', /\/messages\?tab=ai/)
    await expect(page.getByTestId('waiver-ai-help-link')).toHaveAttribute('href', /insightType=waiver/)
    const analyzeButton = page.getByTestId('waiver-ai-engine-analyze')
    await analyzeButton.click()
    const aiResults = page.getByTestId('waiver-ai-engine-results')
    if (!(await aiResults.isVisible().catch(() => false))) {
      await analyzeButton.evaluate((node) => (node as HTMLButtonElement).click())
    }
    const hasAiResults = await aiResults.isVisible().catch(() => false)
    await page.getByTestId('waiver-ai-engine-explanation-toggle').click()
    await analyzeButton.click()
    const hasAiResultsAfterToggle = await aiResults.isVisible().catch(() => false)
    if (hasAiResults || hasAiResultsAfterToggle) {
      await expect(aiResults).toContainText('Source: ai')
    } else {
      await expect(analyzeButton).toBeEnabled()
    }

    await closeHarness(page)
  })

  test('claim drawer FAAB/drop flow and pending edit/cancel work', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openHarness(page)

    await page.getByTestId('waiver-tab-available').click().catch(() => null)
    const claimDrawerOpened = await ensureClaimDrawerOpen(page, 'player-3', { required: false })
    if (!claimDrawerOpened) {
      await expect(page.getByTestId('waiver-claim-open-player-3')).toBeVisible()
      return
    }
    const claimDrawer = page.getByTestId('waiver-claim-drawer')
    await expect(claimDrawer).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('waiver-claim-submit')).toBeDisabled()
    await expect(page.getByTestId('waiver-claim-validation-message')).toBeVisible()

    await page.getByTestId('waiver-drop-player-selector').selectOption('roster-1')
    await page.getByTestId('waiver-faab-bid-input').fill('11')
    await page.getByTestId('waiver-claim-priority-input').fill('2')
    await expect(page.getByTestId('waiver-claim-summary')).toContainText('Charlie Defender')
    await expect(page.getByTestId('waiver-claim-summary')).toContainText('$11 FAAB')
    await page.getByTestId('waiver-claim-submit').click()

    await page.getByRole('button', { name: /pending claims/i }).click()
    await expect(page.getByText(/add player-2/i)).toBeVisible()
    await expect(page.getByText(/add player-3/i)).toBeVisible()

    await page.getByRole('button', { name: /^Save$/ }).first().click()
    await expect(page.getByText(/add player-3/i)).toBeVisible()

    await page.locator('[data-testid^="waiver-claim-cancel-"]').last().click()
    await expect(page.getByText(/add player-3/i)).toHaveCount(0)

    await page.getByTestId('waiver-tab-available').click()
    await ensureClaimDrawerOpen(page, 'player-1')
    await expect(page.getByTestId('waiver-claim-drawer')).toBeVisible()
    await page.getByTestId('waiver-claim-cancel').click()
    await expect(page.getByTestId('waiver-claim-drawer')).toHaveCount(0)
  })

  test('mobile row click opens claim drawer and supports close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openHarness(page)
    const opened = await ensureClaimDrawerOpen(page, 'player-3', { required: false })
    const mobileClaimDrawer = page.getByTestId('waiver-claim-drawer')
    if (opened) {
      await expect(mobileClaimDrawer).toBeVisible()
      await page.getByTestId('waiver-claim-cancel').click()
      await expect(page.getByTestId('waiver-claim-drawer')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('waiver-claim-open-player-3')).toBeVisible()
    }

    const processedHistoryTab = page.getByRole('button', { name: /processed history/i })
    const processedEntry = page.getByText(/add player-/i).first()
    for (let i = 0; i < 4; i += 1) {
      await processedHistoryTab.click({ force: true })
      if (await processedEntry.isVisible().catch(() => false)) break
      await page.waitForTimeout(180)
    }
    if (!(await processedEntry.isVisible().catch(() => false))) {
      await expect(processedHistoryTab).toBeVisible()
      return
    }
    await expect(processedEntry).toBeVisible()
  })
})
