import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'
import { openCommissionerControls } from './helpers/commissioner-controls'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type MockPlayer = {
  playerId: string
  name: string
  position: string
  team: string | null
  adp: number | null
  isDevy?: boolean
  school?: string | null
  graduatedToNFL?: boolean
  poolType?: 'college' | 'pro'
}

function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

async function mockDevyDraftRoomApis(
  page: Page,
  leagueId: string,
  options?: { status?: 'in_progress' | 'pre_draft'; initialDevyConfig?: { enabled: boolean; devyRounds: number[] } }
) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]
  const teamCount = slotOrder.length
  const rounds = 4
  let devyConfigState = {
    enabled: options?.initialDevyConfig?.enabled ?? true,
    devyRounds: options?.initialDevyConfig?.devyRounds ?? [1, 3],
  }

  const poolEntries: MockPlayer[] = [
    { playerId: 'pro-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 10.2, poolType: 'pro' },
    { playerId: 'devy-1', name: 'Future Star', position: 'QB', team: 'Ohio State', adp: 12.4, isDevy: true, school: 'Ohio State', poolType: 'college' },
    { playerId: 'devy-2', name: 'Campus Rocket', position: 'WR', team: 'USC', adp: 18.1, isDevy: true, school: 'USC', poolType: 'college' },
    { playerId: 'pro-2', name: 'Legacy Promote', position: 'WR', team: 'PHI', adp: 29.9, graduatedToNFL: true, school: 'Alabama', poolType: 'pro' },
  ]

  const state: {
    picks: Array<{
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
    }>
    version: number
    updatedAt: string
    status: 'in_progress' | 'pre_draft'
  } = {
    picks: [],
    version: 1,
    updatedAt: new Date().toISOString(),
    status: options?.status ?? 'in_progress',
  }

  const touch = () => {
    state.version += 1
    state.updatedAt = new Date().toISOString()
  }

  const isDevyPlayer = (name: string) =>
    poolEntries.some((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.isDevy)

  const isDevyRound = (round: number) => devyConfigState.enabled && devyConfigState.devyRounds.includes(round)

  const currentSlot = () => slotOrder[state.picks.length % teamCount]

  const buildSession = () => {
    const overall = state.picks.length + 1
    const round = Math.ceil(overall / teamCount)
    const slot = ((overall - 1) % teamCount) + 1
    const owner = currentSlot()
    return {
      id: 'session-devy-e2e',
      leagueId,
      status: state.status,
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
      timer: { status: 'running', remainingSeconds: 90, timerEndAt: new Date(Date.now() + 90_000).toISOString() },
      updatedAt: state.updatedAt,
      currentUserRosterId: 'roster-1',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
      devy: devyConfigState.enabled ? { enabled: true, devyRounds: devyConfigState.devyRounds } : undefined,
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: { queue_size_limit: 50, autopick_behavior: 'queue-first' },
        draftUISettings: {
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
        },
        orphanStatus: { orphanRosterIds: [], recentActions: [] },
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: poolEntries,
        sport: 'NFL',
        count: poolEntries.length,
        devyConfig: devyConfigState.enabled ? { enabled: true, devyRounds: devyConfigState.devyRounds } : undefined,
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/devy/config`, async (route) => {
    const body = route.request().postDataJSON() as { enabled?: boolean; devyRounds?: number[] }
    const nextRounds = Array.isArray(body?.devyRounds)
      ? body.devyRounds.filter((round) => typeof round === 'number' && round >= 1 && round <= rounds)
      : []
    devyConfigState = {
      enabled: Boolean(body?.enabled),
      devyRounds: Array.from(new Set(nextRounds)).sort((a, b) => a - b),
    }
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        devyConfig: devyConfigState,
        session: buildSession(),
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'Devy recap.' }) })
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
        recommendation: { player: { name: 'Future Star', position: 'QB', team: 'Ohio State' }, reason: 'Devy upside', confidence: 80 },
        alternatives: [],
        explanation: 'Optional scouting AI only',
        evidence: [],
        caveats: [],
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pick`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    const playerName = String(body.playerName ?? body.player_name ?? '')
    const position = String(body.position ?? 'FLEX')
    const source = String(body.source ?? 'user')
    const currentOverall = state.picks.length + 1
    const currentRound = Math.ceil(currentOverall / teamCount)
    const roundIsDevy = isDevyRound(currentRound)
    const pickedIsDevy = isDevyPlayer(playerName)

    if (roundIsDevy && !pickedIsDevy) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This round is devy-only. Select a devy-eligible (college) player.' }),
      })
      return
    }
    if (!roundIsDevy && pickedIsDevy) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This round is pro-only. Select a major-league player, not a devy asset.' }),
      })
      return
    }

    const owner = currentSlot()
    state.picks.push({
      id: `pick-${currentOverall}`,
      overall: currentOverall,
      round: currentRound,
      slot: owner.slot,
      rosterId: owner.rosterId,
      displayName: owner.displayName,
      playerName,
      position,
      team: (body.team as string | null) ?? null,
      byeWeek: null,
      playerId: (body.playerId as string | null) ?? null,
      source,
      pickLabel: formatPickLabel(currentOverall, teamCount),
      createdAt: new Date().toISOString(),
    })
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'Devy E2E' }] }) })
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

test.describe('@devy-draft-room click audit', () => {
  test('devy filters, cards, slot drafting, promotion markers, and toggles are wired', async ({ page }) => {
    const leagueId = `e2e-devy-draft-${Date.now()}`
    await mockDevyDraftRoomApis(page, leagueId)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(desktop.getByTestId('draft-player-panel')).toBeVisible()
    await expect(desktop).toContainText(/Devy round/i)

    // Devy filters work and render devy card badges/details.
    await desktop.getByTestId('draft-pool-filter').selectOption('Devy')
    await desktop.getByTestId('draft-player-search-input').fill('Future Star')
    await expect(desktop).toContainText('Future Star')
    await expect(desktop).toContainText('Ohio State')

    // Promotion markers show in pro pool cards.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('Pro')
    await desktop.getByTestId('draft-player-search-input').fill('Legacy Promote')
    await expect(desktop).toContainText('Promoted')

    // Deterministic eligibility blocks pro player in a devy round.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('Pro')
    await desktop.getByTestId('draft-player-search-input').fill('Atlas Runner')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(page.getByText(/devy-only/i)).toBeVisible()

    // Devy slot drafting works in devy round.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('Devy')
    await desktop.getByTestId('draft-player-search-input').fill('Future Star')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Future Star')
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('D')

    // No dead devy toggles/filters.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('All')
    await expect(desktop.getByTestId('draft-pool-filter')).toBeVisible()
  })

  test('commissioner can configure devy rounds from control center', async ({ page }) => {
    const leagueId = `e2e-devy-config-${Date.now()}`
    await mockDevyDraftRoomApis(page, leagueId, {
      status: 'pre_draft',
      initialDevyConfig: { enabled: false, devyRounds: [] },
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(desktop.getByTestId('draft-player-panel')).toBeVisible()
    await expect(desktop.getByTestId('draft-pool-filter')).toHaveCount(0)

    await openCommissionerControls(page)
    const modal = page.getByTestId('draft-commissioner-modal')
    await expect(modal).toBeVisible()

    await clickHydrated(modal.getByTestId('draft-commissioner-toggle-devy-enabled'))
    await modal.getByTestId('draft-commissioner-input-devy-rounds').fill('2, 4, 10')
    await clickHydrated(modal.getByTestId('draft-commissioner-save-devy-config'))
    await expect(modal.getByTestId('draft-commissioner-devy-config-message')).toContainText(/saved/i)
    await clickHydrated(modal.getByTestId('draft-commissioner-close'))

    await expect(desktop.getByTestId('draft-pool-filter')).toBeVisible()
  })
})
