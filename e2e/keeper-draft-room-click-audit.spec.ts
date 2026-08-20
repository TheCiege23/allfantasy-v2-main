import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type KeeperSelection = {
  rosterId: string
  roundCost: number
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  commissionerOverride?: boolean
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function getRoundSlotForRoster(
  round: number,
  rosterSlot: number,
  teamCount: number
): { slot: number; overall: number } {
  const isReversed = round % 2 === 0
  const pickInRound = isReversed ? teamCount - rosterSlot + 1 : rosterSlot
  const overall = (round - 1) * teamCount + pickInRound
  return { slot: rosterSlot, overall }
}

async function mockKeeperDraftRoomApis(page: Page, leagueId: string) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]
  const rounds = 4
  const teamCount = slotOrder.length
  const carryoverByRoster: Record<string, string[]> = {
    'roster-1': ['legacy runner', 'carry star', 'keeper ace'],
    'roster-2': ['beta guardian', 'beta flyer'],
    'roster-3': [],
    'roster-4': [],
  }

  const state: {
    version: number
    updatedAt: string
    status: 'pre_draft' | 'in_progress' | 'paused' | 'completed'
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
    keeperConfig: {
      maxKeepers: number
      deadline: string | null
      maxKeepersPerPosition?: Record<string, number>
    }
    keeperSelections: KeeperSelection[]
  } = {
    version: 1,
    updatedAt: new Date().toISOString(),
    status: 'pre_draft',
    picks: [],
    keeperConfig: { maxKeepers: 1, deadline: null, maxKeepersPerPosition: { QB: 1 } },
    keeperSelections: [],
  }

  const requests = {
    keeperAdd: [] as Array<Record<string, unknown>>,
    keeperRemove: [] as Array<Record<string, unknown>>,
    keeperConfig: [] as Array<Record<string, unknown>>,
  }

  const touch = () => {
    state.version += 1
    state.updatedAt = new Date().toISOString()
  }

  const keeperLocks = () => {
    return state.keeperSelections.flatMap((selection) => {
      const rosterSlot = slotOrder.find((entry) => entry.rosterId === selection.rosterId)?.slot
      if (!rosterSlot) return []
      if (selection.roundCost < 1 || selection.roundCost > rounds) return []
      const mapped = getRoundSlotForRoster(selection.roundCost, rosterSlot, teamCount)
      return [
        {
          round: selection.roundCost,
          slot: mapped.slot,
          overall: mapped.overall,
          rosterId: selection.rosterId,
          displayName: slotOrder.find((entry) => entry.rosterId === selection.rosterId)?.displayName ?? null,
          playerName: selection.playerName,
          position: selection.position,
          team: selection.team,
          playerId: selection.playerId,
          isKeeper: true as const,
        },
      ]
    })
  }

  const buildSession = () => ({
    id: 'session-keeper-e2e-1',
    leagueId,
    status: state.status,
    draftType: 'snake',
    rounds,
    teamCount,
    thirdRoundReversal: false,
    timerSeconds: 60,
    timerEndAt: null,
    pausedRemainingSeconds: null,
    slotOrder,
    tradedPicks: [],
    version: state.version,
    picks: state.picks,
    currentPick: {
      overall: state.picks.length + 1,
      round: Math.ceil((state.picks.length + 1) / teamCount),
      slot: ((state.picks.length % teamCount) + 1),
      rosterId: slotOrder[state.picks.length % teamCount].rosterId,
      displayName: slotOrder[state.picks.length % teamCount].displayName,
      pickLabel: `${Math.ceil((state.picks.length + 1) / teamCount)}.${String(((state.picks.length % teamCount) + 1)).padStart(2, '0')}`,
    },
    timer: { status: 'none', remainingSeconds: null, timerEndAt: null },
    keeper: {
      config: state.keeperConfig,
      selections: state.keeperSelections,
      locks: keeperLocks(),
    },
    updatedAt: state.updatedAt,
    currentUserRosterId: 'roster-1',
    orphanRosterIds: [],
    aiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
  })

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
      body: JSON.stringify({
        leagueId,
        updated: true,
        updatedAt: state.updatedAt,
        session: buildSession(),
      }),
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
        entries: [
          { name: 'Legacy Runner', position: 'RB', team: 'NYJ', adp: 10.2, playerId: 'p-1' },
          { name: 'Carry Star', position: 'WR', team: 'DAL', adp: 14.6, playerId: 'p-2' },
          { name: 'Keeper Ace', position: 'QB', team: 'KC', adp: 20.1, playerId: 'p-3' },
        ],
        sport: 'NFL',
        count: 3,
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagueId, queue: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [], syncActive: true }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/recap`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'Keeper recap' }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/replay`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) })
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
        recommendation: { player: { name: 'Legacy Runner', position: 'RB', team: 'NYJ' }, reason: 'Best keeper value', confidence: 83 },
        alternatives: [],
        explanation: 'Optional AI advice only.',
        evidence: [],
        caveats: [],
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/keepers`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: state.keeperConfig,
          deadlineLocked: false,
          sessionStatus: state.status,
          selections: state.keeperSelections,
          locks: keeperLocks(),
          mySelections: state.keeperSelections.filter((entry) => entry.rosterId === 'roster-1'),
          carryoverByRoster,
          myCarryover: carryoverByRoster['roster-1'],
          currentUserRosterId: 'roster-1',
        }),
      })
      return
    }

    const payload = route.request().postDataJSON() as Record<string, unknown>
    requests.keeperAdd.push(payload)
    const rosterId = String(payload.rosterId ?? '')
    const roundCost = Math.round(Number(payload.roundCost))
    const playerName = String(payload.playerName ?? '').trim()
    const position = String(payload.position ?? '—').trim().toUpperCase() || '—'
    const team = payload.team ? String(payload.team) : null
    const commissionerOverride = Boolean(payload.commissionerOverride)

    if (!rosterId || !playerName || !Number.isFinite(roundCost)) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid keeper payload' }) })
      return
    }
    if (roundCost < 1 || roundCost > rounds) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Round cost out of range' }) })
      return
    }

    const rosterSelections = state.keeperSelections.filter((entry) => entry.rosterId === rosterId)
    const filtered = state.keeperSelections.filter((entry) => {
      if (entry.rosterId !== rosterId) return true
      return normalizeName(entry.playerName) !== normalizeName(playerName) && entry.roundCost !== roundCost
    })
    const carryoverForRoster = carryoverByRoster[rosterId] ?? []
    if (!commissionerOverride && carryoverForRoster.length > 0 && !carryoverForRoster.includes(normalizeName(playerName))) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Player is not eligible for keeper carryover on this roster.' }),
      })
      return
    }
    if (!commissionerOverride && rosterSelections.length >= state.keeperConfig.maxKeepers) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Maximum ${state.keeperConfig.maxKeepers} keepers per team` }),
      })
      return
    }
    if (!commissionerOverride && rosterSelections.some((entry) => entry.roundCost === roundCost)) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: `You already have a keeper for round ${roundCost}` }),
      })
      return
    }
    if (!commissionerOverride && filtered.some((entry) => normalizeName(entry.playerName) === normalizeName(playerName))) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Player is already protected by another roster' }),
      })
      return
    }

    state.keeperSelections = [
      ...filtered,
      {
        rosterId,
        roundCost,
        playerName,
        position,
        team,
        playerId: null,
        commissionerOverride,
      },
    ]
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        keeper: {
          config: state.keeperConfig,
          selections: state.keeperSelections,
          locks: keeperLocks(),
        },
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/keepers/remove`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    requests.keeperRemove.push(payload)
    const rosterId = String(payload.rosterId ?? '')
    const playerName = payload.playerName != null ? String(payload.playerName) : null
    const roundCost = payload.roundCost != null ? Math.round(Number(payload.roundCost)) : null
    const before = state.keeperSelections.length
    state.keeperSelections = state.keeperSelections.filter((entry) => {
      if (entry.rosterId !== rosterId) return true
      if (playerName && normalizeName(entry.playerName) === normalizeName(playerName)) return false
      if (roundCost != null && entry.roundCost === roundCost) return false
      return true
    })
    if (state.keeperSelections.length === before) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'No matching keeper to remove' }) })
      return
    }
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Shape must match app/api/leagues/[leagueId]/draft/keepers/route.ts, which
      // returns these fields at the TOP level. The mock previously nested them
      // under `keeper`, so KeeperPanel read json.config as undefined and fell back
      // to { maxKeepers: 0 } — which makes canEdit false and hides the entire add
      // form. The keepers tab still rendered, so the failure looked like a missing
      // button rather than a mock that answered the wrong shape.
      body: JSON.stringify({
        config: state.keeperConfig,
        deadlineLocked: false,
        sessionStatus: state.status,
        selections: state.keeperSelections,
        locks: keeperLocks(),
        mySelections: state.keeperSelections.filter((s) => s.rosterId === 'roster-1'),
        carryoverByRoster: {},
        myCarryover: [],
        currentUserRosterId: 'roster-1',
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/keepers/config`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    requests.keeperConfig.push(payload)
    if (typeof payload.maxKeepers === 'number') {
      state.keeperConfig.maxKeepers = Math.max(0, Math.min(50, Math.round(payload.maxKeepers)))
    }
    if (payload.deadline !== undefined) {
      state.keeperConfig.deadline = payload.deadline ? String(payload.deadline) : null
    }
    if (payload.maxKeepersPerPosition && typeof payload.maxKeepersPerPosition === 'object') {
      state.keeperConfig.maxKeepersPerPosition = payload.maxKeepersPerPosition as Record<string, number>
    }
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, config: state.keeperConfig, session: buildSession() }),
    })
  })

  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'Keeper Draft E2E' }] }) })
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

  return requests
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

test.describe('@keeper-draft-room click audit', () => {
  test('keeper selection, validation, round-cost lock mapping, override, and remove are wired', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const leagueId = `e2e-keeper-draft-${Date.now()}`
    const requests = await mockKeeperDraftRoomApis(page, leagueId)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL&commissioner=1`)
    await openDraftRoomHarness(page)
    const mobile = page.getByTestId('draft-mobile-layout')

    await page.getByTestId('draft-mobile-tab-keepers').click()
    await expect(mobile.getByTestId('draft-keeper-add-submit')).toBeVisible()
    await mobile.getByTestId('draft-keeper-select-roster').selectOption('roster-1')

    await mobile.getByTestId('draft-keeper-config-max-keepers').fill('1')
    await mobile.getByTestId('draft-keeper-config-position-caps').fill('{"QB":1,"RB":1}')
    await mobile.getByTestId('draft-keeper-config-save').click()
    await expect.poll(() => requests.keeperConfig.length).toBeGreaterThan(0)

    // Select keeper works.
    await mobile.getByTestId('draft-keeper-add-player-name').fill('Legacy Runner')
    await mobile.getByTestId('draft-keeper-add-position').fill('RB')
    await mobile.getByTestId('draft-keeper-add-team').fill('NYJ')
    await mobile.getByTestId('draft-keeper-add-round-cost').selectOption('2')
    await mobile.getByTestId('draft-keeper-add-submit').click()
    await expect(mobile.getByTestId('draft-keeper-row-0')).toContainText('Legacy Runner')
    await expect.poll(() => requests.keeperAdd.length).toBeGreaterThan(0)

    // Round-cost mapping and board lock rendering.
    await page.getByTestId('draft-mobile-tab-board').click()
    await expect(mobile.getByTestId('draft-board-cell-8')).toContainText('Legacy Runner')
    await expect(mobile.getByTestId('draft-board-cell-8')).toContainText('K')

    await page.getByTestId('draft-mobile-tab-keepers').click()

    // Validate eligibility rules (carryover + max keepers).
    await mobile.getByTestId('draft-keeper-add-player-name').fill('Random Outsider')
    await mobile.getByTestId('draft-keeper-add-position').fill('WR')
    await mobile.getByTestId('draft-keeper-add-team').fill('LAR')
    await mobile.getByTestId('draft-keeper-add-round-cost').selectOption('3')
    await mobile.getByTestId('draft-keeper-commissioner-override').uncheck()
    await mobile.getByTestId('draft-keeper-add-submit').click()
    await expect(page.getByText(/not eligible for keeper carryover/i)).toBeVisible()

    // Commissioner override works (bypass eligibility / max keeper cap).
    await mobile.getByTestId('draft-keeper-commissioner-override').check()
    await mobile.getByTestId('draft-keeper-add-submit').click()
    await expect(mobile.getByTestId('draft-keeper-row-1')).toContainText('Random Outsider')

    await page.getByTestId('draft-mobile-tab-board').click()
    await expect(mobile.getByTestId('draft-board-cell-9')).toContainText('Random Outsider')

    // No dead keeper actions: remove updates list and board lock.
    await page.getByTestId('draft-mobile-tab-keepers').click()
    await mobile.getByTestId('draft-keeper-remove-0').click()
    await expect.poll(() => requests.keeperRemove.length).toBeGreaterThan(0)
    await page.getByTestId('draft-mobile-tab-board').click()
    await expect(mobile.getByTestId('draft-board-cell-8')).not.toContainText('Legacy Runner')
  })
})
