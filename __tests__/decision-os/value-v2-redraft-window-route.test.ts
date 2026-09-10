import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The redraft trade-value-preview route as the FIRST production consumer of the window.
 *
 * 🛑 THE ORDERING CLAIM IS THE SECURITY CLAIM, AND IT IS THE ONE THIS FILE EXISTS TO PROVE.
 * Session, membership, league/season roster scoping and proposer ownership all gate the window
 * read. A window resolved before those gates would read one team's competitive evidence for a
 * caller about to receive a 403 — and it would be INVISIBLE, because the response body is
 * identical either way. So every denial below asserts that the adapter was never called, rather
 * than only asserting the status code.
 *
 * ⚠ AND THE FLAG CLAIM IS A COST CLAIM. Flag off must add no reads at all; a flag that still
 * pays for the work it disables is not a flag. Asserted the same way — by call count.
 */

const adapter = vi.hoisted(() => ({ resolveRedraftTeamWindow: vi.fn() }))
const flag = vi.hoisted(() => ({ valueV2ShadowEnabled: vi.fn(() => false) }))
const compute = vi.hoisted(() => ({ computeRedraftTradeValueSnapshot: vi.fn() }))
const gate = vi.hoisted(() => ({ assertLeagueMember: vi.fn() }))
const session = vi.hoisted(() => ({ getServerSession: vi.fn() }))
const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
}))

vi.mock('next-auth', () => ({ getServerSession: session.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: gate.assertLeagueMember }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({
  computeRedraftTradeValueSnapshot: compute.computeRedraftTradeValueSnapshot,
}))
vi.mock('@/lib/decision-os/value-v2/shadow', () => ({ valueV2ShadowEnabled: flag.valueV2ShadowEnabled }))
vi.mock('@/lib/decision-os/value-v2/redraftWindowServerAdapter', () => ({
  resolveRedraftTeamWindow: adapter.resolveRedraftTeamWindow,
}))

import { POST } from '@/app/api/redraft/trade-value-preview/route'

const USER = 'user-1'
const BODY = {
  leagueId: 'af-league-uuid',
  seasonId: 'season-cuid',
  proposerRosterId: 'proposer-cuid',
  receiverRosterId: 'receiver-cuid',
  assets: [{ fromRosterId: 'proposer-cuid', toRosterId: 'receiver-cuid', assetType: 'player', playerId: 'p1' }],
}

function request(body: unknown = BODY) {
  return { json: async () => body, headers: new Headers() } as never
}

/** The happy path, from which each test subtracts exactly one thing. */
function allowEverything() {
  session.getServerSession.mockResolvedValue({ user: { id: USER } })
  gate.assertLeagueMember.mockResolvedValue({ ok: true })
  db.redraftSeason.findFirst.mockResolvedValue({ sport: 'NFL', season: 2026, currentWeek: 6 })
  db.redraftRoster.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
    args.where.id === 'proposer-cuid'
      ? { id: 'proposer-cuid', ownerId: USER }
      : { id: 'receiver-cuid', ownerId: 'someone-else' },
  )
  db.redraftMatchup.findMany.mockResolvedValue([{ week: 1 }, { week: 2 }, { week: 3 }, { week: 4 }, { week: 5 }, { week: 6 }])
  compute.computeRedraftTradeValueSnapshot.mockResolvedValue({ version: 3, sides: [], grade: {} })
  adapter.resolveRedraftTeamWindow.mockResolvedValue({ state: 'evidenced', status: 'contender' })
  flag.valueV2ShadowEnabled.mockReturnValue(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  allowEverything()
})

describe('the window read is gated behind every authorization check', () => {
  it('401 with no session, and resolves no window', async () => {
    session.getServerSession.mockResolvedValue(null)
    const res = await POST(request())
    expect(res.status).toBe(401)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
  })

  it('403 for a non-member, and resolves no window', async () => {
    gate.assertLeagueMember.mockResolvedValue({ ok: false, status: 403 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
  })

  it('404 when a roster is not in this league and season, and resolves no window', async () => {
    db.redraftRoster.findFirst.mockResolvedValue(null)
    const res = await POST(request())
    expect(res.status).toBe(404)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
  })

  /*
   * 🛑 THE ONE THE HEADER CALLS OUT. A league member pricing somebody ELSE'S roster is refused —
   * and must be refused BEFORE the window read, or the refusal still leaked that team's
   * competitive evidence into a resolver on their behalf.
   */
  it('403 when the caller does not own the proposer roster, and resolves no window', async () => {
    db.redraftRoster.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'proposer-cuid'
        ? { id: 'proposer-cuid', ownerId: 'a-different-user' }
        : { id: 'receiver-cuid', ownerId: 'someone-else' },
    )
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
    expect(compute.computeRedraftTradeValueSnapshot).not.toHaveBeenCalled()
  })

  it('400 on a malformed body, and resolves no window', async () => {
    const res = await POST(request({ leagueId: 'l1' }))
    expect(res.status).toBe(400)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
  })
})

describe('the shadow flag decides whether any window work happens', () => {
  it('flag OFF: no window read, no schedule read, and a null window reaches the valuation', async () => {
    flag.valueV2ShadowEnabled.mockReturnValue(false)
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(adapter.resolveRedraftTeamWindow).not.toHaveBeenCalled()
    // The schedule query is part of the window work and must not run either.
    expect(db.redraftMatchup.findMany).not.toHaveBeenCalled()
    expect(compute.computeRedraftTradeValueSnapshot.mock.calls[0][0].teamWindowV2).toBeNull()
  })

  it('flag ON: the window is resolved once and threaded into the valuation', async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(adapter.resolveRedraftTeamWindow).toHaveBeenCalledTimes(1)
    expect(compute.computeRedraftTradeValueSnapshot.mock.calls[0][0].teamWindowV2)
      .toEqual({ state: 'evidenced', status: 'contender' })
  })
})

describe('the identity handed to the adapter is the authenticated proposer', () => {
  it('passes the caller, the proposer roster, and the league/season/period from the season row', async () => {
    await POST(request())
    const arg = adapter.resolveRedraftTeamWindow.mock.calls[0][0]
    expect(arg.userId).toBe(USER)
    expect(arg.proposerRosterId).toBe('proposer-cuid')
    expect(arg.leagueId).toBe('af-league-uuid')
    expect(arg.sport).toBe('NFL')
    expect(arg.season).toBe(2026)
    expect(arg.week).toBe(6)
  })

  /*
   * ⚠ NEVER THE RECEIVER, AND NEVER AN ASSET'S `fromRosterId`. Both are attacker-controlled in
   * the request body; only the proposer roster has been proved to belong to the caller.
   */
  it('never passes the receiver roster as the requesting team', async () => {
    await POST(request({
      ...BODY,
      assets: [{ fromRosterId: 'receiver-cuid', toRosterId: 'proposer-cuid', assetType: 'player', playerId: 'p1' }],
    }))
    const arg = adapter.resolveRedraftTeamWindow.mock.calls[0][0]
    expect(arg.proposerRosterId).toBe('proposer-cuid')
    expect(JSON.stringify(arg)).not.toContain('receiver-cuid')
  })

  it('passes the real scheduled periods, not 1..currentWeek', async () => {
    db.redraftMatchup.findMany.mockResolvedValue([{ week: 1 }, { week: 2 }, { week: 5 }, { week: 6 }])
    await POST(request())
    // The gap at 3-4 survives: a schedule with a hole is not the same as a contiguous one.
    expect(adapter.resolveRedraftTeamWindow.mock.calls[0][0].scheduledPeriods).toEqual([1, 2, 5, 6])
  })
})

describe('a refused window does not fail the request', () => {
  it('still returns 200 and prices the trade when the window refuses', async () => {
    adapter.resolveRedraftTeamWindow.mockResolvedValue({ state: 'refused', status: null, gaps: ['window_team_not_claimed'] })
    const res = await POST(request())
    expect(res.status).toBe(200)
    const passed = compute.computeRedraftTradeValueSnapshot.mock.calls[0][0].teamWindowV2
    expect(passed.state).toBe('refused')
    expect(passed.gaps).toContain('window_team_not_claimed')
  })

  it('a valuation failure is still a 500 and not a zeroed snapshot', async () => {
    compute.computeRedraftTradeValueSnapshot.mockRejectedValue(new Error('boom'))
    const res = await POST(request())
    expect(res.status).toBe(500)
  })
})
