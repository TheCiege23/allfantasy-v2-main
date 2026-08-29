import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `pricePlayer` reading the league's IDP board.
 *
 * 🛑 THE BUG THIS CLOSES IS WORSE THAN "EVERY LINEBACKER COSTS 800". The flat constant
 * `IDP_KICKER_BASELINE_VALUES` is keyed on POSITION, and `pricePlayer` reads position off
 * the FantasyCalc row — which for a defender does not exist, because FantasyCalc prices no
 * defenders at all. So the position resolved to 'UNKNOWN', the flat branch never fired, and
 * a defender fell through to an analytics lifetime value or came back `unpriced`. The board
 * is keyed by NAME precisely so it does not depend on a position lookup that cannot succeed.
 *
 * The last two tests are the backward-compatibility half: a caller that supplies no board
 * must be priced exactly as before, because most leagues do not score IDP and every one of
 * them goes through this function.
 */

const getHistoricalPlayerValue = vi.fn()
const findPlayerByName = vi.fn()
const getPlayerAnalytics = vi.fn()

vi.mock('@/lib/historical-values', () => ({
  getHistoricalPlayerValue: (...a: unknown[]) => getHistoricalPlayerValue(...a),
  getHistoricalPickValueWeighted: vi.fn(() => ({ value: null })),
}))

vi.mock('@/lib/fantasycalc', () => ({
  findPlayerByName: (...a: unknown[]) => findPlayerByName(...a),
}))

vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => []),
}))

vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalytics: (...a: unknown[]) => getPlayerAnalytics(...a),
}))

const { pricePlayer } = await import('@/lib/hybrid-valuation')

const TODAY = new Date().toISOString().slice(0, 10)

const baseCtx = { asOfDate: TODAY, isSuperFlex: false, fantasyCalcPlayers: [] as never[] }

beforeEach(() => {
  vi.clearAllMocks()
  // The two states a defender is actually in: no market price, no spreadsheet row.
  findPlayerByName.mockReturnValue(null)
  getHistoricalPlayerValue.mockReturnValue({ value: null })
  getPlayerAnalytics.mockResolvedValue(null)
})

describe('pricePlayer with a league IDP board', () => {
  it('prices a defender off the board and says where the number came from', async () => {
    const priced = await pricePlayer('Stud Backer', {
      ...baseCtx,
      leagueValueByNameLower: new Map([['stud backer', { value: 5500, position: 'LB', basis: 'idp-vorp' as const }]]),
    })

    expect(priced.value).toBe(5500)
    expect(priced.source).toBe('idp-vorp')
    expect(priced.position).toBe('LB')
    expect(priced.unpriced).toBeUndefined()
  })

  /** Two defenders in the same league must not collapse to one number. */
  it('separates defenders the old flat constant priced identically', async () => {
    const board = new Map([
      ['stud backer', { value: 5500, position: 'LB', basis: 'idp-vorp' as const }],
      ['scrub backer', { value: 240, position: 'LB', basis: 'idp-vorp' as const }],
    ])

    const stud = await pricePlayer('Stud Backer', { ...baseCtx, leagueValueByNameLower: board })
    const scrub = await pricePlayer('Scrub Backer', { ...baseCtx, leagueValueByNameLower: board })

    expect(stud.value).toBeGreaterThan(scrub.value * 10)
  })

  it('matches on a trimmed, case-insensitive name', async () => {
    const priced = await pricePlayer('  STUD Backer ', {
      ...baseCtx,
      leagueValueByNameLower: new Map([['stud backer', { value: 5500, position: 'LB', basis: 'idp-vorp' as const }]]),
    })

    expect(priced.value).toBe(5500)
  })

  /**
   * The board is built from the CURRENT projection week. Answering a question about the
   * past with it would restate today's price as history.
   */
  it('does not answer a hindsight query from the board', async () => {
    getHistoricalPlayerValue.mockReturnValue({ value: 900, snapshotDate: '2024-09-01' })

    const priced = await pricePlayer('Stud Backer', {
      ...baseCtx,
      asOfDate: '2024-09-01',
      leagueValueByNameLower: new Map([['stud backer', { value: 5500, position: 'LB', basis: 'idp-vorp' as const }]]),
    })

    expect(priced.source).toBe('excel')
    expect(priced.value).toBe(900)
  })

  it('leaves an offensive player on the market board untouched', async () => {
    findPlayerByName.mockReturnValue({
      value: 7000,
      redraftValue: 5000,
      positionRank: 3,
      player: { position: 'WR', maybeAge: 25 },
    })

    const priced = await pricePlayer('Wide One', {
      ...baseCtx,
      leagueValueByNameLower: new Map([['stud backer', { value: 5500, position: 'LB', basis: 'idp-vorp' as const }]]),
    })

    expect(priced.source).toBe('fantasycalc')
    expect(priced.value).toBe(7000)
  })

  it('is unchanged for a caller that supplies no board', async () => {
    const priced = await pricePlayer('Stud Backer', baseCtx)

    expect(priced.source).not.toBe('idp-vorp')
    expect(priced.unpriced).toBe(true)
  })

  /**
   * A kicker arrives through the same seam but carries a different claim, and the source
   * has to say which. `idp-vorp` is specific to that defender; `kicker-flat` is specific to
   * the LEAGUE and identical for every kicker in it.
   */
  it('prices a kicker and reports the flat basis, not the IDP one', async () => {
    const priced = await pricePlayer('Boot Leg', {
      ...baseCtx,
      leagueValueByNameLower: new Map([['boot leg', { value: 310, position: 'K', basis: 'kicker-flat' as const }]]),
    })

    expect(priced.value).toBe(310)
    expect(priced.source).toBe('kicker-flat')
    expect(priced.position).toBe('K')
    expect(priced.unpriced).toBeUndefined()
  })
})
