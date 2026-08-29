import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The join that finally connects the IDP board to a trade grade.
 *
 * Both halves of this already worked in isolation and never met: `loadLeagueIdpVorp`
 * prices a league's defenders off its own scoring, and `pricePlayer` priced every
 * defender at a flat per-position constant. These tests pin the seam, and they weight
 * the REFUSALS as heavily as the successes — a name join that guesses is how a wide
 * receiver ends up holding a linebacker's price.
 */

const getLeagueRosters = vi.fn()
const getLeagueInfo = vi.fn()
const getPlayersBySport = vi.fn()
const loadLeagueIdpVorp = vi.fn()
const resolveLeagueIdpScoring = vi.fn()

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueRosters: (...a: unknown[]) => getLeagueRosters(...a),
  getLeagueInfo: (...a: unknown[]) => getLeagueInfo(...a),
  getPlayersBySport: (...a: unknown[]) => getPlayersBySport(...a),
}))

vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  loadLeagueIdpVorp: (...a: unknown[]) => loadLeagueIdpVorp(...a),
  resolveLeagueIdpScoring: (...a: unknown[]) => resolveLeagueIdpScoring(...a),
}))

const { loadIdpTradeValuesByName } = await import('@/lib/idp-projections/idpTradeValues')

const prisma = {} as never

/** Two rosters. `lb_stud` and `lb_mid` are defenders; `wr_one` is not. */
const ROSTERS = [
  { players: ['lb_stud', 'wr_one'] },
  { players: ['lb_mid', 'k_one'] },
]

const PLAYERS: Record<string, { full_name: string; position: string }> = {
  lb_stud: { full_name: 'Stud Backer', position: 'LB' },
  lb_mid: { full_name: 'Mid Backer', position: 'LB' },
  wr_one: { full_name: 'Wide One', position: 'WR' },
  k_one: { full_name: 'Kick One', position: 'K' },
}

const boardResult = (valueBySleeperId: Map<string, number>, skipped: unknown = null) => ({
  vorpBySleeperId: new Map(),
  positionRankBySleeperId: new Map(),
  valueBySleeperId,
  skipped,
  coverage: { defenders: 2, projected: 2, priced: valueBySleeperId.size },
  projectionBySleeperId: new Map(),
  projectedFor: { season: 2026, week: 3 },
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveLeagueIdpScoring.mockResolvedValue({ ok: true, scoring: { idp_tkl: 1 } })
  getLeagueRosters.mockResolvedValue(ROSTERS)
  getLeagueInfo.mockResolvedValue({ roster_positions: ['QB', 'RB', 'WR', 'LB', 'DB'], total_rosters: 12 })
  getPlayersBySport.mockResolvedValue(PLAYERS)
  loadLeagueIdpVorp.mockResolvedValue(
    boardResult(new Map([['lb_stud', 5500], ['lb_mid', 1200]])),
  )
})

describe('loadIdpTradeValuesByName', () => {
  it('keys the league board by lowercased name and keeps the values intact', async () => {
    const res = await loadIdpTradeValuesByName({
      prisma,
      platformLeagueId: 'L1',
      isDynasty: true,
    })

    expect(res.skipped).toBeNull()
    expect(res.byNameLower.get('stud backer')?.value).toBe(5500)
    expect(res.byNameLower.get('mid backer')?.value).toBe(1200)
    expect(res.coverage.named).toBe(2)
  })

  /**
   * 🛑 THE REGRESSION THAT WOULD BE INVISIBLE. `loadLeagueIdpVorp` prices rank 1 at the
   * ceiling, so handing it only the two defenders in a trade returns both as top-of-board
   * assets and the grade looks confident. The board must be built over every rostered
   * player in the league.
   */
  it('builds the board over the whole league, not over the traded players', async () => {
    await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: true })

    const passed = loadLeagueIdpVorp.mock.calls[0][0] as { rosterPlayerIds: string[] }
    expect([...passed.rosterPlayerIds].sort()).toEqual(['k_one', 'lb_mid', 'lb_stud', 'wr_one'])
  })

  /**
   * 🛑 A DEFENDER SHARING A NAME WITH AN OFFENSIVE PLAYER ON THE SAME ROSTERS. Justin
   * Jefferson is a WR in Minnesota and a linebacker in Cleveland. Emitting the linebacker's
   * price under that name hands it to whichever one the trade actually names.
   */
  it('refuses a name shared with another rostered player rather than guessing', async () => {
    getPlayersBySport.mockResolvedValue({
      ...PLAYERS,
      lb_stud: { full_name: 'Justin Jefferson', position: 'LB' },
      wr_one: { full_name: 'Justin Jefferson', position: 'WR' },
    })

    const res = await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: true })

    expect(res.byNameLower.has('justin jefferson')).toBe(false)
    expect(res.ambiguousNames).toContain('justin jefferson')
    // The unambiguous defender still prices — one collision must not drop the board.
    expect(res.byNameLower.get('mid backer')?.value).toBe(1200)
    expect(res.coverage.named).toBe(1)
  })

  /**
   * 🛑 THE GATE MUST COME BEFORE THE PROVIDER CALLS. Only ~10 of 110 production leagues
   * score IDP; if this ordering regresses, the other ~100 pay two Sleeper round trips on
   * every trade grade for a result they can never use — a latency cost nothing would fail
   * on, which is exactly why it is asserted here.
   */
  it('returns empty WITHOUT fetching anything when the league does not score IDP', async () => {
    resolveLeagueIdpScoring.mockResolvedValue({ ok: false, reason: 'not_an_idp_league' })

    const res = await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: true })

    expect(res.byNameLower.size).toBe(0)
    expect(res.skipped).toBe('not_an_idp_league')
    expect(getLeagueRosters).not.toHaveBeenCalled()
    expect(getPlayersBySport).not.toHaveBeenCalled()
    expect(loadLeagueIdpVorp).not.toHaveBeenCalled()
  })

  it('returns empty when the board itself refuses after the gate passes', async () => {
    loadLeagueIdpVorp.mockResolvedValue(boardResult(new Map(), 'no_projection_history'))

    const res = await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: true })

    expect(res.byNameLower.size).toBe(0)
    expect(res.skipped).toBe('no_projection_history')
  })

  it('degrades to empty instead of throwing when the board blows up', async () => {
    loadLeagueIdpVorp.mockRejectedValue(new Error('db down'))

    const res = await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: true })

    expect(res.skipped).toBe('error')
    expect(res.byNameLower.size).toBe(0)
  })

  it('skips every fetch when there is no league id', async () => {
    const res = await loadIdpTradeValuesByName({ prisma, platformLeagueId: null, isDynasty: true })

    expect(res.skipped).toBe('no_league_id')
    expect(getLeagueRosters).not.toHaveBeenCalled()
    expect(loadLeagueIdpVorp).not.toHaveBeenCalled()
  })

  it('uses prefetched payloads rather than fetching them again', async () => {
    await loadIdpTradeValuesByName({
      prisma,
      platformLeagueId: 'L1',
      isDynasty: true,
      prefetched: {
        rosters: ROSTERS,
        rosterPositions: ['QB', 'LB'],
        numTeams: 10,
        players: PLAYERS,
      },
    })

    expect(getLeagueRosters).not.toHaveBeenCalled()
    expect(getLeagueInfo).not.toHaveBeenCalled()
    expect(getPlayersBySport).not.toHaveBeenCalled()
  })

  /** The two decay curves differ; the caller's format must reach the board unchanged. */
  it('passes the league format through to the curve', async () => {
    await loadIdpTradeValuesByName({ prisma, platformLeagueId: 'L1', isDynasty: false })

    expect((loadLeagueIdpVorp.mock.calls[0][0] as { isDynasty: boolean }).isDynasty).toBe(false)
  })
})
