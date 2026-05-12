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

  buildSession(sessionId = 'session-e2e-1', leagueId = 'e2e-league'): Record<string, unknown> {
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
      version: this._version,
      picks: this._picks,
      currentPick,
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

  async handleStateRoute(route: Route, sessionId?: string, leagueId?: string): Promise<void> {
    // Inject artificial delay (used to test connection-degraded banner)
    if (this._stateDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this._stateDelayMs))
    }
    // Inject transient failures (used to test reconnect recovery)
    if (this._stateFailsRemaining > 0) {
      this._stateFailsRemaining -= 1
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service Unavailable' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(this.buildSession(sessionId, leagueId)),
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
 * Routes registered (all wildcard-matched so they work regardless of exact path):
 *  - auth/session
 *  - auth/config-check
 *  - user/profile
 *  - subscription/entitlements
 *  - tokens/balance
 *  - league/settings
 *  - draft/{id}/state  (session polling — reads from sim)
 *  - draft/{id}/pick   (pick submission — records in sim)
 *  - draft/{id}/controls  (pause/resume — records in sim)
 *  - draft/{id}/bid    (auction bids — records in sim)
 *  - draft/{id}/autopick
 *  - draft/{id}/queue/{...}
 *  - draft/{id}/chat/{...}
 *  - draft/pusher-auth  (returns 403 so Pusher stays disabled — polling is the signal)
 *  - leagues/{id}/draft/{...}  (any other league-draft endpoints)
 *
 * @param page       Playwright page to install mocks on
 * @param leagueId   Used to scope league/settings and build session leagueId
 * @param sim        DraftSimulator instance (shared across pages for multi-user tests)
 * @param opts.sessionId  Override default 'session-e2e-1'
 * @param opts.currentUserId  Auth session userId (default 'e2e-user-1')
 * @param opts.isCommissioner  Auth session isCommissioner flag
 */
export async function installDraftMocks(
  page: Page,
  leagueId: string,
  sim: DraftSimulator,
  opts: {
    sessionId?: string
    currentUserId?: string
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
        user: { id: currentUserId, name: `User ${currentUserId}`, email: `${currentUserId}@e2e.test` },
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

  // ── League settings (provides slotOrder / team display names) ─────────────
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

  // ── Draft session state (main polling endpoint) ────────────────────────────
  // Match both common path patterns: /api/draft/[id]/state and /api/leagues/[id]/draft/session
  await page.route('**/api/draft/*/state**', async (route) => {
    await sim.handleStateRoute(route, sessionId, leagueId)
  })

  await page.route('**/api/leagues/*/draft/session**', async (route) => {
    await sim.handleStateRoute(route, sessionId, leagueId)
  })

  // Also catch the initial load endpoint (some routes use /state, others /session directly)
  await page.route('**/api/leagues/*/draft**', async (route) => {
    // Only handle GET requests for state; let POST fall through
    if (route.request().method() === 'GET') {
      await sim.handleStateRoute(route, sessionId, leagueId)
    } else {
      await route.fallback()
    }
  })

  // ── Pick submission ────────────────────────────────────────────────────────
  await page.route('**/api/draft/*/pick**', async (route) => {
    await sim.handlePickRoute(route, { forceConflict: forcePickConflict })
  })

  await page.route('**/api/draft/pick/**', async (route) => {
    await sim.handlePickRoute(route, { forceConflict: forcePickConflict })
  })

  // ── Commissioner controls (pause / resume / undo) ─────────────────────────
  await page.route('**/api/draft/*/controls**', async (route) => {
    await sim.handleControlRoute(route)
  })

  await page.route('**/api/leagues/*/draft/controls**', async (route) => {
    await sim.handleControlRoute(route)
  })

  await page.route('**/api/leagues/*/draft/actions**', async (route) => {
    await sim.handleControlRoute(route)
  })

  // ── Auction bids ──────────────────────────────────────────────────────────
  await page.route('**/api/draft/*/bid**', async (route) => {
    await sim.handleBidRoute(route, { forceConflict: forceBidConflict })
  })

  await page.route('**/api/draft/auction/**', async (route) => {
    await sim.handleBidRoute(route, { forceConflict: forceBidConflict })
  })

  // ── Auto-pick / queue ─────────────────────────────────────────────────────
  await page.route('**/api/draft/*/autopick**', async (route) => {
    if (route.request().method() === 'POST') {
      const raw = route.request().postData()
      sim.autopickRequests.push(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route('**/api/draft/queue**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queue: [
            { playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' },
            { playerName: 'Blaze Catcher', position: 'WR', team: 'DAL' },
          ],
        }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })

  await page.route('**/api/draft/*/queue**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ queue: [] }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })

  // ── Chat ──────────────────────────────────────────────────────────────────
  await page.route('**/api/draft/chat/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [{ id: 'm1', from: 'System', text: 'Draft started.', at: new Date().toISOString() }] }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })

  // ── Pusher auth — return 403 so Pusher stays disabled in tests ─────────────
  // The polling fallback (useLiveDraftSync) remains the sole sync mechanism,
  // which is exactly what we want: deterministic, controlled by simulator state.
  await page.route('**/api/draft/*/pusher-auth**', async (route) => {
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) })
  })

  // ── AI recommendations (not under test — return empty) ────────────────────
  await page.route('**/api/draft/ai/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picks: [], recommendations: [] }) })
  })

  await page.route('**/api/draft/recommend**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picks: [] }) })
  })

  // ── Misc league endpoints ─────────────────────────────────────────────────
  await page.route(`**/api/leagues/*/privacy**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inviteLink: null }) })
  })

  await page.route(`**/api/leagues/*/claim-roster**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alreadyClaimed: true, rosters: [] }) })
  })

  await page.route(`**/api/leagues/*/draft/round-one-highlight**`, async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })

  await page.route(`**/api/leagues/*/ai-opponents/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ opponents: [] }) })
  })
}

// ─── Navigation helper ────────────────────────────────────────────────────────

/**
 * Navigate to the E2E draft room harness and wait for the board to be visible.
 *
 * With `e2eRoom=1` the harness skips the "Enter draft room" gate button and
 * mounts DraftBoard immediately.
 */
export async function navigateToDraftRoom(
  page: Page,
  leagueId: string,
  opts: { sport?: string; commissioner?: boolean; viewport?: { width: number; height: number } } = {},
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

  await page.goto(`/e2e/draft-room?${params.toString()}`)

  // Wait for the board or the harness gate button (whichever appears first)
  await page
    .getByTestId('draft-board')
    .or(page.getByRole('button', { name: /enter draft room/i }))
    .waitFor({ state: 'visible', timeout: 30_000 })

  // If the gate button appeared, click through it
  const gateBtn = page.getByRole('button', { name: /enter draft room/i })
  if (await gateBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await gateBtn.click()
  }
}
