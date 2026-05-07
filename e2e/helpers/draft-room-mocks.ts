/**
 * Shared mock + harness helpers for DraftRoom Playwright specs.
 *
 * Originally inlined inside e2e/draft-room-click-audit.spec.ts. Extracted so
 * other render-pipeline specs (e.g. draft-room-ai-adp-render.spec.ts) can boot
 * the harness without duplicating ~1100 lines of route mocks.
 */
import { expect, type Page } from '@playwright/test'

export function createLeagueId(prefix: string): string {
  const entropy = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${entropy}`
}

export function getSlotForOverall(overall: number, teamCount: number): { round: number; slot: number; pickLabel: string } {
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

export async function mockDraftRoomApis(
  page: Page,
  leagueId: string,
  options?: { initialStatus?: 'pre_draft' | 'in_progress' | 'paused' | 'completed' }
) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(null),
    })
  })

  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/user/profile', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/subscription/entitlements**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route('**/api/tokens/balance**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balance: 0, updatedAt: new Date().toISOString() }),
    })
  })

  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]

  await page.route('**/api/league/settings**', async (route) => {
    const url = route.request().url()
    const id = new URL(url).searchParams.get('leagueId')
    if (id && id !== leagueId) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        league: {
          teams: slotOrder.map((s) => ({
            id: s.rosterId,
            rosterId: s.rosterId,
            teamName: `Team ${s.slot}`,
            ownerName: s.displayName,
            displayName: s.displayName,
          })),
        },
      }),
    })
  })

  await page.route(`**/api/leagues/*/privacy**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviteLink: null, inviteCode: null }),
    })
  })

  await page.route(`**/api/leagues/*/claim-roster**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ alreadyClaimed: true, rosters: [] }),
    })
  })

  await page.route(`**/api/leagues/*/draft/round-one-highlight**`, async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })

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
    commissionerPauseControlsEnabled: true,
  }

  const poolEntries = [
    { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
    { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
    { playerId: 'p-3', name: 'Core Signal', position: 'QB', team: 'KC', adp: 21.2 },
    { playerId: 'p-4', name: 'Delta Edge', position: 'TE', team: 'SEA', adp: 25.3 },
    { playerId: 'p-5', name: 'Echo Guard', position: 'RB', team: 'MIA', adp: 31.8 },
  ]

  const pickRequests: Array<Record<string, unknown>> = []
  const queuePutRequests: Array<Array<{ playerName: string; position: string; team?: string | null }>> = []
  const controlsRequests: Array<Record<string, unknown>> = []
  const settingsPatchRequests: Array<Record<string, unknown>> = []
  const resyncHits: string[] = []
  const aiPickRequests: Array<Record<string, unknown>> = []
  const tradeOfferRequests: Array<Record<string, unknown>> = []
  const tradeReviewRequests: Array<string> = []
  const tradeRespondRequests: Array<{ proposalId: string; action: string }> = []
  const orphanRecentActions: Array<{ action: string; createdAt: string; reason: string | null; rosterId?: string }> = []

  const state: {
    queue: Array<{ playerName: string; position: string; team?: string | null }>
    chat: Array<{ id: string; from: string; text: string; at: string }>
    version: number
    sessionStatus: 'pre_draft' | 'in_progress' | 'paused' | 'completed'
    picks: Array<Record<string, unknown>>
    tradedPicks: Array<{
      round: number
      originalRosterId: string
      previousOwnerName: string
      newRosterId: string
      newOwnerName: string
    }>
    proposals: Array<{
      id: string
      proposerRosterId: string
      receiverRosterId: string
      giveRound: number
      giveSlot: number
      giveOriginalRosterId: string
      receiveRound: number
      receiveSlot: number
      receiveOriginalRosterId: string
      proposerName: string
      receiverName: string
      status: string
      createdAt: string
    }>
  } = {
    queue: [
      { playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' },
      { playerName: 'Blaze Catcher', position: 'WR', team: 'DAL' },
    ],
    chat: [
      { id: 'm1', from: 'Commissioner', text: 'Welcome to the draft room.', at: new Date().toISOString() },
    ],
    version: 1,
    sessionStatus: options?.initialStatus ?? 'in_progress',
    picks:
      options?.initialStatus === 'pre_draft'
        ? []
        : ([
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
          ] as Array<Record<string, unknown>>),
    tradedPicks: [],
    proposals: [
      {
        id: 'tp-1',
        proposerRosterId: 'roster-1',
        receiverRosterId: 'roster-2',
        giveRound: 2,
        giveSlot: 1,
        giveOriginalRosterId: 'roster-1',
        receiveRound: 3,
        receiveSlot: 2,
        receiveOriginalRosterId: 'roster-2',
        proposerName: 'Alpha',
        receiverName: 'Beta',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'tp-2',
        proposerRosterId: 'roster-3',
        receiverRosterId: 'roster-2',
        giveRound: 2,
        giveSlot: 3,
        giveOriginalRosterId: 'roster-3',
        receiveRound: 4,
        receiveSlot: 2,
        receiveOriginalRosterId: 'roster-2',
        proposerName: 'Gamma',
        receiverName: 'Beta',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'tp-3',
        proposerRosterId: 'roster-4',
        receiverRosterId: 'roster-2',
        giveRound: 2,
        giveSlot: 4,
        giveOriginalRosterId: 'roster-4',
        receiveRound: 4,
        receiveSlot: 2,
        receiveOriginalRosterId: 'roster-2',
        proposerName: 'Delta',
        receiverName: 'Beta',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ],
  }
  if (state.sessionStatus === 'completed' && state.picks.length < 4) {
    state.picks.push(
      {
        id: 'pick-2',
        overall: 2,
        round: 1,
        slot: 2,
        rosterId: 'roster-2',
        displayName: 'Beta',
        playerName: 'Atlas Runner',
        position: 'RB',
        team: 'NYJ',
        byeWeek: null,
        playerId: 'p-1',
        tradedPickMeta: null,
        source: 'user',
        pickLabel: '1.02',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'pick-3',
        overall: 3,
        round: 1,
        slot: 3,
        rosterId: 'roster-3',
        displayName: 'Gamma',
        playerName: 'Blaze Catcher',
        position: 'WR',
        team: 'DAL',
        byeWeek: null,
        playerId: 'p-2',
        tradedPickMeta: null,
        source: 'user',
        pickLabel: '1.03',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'pick-4',
        overall: 4,
        round: 1,
        slot: 4,
        rosterId: 'roster-4',
        displayName: 'Delta',
        playerName: 'Core Signal',
        position: 'QB',
        team: 'KC',
        byeWeek: null,
        playerId: 'p-3',
        tradedPickMeta: null,
        source: 'user',
        pickLabel: '1.04',
        createdAt: new Date().toISOString(),
      }
    )
  }

  const buildSession = () => {
    const overall = state.picks.length + 1
    const current = getSlotForOverall(overall, slotOrder.length)
    const roster = slotOrder[current.slot - 1]
    const currentPick =
      state.sessionStatus === 'completed' || state.sessionStatus === 'pre_draft'
        ? null
        : {
            overall,
            round: current.round,
            slot: current.slot,
            rosterId: roster.rosterId,
            displayName: roster.displayName,
            pickLabel: current.pickLabel,
          }
    return {
      id: 'session-e2e-1',
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
      tradedPicks: state.tradedPicks,
      version: state.version,
      picks: state.picks,
      currentPick,
      timer: {
        status:
          state.sessionStatus === 'paused'
            ? 'paused'
            : state.sessionStatus === 'in_progress'
              ? 'running'
              : 'none',
        remainingSeconds: state.sessionStatus === 'in_progress' || state.sessionStatus === 'paused' ? 55 : null,
        timerEndAt: state.sessionStatus === 'in_progress' ? new Date(Date.now() + 55_000).toISOString() : null,
      },
      updatedAt: new Date().toISOString(),
      currentUserRosterId: 'roster-2',
      orphanRosterIds: settings.orphanTeamAiManagerEnabled ? slotOrder.map((entry) => entry.rosterId) : [],
      aiManagerEnabled: settings.orphanTeamAiManagerEnabled,
      orphanDrafterMode: settings.orphanDrafterMode,
    }
  }

  await page.route(`**/api/leagues/*/draft/session**`, async (route) => {
    if (route.request().method() === 'GET') {
      resyncHits.push('session')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, session: buildSession() }),
      })
      return
    }
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'start') {
      state.sessionStatus = 'in_progress'
      state.version += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, session: buildSession() }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/leagues/*/draft/events**`, async (route) => {
    resyncHits.push('events')
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

  await page.route(`**/api/leagues/*/draft/live-sync**`, async (route) => {
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

  await page.route(`**/api/leagues/*/draft/assistant-context**`, async (route) => {
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

  await page.route(`**/api/draft/intel/stream**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 60000\nevent: ping\ndata: {}\n\n',
    })
  })

  await page.route(`**/api/leagues/*/draft/settings**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: { queue_size_limit: 50, autopick_behavior: 'skip' },
          draftUISettings: settings,
          idpRosterSummary: null,
          orphanStatus: {
            orphanRosterIds: settings.orphanTeamAiManagerEnabled ? slotOrder.map((entry) => entry.rosterId) : [],
            recentActions: orphanRecentActions.slice(0, 10),
          },
        }),
      })
      return
    }
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>
      settingsPatchRequests.push(patch)
      Object.assign(settings, patch)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: { queue_size_limit: 50, autopick_behavior: 'skip' },
          draftUISettings: settings,
          idpRosterSummary: null,
          orphanStatus: {
            orphanRosterIds: settings.orphanTeamAiManagerEnabled ? slotOrder.map((entry) => entry.rosterId) : [],
            recentActions: orphanRecentActions.slice(0, 10),
          },
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/league/ai-opponents/summary**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aiManagedDraftRosterIds: [], assignments: [] }),
    })
  })

  await page.route(`**/api/leagues/*/roster-config**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
        benchSlots: 6,
        taxiSlots: 0,
        devySlots: 0,
        orderedSlotLabels: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/pool**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: poolEntries,
        sport: 'NFL',
        count: poolEntries.length,
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/queue**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leagueId, queue: state.queue }),
      })
      return
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { queue?: Array<{ playerName: string; position: string; team?: string | null }> }
      state.queue = body.queue ?? []
      queuePutRequests.push(state.queue)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, queue: state.queue }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/leagues/*/draft/queue/ai-reorder**`, async (route) => {
    const body = route.request().postDataJSON() as { queue?: Array<{ playerName: string; position: string; team?: string | null }> }
    const reordered = [...(body.queue ?? state.queue)].reverse()
    state.queue = reordered
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reordered,
        explanation: 'Balanced by roster need and ADP value.',
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/pick**`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    pickRequests.push(body)

    const playerName = String(body.playerName ?? '')
    if (!playerName) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'playerName required' }) })
      return
    }
    if (state.picks.some((pick) => pick.playerName === playerName)) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Duplicate pick' }) })
      return
    }
    const overall = state.picks.length + 1
    const pos = String(body.position ?? 'FLEX')
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
      position: pos,
      team: (body.team as string | null) ?? null,
      byeWeek: null,
      playerId: null,
      tradedPickMeta: null,
      source: 'user',
      pickLabel: slot.pickLabel,
      createdAt: new Date().toISOString(),
    })
    state.version += 1
    state.queue = state.queue.filter((entry) => entry.playerName !== playerName)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        pick: state.picks[state.picks.length - 1],
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/ai-pick**`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    aiPickRequests.push(payload)
    const current = buildSession().currentPick
    if (!current) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No current pick' }),
      })
      return
    }
    const fallback = poolEntries.find((entry) => !state.picks.some((pick) => pick.playerName === entry.name)) ?? poolEntries[0]
    const playerName = fallback?.name ?? `AI Pick ${current.overall}`
    const position = fallback?.position ?? 'WR'
    const team = fallback?.team ?? null
    state.picks.push({
      id: `pick-ai-${current.overall}`,
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
      tradedPickMeta: null,
      source: 'auto',
      pickLabel: current.pickLabel,
      createdAt: new Date().toISOString(),
    })
    state.version += 1
    orphanRecentActions.unshift({
      action: 'draft_pick',
      createdAt: new Date().toISOString(),
      reason: `AI manager selected ${playerName}.`,
      rosterId: current.rosterId,
    })
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
        reason: `AI manager selected ${playerName}.`,
        session: buildSession(),
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/chat**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: state.chat,
          syncActive: settings.liveDraftChatSyncEnabled && buildSession().status === 'in_progress',
        }),
      })
      return
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { text?: string }
      const msg = {
        id: `m-${state.chat.length + 1}`,
        from: 'You',
        text: body.text ?? '',
        at: new Date().toISOString(),
      }
      state.chat.push(msg)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: msg,
          syncActive: settings.liveDraftChatSyncEnabled && buildSession().status === 'in_progress',
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/leagues/*/draft/trade-proposals**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ proposals: state.proposals }),
      })
      return
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      tradeOfferRequests.push(body)
      const receiveSlot = Number(body.receiveSlot ?? 1)
      const giveSlot = Number(body.giveSlot ?? 1)
      const giveOriginalRosterId = slotOrder.find((entry) => entry.slot === giveSlot)?.rosterId ?? 'roster-2'
      const receiveOriginalRosterId = slotOrder.find((entry) => entry.slot === receiveSlot)?.rosterId ?? String(body.receiverRosterId ?? 'roster-3')
      const proposalId = `tp-new-${state.proposals.length + 1}`
      const receiverName = slotOrder.find((entry) => entry.rosterId === String(body.receiverRosterId ?? ''))?.displayName ?? 'Manager'
      const created = {
        id: proposalId,
        proposerRosterId: 'roster-2',
        receiverRosterId: String(body.receiverRosterId ?? ''),
        giveRound: Number(body.giveRound ?? 1),
        giveSlot,
        giveOriginalRosterId,
        receiveRound: Number(body.receiveRound ?? 1),
        receiveSlot,
        receiveOriginalRosterId,
        proposerName: 'Beta',
        receiverName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
      state.proposals.unshift(created)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          proposal: created,
          privateAiReviewQueued: true,
          privacy: { aiReview: 'private' },
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.route(`**/api/leagues/*/draft/trade-proposals/*/review**`, async (route) => {
    const url = route.request().url()
    const match = url.match(/trade-proposals\/([^/?]+)\/review/)
    const proposalId = match?.[1] ?? 'unknown'
    tradeReviewRequests.push(proposalId)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verdict: 'counter',
        summary: 'The offer is close, but you should ask for a stronger return.',
        reasons: ['Value is near fair, but you are giving up the earlier premium slot.'],
        declineReasons: ['Current package underpays your side in the next tier break.'],
        counterReasons: ['Request an additional move-up in a later round.'],
        suggestedCounterPackage: 'Ask for their Round 4 slot 1 in addition to the current return.',
        private: true,
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/trade-proposals/*/respond**`, async (route) => {
    const url = route.request().url()
    const match = url.match(/trade-proposals\/([^/?]+)\/respond/)
    const proposalId = match?.[1] ?? ''
    const body = route.request().postDataJSON() as { action?: string }
    const action = String(body.action ?? 'reject')
    tradeRespondRequests.push({ proposalId, action })
    const proposal = state.proposals.find((entry) => entry.id === proposalId)
    if (!proposal) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Proposal not found' }),
      })
      return
    }

    if (action === 'accept') {
      proposal.status = 'accepted'
      const previousGive = slotOrder.find((entry) => entry.rosterId === proposal.giveOriginalRosterId)?.displayName ?? 'Team'
      const previousReceive = slotOrder.find((entry) => entry.rosterId === proposal.receiveOriginalRosterId)?.displayName ?? 'Team'
      state.tradedPicks.push(
        {
          round: proposal.giveRound,
          originalRosterId: proposal.giveOriginalRosterId,
          previousOwnerName: previousGive,
          newRosterId: proposal.receiverRosterId,
          newOwnerName: proposal.receiverName,
        },
        {
          round: proposal.receiveRound,
          originalRosterId: proposal.receiveOriginalRosterId,
          previousOwnerName: previousReceive,
          newRosterId: proposal.proposerRosterId,
          newOwnerName: proposal.proposerName,
        }
      )
      state.version += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, action: 'accepted', session: buildSession() }),
      })
      return
    }
    if (action === 'counter') {
      proposal.status = 'countered'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, action: 'countered' }),
      })
      return
    }
    proposal.status = 'rejected'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, action: 'rejected' }),
    })
  })

  await page.route(`**/api/leagues/*/draft/post-draft-summary**`, async (route) => {
    const pickLog = state.picks.map((pick) => ({
      id: String(pick.id),
      overall: Number(pick.overall),
      round: Number(pick.round),
      slot: Number(pick.slot),
      rosterId: String(pick.rosterId),
      displayName: (pick.displayName as string | null) ?? null,
      playerName: String(pick.playerName),
      position: String(pick.position),
      team: (pick.team as string | null) ?? null,
      pickLabel: String(pick.pickLabel),
      amount: null,
    }))
    const byPosition = pickLog.reduce<Record<string, number>>((acc, pick) => {
      acc[pick.position] = (acc[pick.position] ?? 0) + 1
      return acc
    }, {})
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        leagueName: 'E2E Draft Room',
        sport: 'NFL',
        draftType: 'snake',
        status: state.sessionStatus,
        rounds: 4,
        teamCount: slotOrder.length,
        totalPicks: 16,
        pickCount: pickLog.length,
        byPosition,
        pickLog,
        teamResults: slotOrder.map((entry) => ({
          rosterId: entry.rosterId,
          displayName: entry.displayName,
          slot: entry.slot,
          pickCount: pickLog.filter((pick) => pick.rosterId === entry.rosterId).length,
          picks: pickLog.filter((pick) => pick.rosterId === entry.rosterId),
        })),
        valueReach: [
          { position: 'QB', earliestOverall: 1, firstPickBy: 'Alpha' },
          { position: 'RB', earliestOverall: 2, firstPickBy: 'Beta' },
          { position: 'WR', earliestOverall: 3, firstPickBy: 'Gamma' },
        ],
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/replay**`, async (route) => {
    const pickLog = state.picks.map((pick) => ({
      id: String(pick.id),
      overall: Number(pick.overall),
      round: Number(pick.round),
      slot: Number(pick.slot),
      rosterId: String(pick.rosterId),
      displayName: (pick.displayName as string | null) ?? null,
      playerName: String(pick.playerName),
      position: String(pick.position),
      team: (pick.team as string | null) ?? null,
      pickLabel: String(pick.pickLabel),
      amount: null,
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        leagueName: 'E2E Draft Room',
        sport: 'NFL',
        draftType: 'snake',
        rounds: 4,
        teamCount: slotOrder.length,
        pickCount: pickLog.length,
        pickLog,
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/recap**`, async (route) => {
    const includeAiExplanation = Boolean((route.request().postDataJSON() as { includeAiExplanation?: boolean } | null)?.includeAiExplanation)
    const sections = {
      leagueNarrativeRecap:
        'Deterministic recap: Alpha opened QB early, Beta prioritized RB value, and positional balance held through the board.',
      strategyRecap:
        'Managers opened with core starters and shifted into depth/value in rounds 3-4, preserving roster flexibility.',
      bestWorstValueExplanation:
        'Best value came from Atlas Runner at #2. Largest reach came from Keeper One at #1 relative to ADP.',
      chimmyDraftDebrief:
        'Chimmy debrief: review your bench leverage spots and set early waiver contingencies this week.',
      teamGradeExplanations: [
        {
          rank: 1,
          rosterId: 'roster-1',
          displayName: 'Alpha',
          grade: 'A',
          score: 91.2,
          explanation: 'Alpha captured strong value and maintained balanced positional construction.',
        },
      ],
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recap: includeAiExplanation
          ? 'AI recap: Alpha combined board value with stable roster balance, while Beta built strong RB leverage with manageable reach exposure.'
          : sections.leagueNarrativeRecap,
        deterministicRecap: sections.leagueNarrativeRecap,
        sections,
        execution: { mode: includeAiExplanation ? 'ai_explained' : 'instant_automated' },
      }),
    })
  })

  await page.route('**/api/draft/recommend', async (route) => {
    const body = route.request().postDataJSON() as {
      available?: Array<{ name: string; position: string; team?: string | null; adp?: number | null }>
      includeAIExplanation?: boolean
    }
    const first = body.available?.[0] ?? { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 }
    const includeAIExplanation = Boolean(body.includeAIExplanation)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: {
          player: first,
          reason: 'Best value and strong roster fit.',
          confidence: 87,
        },
        alternatives: [
          { player: { name: 'Blaze Catcher', position: 'WR', team: 'DAL' }, reason: 'High ceiling route tree.', confidence: 79 },
        ],
        reachWarning: null,
        valueWarning: 'Good ADP value at current slot.',
        scarcityInsight: 'RB tier drop expected in next 6 picks.',
        stackInsight: 'Stack path: Atlas Runner correlates with your NYJ QB.',
        correlationInsight: 'Correlation watch: you already roster 2 NYJ players.',
        formatInsight: 'FLEX lineup structure supports this position.',
        byeNote: null,
        explanation: includeAIExplanation
          ? 'AI explanation: Drafting RB now balances your construction and preserves flexibility, with Blaze Catcher as immediate fallback if sniped.'
          : 'Drafting RB now balances your construction and preserves flexibility.',
        evidence: [
          'Context: Round 1, Pick 2 (overall 2).',
          'Need score (RB): 82/100.',
          'Market edge: +3.1 picks vs ADP.',
        ],
        caveats: ['Monitor teammate stack exposure.'],
        uncertainty: 'Uncertainty: Limited ADP coverage in this pool; confidence is reduced.',
        execution: { mode: includeAIExplanation ? 'ai_explained' : 'instant_automated' },
      }),
    })
  })

  await page.route('**/api/ai/draft/recommend**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: null,
        reason: 'E2E mocked AI recommend response',
      }),
    })
  })

  await page.route('**/api/music/artists**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artists: [],
      }),
    })
  })

  await page.route('**/api/draft/live-brain**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        insights: [],
      }),
    })
  })

  await page.route(`**/api/leagues/*/draft/controls**`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const raw = route.request().postData()
    let body: Record<string, unknown> = {}
    if (raw) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    controlsRequests.push(body)
    const action = String(body.action ?? '')
    if (action === 'start') {
      state.sessionStatus = 'in_progress'
      state.version += 1
    } else if (action === 'pause') {
      state.sessionStatus = 'paused'
      state.version += 1
    } else if (action === 'resume') {
      state.sessionStatus = 'in_progress'
      state.version += 1
    } else if (action === 'undo_pick') {
      if (state.picks.length > 1) state.picks.pop()
      state.version += 1
    } else if (action === 'skip_pick') {
      const current = buildSession().currentPick
      if (current) {
        state.picks.push({
          id: `pick-skip-${current.overall}`,
          overall: current.overall,
          round: current.round,
          slot: current.slot,
          rosterId: current.rosterId,
          displayName: current.displayName,
          playerName: '(Skipped)',
          position: 'SKIP',
          team: null,
          byeWeek: null,
          playerId: null,
          tradedPickMeta: null,
          source: 'commissioner',
          pickLabel: current.pickLabel,
          createdAt: new Date().toISOString(),
        })
      }
      state.version += 1
    } else if (action === 'force_autopick') {
      const current = buildSession().currentPick
      if (current) {
        const fallback =
          poolEntries.find((entry) => !state.picks.some((pick) => pick.playerName === entry.name)) ?? poolEntries[0]
        const playerName = fallback?.name ?? `Force Auto Pick ${current.overall}`
        const position = fallback?.position ?? 'WR'
        const team = fallback?.team ?? null
        state.picks.push({
          id: `pick-force-${current.overall}`,
          overall: current.overall,
          round: current.round,
          slot: current.slot,
          rosterId: current.rosterId,
          displayName: current.displayName,
          playerName,
          position,
          team,
          byeWeek: null,
          playerId: fallback?.playerId ?? null,
          tradedPickMeta: null,
          source: 'commissioner',
          pickLabel: current.pickLabel,
          createdAt: new Date().toISOString(),
        })
      }
      state.version += 1
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
        leagues: [
          { id: leagueId, name: 'E2E Draft Room' },
          { id: 'league-other', name: 'Other League' },
        ],
      }),
    })
  })

  await page.route('**/api/commissioner/broadcast', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  return {
    getPickRequests: () => pickRequests,
    getQueuePutRequests: () => queuePutRequests,
    getControlsRequests: () => controlsRequests,
    getSettingsPatchRequests: () => settingsPatchRequests,
    getResyncHits: () => resyncHits,
    getAiPickRequests: () => aiPickRequests,
    getTradeOfferRequests: () => tradeOfferRequests,
    getTradeReviewRequests: () => tradeReviewRequests,
    getTradeRespondRequests: () => tradeRespondRequests,
  }
}

/** Console / network hooks for debugging harness boot (chunk load, hydration, API mocks). */
export function attachDraftHarnessDiagnostics(page: Page) {
  const staticChunkFailures: string[] = []

  const recordStaticChunkFailure = (line: string) => {
    if (!staticChunkFailures.includes(line)) staticChunkFailures.push(line)
  }

  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[draft-harness e2e][browser]', msg.type(), msg.text())
  })
  page.on('pageerror', (err) => {
    // eslint-disable-next-line no-console
    console.log('[draft-harness e2e][pageerror]', err.message)
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    const failure = req.failure()?.errorText ?? 'unknown failure'
    if (url.includes('/_next/static/')) {
      recordStaticChunkFailure(`${url} :: ${failure}`)
    }
    // eslint-disable-next-line no-console
    console.log('[draft-harness e2e][requestfailed]', url, failure)
  })
  page.on('response', (res) => {
    const u = res.url()
    if (u.includes('/_next/static/')) {
      const status = res.status()
      if (status >= 400) {
        recordStaticChunkFailure(`${status} ${u}`)
      }
    }
    if (!u.includes('/api/')) return
    // eslint-disable-next-line no-console
    console.log('[draft-harness e2e][api]', res.status(), u)
  })

  return {
    /** Clear recorded failures — call after harness is confirmed visible to dismiss transient dev-server compilation aborts. */
    clearStaticChunkFailures() {
      staticChunkFailures.length = 0
    },
    assertNoStaticChunkFailures() {
      expect(
        staticChunkFailures,
        staticChunkFailures.length
          ? `Next.js static assets failed to load (hydration cannot proceed):\n${staticChunkFailures.join('\n')}`
          : '',
      ).toEqual([])
    },
  }
}

export type OpenDraftRoomHarnessOptions = {
  /** Room is already open; only wait for `draft-room-shell`. */
  roomAlreadyOpen?: boolean
  /** Same as `roomAlreadyOpen` — prefer in harness health / `?e2eRoom=1` flows. */
  e2eRoom?: boolean
}

export async function openDraftRoomHarness(page: Page, options?: OpenDraftRoomHarnessOptions) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const roomOpen = Boolean(options?.roomAlreadyOpen || options?.e2eRoom)
  const shell = page.getByTestId('draft-room-shell')
  const desktopLayout = page.getByTestId('draft-desktop-layout')
  const mobileLayout = page.getByTestId('draft-mobile-layout')
  const loadingCopy = page.getByText('Loading draft room…')
  const button = page.getByTestId('draft-enter-room-button')
  const startedAt = Date.now()
  const deadline = startedAt + 75_000

  const isReadySurfaceVisible = async () => {
    const shellVisible = await shell.isVisible().catch(() => false)
    if (shellVisible) return true
    const desktopVisible = await desktopLayout.isVisible().catch(() => false)
    if (desktopVisible) return true
    const mobileVisible = await mobileLayout.isVisible().catch(() => false)
    return mobileVisible
  }

  if (roomOpen && (await isReadySurfaceVisible())) {
    return
  }

  let reloadCount = 0
  while (Date.now() < deadline) {
    if (await isReadySurfaceVisible()) {
      return
    }

    const buttonVisible = await button.isVisible().catch(() => false)
    if (buttonVisible) {
      try {
        await button.click({ timeout: 2_000, force: true, noWaitAfter: true })
      } catch {
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="draft-enter-room-button"]') as HTMLButtonElement | null
          el?.click()
        })
      }
    }

    const elapsed = Date.now() - startedAt
    const showingLoadingCopy = await loadingCopy.isVisible().catch(() => false)
    const shouldReload =
      showingLoadingCopy &&
      ((reloadCount === 0 && elapsed > 20_000) || (reloadCount === 1 && elapsed > 45_000))
    if (shouldReload) {
      reloadCount += 1
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null)
    }

    await sleep(250)
  }

  const loadingVisible = await loadingCopy.isVisible().catch(() => false)
  const buttonVisible = await button.isVisible().catch(() => false)
  if (loadingVisible && !buttonVisible) {
    const currentUrl = page.url()
    await page.goto(currentUrl, { waitUntil: 'commit', timeout: 30_000 }).catch(() => null)
    await sleep(500)
    if (await isReadySurfaceVisible()) {
      return
    }
  }
  throw new Error(
    `Draft room did not become interactive within 45s (url=${page.url()}, loadingVisible=${String(loadingVisible)}, enterButtonVisible=${String(buttonVisible)})`,
  )
}

export async function gotoDraftRoomHarness(page: Page, url: string) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const navTimeout = attempt === 0 ? 45_000 : 30_000
      await page.goto(url, { waitUntil: 'commit', timeout: navTimeout })
      // Accept either harness root or loading copy; openDraftRoomHarness owns the final interactive gate.
      await expect
        .poll(
          async () => {
            const harnessVisible = await page.getByTestId('e2e-draft-room-harness').isVisible().catch(() => false)
            if (harnessVisible) return true
            const loadingVisible = await page.getByText('Loading draft room…').isVisible().catch(() => false)
            return loadingVisible
          },
          { timeout: 15_000 },
        )
        .toBe(true)
      return
    } catch (error) {
      lastError = error
      await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => null)
      await page.waitForTimeout(700 * (attempt + 1)).catch(() => null)
    }
  }

  throw lastError
}