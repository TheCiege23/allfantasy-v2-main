import { test, expect, type Page } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

// See the helper: dev-mode CSP reports otherwise saturate the shared `next dev`.
test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

test.describe.configure({ timeout: 180_000 })

async function mockDraftSettingsApi(page: Page, leagueId: string) {
  let persisted = {
    draftOrderRandomizationEnabled: true,
    pickTradeEnabled: true,
    tradedPickColorModeEnabled: false,
    tradedPickOwnerNameRedEnabled: false,
    aiAdpEnabled: false,
    aiQueueReorderEnabled: false,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
    liveDraftChatSyncEnabled: true,
    autoPickEnabled: false,
    timerMode: 'per_pick',
    slowDraftPauseWindow: null,
    commissionerForceAutoPickEnabled: false,
  } as Record<string, unknown>

  const capturedPatches: Array<Record<string, unknown>> = []

  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: {
            draft_type: 'snake',
            rounds: 15,
            timer_seconds: 90,
            slow_timer_seconds: 3600,
            snake_or_linear: 'snake',
            pick_order_rules: 'snake',
            third_round_reversal: false,
            autopick_behavior: 'queue-first',
            queue_size_limit: 50,
            pre_draft_ranking_source: 'adp',
            roster_fill_order: 'starter_first',
            position_filter_behavior: 'by_eligibility',
            sport: 'NFL',
            variant: null,
            leagueSize: 12,
          },
          draftUISettings: persisted,
          isCommissioner: true,
          sessionPreDraft: true,
          draftOrderMode: 'randomize',
          lotteryConfig: null,
          orphanStatus: {
            orphanRosterIds: ['roster-orphan-1'],
            orphanTeamAiManagerEnabled: false,
            recentActions: [],
          },
        }),
      })
      return
    }

    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>
      capturedPatches.push(patch)
      persisted = { ...persisted, ...patch }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: {
            draft_type: 'snake',
            rounds: 15,
            timer_seconds: 90,
            slow_timer_seconds: 3600,
            snake_or_linear: 'snake',
            pick_order_rules: 'snake',
            third_round_reversal: false,
            autopick_behavior: 'queue-first',
            queue_size_limit: 50,
            pre_draft_ranking_source: 'adp',
            roster_fill_order: 'starter_first',
            position_filter_behavior: 'by_eligibility',
            sport: 'NFL',
            variant: null,
            leagueSize: 12,
          },
          draftUISettings: persisted,
          isCommissioner: true,
          sessionPreDraft: true,
          draftOrderMode: 'randomize',
          lotteryConfig: null,
        }),
      })
      return
    }

    await route.fallback()
  })

  await page.route(`**/api/leagues/${leagueId}/settings/draft`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
      return
    }

    await route.fallback()
  })

  return {
    getPatches: () => capturedPatches,
  }
}

test.describe('@draft-room commissioner and queue regressions', () => {
  test('commissioner can save draft settings panel queue controls', async ({ page }) => {
    const leagueId = `e2e-settings-${Date.now()}`
    const draftSettings = await mockDraftSettingsApi(page, leagueId)

    await page.goto(`/e2e/draft-settings?leagueId=${leagueId}`)
    await expect(page.getByRole('heading', { name: /e2e draft settings harness/i })).toBeVisible()
    await expect(page.getByText(/draft variant settings hub/i)).toBeVisible()

    const aiQueueReorderToggle = page.getByTestId('commissioner-draft-ai-queue-reorder-toggle')
    const autoPickToggle = page
      .getByRole('checkbox', { name: 'Auto-pick enabled', exact: true })
    const orphanAiToggle = page.getByTestId('commissioner-draft-ai-manager-toggle')

    await aiQueueReorderToggle.check()
    await autoPickToggle.check()
    await orphanAiToggle.check()

    await page.getByRole('button', { name: /save draft variant settings/i }).click()

    await expect(page.getByText(/^Saved\.$/)).toBeVisible()
    const patches = draftSettings.getPatches()
    expect(patches.length).toBeGreaterThan(0)
    const latestPatch = patches[patches.length - 1]
    expect(latestPatch.aiQueueReorderEnabled).toBe(true)
    expect(latestPatch.autoPickEnabled).toBe(true)
    expect(latestPatch.orphanTeamAiManagerEnabled).toBe(true)
    expect(latestPatch.orphanDrafterMode).toBe('ai')

    await page.reload()
    await expect(aiQueueReorderToggle).toBeChecked()
    await expect(autoPickToggle).toBeChecked()
    await expect(orphanAiToggle).toBeChecked()
    await expect(page.getByText(/Orphan rosters:\s*1/i)).toBeVisible()
  })

  test('draft queue toggles and queue actions work in browser', async ({ page }) => {
    await page.goto('/e2e/draft-queue')
    await expect(page.getByRole('heading', { name: /e2e draft queue harness/i })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /auto-pick from queue/i })).toBeVisible()

    const autoPickToggle = page
      .locator('label', { hasText: 'Auto-pick from queue' })
      .locator('input[type="checkbox"]')
    const awayModeToggle = page
      .locator('label', { hasText: 'Away mode' })
      .locator('input[type="checkbox"]')

    await autoPickToggle.check()
    await awayModeToggle.check()
    await expect(autoPickToggle).toBeChecked()
    await expect(awayModeToggle).toBeChecked()

    await page.getByRole('button', { name: /^Draft$/ }).click()
    await expect(page.getByText('Queue Player One')).not.toBeVisible()
  })
})
