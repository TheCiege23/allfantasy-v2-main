import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

function getSlotForOverall(overall: number, teamCount: number): { round: number; slot: number; pickLabel: string } {
  const round = Math.ceil(overall / teamCount)
  let slot = ((overall - 1) % teamCount) + 1
  if (round % 2 === 0) slot = teamCount - slot + 1
  const pickInRound = ((overall - 1) % teamCount) + 1
  return {
    round,
    slot,
    pickLabel: `${round}.${String(pickInRound).padStart(2, '0')}`,
  }
}

async function mockDraftAssetApis(page: Page, leagueId: string) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]
  const settings = {
    draftOrderRandomizationEnabled: true,
    pickTradeEnabled: true,
    tradedPickColorModeEnabled: true,
    tradedPickOwnerNameRedEnabled: true,
    aiAdpEnabled: false,
    aiQueueReorderEnabled: true,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu' as const,
    liveDraftChatSyncEnabled: true,
    autoPickEnabled: false,
    timerMode: 'per_pick',
    slowDraftPauseWindow: null,
    commissionerForceAutoPickEnabled: false,
  }

  const poolEntries = [
    {
      playerId: 'p-broken',
      name: 'Broken Image Back',
      position: 'RB',
      team: 'NYJ',
      adp: 8.2,
      byeWeek: 7,
      display: {
        playerId: 'p-broken',
        displayName: 'Broken Image Back',
        sport: 'NFL',
        assets: {
          headshotUrl: null,
          teamLogoUrl: null,
        },
        team: {
          teamId: 'NYJ',
          abbreviation: 'NYJ',
          displayName: 'NYJ',
          sport: 'NFL',
          logoUrl: null,
        },
        stats: {
          primaryStatLabel: 'ADP',
          primaryStatValue: 8.2,
          secondaryStatLabel: 'Bye',
          secondaryStatValue: 7,
          adp: 8.2,
          byeWeek: 7,
        },
        metadata: {
          position: 'RB',
          teamAbbreviation: 'NYJ',
          byeWeek: 7,
          injuryStatus: null,
          sport: 'NFL',
        },
      },
    },
    {
      playerId: 'p-2',
      name: 'Stable Receiver',
      position: 'WR',
      team: 'DAL',
      adp: 12.4,
      byeWeek: 9,
    },
  ]

  const state: {
    version: number
    picks: Array<Record<string, unknown>>
    queue: Array<{ playerName: string; position: string; team?: string | null }>
  } = {
    version: 1,
    picks: [
      {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-1',
        displayName: 'Alpha',
        playerName: 'Existing Keeper',
        position: 'QB',
        team: 'BUF',
        byeWeek: 8,
        playerId: 'p-keep',
        source: 'user',
        pickLabel: '1.01',
        createdAt: new Date().toISOString(),
      },
    ],
    queue: [],
  }

  const buildSession = () => {
    const overall = state.picks.length + 1
    const current = getSlotForOverall(overall, slotOrder.length)
    const roster = slotOrder[current.slot - 1]
    return {
      id: 'session-assets-e2e',
      leagueId,
      status: 'in_progress',
      draftType: 'snake',
      rounds: 4,
      teamCount: slotOrder.length,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: new Date(Date.now() + 45_000).toISOString(),
      pausedRemainingSeconds: null,
      slotOrder,
      tradedPicks: [],
      version: state.version,
      picks: state.picks,
      currentPick: {
        overall,
        round: current.round,
        slot: current.slot,
        rosterId: roster.rosterId,
        displayName: roster.displayName,
        pickLabel: current.pickLabel,
      },
      timer: {
        status: 'running',
        remainingSeconds: 45,
        timerEndAt: new Date(Date.now() + 45_000).toISOString(),
      },
      updatedAt: new Date().toISOString(),
      currentUserRosterId: 'roster-2',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
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

  /*
   * ⚠ THESE THREE ARE NOT OPTIONAL, EVEN THOUGH NOTHING ASSERTS THEM.
   *
   * fetchDraftChromeData() calls /api/league/settings (singular "league") and
   * /api/leagues/<id>/privacy inside a Promise.all, and DraftRoomPageClient
   * awaits it in a Promise.allSettled BEFORE it ever calls fetchDraftPool
   * (DraftRoomPageClient.tsx:2018 and :2031). Leave them unmocked and they hit
   * the real dev server with a league id that does not exist, the bootstrap
   * never settles, the pool is never fetched, and the player panel renders with
   * a working search box and zero cards.
   *
   * Measured before adding them: the app never logged "[draft-room] draft pool
   * loaded", player cards in the DOM were 0, and the search input still held
   * its value -- so the failure looked like a missing testid when it was
   * actually a blocked bootstrap two awaits upstream.
   */
  await page.route('**/api/league/settings**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: {} }) })
  })
  await page.route(`**/api/leagues/${leagueId}/privacy`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ privacy: {} }) })
  })
  await page.route(`**/api/leagues/${leagueId}/claim-roster`, async (route) => {
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
      body: JSON.stringify({ leagueId, updated: true, updatedAt: new Date().toISOString(), session: buildSession() }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: { queue_size_limit: 50, autopick_behavior: 'queue-first' },
        draftUISettings: settings,
        orphanStatus: { orphanRosterIds: [], recentActions: [] },
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: poolEntries, sport: 'NFL', count: poolEntries.length }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        queue?: Array<{ playerName: string; position: string; team?: string | null }>
      }
      state.queue = body.queue ?? []
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: state.queue }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue/ai-reorder`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reordered: [...state.queue].reverse() }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [], syncActive: true }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/pick`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    const playerName = String(body.playerName ?? '')
    const position = String(body.position ?? 'FLEX')
    const team = (body.team as string | null) ?? null
    const overall = state.picks.length + 1
    const slot = getSlotForOverall(overall, slotOrder.length)
    const roster = slotOrder[slot.slot - 1]
    state.picks.push({
      id: `pick-${overall}`,
      overall,
      round: slot.round,
      slot: slot.slot,
      rosterId: roster.rosterId,
      displayName: roster.displayName,
      playerName,
      position,
      team,
      byeWeek: null,
      playerId: null,
      source: 'user',
      pickLabel: slot.pickLabel,
      createdAt: new Date().toISOString(),
    })
    state.version += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/controls`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })
  await page.route('**/api/draft/recommend', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: { player: { name: 'Broken Image Back', position: 'RB', team: 'NYJ' }, reason: 'Best value', confidence: 88 },
        alternatives: [],
      }),
    })
  })
  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'Asset E2E' }] }) })
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

async function openDraftRoomHarness(page: Page) {
  await clickHydrated(page.getByTestId('draft-enter-room-button'))
  await expect(page.getByTestId('draft-room-shell')).toBeVisible()
}

test.describe('@draft-asset-pipeline click audit', () => {
  test('player cards handle open, queue, drafted update, and image fallback', async ({ page }) => {
    const leagueId = `e2e-draft-assets-${Date.now()}`
    await mockDraftAssetApis(page, leagueId)

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)
    const desktop = page.getByTestId('draft-desktop-layout')

    await desktop.getByTestId('draft-player-search-input').fill('Broken Image Back')
    await clickHydrated(desktop.getByTestId('draft-player-card-0'))
    await expect(desktop.getByTestId('draft-selected-player-panel')).toBeVisible()
    await clickHydrated(desktop.getByTestId('draft-clear-selected-player'))

    await clickHydrated(desktop.getByTestId('draft-queue-add-0'))
    await expect(desktop.getByTestId('draft-queue-item-0')).toContainText('Broken Image Back')

    await expect(desktop.getByTestId('draft-player-card-0-headshot-fallback')).toBeVisible({ timeout: 15_000 })
    await expect(desktop.getByTestId('draft-player-card-0-team-logo-fallback')).toBeVisible({ timeout: 15_000 })

    await clickHydrated(desktop.getByTestId('draft-player-button-0'))
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    await expect(desktop.getByTestId('draft-board-cell-2')).toContainText('Broken Image Back')

    await expect(page.getByText(/sleeperId|ffcPlayerId|external_source_id/i)).toHaveCount(0)
    await expect(page.getByTestId('draft-player-asset-retry')).toHaveCount(0)
  })
})
