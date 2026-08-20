import { expect, test, type Page } from '@playwright/test'
import { openCommissionerControls } from './helpers/commissioner-controls'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type MockPick = {
  id: string
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  playerId: string | null
  source: string
  pickLabel: string
  createdAt: string
}

function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

async function openDraftRoomHarness(page: Page) {
  const button = page.getByTestId('draft-enter-room-button')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await button.isVisible().catch(() => false)
    if (!visible) {
      await page.waitForTimeout(150)
      continue
    }
    await button.click({ force: true })
    const shellVisible = await page.getByTestId('draft-room-shell').isVisible().catch(() => false)
    if (shellVisible) return
    await page.waitForTimeout(200)
  }
  await expect(page.getByTestId('draft-room-shell')).toBeVisible()
}

async function mockCpuAiDrafterApis(
  page: Page,
  leagueId: string,
  options: { aiProviderAvailable: boolean }
) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Orphan Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
  ]
  const teamCount = slotOrder.length
  const rounds = 4
  const state: {
    picks: MockPick[]
    version: number
    updatedAt: string
    settings: {
      orphanTeamAiManagerEnabled: boolean
      orphanDrafterMode: 'cpu' | 'ai'
      tradedPickColorModeEnabled: boolean
      tradedPickOwnerNameRedEnabled: boolean
      aiAdpEnabled: boolean
      aiQueueReorderEnabled: boolean
      liveDraftChatSyncEnabled: boolean
      autoPickEnabled: boolean
      timerMode: 'per_pick' | 'soft_pause' | 'overnight_pause' | 'none'
      commissionerForceAutoPickEnabled: boolean
      draftOrderRandomizationEnabled: boolean
      pickTradeEnabled: boolean
    }
    orphanRecentActions: Array<{ action: string; createdAt: string; reason: string | null; rosterId?: string }>
    settingsPatchRequests: Array<Record<string, unknown>>
    aiPickRequests: Array<Record<string, unknown>>
  } = {
    picks: [],
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      orphanTeamAiManagerEnabled: true,
      orphanDrafterMode: 'cpu',
      tradedPickColorModeEnabled: true,
      tradedPickOwnerNameRedEnabled: true,
      aiAdpEnabled: true,
      aiQueueReorderEnabled: true,
      liveDraftChatSyncEnabled: true,
      autoPickEnabled: true,
      timerMode: 'per_pick',
      commissionerForceAutoPickEnabled: true,
      draftOrderRandomizationEnabled: true,
      pickTradeEnabled: true,
    },
    orphanRecentActions: [],
    settingsPatchRequests: [],
    aiPickRequests: [],
  }

  const touch = () => {
    state.version += 1
    state.updatedAt = new Date().toISOString()
  }

  const getEffectiveMode = (): 'cpu' | 'ai' =>
    state.settings.orphanDrafterMode === 'ai' && !options.aiProviderAvailable
      ? 'cpu'
      : state.settings.orphanDrafterMode

  const buildSession = () => {
    const overall = state.picks.length + 1
    const round = Math.ceil(overall / teamCount)
    const slot = ((overall - 1) % teamCount) + 1
    const owner = slotOrder[slot - 1]
    return {
      id: 'session-cpu-ai-drafter-e2e',
      leagueId,
      status: 'in_progress',
      draftType: 'snake',
      rounds,
      teamCount,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: new Date(Date.now() + 90_000).toISOString(),
      pausedRemainingSeconds: null,
      slotOrder,
      tradedPicks: [],
      version: state.version,
      picks: state.picks,
      currentPick: {
        overall,
        round,
        slot,
        rosterId: owner.rosterId,
        displayName: owner.displayName,
        pickLabel: formatPickLabel(overall, teamCount),
      },
      timer: {
        status: 'running',
        remainingSeconds: 90,
        timerEndAt: new Date(Date.now() + 90_000).toISOString(),
      },
      updatedAt: state.updatedAt,
      currentUserRosterId: 'roster-1',
      orphanRosterIds: ['roster-1'],
      aiManagerEnabled: state.settings.orphanTeamAiManagerEnabled,
      orphanDrafterMode: state.settings.orphanDrafterMode,
      orphanAiProviderAvailable: options.aiProviderAvailable,
      orphanDrafterEffectiveMode: getEffectiveMode(),
    }
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

  await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, session: buildSession() }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updated: true, updatedAt: state.updatedAt, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>
      state.settingsPatchRequests.push(patch)
      if (typeof patch.orphanTeamAiManagerEnabled === 'boolean') {
        state.settings.orphanTeamAiManagerEnabled = patch.orphanTeamAiManagerEnabled
      }
      if (patch.orphanDrafterMode === 'cpu' || patch.orphanDrafterMode === 'ai') {
        state.settings.orphanDrafterMode = patch.orphanDrafterMode
      }
      touch()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftUISettings: state.settings,
          orphanAiProviderAvailable: options.aiProviderAvailable,
          orphanDrafterEffectiveMode: getEffectiveMode(),
          orphanStatus: {
            orphanRosterIds: ['roster-1'],
            recentActions: state.orphanRecentActions,
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: { queue_size_limit: 50, autopick_behavior: 'queue-first' },
        draftUISettings: state.settings,
        orphanStatus: {
          orphanRosterIds: ['roster-1'],
          recentActions: state.orphanRecentActions,
        },
        orphanAiProviderAvailable: options.aiProviderAvailable,
        orphanDrafterEffectiveMode: getEffectiveMode(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          { playerId: 'orphan-p1', name: 'Fallback Runner', position: 'RB', team: 'BUF', adp: 10.2 },
          { playerId: 'orphan-p2', name: 'Narrative Receiver', position: 'WR', team: 'MIA', adp: 13.4 },
        ],
        sport: 'NFL',
        count: 2,
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [], syncActive: true }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/replay`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/recap`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'CPU/AI drafter recap' }) })
  })
  await page.route(`**/api/leagues/${leagueId}/ai-adp`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entries: [] }) })
  })
  await page.route('**/api/draft/recommend', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: { player: { name: 'Fallback Runner', position: 'RB', team: 'BUF' }, reason: 'Best blend', confidence: 82 },
        alternatives: [],
        explanation: 'Deterministic recommendation.',
        evidence: [],
        caveats: [],
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/ai-pick`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    state.aiPickRequests.push(payload)
    const current = buildSession().currentPick
    const executedMode = getEffectiveMode()
    const usedFallback = state.settings.orphanDrafterMode === 'ai' && executedMode === 'cpu'
    const playerName = executedMode === 'ai' ? 'Narrative Receiver' : 'Fallback Runner'
    const position = executedMode === 'ai' ? 'WR' : 'RB'
    const team = executedMode === 'ai' ? 'MIA' : 'BUF'

    state.picks.push({
      id: `pick-${current.overall}`,
      overall: current.overall,
      round: current.round,
      slot: current.slot,
      rosterId: current.rosterId,
      displayName: current.displayName,
      playerName,
      position,
      team,
      byeWeek: null,
      playerId: null,
      source: 'auto',
      pickLabel: current.pickLabel,
      createdAt: new Date().toISOString(),
    })
    state.orphanRecentActions.unshift({
      action: 'draft_pick',
      createdAt: new Date().toISOString(),
      reason: usedFallback
        ? `AI mode fallback to CPU selected ${playerName}.`
        : `AI drafter selected ${playerName}.`,
      rosterId: current.rosterId,
    })
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        pick: {
          playerName,
          position,
          overall: current.overall,
          round: current.round,
          slot: current.slot,
        },
        reason: state.orphanRecentActions[0]?.reason,
        requestedMode: state.settings.orphanDrafterMode,
        executedMode,
        aiProviderAvailable: options.aiProviderAvailable,
        usedFallback,
        session: buildSession(),
      }),
    })
  })

  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'CPU/AI Drafter E2E' }] }) })
  })
  await page.route('**/api/commissioner/broadcast', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    const known = [
      '/api/auth/session',
      '/api/auth/config-check',
      '/api/user/profile',
      '/api/draft/recommend',
      '/api/commissioner/leagues',
      '/api/commissioner/broadcast',
      `/api/leagues/${leagueId}/`,
    ].some((path) => url.includes(path))
    if (known) {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  return {
    getSettingsPatchRequests: () => state.settingsPatchRequests,
    getAiPickRequests: () => state.aiPickRequests,
  }
}

test.describe('@cpu-ai-drafter-modes click audit', () => {
  test('mode selector, fallback status, and pick execution are wired', async ({ page }) => {
    const leagueId = `e2e-cpu-ai-fallback-${Date.now()}`
    const mocks = await mockCpuAiDrafterApis(page, leagueId, { aiProviderAvailable: false })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(page.getByTestId('draft-topbar-orphan-mode-label')).toContainText('CPU Manager')

    await openCommissionerControls(page)
    const modal = page.getByTestId('draft-commissioner-modal')
    await expect(modal).toBeVisible()
    await modal.getByTestId('draft-commissioner-toggle-orphan-ai').click()
    await modal.getByTestId('draft-commissioner-toggle-orphan-ai').click()
    await modal.getByTestId('draft-commissioner-select-orphan-drafter-mode').selectOption('ai')

    await expect(modal.getByTestId('draft-commissioner-orphan-status')).toContainText(/Requested mode:\s*AI/i)
    await expect(modal.getByTestId('draft-commissioner-orphan-status')).toContainText(/Effective mode:\s*CPU/i)
    await expect(modal.getByTestId('draft-commissioner-orphan-mode-fallback-note')).toBeVisible()
    await expect(page.getByTestId('draft-topbar-orphan-mode-label')).toContainText('AI Manager (CPU fallback)')
    await modal.getByTestId('draft-commissioner-run-ai-pick').click()
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Fallback Runner')
    expect(mocks.getAiPickRequests().length).toBeGreaterThan(0)

    await modal.getByTestId('draft-commissioner-select-orphan-drafter-mode').selectOption('cpu')
    await expect(modal.getByTestId('draft-commissioner-orphan-status')).toContainText(/Requested mode:\s*CPU/i)
    await modal.getByTestId('draft-commissioner-close').click()
    expect(mocks.getSettingsPatchRequests().some((patch) => patch.orphanDrafterMode === 'ai')).toBeTruthy()
    expect(mocks.getSettingsPatchRequests().some((patch) => patch.orphanDrafterMode === 'cpu')).toBeTruthy()
  })

  test('AI mode displays active AI manager when provider is available', async ({ page }) => {
    const leagueId = `e2e-cpu-ai-live-${Date.now()}`
    await mockCpuAiDrafterApis(page, leagueId, { aiProviderAvailable: true })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await openCommissionerControls(page)
    const modal = page.getByTestId('draft-commissioner-modal')
    await modal.getByTestId('draft-commissioner-select-orphan-drafter-mode').selectOption('ai')
    await expect(modal.getByTestId('draft-commissioner-orphan-status')).toContainText(/Effective mode:\s*AI/i)
    await expect(modal.getByTestId('draft-commissioner-orphan-mode-fallback-note')).toHaveCount(0)
    await expect(page.getByTestId('draft-topbar-orphan-mode-label')).toContainText('AI Manager')
    await modal.getByTestId('draft-commissioner-run-ai-pick').click()

    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Narrative Receiver')
  })
})
