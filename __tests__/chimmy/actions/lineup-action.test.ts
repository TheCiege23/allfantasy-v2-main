import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Set my lineup" for a native league.
 *
 * 🛑 THE RULE THIS FILE EXISTS FOR: PROPOSING NEVER WRITES. `proposeLineupChange` is reachable from
 * the model's tool loop; the only thing it may produce is a card. The lineup engine's persist is a
 * spy here, and the propose tests assert it was never called — on success as much as on refusal.
 */

const h = vi.hoisted(() => ({
  membership: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  gamesFindMany: vi.fn(async () => []),
  gamesCount: vi.fn(async () => 5),
  resolveNames: vi.fn(async () => new Map()),
  template: vi.fn(),
  lock: vi.fn(),
  persist: vi.fn(async () => ({ ok: true })),
  chopped: vi.fn(async () => false),
  anyWrite: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    roster: { findFirst: h.rosterFindFirst, update: h.anyWrite, updateMany: h.anyWrite },
    sportsGame: { findMany: h.gamesFindMany, count: h.gamesCount },
    $transaction: h.anyWrite,
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: h.resolveNames }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: h.template }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: h.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: h.persist }))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: h.chopped }))
vi.mock('@/lib/sports-evidence/lineupIntegration', () => ({
  CertifiedLineupIntegrationService: class {
    evaluateLineupPersistSafety = vi.fn(async () => ({ block: false, reason: 'ok' }))
  },
  extractPlayerRefs: () => [],
}))
vi.mock('@/lib/sports/teamRef', () => ({ sameNflTeam: (a: string, b: string) => a === b }))
vi.mock('@/lib/trade-engine/caching', () => ({ handleInvalidationTrigger: vi.fn() }))
vi.mock('@/lib/league-notifications/realtimeHint', () => ({ publishLeagueRealtimeHint: vi.fn() }))

import { executeLineupAction, proposeLineupChange } from '@/lib/chimmy/actions/lineupAction'
import { verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'

const NOW = new Date('2026-09-25T15:00:00Z') // a Friday

const row = (id: string, name: string, position: string, extra: Record<string, unknown> = {}) => ({ id, name, position, team: 'NE', ...extra })

function playerData() {
  return {
    players: ['qb', 'rb1', 'rb2', 'wr1', 'rb3', 'wr2'],
    starters: ['qb', 'rb1', 'rb2', 'wr1'],
    lineup_sections: {
      starters: [row('qb', 'Drake Maye', 'QB'), row('rb1', 'Bijan Robinson', 'RB'), row('rb2', 'Tony Pollard', 'RB'), row('wr1', 'Puka Nacua', 'WR')],
      bench: [row('rb3', 'Kyren Williams', 'RB', { status: 'Questionable' }), row('wr2', 'Rashee Rice', 'WR')],
      ir: [],
      taxi: [],
      devy: [],
    },
  }
}

const LEAGUE = {
  id: 'L1',
  name: 'KBFL',
  sport: 'NFL',
  season: 2026,
  platform: 'allfantasy',
  settings: { currentWeek: 4 },
  leagueVariant: null,
  lifecycleState: 'in_season',
  lockAllMoves: false,
}

const TEMPLATE = {
  slots: [
    { slotName: 'QB', slotOrder: 1, starterCount: 1, allowedPositions: ['QB'], benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'RB', slotOrder: 2, starterCount: 2, allowedPositions: ['RB'], benchCount: 6, reserveCount: 1, taxiCount: 0, devyCount: 0 },
    { slotName: 'WR', slotOrder: 3, starterCount: 1, allowedPositions: ['WR'], benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  ],
}

let currentPd: ReturnType<typeof playerData>
const prevSecret = process.env.NEXTAUTH_SECRET

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  vi.clearAllMocks()
  currentPd = playerData()
  h.membership.mockResolvedValue({ ok: true, access: { isMember: true } })
  h.leagueFindUnique.mockResolvedValue(LEAGUE)
  h.rosterFindFirst.mockImplementation(async () => ({ id: 'r1', platformUserId: 'u1', playerData: currentPd }))
  h.template.mockResolvedValue(TEMPLATE)
  h.lock.mockResolvedValue({ locked: false, lockedPlayerIds: [], perPlayerReasons: {}, policy: 'weekly' })
  h.persist.mockResolvedValue({ ok: true })
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

describe('proposeLineupChange', () => {
  it('builds a signed card for the exact swap and writes NOTHING', async () => {
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['kyren williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.card).toMatchObject({
      kind: 'lineup',
      week: 4,
      league: { id: 'L1', name: 'KBFL', sport: 'NFL' },
      lineup: { moveIn: [{ name: 'Kyren Williams', slot: 'RB2' }], moveOut: [{ name: 'Tony Pollard' }] },
    })
    expect(out.card.warnings.join(' ')).toMatch(/Kyren Williams is listed Questionable/)
    expect(out.text).toMatch(/NOTHING HAS CHANGED YET/)
    expect(out.text).toMatch(/ONLY if the user taps Confirm/)

    const v = verifyChimmyActionToken(out.card.token, NOW)
    expect(v.ok && v.payload.spec).toMatchObject({
      kind: 'lineup',
      rosterId: 'r1',
      week: 4,
      moves: [
        { playerId: 'rb3', to: 'starters' },
        { playerId: 'rb2', to: 'bench' },
      ],
    })
    expect(v.ok && v.payload.userId).toBe('u1')

    expect(h.persist).not.toHaveBeenCalled()
    expect(h.anyWrite).not.toHaveBeenCalled()
  })

  it('refuses an imported league politely and says where to go', async () => {
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'espn' })
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out.ok).toBe(false)
    expect(out.text).toMatch(/imported from ESPN/)
    expect(out.text).toMatch(/Set the lineup in ESPN/)
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('refuses a non-member', async () => {
    h.membership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/not a member/) })
    expect(h.rosterFindFirst).not.toHaveBeenCalled()
  })

  it('refuses to move a player whose game already started (stored game time)', async () => {
    currentPd.lineup_sections.starters[2] = row('rb2', 'Tony Pollard', 'RB', { gameTime: '2026-09-25T00:15:00Z' })
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/Tony Pollard's game has already started/) })
  })

  it("refuses to move a player whose team's game has kicked off on the schedule", async () => {
    h.gamesFindMany.mockResolvedValueOnce([
      { homeTeam: 'NE', awayTeam: 'BUF', homeTeamId: null, awayTeamId: null, startTime: new Date('2026-09-25T00:15:00Z'), status: 'final' },
    ] as never)
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/has already started/) })
  })

  it('refuses when the whole lineup is locked', async () => {
    h.lock.mockResolvedValue({ locked: true, reason: 'All roster moves are locked by the commissioner.' })
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/locked by the commissioner/) })
  })

  it('refuses a name that is not on the roster instead of guessing', async () => {
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Justin Jefferson'], bench: ['Tony Pollard'], now: NOW })
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/"Justin Jefferson" is not on the user's roster/) })
  })
})

describe('executeLineupAction', () => {
  async function token() {
    const out = await proposeLineupChange({ leagueId: 'L1', userId: 'u1', start: ['Kyren Williams'], bench: ['Tony Pollard'], now: NOW })
    if (!out.ok) throw new Error(out.text)
    const v = verifyChimmyActionToken(out.card.token, NOW)
    if (!v.ok) throw new Error('token')
    return v.payload
  }

  it('saves through the lineup engine with its lock check on, as the user', async () => {
    const payload = await token()
    const r = await executeLineupAction(payload, 'u1', NOW)
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/started Kyren Williams and benched Tony Pollard for week 4/) })
    expect(h.persist).toHaveBeenCalledTimes(1)
    const call = h.persist.mock.calls[0]![0] as Record<string, unknown>
    expect(call).toMatchObject({ leagueId: 'L1', rosterId: 'r1', actorUserId: 'u1', week: 4, season: 2026, source: 'user_save', skipLockCheck: false })
    expect((call.nextPlayerData as { starters: string[] }).starters).toEqual(['qb', 'rb1', 'rb3', 'wr1'])
  })

  it('refuses when the lineup changed after the card was made', async () => {
    const payload = await token()
    currentPd = playerData()
    currentPd.lineup_sections.bench.reverse()
    const r = await executeLineupAction(payload, 'u1', NOW)
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/lineup changed after Chimmy made this card/) })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("refuses when the player's game started between the card and the tap", async () => {
    const payload = await token()
    currentPd.lineup_sections.bench[0] = row('rb3', 'Kyren Williams', 'RB', { gameTime: '2026-09-25T14:00:00Z' })
    /* The row change moves the fingerprint only if order/ids change — it does not, so the lock check is what refuses. */
    const r = await executeLineupAction(payload, 'u1', NOW)
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Kyren Williams's game has already started/) })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('refuses for a different user even with a valid payload', async () => {
    const payload = await token()
    h.rosterFindFirst.mockResolvedValue({ id: 'r-other', platformUserId: 'u2', playerData: currentPd })
    const r = await executeLineupAction(payload, 'u2', NOW)
    expect(r).toMatchObject({ ok: false })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("relays the engine's own refusal and claims nothing was changed", async () => {
    const payload = await token()
    h.persist.mockResolvedValue({ ok: false, error: 'Lineup is locked.', status: 403 })
    expect(await executeLineupAction(payload, 'u1', NOW)).toEqual({ ok: false, message: 'Nothing was changed: Lineup is locked.' })
  })
})
