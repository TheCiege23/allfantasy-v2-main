import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'
import { openCommissionerControls } from './helpers/commissioner-controls'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type AuctionStateModel = {
  nominationOrderIndex: number
  currentNomination: {
    playerName: string
    position: string
    team: string | null
    playerId: string | null
    byeWeek: number | null
  } | null
  currentBid: number
  currentBidderRosterId: string | null
  bidTimerEndAt: string | null
  minNextBid: number
}

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
  amount?: number | null
  createdAt: string
}

function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

async function mockAuctionDraftRoomApis(page: Page, leagueId: string) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]
  const budgetPerTeam = 200

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
    auctionAutoNominationEnabled: false,
  }

  const poolEntries = [
    { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
    { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
    { playerId: 'p-3', name: 'Core Signal', position: 'QB', team: 'KC', adp: 21.2 },
    { playerId: 'p-4', name: 'Delta Edge', position: 'TE', team: 'SEA', adp: 25.3 },
    { playerId: 'p-5', name: 'Echo Guard', position: 'RB', team: 'MIA', adp: 31.8 },
  ]

  const nominateRequests: Array<Record<string, unknown>> = []
  const bidRequests: Array<Record<string, unknown>> = []
  const resolveRequests: Array<Record<string, unknown>> = []
  const controlsRequests: Array<Record<string, unknown>> = []
  const settingsPatchRequests: Array<Record<string, unknown>> = []
  const resyncHits: string[] = []

  const state: {
    version: number
    updatedAt: string
    sessionStatus: 'in_progress' | 'paused' | 'completed'
    timerRemainingSeconds: number
    picks: DraftPickRow[]
    budgets: Record<string, number>
    queue: Array<{ playerName: string; position: string; team?: string | null }>
    auctionState: AuctionStateModel
    chat: Array<{ id: string; from: string; text: string; at: string; isAiSuggestion?: boolean }>
  } = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessionStatus: 'in_progress',
    timerRemainingSeconds: 28,
    picks: [],
    budgets: Object.fromEntries(slotOrder.map((entry) => [entry.rosterId, budgetPerTeam])),
    queue: [],
    auctionState: {
      nominationOrderIndex: 0,
      currentNomination: null,
      currentBid: 0,
      currentBidderRosterId: null,
      bidTimerEndAt: new Date(Date.now() + 28_000).toISOString(),
      minNextBid: 1,
    },
    chat: [
      { id: 'm1', from: 'Commissioner', text: 'Auction room is live.', at: new Date().toISOString() },
      {
        id: 'm2',
        from: 'Chimmy',
        text: 'Auction helper available for your next move.',
        at: new Date().toISOString(),
        isAiSuggestion: true,
      },
    ],
  }

  const getCurrentNominator = () => {
    const index = ((state.auctionState.nominationOrderIndex % slotOrder.length) + slotOrder.length) % slotOrder.length
    return slotOrder[index]
  }

  const touch = () => {
    state.version += 1
    state.updatedAt = new Date().toISOString()
  }

  const advanceTimer = () => {
    if (state.sessionStatus !== 'in_progress') return
    state.timerRemainingSeconds = Math.max(0, state.timerRemainingSeconds - 1)
  }

  const startNomination = (payload: Record<string, unknown>) => {
    state.auctionState.currentNomination = {
      playerName: String(payload.playerName ?? payload.player_name ?? '').trim(),
      position: String(payload.position ?? '').trim().toUpperCase(),
      team: (payload.team as string | null) ?? null,
      playerId: (payload.playerId as string | null) ?? (payload.player_id as string | null) ?? null,
      byeWeek: (payload.byeWeek as number | null) ?? (payload.bye_week as number | null) ?? null,
    }
    state.auctionState.currentBid = 0
    state.auctionState.currentBidderRosterId = null
    state.auctionState.minNextBid = 1
    state.timerRemainingSeconds = 24
    state.auctionState.bidTimerEndAt = new Date(Date.now() + state.timerRemainingSeconds * 1000).toISOString()
    touch()
  }

  const resolveCurrentAuction = () => {
    const nomination = state.auctionState.currentNomination
    if (!nomination) return { sold: false as const, winnerRosterId: undefined, amount: undefined }
    const winnerRosterId = state.auctionState.currentBidderRosterId
    const amount = state.auctionState.currentBid
    let sold = false
    if (winnerRosterId && amount > 0) {
      sold = true
      const overall = state.picks.length + 1
      const teamCount = slotOrder.length
      const round = Math.ceil(overall / teamCount)
      const pickLabel = formatPickLabel(overall, teamCount)
      const winner = slotOrder.find((entry) => entry.rosterId === winnerRosterId)
      state.picks.push({
        id: `pick-${overall}`,
        overall,
        round,
        slot: winner?.slot ?? 1,
        rosterId: winnerRosterId,
        displayName: winner?.displayName ?? 'Manager',
        playerName: nomination.playerName,
        position: nomination.position,
        team: nomination.team ?? null,
        byeWeek: nomination.byeWeek ?? null,
        playerId: nomination.playerId ?? null,
        source: 'user',
        pickLabel,
        amount,
        createdAt: new Date().toISOString(),
      })
      state.budgets[winnerRosterId] = Math.max(0, (state.budgets[winnerRosterId] ?? budgetPerTeam) - amount)
    }
    state.auctionState.nominationOrderIndex = (state.auctionState.nominationOrderIndex + 1) % slotOrder.length
    state.auctionState.currentNomination = null
    state.auctionState.currentBid = 0
    state.auctionState.currentBidderRosterId = null
    state.auctionState.minNextBid = 1
    state.timerRemainingSeconds = 16
    state.auctionState.bidTimerEndAt = new Date(Date.now() + state.timerRemainingSeconds * 1000).toISOString()
    touch()
    return {
      sold,
      winnerRosterId: sold ? winnerRosterId ?? undefined : undefined,
      amount: sold ? amount : undefined,
    }
  }

  const maybeAutoNominate = () => {
    if (state.auctionState.currentNomination != null) return false
    const drafted = new Set(state.picks.map((pick) => pick.playerName.toLowerCase()))
    const candidate = poolEntries.find((entry) => !drafted.has(entry.name.toLowerCase()))
    if (!candidate) return false
    startNomination({
      playerName: candidate.name,
      position: candidate.position,
      team: candidate.team,
      playerId: candidate.playerId,
      byeWeek: null,
    })
    return true
  }

  const buildSession = () => {
    const currentNominator = getCurrentNominator()
    const timerStatus =
      state.sessionStatus === 'paused'
        ? 'paused'
        : state.sessionStatus === 'in_progress'
          ? state.timerRemainingSeconds <= 0
            ? 'expired'
            : 'running'
          : 'none'

    const overall = state.picks.length + 1
    const round = Math.ceil(overall / slotOrder.length)
    return {
      id: 'session-auction-e2e-1',
      leagueId,
      status: state.sessionStatus,
      draftType: 'auction',
      rounds: 4,
      teamCount: slotOrder.length,
      thirdRoundReversal: false,
      timerSeconds: 30,
      timerEndAt: state.sessionStatus === 'in_progress' ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString() : null,
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
              round,
              slot: currentNominator.slot,
              rosterId: currentNominator.rosterId,
              displayName: currentNominator.displayName,
              pickLabel: formatPickLabel(overall, slotOrder.length),
            },
      timer: {
        status: timerStatus,
        remainingSeconds: timerStatus === 'none' ? null : state.timerRemainingSeconds,
        timerEndAt: timerStatus === 'running' ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString() : null,
      },
      updatedAt: state.updatedAt,
      currentUserRosterId: 'roster-1',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
      auction: {
        draftType: 'auction',
        budgetPerTeam,
        budgets: state.budgets,
        minBidIncrement: 1,
        nominationOrder: slotOrder,
        auctionState: state.auctionState,
      },
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
    if (route.request().method() === 'GET') {
      resyncHits.push('session')
      advanceTimer()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, session: buildSession() }),
      })
      return
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
    const method = route.request().method()
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>
      settingsPatchRequests.push(patch)
      Object.assign(draftUiSettings, patch)
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
      const body = route.request().postDataJSON() as { queue?: Array<{ playerName: string; position: string; team?: string | null }> }
      state.queue = body.queue ?? []
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: state.queue }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/queue/ai-reorder`, async (route) => {
    if (route.request().method() === 'POST') {
      state.queue = [...state.queue].sort((a, b) => a.playerName.localeCompare(b.playerName))
      touch()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: state.queue }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { text?: string }
      state.chat.push({
        id: `m-${state.chat.length + 1}`,
        from: 'You',
        text: String(body.text ?? ''),
        at: new Date().toISOString(),
      })
      touch()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: state.chat,
        syncActive: true,
        message: route.request().method() === 'POST' ? state.chat[state.chat.length - 1] : undefined,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proposals: [] }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals/*/review`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, proposal: null }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals/*/respond`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, proposal: null }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pick`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/ai-pick`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession(), pick: null }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/autopick-expired`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession(), changed: false }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/post-draft-summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: null }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/replay`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [] }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/recap`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, recap: 'Auction recap pending.' }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/ai-adp`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, rankings: [] }),
    })
  })

  await page.route('**/api/draft/recommend', async (route) => {
    const body = route.request().postDataJSON() as { available?: Array<{ name: string; position: string; team?: string | null; adp?: number | null }> }
    const first = body.available?.[0] ?? { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: {
          player: first,
          reason: 'Deterministic value recommendation.',
          confidence: 84,
        },
        alternatives: [],
        reachWarning: null,
        valueWarning: null,
        scarcityInsight: null,
        stackInsight: null,
        correlationInsight: null,
        formatInsight: null,
        byeNote: null,
        explanation: 'Use deterministic rankings and roster fit.',
        evidence: ['ADP edge positive.'],
        caveats: [],
        uncertainty: null,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/auction/nominate`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    nominateRequests.push(payload)
    if (state.auctionState.currentNomination) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'A player is already on the block' }) })
      return
    }
    startNomination(payload)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/auction/bid`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    bidRequests.push(payload)
    const amount = Number(payload.amount ?? payload.bid ?? 0)
    if (!state.auctionState.currentNomination) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'No player currently on the block' }) })
      return
    }
    if (!Number.isFinite(amount) || amount < state.auctionState.minNextBid) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: `Minimum bid is $${state.auctionState.minNextBid}` }) })
      return
    }
    state.auctionState.currentBid = amount
    state.auctionState.currentBidderRosterId = 'roster-1'
    state.auctionState.minNextBid = amount + 1
    state.timerRemainingSeconds = 21
    state.auctionState.bidTimerEndAt = new Date(Date.now() + state.timerRemainingSeconds * 1000).toISOString()
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/auction/resolve`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    resolveRequests.push(payload)
    const result = resolveCurrentAuction()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sold: result.sold,
        winnerRosterId: result.winnerRosterId,
        amount: result.amount,
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/controls`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    controlsRequests.push(payload)
    const action = String(payload.action ?? '')
    if (action === 'pause') {
      state.sessionStatus = 'paused'
      touch()
    } else if (action === 'resume') {
      state.sessionStatus = 'in_progress'
      if (state.timerRemainingSeconds <= 0) state.timerRemainingSeconds = 15
      touch()
    } else if (action === 'reset_timer') {
      state.timerRemainingSeconds = 30
      touch()
    } else if (action === 'resolve_auction') {
      resolveCurrentAuction()
    } else if (action === 'auction_tick') {
      if (state.auctionState.currentNomination && state.timerRemainingSeconds <= 0) {
        resolveCurrentAuction()
      } else {
        maybeAutoNominate()
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        action,
        session: buildSession(),
      }),
    })
  })

  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagues: [{ id: leagueId, name: 'Auction League E2E' }],
      }),
    })
  })

  await page.route('**/api/commissioner/broadcast', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // Safety net for any new draft-room league endpoints not explicitly mocked here.
  await page.route(`**/api/leagues/${leagueId}/**`, async (route) => {
    const url = route.request().url()
    const isExplicitlyMocked = [
      '/draft/session',
      '/draft/events',
      '/draft/settings',
      '/draft/pool',
      '/draft/queue',
      '/draft/queue/ai-reorder',
      '/draft/chat',
      '/draft/trade-proposals',
      '/draft/trade-proposals/',
      '/draft/pick',
      '/draft/ai-pick',
      '/draft/auction/nominate',
      '/draft/auction/bid',
      '/draft/auction/resolve',
      '/draft/autopick-expired',
      '/draft/post-draft-summary',
      '/draft/replay',
      '/draft/recap',
      '/draft/controls',
      '/ai-adp',
    ].some((path) => url.includes(path))
    if (isExplicitlyMocked) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    const knownRoot = [
      '/api/auth/session',
      '/api/auth/config-check',
      '/api/user/profile',
      '/api/draft/recommend',
      '/api/commissioner/leagues',
      '/api/commissioner/broadcast',
      `/api/leagues/${leagueId}/`,
    ].some((path) => url.includes(path))
    if (knownRoot) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  return {
    getNominateRequests: () => nominateRequests,
    getBidRequests: () => bidRequests,
    getResolveRequests: () => resolveRequests,
    getControlsRequests: () => controlsRequests,
    getSettingsPatchRequests: () => settingsPatchRequests,
    getResyncHits: () => resyncHits,
  }
}

async function openDraftRoomHarness(page: Page) {
  const enter = page.getByTestId('draft-enter-room-button')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const shellVisible = await page.getByTestId('draft-room-shell').isVisible().catch(() => false)
    if (shellVisible) return
    const visible = await enter.isVisible().catch(() => false)
    if (!visible) {
      await page.waitForTimeout(300)
      continue
    }
    try {
      await enter.click({ timeout: 1500, force: true })
    } catch {
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="draft-enter-room-button"]') as HTMLButtonElement | null
        el?.click()
      })
    }
    await page.waitForTimeout(300)
  }
  await expect(page.getByTestId('draft-room-shell')).toBeVisible()
}

test.describe('@auction-draft-room click audit', () => {
  test('auction deterministic controls and UI are fully wired', async ({ page }) => {
    const leagueId = `e2e-auction-room-${Date.now()}`
    const mocks = await mockAuctionDraftRoomApis(page, leagueId)
    page.on('dialog', async (dialog) => {
      await dialog.dismiss()
    })

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    const desktop = page.getByTestId('draft-desktop-layout')
    const auctionSpotlight = desktop.locator('[data-auction-spotlight]').first()
    await expect(auctionSpotlight).toBeVisible()
    await expect(desktop.getByTestId('auction-current-nominator').first()).toContainText('Alpha')

    // Nominate player flow.
    await desktop.getByTestId('draft-player-search-input').fill('Atlas')
    await clickHydrated(desktop.getByTestId('draft-nominate-player-0'))
    await expect(desktop.getByTestId('draft-pick-confirmation')).toBeVisible()
    await clickHydrated(desktop.getByTestId('draft-confirm-pick-button'))
    expect(mocks.getNominateRequests().length).toBeGreaterThan(0)
    await expect(auctionSpotlight).toContainText('Atlas Runner')

    // Bid flow.
    await desktop.getByTestId('auction-bid-input').first().fill('5')
    await expect(desktop.getByTestId('auction-bid-button').first()).toBeEnabled()
    await clickHydrated(desktop.getByTestId('auction-bid-button').first())
    await expect.poll(() => mocks.getBidRequests().length).toBeGreaterThan(0)
    await expect(desktop.getByTestId('auction-highest-bidder').first()).toContainText('Alpha')

    // Resolve flow updates budget + roster assignment.
    const resolveRequestsBefore = mocks.getResolveRequests().length
    const resolveButton = desktop.getByTestId('auction-resolve-button').first()
    await expect(resolveButton).toBeVisible()
    await expect
      .poll(async () => resolveButton.isEnabled().catch(() => false))
      .toBeTruthy()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await resolveButton.click({ force: true })
      if (mocks.getResolveRequests().length > resolveRequestsBefore) break
      await page.waitForTimeout(150)
    }
    await expect.poll(() => mocks.getResolveRequests().length, { timeout: 10_000 }).toBeGreaterThan(resolveRequestsBefore)
    await expect(desktop.getByTestId('draft-board')).toContainText('Atlas Runner')
    await expect(auctionSpotlight).toContainText('$195')
    await expect(desktop.getByTestId('auction-current-nominator').first()).toContainText('Beta')

    // Timer updates on resync while waiting for nomination.
    const resyncCountBefore = mocks.getResyncHits().length
    const timerBefore = await desktop.getByTestId('auction-nomination-timer').first().innerText()
    await clickHydrated(page.getByTestId('draft-resync-button'))
    await expect.poll(() => mocks.getResyncHits().length).toBeGreaterThan(resyncCountBefore)
    await expect
      .poll(async () => desktop.getByTestId('auction-nomination-timer').first().innerText())
      .not.toBe(timerBefore)

    // AI helper surface opens and recommendation refresh is wired.
    const openAiHelper = desktop.getByTestId('draft-chat-open-ai-helper').first()
    await expect(openAiHelper).toBeVisible()
    await clickHydrated(openAiHelper)
    await expect(openAiHelper).toBeVisible()

    // Commissioner auction controls are wired.
    await openCommissionerControls(page)
    await expect(page.getByTestId('draft-commissioner-modal')).toBeVisible()
    await clickHydrated(page.getByTestId('draft-commissioner-toggle-auction-auto-nomination'))
    await clickHydrated(page.getByTestId('draft-commissioner-auction-tick'))
    await clickHydrated(page.getByTestId('draft-commissioner-resolve-auction'))
    await clickHydrated(page.getByTestId('draft-commissioner-close'))

    const controlActions = mocks.getControlsRequests().map((entry) => String(entry.action ?? ''))
    expect(controlActions).toContain('auction_tick')
    expect(controlActions).toContain('resolve_auction')
    expect(
      mocks.getSettingsPatchRequests().some((patch) =>
        Object.prototype.hasOwnProperty.call(patch, 'auctionAutoNominationEnabled')
      )
    ).toBeTruthy()
  })
})
