import { expect, test, type Page } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

// See the helper: dev-mode CSP reports otherwise saturate the shared `next dev`.
test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

test.describe.configure({ mode: 'serial', timeout: 120_000 })

const ROSTER_INCOMPLETE_HTTP = {
  code: 'ROSTER_CONFIGURATION_INCOMPLETE',
  message: 'Complete roster configuration before starting the draft.',
} as const

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

async function mockAuthAndChrome(page: Page, leagueId: string) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
  })
  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/api/user/profile', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
  await page.route(`**/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        league: {
          teams: [
            { rosterId: 'roster-1', name: 'Alpha' },
            { rosterId: 'roster-2', name: 'Beta' },
          ],
        },
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/privacy`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviteLink: null }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/claim-roster`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ alreadyClaimed: true, rosters: [] }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/assistant-context`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sport: 'NFL',
        headlines: [],
        injuries: [],
        sportsFeed: { available: false, updatedAt: null, sourceKeys: [], digest: null },
      }),
    })
  })
}

async function openDraftRoomHarness(page: Page) {
  const button = page.getByTestId('draft-enter-room-button')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const visible = await button.isVisible().catch(() => false)
    if (!visible) {
      await page.waitForTimeout(150)
      continue
    }
    try {
      await button.click({ timeout: 1500 })
      break
    } catch {
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="draft-enter-room-button"]') as HTMLButtonElement | null
        el?.click()
      })
    }
    await page.waitForTimeout(150)
  }
  await expect(page.getByTestId('draft-room-shell')).toBeVisible()
}

async function mockSnakeRosterGateScenario(
  page: Page,
  leagueId: string,
  opts?: { initialSchemaComplete?: boolean },
) {
  await mockAuthAndChrome(page, leagueId)

  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]

  const settings = {
    tradedPickColorModeEnabled: false,
    tradedPickOwnerNameRedEnabled: false,
    aiAdpEnabled: false,
    aiQueueReorderEnabled: false,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu' as const,
    liveDraftChatSyncEnabled: false,
    autoPickEnabled: false,
    timerMode: 'per_pick',
    commissionerForceAutoPickEnabled: false,
    draftOrderRandomizationEnabled: false,
    pickTradeEnabled: false,
  }

  const poolEntries = [
    { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
    { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
  ]

  let schemaComplete = Boolean(opts?.initialSchemaComplete)
  const state = {
    version: 1,
    sessionStatus: 'in_progress' as const,
    picks: [
      {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-1',
        displayName: 'Alpha',
        playerName: 'Keeper One',
        position: 'QB',
        team: 'BUF',
        byeWeek: 8,
        playerId: 'k-1',
        tradedPickMeta: null,
        source: 'user',
        pickLabel: '1.01',
        createdAt: new Date().toISOString(),
      },
    ] as Array<Record<string, unknown>>,
  }

  const rosterGateSnapshot = () =>
    schemaComplete
      ? { rosterConfigurationIncomplete: false as const, rosterConfigurationMessage: null as null }
      : {
          rosterConfigurationIncomplete: true as const,
          rosterConfigurationMessage:
            'Roster configuration is incomplete. The commissioner must save roster slots in league settings before drafting.',
        }

  const buildSession = () => {
    const overall = state.picks.length + 1
    const current = getSlotForOverall(overall, slotOrder.length)
    const roster = slotOrder[current.slot - 1]
    return {
      id: 'session-e2e-roster-gate',
      leagueId,
      status: state.sessionStatus,
      draftType: 'snake',
      rounds: 4,
      teamCount: slotOrder.length,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: new Date(Date.now() + 55_000).toISOString(),
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
        status: 'running' as const,
        remainingSeconds: 55,
        timerEndAt: new Date(Date.now() + 55_000).toISOString(),
      },
      updatedAt: new Date().toISOString(),
      currentUserRosterId: 'roster-2',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
      ...rosterGateSnapshot(),
    }
  }

  await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, session: buildSession() }),
      })
      return
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { action?: string }
      if (body.action === 'start') {
        if (!schemaComplete) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify(ROSTER_INCOMPLETE_HTTP),
          })
          return
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, session: buildSession() }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/leagues/${leagueId}/draft/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        updated: true,
        updatedAt: new Date().toISOString(),
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/live-sync**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        updated: false,
        updatedAt: buildSession().updatedAt,
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: { queue_size_limit: 50, autopick_behavior: 'skip' },
          draftUISettings: settings,
          idpRosterSummary: null,
          orphanStatus: { orphanRosterIds: [], recentActions: [] },
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    if (!schemaComplete) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [],
          sport: 'NFL',
          count: 0,
          rosterConfigurationIncomplete: true,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: poolEntries,
        sport: 'NFL',
        count: poolEntries.length,
        rosterConfigurationIncomplete: false,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pick`, async (route) => {
    if (!schemaComplete) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          ...ROSTER_INCOMPLETE_HTTP,
          message: 'Roster slots must be configured before drafting.',
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: [] }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [], syncActive: false }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/roster-config`, async (route) => {
    if (!schemaComplete) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          templateId: 't1',
          sportType: 'NFL',
          formatType: 'standard',
          starterSlots: {},
          benchSlots: 0,
          taxiSlots: 0,
          devySlots: 0,
          slots: [],
          orderedSlotLabels: [],
          hasPersistedRosterSchema: false,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        templateId: 't1',
        sportType: 'NFL',
        formatType: 'standard',
        starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
        benchSlots: 6,
        taxiSlots: 0,
        devySlots: 0,
        slots: [],
        orderedSlotLabels: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
        hasPersistedRosterSchema: true,
      }),
    })
  })

  await page.route(`**/api/commissioner/leagues/${leagueId}/roster-settings`, async (route) => {
    if (route.request().method() === 'PUT') {
      schemaComplete = true
      state.version += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          config: { templateKey: 'custom', slots: { QB: 1 } },
          unifiedConfig: { rosterMatchesTemplate: true, rosterWarnings: [] },
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  const flipSchemaComplete = () => {
    schemaComplete = true
    state.version += 1
  }

  return { flipSchemaComplete, buildSession }
}

type AuctionPickRow = {
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

async function mockAuctionRosterGateScenario(page: Page, leagueId: string) {
  await mockAuthAndChrome(page, leagueId)

  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]
  const budgetPerTeam = 200

  const settings = {
    tradedPickColorModeEnabled: false,
    tradedPickOwnerNameRedEnabled: false,
    aiAdpEnabled: false,
    aiQueueReorderEnabled: false,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu' as const,
    liveDraftChatSyncEnabled: false,
    autoPickEnabled: false,
    timerMode: 'per_pick',
    commissionerForceAutoPickEnabled: false,
    draftOrderRandomizationEnabled: false,
    pickTradeEnabled: false,
  }

  let schemaComplete = false

  const rosterGateSnapshot = () =>
    schemaComplete
      ? { rosterConfigurationIncomplete: false as const, rosterConfigurationMessage: null as null }
      : {
          rosterConfigurationIncomplete: true as const,
          rosterConfigurationMessage:
            'Roster configuration is incomplete. The commissioner must save roster slots in league settings before drafting.',
        }

  const state = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessionStatus: 'in_progress' as const,
    timerRemainingSeconds: 28,
    picks: [] as AuctionPickRow[],
    budgets: Object.fromEntries(slotOrder.map((entry) => [entry.rosterId, budgetPerTeam])) as Record<string, number>,
    auctionState: {
      nominationOrderIndex: 0,
      currentNomination: {
        playerName: 'Atlas Runner',
        position: 'RB',
        team: 'NYJ',
        playerId: 'p-1',
        byeWeek: null as number | null,
      },
      currentBid: 5,
      currentBidderRosterId: 'roster-2',
      bidTimerEndAt: new Date(Date.now() + 20_000).toISOString(),
      minNextBid: 6,
    },
  }

  function formatPickLabel(overall: number, teamCount: number): string {
    const round = Math.ceil(overall / teamCount)
    const pickInRound = ((overall - 1) % teamCount) + 1
    return `${round}.${String(pickInRound).padStart(2, '0')}`
  }

  const buildSession = () => {
    const overall = state.picks.length + 1
    const round = Math.ceil(overall / slotOrder.length)
    const currentNominator =
      slotOrder[
        ((Math.max(0, state.auctionState.nominationOrderIndex) % Math.max(1, slotOrder.length)) +
          Math.max(1, slotOrder.length)) %
          Math.max(1, slotOrder.length)
      ]
    const timerStatus =
      state.sessionStatus === 'in_progress'
        ? state.timerRemainingSeconds <= 0
          ? 'expired'
          : 'running'
        : 'none'

    return {
      id: 'session-auction-roster-gate',
      leagueId,
      status: state.sessionStatus,
      draftType: 'auction',
      rounds: 4,
      teamCount: slotOrder.length,
      thirdRoundReversal: false,
      timerSeconds: 30,
      timerEndAt:
        state.sessionStatus === 'in_progress'
          ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString()
          : null,
      pausedRemainingSeconds: null,
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
        remainingSeconds: timerStatus === 'running' ? state.timerRemainingSeconds : null,
        timerEndAt:
          timerStatus === 'running'
            ? new Date(Date.now() + Math.max(0, state.timerRemainingSeconds) * 1000).toISOString()
            : null,
      },
      updatedAt: state.updatedAt,
      currentUserRosterId: 'roster-2',
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
      ...rosterGateSnapshot(),
    }
  }

  await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
    if (route.request().method() === 'GET') {
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

  await page.route(`**/api/leagues/${leagueId}/draft/live-sync**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        updated: false,
        updatedAt: state.updatedAt,
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: { queue_size_limit: 50, autopick_behavior: 'skip' },
          draftUISettings: settings,
          idpRosterSummary: null,
          orphanStatus: { orphanRosterIds: [], recentActions: [] },
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    const entries = [
      { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
      { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
    ]
    if (!schemaComplete) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [],
          sport: 'NFL',
          count: 0,
          rosterConfigurationIncomplete: true,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries,
        sport: 'NFL',
        count: entries.length,
        rosterConfigurationIncomplete: false,
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/auction/nominate`, async (route) => {
    if (!schemaComplete) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          ...ROSTER_INCOMPLETE_HTTP,
          message: 'Roster slots must be configured before nominating.',
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/auction/bid`, async (route) => {
    if (!schemaComplete) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          ...ROSTER_INCOMPLETE_HTTP,
          message: 'Roster slots must be configured before bidding.',
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagueId, queue: [] }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [], syncActive: false }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/roster-config`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        schemaComplete
          ? {
              starterSlots: { QB: 1 },
              benchSlots: 6,
              taxiSlots: 0,
              devySlots: 0,
              orderedSlotLabels: ['QB', 'BN'],
              hasPersistedRosterSchema: true,
            }
          : {
              starterSlots: {},
              benchSlots: 0,
              taxiSlots: 0,
              devySlots: 0,
              orderedSlotLabels: [],
              hasPersistedRosterSchema: false,
            },
      ),
    })
  })

  await page.route(`**/api/commissioner/leagues/${leagueId}/roster-settings`, async (route) => {
    if (route.request().method() === 'PUT') {
      schemaComplete = true
      state.version += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, config: {}, unifiedConfig: {} }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  return { flipSchemaComplete: () => {
    schemaComplete = true
    state.version += 1
  } }
}

test.describe('@draft-room roster configuration gate', () => {
  test('snake: banner visible, timer not live, pool empty, pick + start return 409; commissioner save unlocks room', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const leagueId = `e2e-roster-gate-snake-${Date.now()}`
    await mockSnakeRosterGateScenario(page, leagueId)
    page.on('dialog', async (d) => d.dismiss())

    await page.goto(`/e2e/draft-room?leagueId=${encodeURIComponent(leagueId)}&sport=NFL`)
    await openDraftRoomHarness(page)

    await expect(page.getByTestId('draft-roster-config-incomplete-banner')).toBeVisible()
    const timerEl = page.getByTestId('draft-topbar-timer-value')
    await expect(timerEl).toBeVisible()
    await expect.poll(async () => (await timerEl.textContent())?.trim() ?? '').toMatch(/—|–|-/u)

    const pickAttempt = await page.evaluate(async (id) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/draft/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: 'Atlas Runner',
          position: 'RB',
          team: 'NYJ',
          playerId: 'p-1',
        }),
      })
      const data = await res.json().catch(() => ({}))
      return { status: res.status, code: data.code }
    }, leagueId)
    expect(pickAttempt.status).toBe(409)
    expect(pickAttempt.code).toBe('ROSTER_CONFIGURATION_INCOMPLETE')

    const startAttempt = await page.evaluate(async (id) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/draft/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const data = await res.json().catch(() => ({}))
      return { status: res.status, code: data.code }
    }, leagueId)
    expect(startAttempt.status).toBe(409)
    expect(startAttempt.code).toBe('ROSTER_CONFIGURATION_INCOMPLETE')

    await page.evaluate(async (id) => {
      await fetch(`/api/commissioner/leagues/${encodeURIComponent(id)}/roster-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: { QB: 1, RB: 2 }, templateKey: 'custom' }),
      })
    }, leagueId)

    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent('allfantasy:league-draft-room-revalidate', { detail: { leagueId: id } }),
      )
    }, leagueId)

    await expect.poll(async () => page.getByTestId('draft-roster-config-incomplete-banner').count(), {
      timeout: 15_000,
    }).toBe(0)

    await expect(timerEl).toBeVisible()
    await expect.poll(async () => {
      const t = (await timerEl.textContent())?.trim() ?? ''
      return /\d/.test(t)
    }).toBe(true)
  })

  test('auction: nominate + bid endpoints return 409 while incomplete; unlock after commissioner roster save + revalidate', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const leagueId = `e2e-roster-gate-auct-${Date.now()}`
    await mockAuctionRosterGateScenario(page, leagueId)
    page.on('dialog', async (d) => d.dismiss())

    await page.goto(`/e2e/draft-room?leagueId=${encodeURIComponent(leagueId)}&sport=NFL`)
    await openDraftRoomHarness(page)

    await expect(page.getByTestId('draft-roster-config-incomplete-banner')).toBeVisible()

    const nomRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/draft/auction/nominate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: 'Blaze Catcher',
          position: 'WR',
          team: 'DAL',
          playerId: 'p-2',
          byeWeek: null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      return { status: res.status, code: data.code }
    }, leagueId)
    expect(nomRes.status).toBe(409)
    expect(nomRes.code).toBe('ROSTER_CONFIGURATION_INCOMPLETE')

    const bidRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/draft/auction/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 10 }),
      })
      const data = await res.json().catch(() => ({}))
      return { status: res.status, code: data.code }
    }, leagueId)
    expect(bidRes.status).toBe(409)
    expect(bidRes.code).toBe('ROSTER_CONFIGURATION_INCOMPLETE')

    await page.evaluate(async (id) => {
      await fetch(`/api/commissioner/leagues/${encodeURIComponent(id)}/roster-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: { QB: 1 }, templateKey: 'custom' }),
      })
    }, leagueId)

    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent('allfantasy:league-draft-room-revalidate', { detail: { leagueId: id } }),
      )
    }, leagueId)

    await expect.poll(async () => page.getByTestId('draft-roster-config-incomplete-banner').count(), {
      timeout: 15_000,
    }).toBe(0)
  })

  test('snake: session without roster gate shows no banner and numeric timer', async ({ page }) => {
    test.setTimeout(120_000)
    const leagueId = `e2e-roster-ok-snake-${Date.now()}`
    await mockSnakeRosterGateScenario(page, leagueId, { initialSchemaComplete: true })
    page.on('dialog', async (d) => d.dismiss())

    await page.goto(`/e2e/draft-room?leagueId=${encodeURIComponent(leagueId)}&sport=NFL`)
    await openDraftRoomHarness(page)

    await expect(page.getByTestId('draft-roster-config-incomplete-banner')).toHaveCount(0)
    const timerEl = page.getByTestId('draft-topbar-timer-value')
    await expect.poll(async () => /\d/.test((await timerEl.textContent())?.trim() ?? '')).toBe(true)
  })
})
