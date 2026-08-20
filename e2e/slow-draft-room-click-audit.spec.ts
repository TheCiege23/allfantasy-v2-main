import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type DraftPickRow = {
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

async function mockSlowDraftRoomApis(page: Page, leagueId: string) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]

  const draftUiSettings: Record<string, unknown> = {
    tradedPickColorModeEnabled: true,
    tradedPickOwnerNameRedEnabled: true,
    aiAdpEnabled: false,
    aiQueueReorderEnabled: true,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
    liveDraftChatSyncEnabled: true,
    autoPickEnabled: true,
    timerMode: 'per_pick',
    commissionerForceAutoPickEnabled: true,
    draftOrderRandomizationEnabled: true,
    pickTradeEnabled: true,
    slowDraftPauseWindow: {
      start: '22:00',
      end: '08:00',
      timezone: 'America/New_York',
    },
  }

  const poolEntries = [
    { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
    { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
    { playerId: 'p-3', name: 'Core Signal', position: 'QB', team: 'KC', adp: 21.2 },
    { playerId: 'p-4', name: 'Delta Edge', position: 'TE', team: 'SEA', adp: 25.3 },
  ]

  const pickRequests: Array<Record<string, unknown>> = []
  const autopickRequests: Array<Record<string, unknown>> = []
  const controlsRequests: Array<Record<string, unknown>> = []
  const settingsPatchRequests: Array<Record<string, unknown>> = []
  const resyncHits: string[] = []

  const state: {
    version: number
    updatedAt: string
    sessionStatus: 'in_progress' | 'paused' | 'completed'
    timerRemainingSeconds: number
    picks: DraftPickRow[]
    queue: Array<{ playerName: string; position: string; team?: string | null }>
  } = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessionStatus: 'in_progress',
    timerRemainingSeconds: 7200,
    picks: [],
    queue: [
      { playerName: 'Blaze Catcher', position: 'WR', team: 'DAL' },
      { playerName: 'Core Signal', position: 'QB', team: 'KC' },
    ],
  }

  const touch = () => {
    state.version += 1
    state.updatedAt = new Date().toISOString()
  }

  const currentSlotIndex = () => state.picks.length % slotOrder.length
  const currentSlot = () => slotOrder[currentSlotIndex()]

  const submitPickForCurrent = (playerName: string, position: string, team: string | null, source: string) => {
    const owner = currentSlot()
    const overall = state.picks.length + 1
    state.picks.push({
      id: `pick-${overall}`,
      overall,
      round: Math.ceil(overall / slotOrder.length),
      slot: owner.slot,
      rosterId: owner.rosterId,
      displayName: owner.displayName,
      playerName,
      position,
      team,
      byeWeek: null,
      playerId: null,
      source,
      pickLabel: formatPickLabel(overall, slotOrder.length),
      createdAt: new Date().toISOString(),
    })
    state.timerRemainingSeconds = 7200
    state.sessionStatus = 'in_progress'
    touch()
  }

  const buildSession = () => {
    const timerStatus =
      state.sessionStatus === 'paused'
        ? 'paused'
        : state.sessionStatus === 'in_progress'
          ? state.timerRemainingSeconds <= 0
            ? 'expired'
            : 'running'
          : 'none'
    const owner = currentSlot()
    const overall = state.picks.length + 1
    return {
      id: 'session-slow-e2e-1',
      leagueId,
      status: state.sessionStatus,
      draftType: 'snake',
      rounds: 4,
      teamCount: slotOrder.length,
      thirdRoundReversal: false,
      timerSeconds: 7200,
      timerEndAt:
        state.sessionStatus === 'in_progress'
          ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString()
          : null,
      pausedRemainingSeconds: state.sessionStatus === 'paused' ? state.timerRemainingSeconds : null,
      slotOrder,
      tradedPicks: [],
      version: state.version,
      picks: state.picks,
      currentPick:
        state.sessionStatus === 'completed'
          ? null
          : {
              overall,
              round: Math.ceil(overall / slotOrder.length),
              slot: owner.slot,
              rosterId: owner.rosterId,
              displayName: owner.displayName,
              pickLabel: formatPickLabel(overall, slotOrder.length),
            },
      timer: {
        status: timerStatus,
        remainingSeconds: timerStatus === 'none' ? null : state.timerRemainingSeconds,
        timerEndAt:
          timerStatus === 'running'
            ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString()
            : null,
      },
      updatedAt: state.updatedAt,
      currentUserRosterId: 'roster-1',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
      isSlowDraft: true,
    }
  }

  const advanceTimer = () => {
    if (state.sessionStatus !== 'in_progress') return
    state.timerRemainingSeconds = Math.max(0, state.timerRemainingSeconds - 60)
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
    if (route.request().method() === 'GET') {
      resyncHits.push('session')
      advanceTimer()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/events**`, async (route) => {
    resyncHits.push('events')
    advanceTimer()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        updated: true,
        updatedAt: state.updatedAt,
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>
      settingsPatchRequests.push(patch)
      Object.assign(draftUiSettings, patch)
      touch()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: { queue_size_limit: 50, autopick_behavior: 'queue-first' },
        draftUISettings: draftUiSettings,
        orphanStatus: { orphanRosterIds: [], recentActions: [] },
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: poolEntries.map((entry) => ({
          name: entry.name,
          position: entry.position,
          team: entry.team,
          adp: entry.adp,
          playerId: entry.playerId,
        })),
        sport: 'NFL',
        count: poolEntries.length,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        queue?: Array<{ playerName: string; position: string; team?: string | null }>
      }
      state.queue = body.queue ?? []
      touch()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: state.queue }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [{ id: 'm1', from: 'Commissioner', text: 'Slow draft room live.', at: new Date().toISOString() }],
        syncActive: true,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pick`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    pickRequests.push(body)
    submitPickForCurrent(
      String(body.playerName ?? body.player_name ?? 'Manual Player'),
      String(body.position ?? 'FLEX'),
      (body.team as string | null) ?? null,
      'user'
    )
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/autopick-expired`, async (route) => {
    autopickRequests.push({})
    const drafted = new Set(state.picks.map((pick) => pick.playerName.toLowerCase()))
    const next = state.queue.find((entry) => !drafted.has(entry.playerName.toLowerCase())) ?? state.queue[0]
    if (!next) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Queue is empty.' }),
      })
      return
    }
    submitPickForCurrent(next.playerName, next.position, next.team ?? null, 'auto')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        submittedPlayerName: next.playerName,
        strategy: 'queue-first',
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/controls`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    controlsRequests.push(body)
    const action = String(body.action ?? '')
    if (action === 'pause') {
      state.sessionStatus = 'paused'
      touch()
    } else if (action === 'resume') {
      state.sessionStatus = 'in_progress'
      if (state.timerRemainingSeconds <= 0) state.timerRemainingSeconds = 3600
      touch()
    } else if (action === 'undo_pick') {
      state.picks.pop()
      state.timerRemainingSeconds = 7200
      state.sessionStatus = 'in_progress'
      touch()
    } else if (action === 'slow_tick') {
      if (String(draftUiSettings.timerMode ?? 'per_pick') === 'overnight_pause') {
        state.sessionStatus = 'paused'
      } else {
        state.sessionStatus = 'in_progress'
        state.timerRemainingSeconds = 0
      }
      touch()
    } else if (action === 'reset_timer') {
      state.timerRemainingSeconds = 7200
      state.sessionStatus = 'in_progress'
      touch()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, action, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals/*/review`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals/*/respond`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue/ai-reorder`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reordered: state.queue }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/ai-pick`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: buildSession() }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/post-draft-summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: null }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/replay`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/recap`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'Slow draft recap.' }) })
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
        recommendation: { player: { name: 'Atlas Runner', position: 'RB', team: 'NYJ' }, reason: 'Best pick now', confidence: 82 },
        alternatives: [],
        explanation: 'Deterministic recommendation.',
        evidence: [],
        caveats: [],
      }),
    })
  })
  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'Slow Draft E2E' }] }) })
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
    getPickRequests: () => pickRequests,
    getAutopickRequests: () => autopickRequests,
    getControlsRequests: () => controlsRequests,
    getSettingsPatchRequests: () => settingsPatchRequests,
    getResyncHits: () => resyncHits,
  }
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

test.describe('@slow-draft-room click audit', () => {
  test('slow draft timer, pause window, picks, queue autopick, and resync are wired', async ({ page }) => {
    const leagueId = `e2e-slow-draft-${Date.now()}`
    const mocks = await mockSlowDraftRoomApis(page, leagueId)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(desktop.getByTestId('draft-board')).toBeVisible()

    // Long timer behavior is present and changes on resync.
    const resyncCountBefore = mocks.getResyncHits().length
    const timerBefore = await page.getByTestId('draft-topbar-timer-value').first().innerText()
    expect(timerBefore.toLowerCase()).toContain('h')
    await clickHydrated(page.getByTestId('draft-resync-button'))
    await expect.poll(() => mocks.getResyncHits().length).toBeGreaterThan(resyncCountBefore)
    await expect
      .poll(async () => page.getByTestId('draft-topbar-timer-value').first().innerText())
      .not.toBe(timerBefore)

    // Pause window behavior via overnight mode + slow automation tick.
    await clickHydrated(page.getByTestId('draft-open-commissioner-controls'))
    const commissionerModal = page.getByTestId('draft-commissioner-modal')
    await expect(commissionerModal).toBeVisible()
    await commissionerModal.getByTestId('draft-commissioner-select-timer-mode').selectOption('overnight_pause')
    await clickHydrated(commissionerModal.getByTestId('draft-commissioner-slow-tick'))
    await clickHydrated(commissionerModal.getByTestId('draft-commissioner-close'))
    await expect(page.getByTestId('draft-topbar-timer-value').first()).toContainText(/h|m:/i)
    await expect(page.locator('header')).toContainText('paused')

    // Return to active mode, force expiry, then submit from queue.
    await clickHydrated(page.getByTestId('draft-open-commissioner-controls'))
    await expect(commissionerModal).toBeVisible()
    await commissionerModal.getByTestId('draft-commissioner-select-timer-mode').selectOption('per_pick')
    await clickHydrated(commissionerModal.getByTestId('draft-commissioner-slow-tick'))
    await clickHydrated(commissionerModal.getByTestId('draft-commissioner-close'))
    await expect(page.getByTestId('draft-use-queue-button')).toBeVisible()
    await clickHydrated(page.getByTestId('draft-use-queue-button'))
    expect(mocks.getAutopickRequests().length).toBeGreaterThan(0)
    await expect(desktop.getByTestId('draft-board')).toContainText('Blaze Catcher')

    // Manual pick submission still works.
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await expect(desktop.getByTestId('draft-pick-confirmation')).toBeVisible()
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    expect(mocks.getPickRequests().length).toBeGreaterThan(0)
    await expect(desktop.getByTestId('draft-board')).toContainText(/Atlas Runner|Blaze Catcher|Core Signal/i)

    // Resync should not leave stale on-the-clock state.
    const onClockBefore = await page.getByTestId('draft-topbar-on-clock-manager').first().innerText()
    await clickHydrated(page.getByTestId('draft-resync-button'))
    await expect.poll(() => mocks.getResyncHits().length).toBeGreaterThan(0)
    const onClockAfter = await page.getByTestId('draft-topbar-on-clock-manager').first().innerText()
    expect(onClockAfter).toEqual(onClockBefore)

    // No dead notification CTA expectation in draft room shell.
    await expect(page.getByText(/enable notifications|turn on notifications/i)).toHaveCount(0)

    expect(mocks.getControlsRequests().map((entry) => String(entry.action ?? ''))).toContain('slow_tick')
    expect(mocks.getSettingsPatchRequests().some((entry) => Object.prototype.hasOwnProperty.call(entry, 'timerMode'))).toBeTruthy()
  })
})
