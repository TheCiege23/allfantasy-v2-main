import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The board that answers "what should I offer for HIS linebacker".
 *
 * 🛑 THE VALUES ALREADY EXISTED AND WERE BEING THROWN AWAY. `loadDefenseHub` prices every
 * defender in the league — it has to, because replacement level is a property of the league and
 * not of your team — and then renders only the caller's own players. A manager could read what
 * his own defender was worth and had no way to ask about the one he wanted to trade for.
 *
 * These tests weight the REFUSALS as heavily as the rows, because every honesty rule in the IDP
 * stack is a thing this board could quietly undo: an unpriced defender must not sort as the
 * cheapest, a kicker must not acquire a rank, and no defender may be priced by anything except
 * the one league board.
 */

const loadLeagueIdpVorp = vi.fn()
const resolveLeagueKickerValue = vi.fn()
const findMyRoster = vi.fn()

vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  loadLeagueIdpVorp: (...a: unknown[]) => loadLeagueIdpVorp(...a),
}))

vi.mock('@/lib/kicker-values/leagueKickerValue', () => ({
  resolveLeagueKickerValue: (...a: unknown[]) => resolveLeagueKickerValue(...a),
}))

vi.mock('@/lib/core-app/myRoster', () => ({
  findMyRoster: (...a: unknown[]) => findMyRoster(...a),
  rosterPlayerIds: (pd: unknown) => (Array.isArray(pd) ? (pd as string[]) : []),
}))

const { loadLeagueDefenderBoard } = await import('@/lib/values/leagueDefenderBoard')

/** Two teams. `mine` holds lb_mine; `theirs` holds the player a manager wants to ask about. */
const ROSTERS = [
  { platformUserId: 'u-me', playerData: ['lb_mine', 'k_mine'] },
  { platformUserId: 'u-them', playerData: ['lb_target', 'dl_unpriced', 'wr_offense'] },
]

const TEAMS = [
  { platformUserId: 'u-me', teamName: 'My Team', ownerName: 'Me' },
  { platformUserId: 'u-them', teamName: 'Their Team', ownerName: 'Them' },
]

const SPORTS_PLAYERS = [
  { sleeperId: 'lb_mine', name: 'My Backer', team: 'CLE', position: 'LB', updatedAt: new Date() },
  { sleeperId: 'lb_target', name: 'Target Backer', team: 'DAL', position: 'LB', updatedAt: new Date() },
  { sleeperId: 'dl_unpriced', name: 'Unpriced Lineman', team: 'NYJ', position: 'DE', updatedAt: new Date() },
  { sleeperId: 'k_mine', name: 'My Boot', team: 'BUF', position: 'K', updatedAt: new Date() },
  { sleeperId: 'wr_offense', name: 'A Receiver', team: 'MIA', position: 'WR', updatedAt: new Date() },
]

const prisma = {
  league: {
    findUnique: vi.fn(async () => ({
      id: 'L1',
      settings: { roster_positions: ['QB', 'LB', 'LB', 'DL', 'DB', 'K'] },
      leagueType: 'dynasty',
    })),
    findFirst: vi.fn(async () => null),
  },
  roster: { findMany: vi.fn(async () => ROSTERS) },
  leagueTeam: { findMany: vi.fn(async () => TEAMS) },
  sportsPlayer: { findMany: vi.fn(async () => SPORTS_PLAYERS) },
} as never

const VORP_OK = () => ({
  vorpBySleeperId: new Map([
    ['lb_mine', 3.1],
    ['lb_target', 9.4],
    ['dl_unpriced', null],
  ]),
  positionRankBySleeperId: new Map([
    ['lb_mine', 2],
    ['lb_target', 1],
  ]),
  valueBySleeperId: new Map([
    ['lb_mine', 900],
    ['lb_target', 5200],
  ]),
  projectionBySleeperId: new Map([
    ['lb_mine', 11.2],
    ['lb_target', 17.8],
    ['dl_unpriced', null],
  ]),
  projectedFor: { season: 2026, week: 4 },
  skipped: null,
  coverage: { defenders: 3, projected: 3, priced: 2 },
})

beforeEach(() => {
  vi.clearAllMocks()
  loadLeagueIdpVorp.mockResolvedValue(VORP_OK())
  resolveLeagueKickerValue.mockReturnValue({
    value: 500,
    replacementRank: 13,
    scarcity: 0.4,
    rankPredictability: 'none',
    basis: 'flat by design',
  })
  findMyRoster.mockResolvedValue({ found: true, playerData: ['lb_mine', 'k_mine'] })
})

describe('the board a manager reads before making an offer', () => {
  it("shows a defender he does NOT own — the whole reason this exists", async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })

    const target = board.rows.find((r) => r.sleeperId === 'lb_target')
    expect(target).toBeDefined()
    expect(target?.value).toBe(5200)
    expect(target?.ownedBy.isMine).toBe(false)
    expect(target?.ownedBy.teamName).toBe('Their Team')
    expect(target?.ownedBy.ownerName).toBe('Them')
  })

  it("still marks his own players, so he can tell the two apart", async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.rows.find((r) => r.sleeperId === 'lb_mine')?.ownedBy.isMine).toBe(true)
  })

  it('prices nothing itself — every value comes from the league board', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    const fromBoard = VORP_OK().valueBySleeperId
    for (const row of board.rows) {
      expect(row.value).toBe(fromBoard.get(row.sleeperId) ?? null)
    }
  })

  it('carries the projection and the week it is for, so a value is not read as current', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.projectedFor).toEqual({ season: 2026, week: 4 })
    expect(board.rows.find((r) => r.sleeperId === 'lb_target')?.projectedPoints).toBe(17.8)
  })

  it('leaves offensive players off — this board is defenders and kickers', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.rows.map((r) => r.sleeperId)).not.toContain('wr_offense')
  })
})

describe('the honesty rules it could quietly undo', () => {
  /*
   * 🛑 A NULL VALUE IS NOT A CHEAP PLAYER. Replacement level could not be established for him.
   * A plain descending numeric sort puts null at one end or the other and either way renders an
   * absence of information as a position on the board.
   */
  it('sorts an unpriced defender LAST, not as the cheapest', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.rows.map((r) => r.sleeperId)).toEqual(['lb_target', 'lb_mine', 'dl_unpriced'])
    expect(board.rows.at(-1)?.value).toBeNull()
  })

  it('says out loud that an unpriced defender is not worth nothing', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.notes.join(' ')).toMatch(/different from being\s+worth nothing/)
  })

  /*
   * ⚠ KICKERS GET NO RANK AND NO PROJECTION COLUMN, matching the defense hub. Over seven seasons
   * kicker rank does not carry, so a column inviting a manager to compare two of them would
   * assert signal the measurement says is absent.
   */
  it('gives kickers a value but never a rank or a projection', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.kickerValue?.value).toBe(500)
    expect(board.kickers).toHaveLength(1)
    expect(board.kickers[0]).not.toHaveProperty('positionRank')
    expect(board.kickers[0]).not.toHaveProperty('projectedPoints')
    expect(board.kickers[0]).not.toHaveProperty('value')
  })

  it('offers no kicker at all when the league starts none', async () => {
    resolveLeagueKickerValue.mockReturnValue({
      value: null,
      replacementRank: 0,
      scarcity: 0,
      rankPredictability: 'none',
      basis: '',
    })
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.kickerValue).toBeNull()
    expect(board.kickers).toEqual([])
  })

  it('states that these values do not travel to another league', async () => {
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.notes.join(' ')).toMatch(/specific to THIS league/i)
  })

  /*
   * The positive control for the whole file: replacement level MUST be computed over every
   * roster, not just the caller's, or the same player prices differently depending on who asks.
   */
  it('prices against the whole league, not the caller’s roster', async () => {
    await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    const passed = loadLeagueIdpVorp.mock.calls[0][0].rosterPlayerIds as string[]
    expect(passed).toEqual(expect.arrayContaining(['lb_mine', 'lb_target', 'dl_unpriced']))
    expect(loadLeagueIdpVorp.mock.calls[0][0].numTeams).toBe(2)
  })
})

describe('refusals', () => {
  it.each([
    ['not_an_idp_league', 'not_idp_league'],
    ['no_scoring_settings', 'no_scoring_settings'],
    ['no_projection_history', 'no_projection_history'],
    ['valuation_refused', 'valuation_refused'],
  ])('reports %s as state %s rather than an empty board', async (skipped, state) => {
    loadLeagueIdpVorp.mockResolvedValue({ ...VORP_OK(), skipped })
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'me' })
    expect(board.state).toBe(state)
    expect(board.rows).toEqual([])
  })

  it('still renders the board for a caller who holds no roster in the league', async () => {
    findMyRoster.mockResolvedValue({ found: false, reason: 'no_roster' })
    const board = await loadLeagueDefenderBoard({ prisma, leagueId: 'L1', userId: 'stranger' })
    expect(board.state).toBe('ok')
    expect(board.rows.length).toBeGreaterThan(0)
    expect(board.rows.every((r) => r.ownedBy.isMine === false)).toBe(true)
  })
})
