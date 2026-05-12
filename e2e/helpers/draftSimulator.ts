/**
 * DraftSimulator — shared test helper for multi-user draft E2E scenarios.
 *
 * Provides a mutable, server-side-like draft state that Playwright route
 * handlers close over. All pages that install the same simulator instance
 * see consistent, evolving session snapshots — simulating the DB that would
 * back a real live draft.
 *
 * Usage:
 *   const sim = new DraftSimulator({ teamCount: 12, rounds: 3 })
 *   await installDraftMocks(page, leagueId, sim)
 *   // navigate, interact, then:
 *   sim.makePick(1, { playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' })
 *   // next poll returns updated session
 */

import type { Page, Route } from '@playwright/test'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlotOrderEntry {
  slot: number
  rosterId: string
  displayName: string
}

export interface PickRecord {
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
  tradedPickMeta: null
  source: string
  pickLabel: string
  pickEditorEmpty: boolean
  createdAt: string
  amount?: number | null
}

export interface DraftSimulatorOptions {
  teamCount: number
  rounds: number
  draftType?: 'snake' | 'linear' | 'auction'
  thirdRoundReversal?: boolean
  timerSeconds?: number
  /** When true the route handlers add an artificial delay to state responses (ms). */
  stateResponseDelayMs?: number
  /** If set, state responses return this status code for the first N requests. */
  initialFailCount?: number
}

export type SessionStatus = 'pre_draft' | 'in_progress' | 'paused' | 'completed'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute which slot owns overall pick `n` in a snake draft. */
function snakeSlot(overall: number, teamCount: number, thirdRoundReversal: boolean): number {
  const round = Math.ceil(overall / teamCount)
  const posInRound = ((overall - 1) % teamCount) + 1

  let reversed: boolean
  if (!thirdRoundReversal) {
    reversed = round % 2 === 0
  } else {
    reversed = round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
  }

  return reversed ? teamCount - posInRound + 1 : posInRound
}

function linearSlot(overall: number, teamCount: number): number {
  return ((overall - 1) % teamCount) + 1
}

function pickLabelForOverall(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

// ─── DraftSimulator ───────────────────────────────────────────────────────────

export class DraftSimulator {
  readonly teamCount: number
  readonly rounds: number
  readonly draftType: 'snake' | 'linear' | 'auction'
  readonly thirdRoundReversal: boolean
  readonly timerSeconds: number

  private _status: SessionStatus = 'in_progress'
  private _version = 1
  private _picks: PickRecord[] = []
  private _slotOrder: SlotOrderEntry[]
  private _stateDelayMs: number
  private _stateFailsRemaining: number

  // Recorded outbound requests for assertion in tests
  readonly pickRequests: Array<Record<string, unknown>> = []
  readonly controlRequests: Array<Record<string, unknown>> = []
  readonly bidRequests: Array<Record<string, unknown>> = []
  readonly autopickRequests: Array<Record<string, unknown>> = []

  constructor(opts: DraftSimulatorOptions) {
    this.teamCount = opts.teamCount
    this.rounds = opts.rounds
    this.draftType = opts.draftType ?? 'snake'
    this.thirdRoundReversal = opts.thirdRoundReversal ?? false
    this.timerSeconds = opts.timerSeconds ?? 90
    this._stateDelayMs = opts.stateResponseDelayMs ?? 0
    this._stateFailsRemaining = opts.initialFailCount ?? 0

    // Generate generic slot order: slots 1..N with manager names A-L etc.
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot',
                   'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
                   'Mike', 'November', 'Oscar', 'Papa']
    this._slotOrder = Array.from({ length: opts.teamCount }, (_, i) => ({
      slot: i + 1,
      rosterId: `roster-${i + 1}`,
      displayName: names[i] ?? `Team ${i + 1}`,
    }))
  }

  // ── State mutators ─────────────────────────────────────────────────────────

  makePick(
    overall: number,
    info: { playerName: string; position: string; team?: string | null; playerId?: string | null; amount?: number },
  ): PickRecord {
    const round = Math.ceil(overall / this.teamCount)
    const slot = this.draftType === 'auction'
      ? 1 // auction picks track by overall, slot less meaningful
      : this.draftType === 'linear'
        ? linearSlot(overall, this.teamCount)
        : snakeSlot(overall, this.teamCount, this.thirdRoundReversal)
    const slotEntry = this._slotOrder.find((s) => s.slot === slot) ?? this._slotOrder[0]!

    const pick: PickRecord = {
      id: `pick-${overall}`,
      overall,
      round,
      slot,
      rosterId: slotEntry.rosterId,
      displayName: slotEntry.displayName,
      playerName: info.playerName,
      position: info.position,
      team: info.team ?? null,
      byeWeek: null,
      playerId: info.playerId ?? `player-${overall}`,
      tradedPickMeta: null,
      source: 'user',
      pickLabel: pickLabelForOverall(overall, this.teamCount),
      pickEditorEmpty: false,
      createdAt: new Date().toISOString(),
      amount: info.amount ?? null,
    }
    this._picks.push(pick)
    this._version += 1
    return pick
  }

  undoPick(): PickRecord | undefined {
    const removed = this._picks.pop()
    if (removed) this._version += 1
    return removed
  }

  pause(): void {
    this._status = 'paused'
    this._version += 1
  }

  resume(): void {
    this._status = 'in_progress'
    this._version += 1
  }

  complete(): void {
    this._status = 'completed'
    this._version += 1
  }

  setStatus(s: SessionStatus): void {
    this._status = s
    this._version += 1
  }

  /** Simulate N state-poll failures before restoring normal responses. */
  injectStateFails(count: number): void {
    this._stateFailsRemaining = count
  }

  /** Set artificial delay on state responses (e.g. to test connection-degraded). */
  setStateDelay(ms: number): void {
    this._stateDelayMs = ms
  }

  // ── Session snapshot builder ───────────────────────────────────────────────

  buildSession(
    sessionId = 'session-e2e-1',
    leagueId = 'e2e-league',
    currentUserRosterId = 'roster-1',
  ): Record<string, unknown> {
    const nextOverall = this._picks.length + 1
    const totalPicks = this.teamCount * this.rounds
    const isDone = this._status === 'completed' || nextOverall > totalPicks

    const currentSlot = isDone
      ? null
      : this.draftType === 'linear'
        ? linearSlot(nextOverall, this.teamCount)
        : snakeSlot(nextOverall, this.teamCount, this.thirdRoundReversal)

    const currentSlotEntry = currentSlot ? this._slotOrder.find((s) => s.slot === currentSlot) ?? null : null

    const currentPick = isDone
      ? null
      : {
          overall: nextOverall,
          round: Math.ceil(nextOverall / this.teamCount),
          slot: currentSlot,
          rosterId: currentSlotEntry?.rosterId ?? null,
          displayName: currentSlotEntry?.displayName ?? null,
          pickLabel: pickLabelForOverall(nextOverall, this.teamCount),
        }

    const timerStatus =
      this._status === 'paused' ? 'paused'
        : this._status === 'in_progress' ? 'running'
        : 'none'

    return {
      id: sessionId,
      leagueId,
      status: this._status,
      draftType: this.draftType,
      rounds: this.rounds,
      teamCount: this.teamCount,
      thirdRoundReversal: this.thirdRoundReversal,
      timerSeconds: this.timerSeconds,
      timerEndAt: timerStatus === 'running'
        ? new Date(Date.now() + this.timerSeconds * 1000).toISOString()
        : null,
      pausedRemainingSeconds: this._status === 'paused' ? 45 : null,
      slotOrder: this._slotOrder,
      tradedPicks: [],
      proposals: [],
      version: this._version,
      picks: this._picks,
      currentPick,
      currentUserRosterId,
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
      timer: {
        status: timerStatus,
        remainingSeconds: this._status === 'paused' ? 45 : this.timerSeconds,
        timerEndAt: timerStatus === 'running'
          ? new Date(Date.now() + this.timerSeconds * 1000).toISOString()
          : null,
        pauseReason: null,
      },
      updatedAt: new Date().toISOString(),
    }
  }

  // ── Route handler helpers ─────────────────────────────────────────────────

  /**
   * Handle GET /api/leagues/{id}/draft/session.
   * Returns { leagueId, session: ... } — the shape fetchSession() in
   * DraftRoomPageClient expects (checks data.session).
   */
  async handleStateRoute(
    route: Route,
    sessionId?: string,
    leagueId?: string,
    currentUserRosterId?: string,
  ): Promise<void> {
    // Inject artificial delay (used to test connection-degraded banner)
    if (this._stateDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this._stateDelayMs))
    }
    // Inject transient failures (used to test reconnect recovery)
    if (this._stateFailsRemaining > 0) {
      this._stateFailsRemaining -= 1
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      })
      return
    }
    const lg = leagueId ?? 'e2e-league'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId: lg,
        session: this.buildSession(sessionId, lg, currentUserRosterId),
      }),
    })
  }

  /**
   * Handle GET /api/leagues/{id}/draft/live-sync.
   * Returns { leagueId, updated, updatedAt, session, queue, messages } —
   * the shape fetchLiveSync() in useLiveDraftSync expects (checks data.session).
   */
  async handleLiveSyncRoute(
    route: Route,
    sessionId?: string,
    leagueId?: string,
    currentUserRosterId?: string,
  ): Promise<void> {
    if (this._stateFailsRemaining > 0) {
      this._stateFailsRemaining -= 1
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      })
      return
    }
    const lg = leagueId ?? 'e2e-league'
    const session = this.buildSession(sessionId, lg, currentUserRosterId)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId: lg,
        updated: true,
        updatedAt: session.updatedAt,
        session,
        queue: [],
        messages: [],
        syncActive: false,
      }),
    })
  }

  async handlePickRoute(route: Route, opts?: { forceConflict?: boolean }): Promise<void> {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    const raw = route.request().postData()
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    this.pickRequests.push(body)

    if (opts?.forceConflict) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'CONFLICT', message: 'Another pick was already submitted for this slot.' }),
      })
      return
    }

    // Record the pick in simulator state so subsequent state polls reflect it
    const overall = typeof body.overall === 'number' ? body.overall : (this._picks.length + 1)
    this.makePick(overall, {
      playerName: (body.playerName as string) ?? 'Unknown Player',
      position: (body.position as string) ?? 'WR',
      team: (body.team as string | null) ?? null,
      playerId: (body.playerId as string | null) ?? null,
    })

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, pick: this._picks[this._picks.length - 1] }),
    })
  }

  async handleControlRoute(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    const raw = route.request().postData()
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    this.controlRequests.push(body)

    const action = body.action as string | undefined
    if (action === 'pause') this.pause()
    if (action === 'resume') this.resume()

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  }

  async handleBidRoute(route: Route, opts?: { forceConflict?: boolean }): Promise<void> {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    const raw = route.request().postData()
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    this.bidRequests.push(body)

    if (opts?.forceConflict) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'BID_CONFLICT', message: 'A higher bid was already placed.' }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, currentBid: body.amount }),
    })
  }

  get picks(): readonly PickRecord[] { return this._picks }
  get status(): SessionStatus { return this._status }
  get version(): number { return this._version }
  get slotOrder(): readonly SlotOrderEntry[] { return this._slotOrder }
}

// ─── installDraftMocks ────────────────────────────────────────────────────────

/**
 * Register all the API route mocks needed by DraftRoomPageClient on `page`.
 *
 * Routes registered (wildcard-matched):
 *  - auth/session, auth/config-check
 *  - user/profile, subscription/entitlements, tokens/balance
 *  - league/settings
 *  - leagues/{id}/draft/session   (GET state + POST start — reads from sim)
 *  - leagues/{id}/draft/live-sync (8-second poll — reads from sim)
 *  - leagues/{id}/draft/events    (event feed)
 *  - leagues/{id}/draft/pick      (pick submission — records in sim)
 *  - leagues/{id}/draft/controls  (pause/resume — records in sim)
 *  - leagues/{id}/draft/auction/bid (auction bids — records in sim)
 *  - leagues/{id}/draft/autopick  (auto-pick)
 *  - leagues/{id}/draft/queue     (user queue GET/PUT)
 *  - leagues/{id}/draft/settings  (UI settings)
 *  - leagues/{id}/draft/pool      (player pool)
 *  - leagues/{id}/draft/assistant-context
 *  - leagues/{id}/roster-config
 *  - league/ai-opponents/summary
 *  - draft/intel/stream (SSE — returns empty stream)
 *  - draft/pusher-auth  (returns 403 so Pusher stays disabled — polling is the signal)
 *  - leagues/{id}/privacy, leagues/{id}/claim-roster
 *  - leagues/{id}/draft/round-one-highlight
 *  - leagues/{id}/ai-opponents
 *
 * @param page                Playwright page to install mocks on
 * @param leagueId            Used to scope league/settings and build session leagueId
 * @param sim                 DraftSimulator instance (shared across pages for multi-user tests)
 * @param opts.sessionId      Override default 'session-e2e-1'
 * @param opts.currentUserId  Auth session userId (default 'e2e-user-1')
 * @param opts.currentUserRosterId  The rosterId owned by this page's user (default 'roster-1')
 * @param opts.isCommissioner Auth session isCommissioner flag
 * @param opts.forcePickConflict  When true, pick submissions return 409
 * @param opts.forceBidConflict   When true, bid submissions return 409
 */
export async function installDraftMocks(
  page: Page,
  leagueId: string,
  sim: DraftSimulator,
  opts: {
    sessionId?: string
    currentUserId?: string
    currentUserRosterId?: string
    isCommissioner?: boolean
    /** When true the pick route will return 409 (simulate collision for this page's picks). */
    forcePickConflict?: boolean
    /** When true the bid route will return 409 (simulate auction collision for this page). */
    forceBidConflict?: boolean
  } = {},
): Promise<void> {
  const {
    sessionId = 'session-e2e-1',
    currentUserId = 'e2e-user-1',
    currentUserRosterId = 'roster-1',
    isCommissioner = true,
    forcePickConflict = false,
    forceBidConflict = false,
  } = opts

  // ── Noise suppression ────────────────────────────────────────────────────
  const EXTERNAL_NOISE = [
    'https://www.google-analytics.com/**',
    'https://connect.facebook.net/**',
    'https://*.doubleclick.net/**',
    'https://*.googletagmanager.com/**',
  ]
  for (const pattern of EXTERNAL_NOISE) {
    await page.route(pattern, (r) => r.abort('blockedbyclient').catch(() => null))
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: currentUserId,
          name: `User ${currentUserId}`,
          email: `${currentUserId}@e2e.test`,
        },
      }),
    })
  })

  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // ── User profile / entitlements ───────────────────────────────────────────
  await page.route('**/api/user/profile**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: currentUserId }) })
  })

  await page.route('**/api/subscription/entitlements**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  await page.route('**/api/tokens/balance**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balance: 0, updatedAt: new Date().toISOString() }),
    })
  })

  // ── League settings ────────────────────────────────────────────────────────
  await page.route('**/api/league/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        league: {
          teams: sim.slotOrder.map((s) => ({
            id: s.rosterId,
            rosterId: s.rosterId,
            teamName: s.displayName,
            ownerName: s.displayName,
            displayName: s.displayName,
          })),
        },
        isCommissioner,
        settings: {
          draftOrderRandomizationEnabled: false,
          pickTradeEnabled: false,
          tradedPickColorModeEnabled: false,
          tradedPickOwnerNameRedEnabled: false,
          aiAdpEnabled: false,
          aiQueueReorderEnabled: false,
          orphanTeamAiManagerEnabled: false,
          orphanDrafterMode: 'cpu',
          liveDraftChatSyncEnabled: false,
          autoPickEnabled: true,
          timerMode: 'per_pick',
          slowDraftPauseWindow: null,
          commissionerForceAutoPickEnabled: true,
          commissionerPauseControlsEnabled: true,
        },
      }),
    })
  })

  // ── Draft session state — GET returns session; POST handles 'start' action ─
  await page.route(`**/api/leagues/*/draft/session**`, async (route) => {
    if (route.request().method() === 'GET') {
      await sim.handleStateRoute(route, sessionId, leagueId, currentUserRosterId)
      return
    }
    if (route.request().method() === 'POST') {
      // Start / resync actions
      const raw = route.request().postData()
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      if (body.action === 'start') {
        sim.setStatus('in_progress')
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          session: sim.buildSession(sessionId, leagueId, currentUserRosterId),
        }),
      })
      return
    }
    await route.fallback()
  })

  // ── Live-sync poll — the 8-second heartbeat ───────────────────────────────
  await page.route(`**/api/leagues/*/draft/live-sync**`, async (route) => {
    await sim.handleLiveSyncRoute(route, sessionId, leagueId, currentUserRosterId)
  })

  // ── Draft events feed ─────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/events**`, async (route) => {
    const session = sim.buildSession(sessionId, leagueId, currentUserRosterId)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagueId,
        updated: true,
        updatedAt: session.updatedAt,
        session,
      }),
    })
  })

  // ── Draft UI settings ──────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/settings**`, async (route) => {
    const method = route.request().method()
    const settingsPayload = {
      config: { queue_size_limit: 50, autopick_behavior: 'skip' },
      draftUISettings: {
        draftOrderRandomizationEnabled: false,
        pickTradeEnabled: false,
        tradedPickColorModeEnabled: false,
        tradedPickOwnerNameRedEnabled: false,
        aiAdpEnabled: false,
        aiQueueReorderEnabled: false,
        orphanTeamAiManagerEnabled: false,
        orphanDrafterMode: 'cpu',
        liveDraftChatSyncEnabled: false,
        autoPickEnabled: true,
        timerMode: 'per_pick',
        slowDraftPauseWindow: null,
        commissionerForceAutoPickEnabled: true,
        commissionerPauseControlsEnabled: true,
      },
      idpRosterSummary: null,
      orphanStatus: { orphanRosterIds: [], recentActions: [] },
    }
    if (method === 'GET' || method === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsPayload),
      })
      return
    }
    await route.fallback()
  })

  // ── Player pool ────────────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/pool**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          { playerId: 'p-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
          { playerId: 'p-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
          { playerId: 'p-3', name: 'Core Signal', position: 'QB', team: 'KC', adp: 21.2 },
          { playerId: 'p-4', name: 'Delta Edge', position: 'TE', team: 'SEA', adp: 25.3 },
          { playerId: 'p-5', name: 'Echo Guard', position: 'RB', team: 'MIA', adp: 31.8 },
        ],
        sport: 'NFL',
        count: 5,
      }),
    })
  })

  // ── Pick submission ─ real path: /api/leagues/{id}/draft/pick ─────────────
  await page.route(`**/api/leagues/*/draft/pick**`, async (route) => {
    await sim.handlePickRoute(route, { forceConflict: forcePickConflict })
  })

  // ── AI pick (commissioner force-pick) ─────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/ai-pick**`, async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    await sim.handlePickRoute(route)
  })

  // ── Commissioner controls (pause / resume / undo) ─────────────────────────
  await page.route(`**/api/leagues/*/draft/controls**`, async (route) => {
    await sim.handleControlRoute(route)
  })

  await page.route(`**/api/leagues/*/draft/actions**`, async (route) => {
    await sim.handleControlRoute(route)
  })

  // ── Auction bids ──────────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/auction/**`, async (route) => {
    await sim.handleBidRoute(route, { forceConflict: forceBidConflict })
  })

  // ── Auto-pick ─────────────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/autopick**`, async (route) => {
    if (route.request().method() === 'POST') {
      const raw = route.request().postData()
      sim.autopickRequests.push(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // ── User draft queue ───────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/queue**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          queue: [
            { playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' },
            { playerName: 'Blaze Catcher', position: 'WR', team: 'DAL' },
          ],
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // ── Draft chat — GET (bootstrap fetchChat) and POST (send) ───────────────
  // Must be mocked or the bootstrap hangs waiting for a DB-backed route.
  await page.route(`**/api/leagues/*/draft/chat**`, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [], leagueId, updatedAt: new Date().toISOString() }),
      })
      return
    }
    // POST (send message)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // ── AI queue reorder ───────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/draft/queue/ai-reorder**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reordered: [
          { playerName: 'Blaze Catcher', position: 'WR', team: 'DAL' },
          { playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' },
        ],
        explanation: 'Balanced by roster need and ADP value.',
      }),
    })
  })

  // ── AI draft assistant context ────────────────────────────────────────────
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

  // ── Roster config ─────────────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/roster-config**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
        benchSlots: 6,
        taxiSlots: 0,
        devySlots: 0,
        orderedSlotLabels: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST',
                            'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      }),
    })
  })

  // ── AI opponents summary ───────────────────────────────────────────────────
  await page.route(`**/api/league/ai-opponents/summary**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aiManagedDraftRosterIds: [], assignments: [] }),
    })
  })

  // ── Draft intel SSE stream ─────────────────────────────────────────────────
  await page.route(`**/api/draft/intel/stream**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 60000\nevent: ping\ndata: {}\n\n',
    })
  })

  // ── Pusher auth — return 403 so Pusher stays disabled in tests ─────────────
  // The polling fallback (useLiveDraftSync) remains the sole sync mechanism,
  // which is exactly what we want: deterministic, controlled by simulator state.
  await page.route('**/api/*/pusher-auth**', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Forbidden' }),
    })
  })

  // ── AI recommendations ────────────────────────────────────────────────────
  await page.route('**/api/draft/ai/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ picks: [], recommendations: [] }),
    })
  })

  // ── Misc league endpoints ─────────────────────────────────────────────────
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

  await page.route(`**/api/leagues/*/ai-opponents/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ opponents: [] }),
    })
  })
}

// ─── Navigation helper ────────────────────────────────────────────────────────

/**
 * Navigate to the E2E draft room harness and wait for the board to be visible.
 *
 * Mirrors the retry + server-readiness pattern used by gotoDraftRoomHarness in
 * draft-room-click-audit.spec.ts:
 *  1. Poll GET / until the Next.js server responds (handles cold starts).
 *  2. Navigate up to 3 times with backoff; use waitUntil:'domcontentloaded' so
 *     we don't block on every client-side fetch completing before checking the DOM.
 *  3. Wait for data-testid="e2e-draft-room-harness" to appear.
 *
 * With `e2eRoom=1` the harness skips the "Enter draft room" gate button and
 * mounts DraftBoard immediately.
 */
export async function navigateToDraftRoom(
  page: Page,
  leagueId: string,
  opts: {
    sport?: string
    commissioner?: boolean
    viewport?: { width: number; height: number }
  } = {},
): Promise<void> {
  if (opts.viewport) {
    await page.setViewportSize(opts.viewport)
  }

  const params = new URLSearchParams({
    leagueId,
    e2eRoom: '1',
    sport: opts.sport ?? 'NFL',
    commissioner: opts.commissioner !== false ? 'true' : 'false',
  })

  const url = `/e2e/draft-room?${params.toString()}`

  // Playwright's webServer config (reuseExistingServer + timeout:120s) guarantees
  // the server is up before any test runs, so no extra readiness poll is needed here.

  // ── Navigate with retry ───────────────────────────────────────────────────
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const navTimeout = attempt === 0 ? 90_000 : 60_000
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })

      // Phase 1: wait for ANY loading indicator — covers three possible states:
      //   (a) Outer RSC Suspense in page.tsx:              "Loading draft harness…"
      //   (b) E2eDraftRoomHarnessClient Suspense fallback:  data-testid="e2e-draft-room-harness"
      //   (c) DraftRoomPageClient bootstrap loading text:   "Loading draft room…"
      // Use .first() to avoid strict-mode violation when multiple are visible at once.
      await page
        .getByTestId('e2e-draft-room-harness')
        .or(page.getByText('Loading draft room…'))
        .or(page.getByText('Loading draft harness…'))
        .first()
        .waitFor({ state: 'visible', timeout: 25_000 })

      // Phase 1b: guarantee RSC streaming is done.
      // "Loading draft harness…" is the outer RSC Suspense fallback — it stays visible
      // until the server finishes streaming E2eDraftRoomHarnessClient. The harness
      // testid only appears AFTER that boundary resolves, so waiting for it here
      // ensures client hydration can begin before we proceed to Phase 2.
      // Under heavy parallel load the RSC stream can take up to 45 s — do NOT swallow
      // (throw to trigger the outer retry on timeout).
      await page
        .getByTestId('e2e-draft-room-harness')
        .waitFor({ state: 'visible', timeout: 45_000 })

      // Phase 2: wait for DraftRoomPageClient bootstrap to complete.
      // bootstrapDraftRoom() shows draft-room-loading-state while loading, then removes it.
      // If the session loads fast (before DraftRoomPageClient even mounts) the element may
      // never appear; waitFor({ state: 'detached' }) resolves immediately when the element
      // is not in the DOM, which is the correct fast-path behavior.
      await page
        .getByTestId('draft-room-loading-state')
        .waitFor({ state: 'detached', timeout: 45_000 })
        .catch(() => null)

      return
    } catch (err) {
      lastErr = err
      await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => null)
      await page.waitForTimeout(700 * (attempt + 1)).catch(() => null)
    }
  }

  throw lastErr
}
