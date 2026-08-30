import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seam that stops a defender carrying two different prices on two different surfaces.
 *
 * `ValuationContext.leagueValueByNameLower` is OPTIONAL, and its absence is silent: a defender
 * still comes back with a number, just the flat per-position constant. Nothing throws and no
 * existing test fails, which is exactly how three call sites priced defenders without it while
 * four wired it. These tests pin the two properties that make the omission impossible to
 * reproduce by accident — an absent board yields no field at all, and format is derived once.
 *
 * ⚠ EVERY NEGATIVE HERE IS PAIRED WITH THE POSITIVE THAT PROVES THE CHECK CAN FAIL. A test
 * asserting "no field was set" passes just as happily when the module is broken and sets
 * nothing ever, so each such case sits beside one where the same assertion must see a field.
 */

const loadLeagueTradeValues = vi.fn()

vi.mock('@/lib/league-values/leagueTradeValues', () => ({
  loadLeagueTradeValues: (...a: unknown[]) => loadLeagueTradeValues(...a),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { __brand: 'default-prisma' } }))

const { resolveLeagueValuePatch, isDynastySleeperLeague } = await import(
  '@/lib/values/leagueValuePatch'
)

/** A board with one priced defender — the "positive control" every negative is checked against. */
const board = (names: string[] = ['micah parsons']) => ({
  byNameLower: new Map(names.map((n) => [n, { value: 4200, position: 'LB', basis: 'idp-vorp' }])),
  idp: {
    skipped: null,
    coverage: { defenders: 1, projected: 1, priced: 1, named: 1 },
    ambiguousNames: [],
  },
  kicker: {
    value: null,
    replacementRank: 0,
    scarcity: 0,
    rankPredictability: 'none',
    basis: '',
    named: 0,
  },
})

const emptyBoard = () => ({ ...board(), byNameLower: new Map() })

const sleeperLeague = (type: number) =>
  ({
    league_id: 'L1',
    settings: { type },
    roster_positions: ['QB', 'RB', 'LB', 'LB', 'K'],
    total_rosters: 14,
  }) as never

beforeEach(() => {
  loadLeagueTradeValues.mockReset()
  loadLeagueTradeValues.mockResolvedValue(board())
})

describe('resolveLeagueValuePatch', () => {
  it('sets the field when the league has a board — the positive control for every case below', async () => {
    const patch = await resolveLeagueValuePatch({
      platformLeagueId: 'L1',
      sleeperLeague: sleeperLeague(2),
    })
    expect('leagueValueByNameLower' in patch).toBe(true)
    expect(patch.leagueValueByNameLower?.get('micah parsons')?.value).toBe(4200)
  })

  it('returns NO field — not an empty map — when the board priced nobody', async () => {
    loadLeagueTradeValues.mockResolvedValue(emptyBoard())
    const patch = await resolveLeagueValuePatch({ platformLeagueId: 'L1' })
    /*
     * An empty map would still be a PRESENT `leagueValueByNameLower`, and its presence is what
     * tells pricePlayer a board exists. Spreading one would state "this league priced nobody"
     * where the truth is "this league has no board".
     */
    expect('leagueValueByNameLower' in patch).toBe(false)
  })

  it('never loads a board without a league id, and never guesses one', async () => {
    const patch = await resolveLeagueValuePatch({ platformLeagueId: null })
    expect('leagueValueByNameLower' in patch).toBe(false)
    expect(loadLeagueTradeValues).not.toHaveBeenCalled()
  })

  it('degrades to no field when the loader throws, rather than failing the caller', async () => {
    loadLeagueTradeValues.mockRejectedValue(new Error('sleeper down'))
    await expect(resolveLeagueValuePatch({ platformLeagueId: 'L1' })).resolves.toEqual({})
  })

  it('spreads into a context without disturbing it when there is nothing to add', async () => {
    loadLeagueTradeValues.mockResolvedValue(emptyBoard())
    const ctx = {
      asOfDate: '2026-08-30',
      isSuperFlex: false,
      ...(await resolveLeagueValuePatch({ platformLeagueId: 'L1' })),
    }
    expect(ctx).toEqual({ asOfDate: '2026-08-30', isSuperFlex: false })
  })
})

describe('format resolution', () => {
  /*
   * 🛑 THE BUG THIS REPLACED. `/api/trade-finder/matchmaking` resolved format with
   * `!/redraft/i.test(String(settings.type))`. `settings.type` is a NUMBER, so the regex tested
   * "0" for the word "redraft", never matched, and every league read as dynasty. It picks the
   * IDP ceiling, the kicker value and which decay curve is used, so it was wrong silently.
   */
  it('reads a redraft league as redraft — the case the old regex could never reach', async () => {
    await resolveLeagueValuePatch({ platformLeagueId: 'L1', sleeperLeague: sleeperLeague(0) })
    expect(loadLeagueTradeValues.mock.calls[0][0].isDynasty).toBe(false)
  })

  it('reads a dynasty league as dynasty', async () => {
    await resolveLeagueValuePatch({ platformLeagueId: 'L1', sleeperLeague: sleeperLeague(2) })
    expect(loadLeagueTradeValues.mock.calls[0][0].isDynasty).toBe(true)
  })

  it('treats a keeper league as redraft, matching getLeagueType', () => {
    expect(isDynastySleeperLeague(sleeperLeague(1))).toBe(false)
  })

  it('lets the league payload win over an explicit isDynasty, since it is the better authority', async () => {
    await resolveLeagueValuePatch({
      platformLeagueId: 'L1',
      sleeperLeague: sleeperLeague(0),
      isDynasty: true,
    })
    expect(loadLeagueTradeValues.mock.calls[0][0].isDynasty).toBe(false)
  })

  it('falls back to dynasty when no payload and no flag is given', async () => {
    await resolveLeagueValuePatch({ platformLeagueId: 'L1' })
    expect(loadLeagueTradeValues.mock.calls[0][0].isDynasty).toBe(true)
  })
})

describe('prefetch forwarding', () => {
  it('reads slots and team count off the supplied league payload', async () => {
    await resolveLeagueValuePatch({ platformLeagueId: 'L1', sleeperLeague: sleeperLeague(2) })
    const { prefetched } = loadLeagueTradeValues.mock.calls[0][0]
    expect(prefetched.rosterPositions).toEqual(['QB', 'RB', 'LB', 'LB', 'K'])
    expect(prefetched.numTeams).toBe(14)
  })

  it('lets an explicit prefetched value win over the payload', async () => {
    await resolveLeagueValuePatch({
      platformLeagueId: 'L1',
      sleeperLeague: sleeperLeague(2),
      prefetched: { rosterPositions: ['QB', 'DL'], numTeams: 10 },
    })
    const { prefetched } = loadLeagueTradeValues.mock.calls[0][0]
    expect(prefetched.rosterPositions).toEqual(['QB', 'DL'])
    expect(prefetched.numTeams).toBe(10)
  })

  it('passes rosters through and nulls what nothing supplied', async () => {
    const rosters = [{ players: ['a'] }]
    await resolveLeagueValuePatch({ platformLeagueId: 'L1', prefetched: { rosters } })
    const { prefetched } = loadLeagueTradeValues.mock.calls[0][0]
    expect(prefetched.rosters).toBe(rosters)
    expect(prefetched.rosterPositions).toBeNull()
    expect(prefetched.numTeams).toBeNull()
  })

  it('uses the default prisma client when the caller injects none', async () => {
    await resolveLeagueValuePatch({ platformLeagueId: 'L1' })
    expect(loadLeagueTradeValues.mock.calls[0][0].prisma).toEqual({ __brand: 'default-prisma' })
  })

  it('reports the full loader result to onResult, so a caller can surface coverage', async () => {
    const onResult = vi.fn()
    await resolveLeagueValuePatch({ platformLeagueId: 'L1', onResult })
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0].idp.coverage.priced).toBe(1)
  })
})
