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
  poolType?: 'college' | 'pro'
}

function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

async function mockC2CDraftRoomApis(
  page: Page,
  leagueId: string,
  options?: { status?: 'in_progress' | 'pre_draft'; initialC2CConfig?: { enabled: boolean; collegeRounds: number[] } }
) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
  ]
  const teamCount = slotOrder.length
  const rounds = 4
  let c2cConfigState = {
    enabled: options?.initialC2CConfig?.enabled ?? true,
    collegeRounds: options?.initialC2CConfig?.collegeRounds ?? [1, 3],
  }

  const poolEntries: MockPlayer[] = [
    { playerId: 'pro-1', name: 'Veteran Pro', position: 'RB', team: 'NYJ', adp: 9.4, poolType: 'pro' },
    { playerId: 'pro-2', name: 'Immediate Impact', position: 'WR', team: 'DAL', adp: 18.7, poolType: 'pro' },
    { playerId: 'col-1', name: 'Campus Ace', position: 'QB', team: 'Ohio State', adp: 12.2, isDevy: true, school: 'Ohio State', poolType: 'college' },
    { playerId: 'col-2', name: 'Future Route', position: 'WR', team: 'USC', adp: 16.8, isDevy: true, school: 'USC', poolType: 'college' },
    { playerId: 'col-3', name: 'Pipeline Runner', position: 'RB', team: 'Texas', adp: 22.5, isDevy: true, school: 'Texas', poolType: 'college' },
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

  const isCollegePlayer = (name: string) =>
    poolEntries.some((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.poolType === 'college')

  const isCollegeRound = (round: number) =>
    c2cConfigState.enabled && c2cConfigState.collegeRounds.includes(round)

  const currentSlot = () => slotOrder[state.picks.length % teamCount]

  const buildSession = () => {
    const overall = state.picks.length + 1
    const round = Math.ceil(overall / teamCount)
    const slot = ((overall - 1) % teamCount) + 1
    const owner = currentSlot()
    return {
      id: 'session-c2c-e2e',
      leagueId,
      status: state.status,
      draftType: 'linear',
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
      c2c: c2cConfigState.enabled ? { enabled: true, collegeRounds: c2cConfigState.collegeRounds } : undefined,
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagueId, session: buildSession() }) })
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
        c2cConfig: c2cConfigState.enabled ? { enabled: true, collegeRounds: c2cConfigState.collegeRounds } : undefined,
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/c2c/config`, async (route) => {
    const body = route.request().postDataJSON() as { enabled?: boolean; collegeRounds?: number[] }
    const nextRounds = Array.isArray(body?.collegeRounds)
      ? body.collegeRounds.filter((round) => typeof round === 'number' && round >= 1 && round <= rounds)
      : []
    c2cConfigState = {
      enabled: Boolean(body?.enabled),
      collegeRounds: Array.from(new Set(nextRounds)).sort((a, b) => a - b),
    }
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, c2cConfig: c2cConfigState, session: buildSession() }),
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'C2C recap.' }) })
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
        recommendation: { player: { name: 'Campus Ace', position: 'QB', team: 'Ohio State' }, reason: 'C2C roster balance', confidence: 81 },
        alternatives: [],
        explanation: 'Optional C2C advice',
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
    const roundIsCollege = isCollegeRound(currentRound)
    const pickedIsCollege = isCollegePlayer(playerName)

    if (roundIsCollege && !pickedIsCollege) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This round is college-only (C2C). Select a college-eligible player.' }),
      })
      return
    }
    if (!roundIsCollege && pickedIsCollege) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This round is pro-only (C2C). Select a pro player, not a college player.' }),
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'C2C E2E' }] }) })
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

test.describe('@c2c-draft-room click audit', () => {
  test('college/pro filters, mixed board, player indicators, and roster assignment are wired', async ({ page }) => {
    const leagueId = `e2e-c2c-draft-${Date.now()}`
    await mockC2CDraftRoomApis(page, leagueId)

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(desktop.getByTestId('draft-player-panel')).toBeVisible()
    await expect(desktop).toContainText(/College round \(C2C\)/i)

    await desktop.getByTestId('draft-pool-filter').selectOption('College')
    await desktop.getByTestId('draft-player-search-input').fill('Campus Ace')
    await expect(desktop).toContainText('Campus Ace')
    await expect(desktop).toContainText('Ohio State')

    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('Pro')
    await desktop.getByTestId('draft-player-search-input').fill('Veteran Pro')
    await expect(desktop).toContainText('Veteran Pro')
    await expect(desktop).toContainText('Pro')

    // College-only round rejects pro pick.
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(page.getByText(/college-only \(C2C\)/i)).toBeVisible()

    // Draft two college picks to move into pro round.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('College')
    await desktop.getByTestId('draft-player-search-input').fill('Campus Ace')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Campus Ace')
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('C')

    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('College')
    await desktop.getByTestId('draft-player-search-input').fill('Future Route')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))

    await expect(desktop).toContainText(/Pro round \(C2C\)/i)

    // Pro round rejects college pick.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('College')
    await desktop.getByTestId('draft-player-search-input').fill('Pipeline Runner')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(page.getByText(/pro-only \(C2C\)/i)).toBeVisible()

    // Pro pick accepted and board shows mixed pool marker.
    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('Pro')
    await desktop.getByTestId('draft-player-search-input').fill('Immediate Impact')
    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(desktop.getByTestId('draft-board-cell-3')).toContainText('Immediate Impact')
    await expect(desktop.getByTestId('draft-board-cell-3')).toContainText('P')

    await clickHydrated(desktop.getByTestId('draft-clear-filters'))
    await desktop.getByTestId('draft-pool-filter').selectOption('All')
    await expect(desktop.getByTestId('draft-pool-filter')).toBeVisible()
  })

  test('commissioner can configure C2C rounds from control center', async ({ page }) => {
    const leagueId = `e2e-c2c-config-${Date.now()}`
    await mockC2CDraftRoomApis(page, leagueId, {
      status: 'pre_draft',
      initialC2CConfig: { enabled: false, collegeRounds: [] },
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    await expect(desktop.getByTestId('draft-player-panel')).toBeVisible()
    await expect(desktop.getByTestId('draft-pool-filter')).toHaveCount(0)

    await openCommissionerControls(page)
    const modal = page.getByTestId('draft-commissioner-modal')
    await expect(modal).toBeVisible()

    await clickHydrated(modal.getByTestId('draft-commissioner-toggle-c2c-enabled'))
    await modal.getByTestId('draft-commissioner-input-c2c-rounds').fill('1, 3, 99')
    await clickHydrated(modal.getByTestId('draft-commissioner-save-c2c-config'))
    await expect(modal.getByTestId('draft-commissioner-c2c-config-message')).toContainText(/saved/i)
    await clickHydrated(modal.getByTestId('draft-commissioner-close'))

    await expect(desktop.getByTestId('draft-pool-filter')).toBeVisible()
  })
})
