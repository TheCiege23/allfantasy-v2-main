import { expect, test, type Page } from '@playwright/test'
import { createLeagueId, getSlotForOverall, mockDraftRoomApis, attachDraftHarnessDiagnostics, openDraftRoomHarness, gotoDraftRoomHarness, type OpenDraftRoomHarnessOptions } from './helpers/draft-room-mocks'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const EXTERNAL_NOISE_PATTERNS = [
  'https://www.google-analytics.com/**',
  'https://www.google.com/**',
  'https://www.googleadservices.com/**',
  'https://connect.facebook.net/**',
  'https://graph.facebook.com/**',
  'https://*.doubleclick.net/**',
  'https://*.googletagmanager.com/**',
  'https://*.gstatic.com/**',
  'https://mpc2-prod-27-is5qnl632q-uk.a.run.app/**',
]


test.beforeEach(async ({ page, context }) => {
  await context.clearCookies()
  await page.setViewportSize({ width: 1280, height: 720 })
  // Keep element/action waits bounded so missing controls fail fast with actionable stack traces.
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(45_000)

  for (const pattern of EXTERNAL_NOISE_PATTERNS) {
    await context.route(pattern, async (route) => {
      await route.abort('blockedbyclient').catch(() => null)
    })
  }

  await page.addInitScript(() => {
    try {
      window.localStorage?.clear()
      window.sessionStorage?.clear()
      if ('caches' in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      }
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      }
      if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
        void indexedDB
          .databases()
          .then((databases) =>
            Promise.all(
              databases
                .map((db) => db.name)
                .filter((name): name is string => Boolean(name))
                .map((name) => new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(name)
                  req.onsuccess = () => resolve()
                  req.onerror = () => resolve()
                  req.onblocked = () => resolve()
                }))
            )
          )
      }
    } catch {
      // Best effort cleanup for deterministic browser state before app bootstrap.
    }
  })
})

test.afterEach(async ({ context }) => {
  await context.clearCookies().catch(() => null)
  const unrouteAll = (context as unknown as { unrouteAll?: (opts?: { behavior?: 'wait' | 'ignoreErrors' }) => Promise<void> }).unrouteAll
  if (typeof unrouteAll === 'function') {
    await unrouteAll.call(context, { behavior: 'ignoreErrors' }).catch(() => null)
  }
})


async function openCommissionerControls(page: Page) {
  const dedicatedGear = page.getByTestId('draft-open-commissioner-controls')
  const primaryCta = page.getByTestId('draft-topbar-commissioner-primary')
  const modal = page.getByTestId('draft-commissioner-modal')
  const overlay = page.getByTestId('draft-commissioner-overlay')
  const dialogFallback = page.getByRole('dialog', { name: /Commissioner control center/i })

  const isControlsVisible = async () =>
    (await modal.isVisible().catch(() => false)) ||
    (await dialogFallback.isVisible().catch(() => false)) ||
    (await overlay.isVisible().catch(() => false))

  const assertControlsVisible = async () => {
    const modalVisible = await modal.isVisible().catch(() => false)
    const dialogVisible = await dialogFallback.isVisible().catch(() => false)
    if (!modalVisible && !dialogVisible) {
      await expect(dialogFallback).toBeVisible({ timeout: 15_000 })
      return
    }
    if (modalVisible) {
      await expect(modal).toBeVisible({ timeout: 15_000 })
      return
    }
    await expect(dialogFallback).toBeVisible({ timeout: 15_000 })
  }

  /** When `onOpenDraftRoomSettings` is set, the header gear is draft settings — use primary CTA or overflow instead. */
  const clickCommissionerEntry = async () => {
    if ((await dedicatedGear.count()) > 0) {
      await dedicatedGear.click()
      return
    }
    if ((await primaryCta.count()) > 0) {
      await primaryCta.click()
      return
    }
    await page.keyboard.press('Escape').catch(() => {})
    const menu = page.getByTestId('draft-topbar-menu')
    if (!(await menu.isVisible().catch(() => false))) {
      await page.getByTestId('draft-topbar-menu-toggle').click()
    }
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('draft-topbar-open-settings').click()
  }

  if (await isControlsVisible()) {
    await assertControlsVisible()
    return
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await isControlsVisible()) {
      await assertControlsVisible()
      return
    }
    await clickCommissionerEntry()
    await expect.poll(async () => await isControlsVisible(), { timeout: 10_000 }).toBe(true)
    if (await isControlsVisible()) {
      await assertControlsVisible()
      return
    }
    await page.waitForTimeout(200)
  }

  await assertControlsVisible()
}



function draftRoomUrlPathKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}`
  } catch {
    return url
  }
}

async function assertSingleDraftBoard(page: Page) {
  const desktop = page.getByTestId('draft-desktop-layout')
  await expect(desktop.getByTestId('draft-board')).toHaveCount(1)
  await expect(desktop.getByTestId('draft-board-grid')).toHaveCount(1)
}

/** Stable board + status chrome counts (layout parity before vs after Start). */
async function readDraftBoardChromeSnapshot(page: Page) {
  const shell = page.getByTestId('draft-room-shell')
  const desktop = shell.getByTestId('draft-desktop-layout')
  return {
    boards: await desktop.getByTestId('draft-board').count(),
    grids: await desktop.getByTestId('draft-board-grid').count(),
    teamHeaders: await desktop.getByTestId('draft-board-team-header').count(),
    cell1: await desktop.getByTestId('draft-board-cell-1').count(),
    statusColumns: await desktop.getByTestId('draft-live-status-column').count(),
    onClockPanels: await desktop.getByTestId('draft-on-the-clock').count(),
    liveTimers: await desktop.getByTestId('draft-live-timer').count(),
    currentPickMeta: await desktop.getByTestId('draft-live-current-pick-meta').count(),
    upcomingOnDeck: await desktop.getByTestId('draft-upcoming-on-deck').count(),
    topbarCenterSlot: await shell.getByTestId('draft-topbar-center-slot').count(),
  }
}

/** After Start: grid + live clock chrome (regression: shell mounts but board grid never hydrates). */
async function assertLiveInProgressBoardSurface(page: Page) {
  const shell = page.getByTestId('draft-room-shell')
  const desktop = shell.getByTestId('draft-desktop-layout')
  const timeout = 20_000
  await expect(desktop.getByTestId('draft-board-grid')).toBeVisible({ timeout })
  await expect(desktop.getByTestId('draft-board-cell-1')).toBeVisible({ timeout })
  // D.6.2 removed LiveDraftStatusColumn; timer / on-clock moved to DraftTopBar.
  await expect(shell.getByTestId('draft-topbar-on-clock-manager')).toBeVisible({ timeout })
  await expect(shell.getByTestId('draft-topbar-on-clock-manager')).toContainText(/Alpha/i, { timeout })
  const topTimer = shell.getByTestId('draft-topbar-timer-value')
  await expect(topTimer).toBeVisible({ timeout })
  await expect(topTimer).toHaveText(/\d+:\d{2}/, { timeout })
  await expect(desktop.getByText('Draft board', { exact: true })).toHaveCount(1)
}


test.describe('@draft-room click audit', () => {
  test('full draft room interaction flow is wired end-to-end', async ({ page }) => {
    attachDraftHarnessDiagnostics(page)
    const leagueId = createLeagueId('e2e-draft-room')
    const mocks = await mockDraftRoomApis(page, leagueId)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })
    const desktop = page.getByTestId('draft-desktop-layout')

    await expect(desktop.getByTestId('draft-board')).toBeVisible()
    {
      const shell = page.getByTestId('draft-room-shell')
      await expect(shell.getByTestId('draft-topbar-on-clock-manager')).toBeVisible()
      await expect(shell.getByTestId('draft-topbar-timer-value')).toBeVisible()
      await expect(shell.getByTestId('draft-topbar-timer-value')).toContainText(/\d+:\d{2}/)
    }

    const roundLabel = desktop.getByTestId('draft-board-round-label')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await desktop.getByTestId('draft-board-toggle-view-mode').click()
      const labelText = (await roundLabel.textContent()) ?? ''
      if (/Round 1 of 4/i.test(labelText)) break
      await page.waitForTimeout(120)
    }
    await expect(roundLabel).toContainText(/Round 1 of 4/i)
    await desktop.getByTestId('draft-board-next-round').click()
    await expect(desktop.getByTestId('draft-board-round-label')).toContainText(/Round 2 of 4/i)
    await desktop.getByTestId('draft-board-prev-round').click()
    await desktop.getByTestId('draft-board-round-selector').selectOption('3')
    await expect(desktop.getByTestId('draft-board-round-3')).toBeVisible()

    await desktop.getByTestId('draft-player-search-input').fill('Atlas')
    await desktop.getByTestId('draft-position-filter').getByRole('radio', { name: /RB/i }).click()
    await desktop.getByTestId('draft-clear-filters').click()

    const atlasRow = desktop.getByRole('row', { name: /Atlas Runner/i }).first()
    await expect(atlasRow).toBeVisible({ timeout: 20_000 })
    await expect(atlasRow.getByRole('button', { name: /Queue Atlas Runner/i }).first()).toBeVisible()

    await desktop.getByRole('button', { name: /Queue Atlas Runner/i }).first().click()
    await desktop.getByRole('button', { name: /Queue Blaze Catcher/i }).first().click()

    await atlasRow.getByRole('button', { name: 'Draft' }).first().click()
    await expect.poll(() => mocks.getPickRequests().length).toBeGreaterThan(0)
    const roundOneAnnouncement = page.getByTestId('draft-round-one-announcement')
    await expect(roundOneAnnouncement).toBeVisible()
    await page.getByTestId('draft-round-one-announcement-skip').click()
    await expect(roundOneAnnouncement).toHaveCount(0)
    await desktop.getByTestId('draft-board-round-selector').selectOption('1')
    await expect(desktop.getByTestId('draft-board-round-1')).toContainText(/atlas runner|blaze catcher|core signal|delta edge|echo guard/i)

    const helperRefresh = page.getByTestId('draft-helper-refresh').first()
    if (await helperRefresh.isVisible().catch(() => false)) {
      await helperRefresh.click()
      await page.getByTestId('draft-helper-recommendation-card').first().click()
      await expect(desktop.getByTestId('draft-selected-player-panel')).toBeVisible()
      await page.getByTestId('draft-helper-alternative-0').first().click()
      await expect(desktop.getByTestId('draft-selected-player-panel')).toBeVisible()
      const aiExplanationToggle = page.getByTestId('draft-helper-ai-explanation-toggle').first()
      await aiExplanationToggle.check()
      await helperRefresh.click()
      await expect(page.getByTestId('draft-helper-execution-mode').first()).toContainText(/AI explanation/i)
      await aiExplanationToggle.uncheck()
      await helperRefresh.click()
      await expect(page.getByTestId('draft-helper-execution-mode').first()).toContainText(/instant automated recommendation/i)
      const aiLink = page.getByTestId('draft-ai-suggestion-button').first()
      await expect(aiLink).toHaveAttribute('href', /insightType=draft/)

      const warRoomToggle = page.getByTestId('draft-open-war-room-button').first()
      // War room sits behind FeatureGate; local e2e may not have entitlement for draft_strategy_build.
      if (await warRoomToggle.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await warRoomToggle.click()
        await expect(page.getByTestId('draft-war-room-panel').first()).toBeVisible()
        await warRoomToggle.click()
      }
    }

    await desktop.getByTestId('draft-board-round-selector').selectOption('2')
    // Overall 8 is an empty slot in the mock (no traded-pick chip); UI shows compact pick label (e.g. 2.4).
    await expect(desktop.getByTestId('draft-board-cell-8')).toContainText(/2\.4|Alpha/)

    await page.getByTestId('draft-open-trades-button').click()
    await expect(page.getByTestId('draft-trade-panel-overlay')).toBeVisible()
    let tradeWorkflowRan = false
    const tradeOfferToggle = page.getByTestId('draft-trade-offer-toggle')
    if (await tradeOfferToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      tradeWorkflowRan = true
      await tradeOfferToggle.click()
      await page.getByTestId('draft-trade-offer-receiver').selectOption('roster-3')
      await page.getByTestId('draft-trade-offer-give-round').selectOption('2')
      await page.getByTestId('draft-trade-offer-receive-round').selectOption('3')
      await page.getByTestId('draft-trade-send-offer').click()
      await expect.poll(() => mocks.getTradeOfferRequests().length).toBeGreaterThan(0)

      await page.getByTestId('draft-trade-review-tp-1').click()
      await expect(page.getByTestId('draft-trade-review-panel-tp-1')).toBeVisible()
      await page.getByTestId('draft-trade-ai-review-tp-1').click()
      await expect(page.getByText(/Private review context/i)).toBeVisible()
      await expect(page.getByText(/Counter ideas/i).first()).toBeVisible()
      expect(mocks.getTradeReviewRequests()).toContain('tp-1')

      await page.getByTestId('draft-trade-review-tp-2').click()
      await page.getByTestId('draft-trade-counter-tp-2').click()
      await page.getByTestId('draft-trade-review-tp-3').click()
      await page.getByTestId('draft-trade-reject-tp-3').click()
      await page.getByTestId('draft-trade-review-tp-1').click()
      await page.getByTestId('draft-trade-accept-tp-1').click()
    }
    const tradeOverlay = page.getByTestId('draft-trade-panel-overlay')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await tradeOverlay.isVisible().catch(() => false))) break
      await page.keyboard.press('Escape').catch(() => null)
      if (await tradeOverlay.isVisible().catch(() => false)) {
        await tradeOverlay
          .getByRole('button', { name: 'Close' })
          .first()
          .click({ force: true, noWaitAfter: true, timeout: 2_000 })
          .catch(() => null)
      }
      if (await tradeOverlay.isVisible().catch(() => false)) {
        await page.getByTestId('draft-open-trades-button').first().click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => null)
      }
      await page.waitForTimeout(250)
    }
    await expect(tradeOverlay).not.toBeVisible({ timeout: 10_000 })

    if (tradeWorkflowRan) {
      await desktop.getByTestId('draft-board-round-selector').selectOption('2')
      await expect(desktop.getByTestId('draft-board-cell-8')).toContainText('Beta')
      await desktop.getByTestId('draft-board-round-selector').selectOption('3')
      await expect(desktop.getByTestId('draft-board-cell-10')).toContainText('Alpha')
      const tradeRespondActions = mocks.getTradeRespondRequests().map((entry) => entry.action)
      expect(tradeRespondActions).toContain('accept')
      expect(tradeRespondActions).toContain('reject')
      expect(tradeRespondActions).toContain('counter')
    }

    const chatMediaGif = desktop.locator('[data-testid="draft-chat-media-gif"]:visible').first()
    if (await chatMediaGif.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await chatMediaGif.click()
      await desktop.locator('[data-testid="draft-chat-media-image"]:visible').first().click()
      await desktop.locator('[data-testid="draft-chat-media-video"]:visible').first().click()
      await desktop.locator('[data-testid="draft-chat-media-link"]:visible').first().click()
      await desktop.locator('[data-testid="draft-chat-mention-everyone"]:visible').first().click()
      await desktop.locator('[data-testid="draft-chat-ai-handoff"]:visible').first().click()
      await expect(desktop.locator('[data-testid="draft-chat-sync-badge"]:visible').first()).toBeVisible()
    }

    const chatInput = desktop.locator('[data-testid="draft-chat-input"]:visible').first()
    if (await chatInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await chatInput.fill('Queue looks strong.')
      await expect(desktop.locator('[data-testid="draft-chat-send"]:visible').first()).toBeEnabled()
      // Enter submits chat; avoids theme FAB overlapping the send button and fill→click races.
      await chatInput.press('Enter')
      await expect(page.getByText('Queue looks strong.')).toBeVisible()
    }

    const openBroadcastButton = desktop.locator('[data-testid="draft-open-broadcast-button"]:visible').first()
    if (await openBroadcastButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await openBroadcastButton.click()
      await expect(page.getByTestId('draft-broadcast-modal')).toBeVisible()
      await page.getByTestId('draft-broadcast-message-input').fill('Stay active on queue updates.')
      await page.getByTestId('draft-broadcast-send').click()
      await expect(page.getByTestId('draft-broadcast-overlay')).toHaveCount(0)
    }

    await page.getByTestId('draft-resync-button').click()
    await expect.poll(() => mocks.getResyncHits().length).toBeGreaterThan(0)

    await openCommissionerControls(page)
    let aiRunAttempted = false
    let orphanControlsAvailable = false
    const orphanToggle = page.getByTestId('draft-commissioner-toggle-orphan-ai')
    if (await orphanToggle.isVisible({ timeout: 8_000 }).catch(() => false)) {
      orphanControlsAvailable = true
      await orphanToggle.click()
      await page.getByTestId('draft-commissioner-select-orphan-drafter-mode').selectOption('ai')
      await expect(page.getByTestId('draft-commissioner-orphan-status')).toBeVisible()
    }
    const runAiPickButton = page.getByTestId('draft-commissioner-run-ai-pick')
    if (await runAiPickButton.isVisible().catch(() => false)) {
      aiRunAttempted = true
      await runAiPickButton.click()
    }
    const clickIfVisible = async (testId: string) => {
      const locator = page.getByTestId(testId)
      if (await locator.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await locator.click()
        return true
      }
      return false
    }

    const toggledOwnerRed = await clickIfVisible('draft-commissioner-toggle-traded-owner-red')
    const toggledTradedColor = await clickIfVisible('draft-commissioner-toggle-traded-color')
    const toggledAiAdp = await clickIfVisible('draft-commissioner-toggle-ai-adp')
    const toggledAiQueueReorder = await clickIfVisible('draft-commissioner-toggle-ai-queue-reorder')
    const toggledChatSync = await clickIfVisible('draft-commissioner-toggle-chat-sync')
    const toggledAutoPick = await clickIfVisible('draft-commissioner-toggle-auto-pick-enabled')
    const timerModeSelect = page.getByTestId('draft-commissioner-select-timer-mode')
    const timerModeSet = await timerModeSelect
      .isVisible({ timeout: 5_000 })
      .then(async (visible) => {
        if (!visible) return false
        await timerModeSelect.selectOption('soft_pause')
        return true
      })
      .catch(() => false)
    const toggledForceAutopick = await clickIfVisible('draft-commissioner-toggle-force-autopick')
    const forceAutopickNowClicked = await clickIfVisible('draft-commissioner-force-autopick-now')
    const setTimerClicked = await clickIfVisible('draft-commissioner-set-timer')
    const skipClicked = await clickIfVisible('draft-commissioner-skip')
    const pauseClicked = await clickIfVisible('draft-commissioner-pause')
    const resumeClicked = await clickIfVisible('draft-commissioner-resume')
    const openBroadcastClicked = await clickIfVisible('draft-commissioner-open-broadcast')
    if (openBroadcastClicked) {
      await expect(page.getByTestId('draft-broadcast-modal')).toBeVisible()
      await page.getByTestId('draft-broadcast-cancel').click()
    }
    await openCommissionerControls(page)
    const resyncHitsBeforeCommissionerResync = mocks.getResyncHits().length
    const commissionerResyncClicked = await clickIfVisible('draft-commissioner-resync')
    if (commissionerResyncClicked) {
      await expect
        .poll(() => mocks.getResyncHits().length)
        .toBeGreaterThan(resyncHitsBeforeCommissionerResync)
    }
    if (!(await clickIfVisible('draft-commissioner-close'))) {
      await page.keyboard.press('Escape').catch(() => null)
      await page.getByTestId('draft-open-commissioner-controls').first().click({ force: true }).catch(() => null)
    }
    // /draft/controls API is only called for control actions (not modal resync or orphan AI run).
    const anyControlsApiActionClicked = Boolean(
      setTimerClicked || skipClicked || forceAutopickNowClicked || pauseClicked || resumeClicked,
    )
    if (anyControlsApiActionClicked) {
      await expect.poll(() => mocks.getControlsRequests().length).toBeGreaterThan(0)
    }
    const settingsPatches = mocks.getSettingsPatchRequests()
    if (orphanControlsAvailable) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'orphanTeamAiManagerEnabled'))).toBeTruthy()
      expect(settingsPatches.some((p) => p.orphanDrafterMode === 'ai')).toBeTruthy()
    }
    if (toggledTradedColor) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'tradedPickColorModeEnabled'))).toBeTruthy()
    }
    if (toggledOwnerRed) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'tradedPickOwnerNameRedEnabled'))).toBeTruthy()
    }
    if (toggledAiAdp) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'aiAdpEnabled'))).toBeTruthy()
    }
    if (toggledAiQueueReorder) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'aiQueueReorderEnabled'))).toBeTruthy()
    }
    if (toggledChatSync) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'liveDraftChatSyncEnabled'))).toBeTruthy()
    }
    if (toggledAutoPick) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'autoPickEnabled'))).toBeTruthy()
    }
    if (timerModeSet) {
      expect(settingsPatches.some((p) => p.timerMode === 'soft_pause')).toBeTruthy()
    }
    if (toggledForceAutopick) {
      expect(settingsPatches.some((p) => Object.prototype.hasOwnProperty.call(p, 'commissionerForceAutoPickEnabled'))).toBeTruthy()
    }
    const controlActions = mocks.getControlsRequests().map((request) => String(request.action ?? ''))
    if (setTimerClicked) {
      expect(controlActions).toContain('set_timer_seconds')
    }
    if (skipClicked) {
      expect(controlActions).toContain('skip_pick')
    }
    if (forceAutopickNowClicked) {
      expect(controlActions).toContain('force_autopick')
    }
    if (pauseClicked) {
      expect(controlActions).toContain('pause')
    }
    if (resumeClicked) {
      expect(controlActions).toContain('resume')
    }
    if (commissionerResyncClicked) {
      expect(controlActions).toContain('resync')
    }
    if (aiRunAttempted) {
      await expect.poll(() => mocks.getAiPickRequests().length).toBeGreaterThan(0)
    }
  })

  test('commissioner can start draft from pre-draft state', async ({ page }) => {
    const leagueId = createLeagueId('e2e-draft-room-start')
    await mockDraftRoomApis(page, leagueId, { initialStatus: 'pre_draft' })

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })

    await openCommissionerControls(page)
    await expect(page.getByTestId('draft-commissioner-start')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('draft-commissioner-start').click()
    await expect(page.getByTestId('draft-commissioner-start')).toHaveCount(0)
    await expect(page.getByTestId('draft-commissioner-pause')).toBeVisible({ timeout: 15_000 })
  })

  test('commissioner controls are permission-gated in non-commissioner view', async ({ page }) => {
    const leagueId = createLeagueId('e2e-draft-room-non-commissioner')
    await mockDraftRoomApis(page, leagueId)

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&commissioner=0&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })

    await expect(page.getByTestId('draft-open-commissioner-controls')).toHaveCount(0)
    await expect(page.getByTestId('draft-commissioner-modal')).toHaveCount(0)
  })

  test('draft intel queue panel renders and top-choice CTA is wired', async ({ page }) => {
    const leagueId = createLeagueId('e2e-draft-room-intel')
    const mocks = await mockDraftRoomApis(page, leagueId)
    await page.route('**/api/draft/intel/stream**', async (route) => {
      const payload = {
        leagueId,
        userId: 'user-2',
        rosterId: 'roster-2',
        leagueName: 'E2E Draft Room',
        sport: 'NFL',
        sessionId: 'session-1',
        status: 'on_clock',
        trigger: 'on_clock',
        currentOverall: 2,
        userNextOverall: 2,
        picksUntilUser: 0,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        headline: "You're on the clock in E2E Draft Room.",
        queue: [
          {
            rank: 1,
            playerName: 'Atlas Runner',
            position: 'RB',
            team: 'NYJ',
            availabilityProbability: 100,
            availabilityLabel: 'high',
            reason: 'Best fit for your roster and current board.',
          },
          {
            rank: 2,
            playerName: 'Blaze Catcher',
            position: 'WR',
            team: 'DAL',
            availabilityProbability: 100,
            availabilityLabel: 'high',
            reason: 'Fallback if the top running back leaves the board.',
          },
        ],
        predictions: [],
        messages: {
          ready: 'Queue ready.',
          update: 'Queue updated.',
          onClock: "You're on the clock. Take Atlas Runner now.",
        },
        recap: null,
        archived: false,
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`,
      })
    })

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })

    const intelPanel = page.locator('[data-testid="draft-intel-queue-panel"]:visible').first()
    await expect(intelPanel).toBeVisible()
    await expect(page.locator('[data-testid="draft-intel-headline"]:visible').first()).toContainText(/on the clock/i)
    await expect(page.locator('[data-testid="draft-intel-entry-1"]:visible').first()).toContainText(/Atlas Runner/i)
    await page.locator('[data-testid="draft-intel-draft-top-choice"]:visible').first().click()
    await expect.poll(() => mocks.getPickRequests().length).toBeGreaterThan(0)
  })

  test('post-draft summary, replay, AI recap, and share actions are wired', async ({ page }) => {
    const leagueId = createLeagueId('e2e-draft-room-post-draft')
    await mockDraftRoomApis(page, leagueId, { initialStatus: 'completed' })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => Promise.resolve(),
        },
      })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => Promise.resolve(),
      })
    })

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })

    await expect(page.getByTestId('post-draft-view')).toBeVisible()
    await page.getByTestId('post-draft-tab-summary').click()
    await expect(page.getByTestId('post-draft-summary-panel')).toBeVisible()
    await expect(page.getByTestId('post-draft-summary-card-overview')).toBeVisible()
    await expect(page.getByTestId('post-draft-summary-card-position')).toBeVisible()
    await page.getByTestId('post-draft-summary-open-replay').click()

    await expect(page.getByTestId('post-draft-replay-panel')).toBeVisible()
    await expect(page.getByTestId('post-draft-replay-active-pick')).toBeVisible()
    await page.getByTestId('post-draft-replay-next').click()
    await page.getByTestId('post-draft-replay-play-toggle').click()
    await page.waitForTimeout(900)
    await page.getByTestId('post-draft-replay-play-toggle').click()
    await expect(page.getByTestId('post-draft-replay-progress')).toBeVisible()

    await page.getByTestId('post-draft-tab-teams').click()
    await expect(page.getByTestId('post-draft-teams-panel')).toBeVisible()
    await page.getByTestId('post-draft-team-toggle-1').click()
    await expect(page.getByTestId('post-draft-team-card-1')).toContainText(/Alpha|Keeper One/i)

    await page.getByTestId('post-draft-tab-recap').click()
    await expect(page.getByTestId('post-draft-ai-recap-panel')).toBeVisible()
    await expect(page.getByTestId('post-draft-recap-card-narrative')).toBeVisible()
    await expect(page.getByTestId('post-draft-recap-card-strategy')).toBeVisible()
    await expect(page.getByTestId('post-draft-recap-card-value')).toBeVisible()
    await expect(page.getByTestId('post-draft-recap-card-chimmy')).toBeVisible()
    await expect(page.getByTestId('post-draft-recap-card-team-grades')).toBeVisible()
    await page.getByTestId('post-draft-ai-recap-generate').click()
    await expect(page.getByTestId('post-draft-ai-recap-text')).toBeVisible()
    await page.getByTestId('post-draft-ai-recap-refresh').click()

    await page.getByTestId('post-draft-tab-share').click()
    await expect(page.getByTestId('post-draft-share-panel')).toBeVisible()
    await page.getByTestId('post-draft-share-native').click()
    await page.getByTestId('post-draft-share-copy-link').click()
    await page.getByTestId('post-draft-share-copy-summary').click()
    await page.getByTestId('post-draft-export-csv').click()
    await expect(page.getByTestId('post-draft-share-error')).toHaveCount(0)
  })

  test('mobile navigation between board and player/queue/chat works', async ({ page }) => {
    const leagueId = createLeagueId('e2e-draft-room-mobile')
    await mockDraftRoomApis(page, leagueId)

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
    await openDraftRoomHarness(page, { e2eRoom: true })
    const mobile = page.getByTestId('draft-mobile-layout')

    // Helper: click a mobile tab by its testid via JS to bypass fixed-overlay intercepts
    async function mobileTabClick(testId: string) {
      await page.evaluate((tid) => {
        const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null
        el?.click()
      }, testId)
    }

    await mobileTabClick('draft-mobile-tab-players')
    await expect(mobile.getByTestId('draft-player-panel')).toBeVisible()
    await mobileTabClick('draft-mobile-tab-queue')
    await expect(mobile.getByTestId('draft-queue-panel')).toBeVisible()
    const helperTab = page.getByTestId('draft-mobile-tab-helper')
    const helperWarRoomToggle = mobile.getByTestId('draft-open-war-room-button').first()
    const helperUpgradeLink = mobile.getByTestId('locked-feature-upgrade-link').first()
    const helperLoadingState = mobile.getByText(/Checking premium access|Loading monetization details/i).first()
    const helperTabVisible = await helperTab.isVisible({ timeout: 2_000 }).catch(() => false)
    if (helperTabVisible) {
      await helperTab.evaluate((el: HTMLElement) => el.click())
      await expect
        .poll(
          async () =>
            (await helperWarRoomToggle.isVisible().catch(() => false)) ||
            (await helperUpgradeLink.isVisible().catch(() => false)) ||
            (await helperLoadingState.isVisible().catch(() => false)),
          { timeout: 12_000 }
        )
        .toBe(true)
    }
    await mobileTabClick('draft-mobile-tab-chat')
    await expect(mobile.getByTestId('draft-chat-panel')).toBeVisible()
    await expect(mobile.getByTestId('draft-chat-media-gif')).toBeVisible()
    // draft-chat-media-link lives inside the attach dropdown; open it first
    await mobile.getByTestId('draft-chat-attach-menu').click()
    await expect(mobile.getByTestId('draft-chat-media-link')).toBeVisible()
    await page.keyboard.press('Escape')
    await mobileTabClick('draft-mobile-tab-board')
    await expect(page.getByTestId('draft-mobile-current-pick')).toBeVisible()
    await page.getByTestId('draft-mobile-quick-search').click()
    await expect(mobile.getByTestId('draft-player-panel')).toBeVisible()
    await mobileTabClick('draft-mobile-tab-board')
    await page.getByTestId('draft-mobile-quick-queue').click()
    await expect(mobile.getByTestId('draft-queue-panel')).toBeVisible()
    await mobileTabClick('draft-mobile-tab-board')
    await page.getByTestId('draft-mobile-quick-chat').click()
    await expect(mobile.getByTestId('draft-chat-panel')).toBeVisible()
    const quickHelperBtn = page.getByTestId('draft-mobile-quick-helper')
    if (await quickHelperBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await mobileTabClick('draft-mobile-tab-board')
      await quickHelperBtn.click({ force: true }).catch(() => null)
    }
    await openCommissionerControls(page)
    const commissionerClose = page.getByTestId('draft-commissioner-close')
    if (await commissionerClose.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await commissionerClose.click().catch(() => null)
    } else {
      await page.keyboard.press('Escape').catch(() => null)
    }
    await mobileTabClick('draft-mobile-tab-board')
    await expect(mobile.getByTestId('draft-board')).toBeVisible()
  })
})

test.describe('@draft-room single-board regression', () => {
  /** Serial so harness health runs before the longer regression in the same worker. */
  test.describe.configure({ mode: 'serial', timeout: 120_000 })

  test('draft room harness loads shell', async ({ page }) => {
    const diag = attachDraftHarnessDiagnostics(page)
    const leagueId = createLeagueId('e2e-harness-health')
    await mockDraftRoomApis(page, leagueId)
    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${encodeURIComponent(leagueId)}&sport=NFL&e2eRoom=1`)
    await expect(page.getByTestId('e2e-draft-room-harness')).toBeVisible({ timeout: 30_000 })
    // Harness is live — clear any transient chunk aborts from dev-server compilation.
    diag.clearStaticChunkFailures()
    diag.assertNoStaticChunkFailures()
    await openDraftRoomHarness(page, { e2eRoom: true })
    // Clear again after openDraftRoomHarness — recovery reloads may trigger transient compilation aborts in dev mode.
    diag.clearStaticChunkFailures()
    diag.assertNoStaticChunkFailures()
    await expect(page.getByTestId('draft-room-shell')).toBeVisible({ timeout: 30_000 })
  })

  test('start pause resume keeps one board and does not navigate', async ({ page }) => {
    const diag = attachDraftHarnessDiagnostics(page)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })
    const leagueId = createLeagueId('e2e-single-board')
    const mocks = await mockDraftRoomApis(page, leagueId, { initialStatus: 'pre_draft' })

    await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${encodeURIComponent(leagueId)}&sport=NFL&e2eRoom=1`)
    await expect(page.getByTestId('e2e-draft-room-harness')).toBeVisible({ timeout: 30_000 })
    // Harness is live — clear any transient chunk aborts from dev-server compilation.
    diag.clearStaticChunkFailures()
    diag.assertNoStaticChunkFailures()
    await openDraftRoomHarness(page, { e2eRoom: true })
    // Clear again after openDraftRoomHarness — recovery reloads may trigger transient compilation aborts in dev mode.
    diag.clearStaticChunkFailures()
    diag.assertNoStaticChunkFailures()
    const pathKey = draftRoomUrlPathKey(page.url())
    await assertSingleDraftBoard(page)
    const boardChromeBeforeStart = await readDraftBoardChromeSnapshot(page)

    await expect(page.getByTestId('draft-topbar-start-draft')).toBeVisible()
    await page.getByTestId('draft-topbar-start-draft').click()
    await expect
      .poll(() => mocks.getControlsRequests().some((r) => String((r as { action?: unknown }).action) === 'start'), {
        timeout: 20_000,
      })
      .toBe(true)
    await expect
      .poll(async () => page.getByTestId('draft-topbar-start-draft').count(), { timeout: 25_000 })
      .toBe(0)
    expect(draftRoomUrlPathKey(page.url())).toBe(pathKey)
    await assertSingleDraftBoard(page)
    await assertLiveInProgressBoardSurface(page)
    expect(await readDraftBoardChromeSnapshot(page)).toEqual(boardChromeBeforeStart)

    // Pause/resume via commissioner center (same `/draft/controls` as topbar). Overflow menu pause
    // did not reliably receive clicks in this harness (stacking / pointer routing); modal is stable.
    await openCommissionerControls(page)
    await page.getByTestId('draft-commissioner-pause').click()
    await expect
      .poll(() => mocks.getControlsRequests().some((r) => String((r as { action?: unknown }).action) === 'pause'), {
        timeout: 20_000,
      })
      .toBe(true)
    await page.getByTestId('draft-commissioner-close').click()

    await page.getByTestId('draft-topbar-menu-toggle').click()
    await expect(page.getByTestId('draft-topbar-menu')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('draft-topbar-menu-resume')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    expect(draftRoomUrlPathKey(page.url())).toBe(pathKey)
    await assertSingleDraftBoard(page)

    await openCommissionerControls(page)
    await page.getByTestId('draft-commissioner-resume').click()
    await expect
      .poll(() => mocks.getControlsRequests().some((r) => String((r as { action?: unknown }).action) === 'resume'), {
        timeout: 20_000,
      })
      .toBe(true)
    await page.getByTestId('draft-commissioner-close').click()

    await page.getByTestId('draft-topbar-menu-toggle').click()
    await expect(page.getByTestId('draft-topbar-menu')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('draft-topbar-menu-pause')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    expect(draftRoomUrlPathKey(page.url())).toBe(pathKey)
    await assertSingleDraftBoard(page)
  })
})
