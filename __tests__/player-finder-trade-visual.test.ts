import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Trade for him" — the visual's loader. Prisma, the market-value service and
 * the league grader's construction are mocked at their module boundaries; the
 * package finder, the team-profile builder and `gradeDeal` are the real ones, so
 * a change in how packages are built, banded or handed to the grader shows up here.
 */

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockGetMarketValues = vi.hoisted(() => vi.fn())
const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGrade = vi.hoisted(() => vi.fn())
const mockRunTradeAnalysis = vi.hoisted(() => vi.fn())
const mockWeeklyFindFirst = vi.hoisted(() => vi.fn())
const mockWeeklyFindMany = vi.hoisted(() => vi.fn())

/*
 * ⚠ `weeklyMatchup` IS HERE BECAUSE `resolveCurrentWeekForLeague` READS IT. Without it the week
 * lookup throws, the caller's `.catch` swallows it, and the paced path silently becomes the
 * unpaced one — a mock that stops doubling exactly the thing under test.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    leagueTeam: { findMany: mockTeamFindMany },
    roster: { findMany: mockRosterFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
    weeklyMatchup: { findFirst: mockWeeklyFindFirst, findMany: mockWeeklyFindMany },
  },
}))

/*
 * 🛑 ONLY THE FETCH IS MOCKED. The lookups — `playerValue` and `playerValueForLeague` — are the
 * REAL ones, so this suite exercises the pricing rather than a hand-written copy of it.
 *
 * The previous version stubbed `playerValue` by hand and listed no other export. That is the mock
 * that stops doubling anything: the day the module reached for a second lookup, the stub either
 * died loudly or, worse, would have priced everything through a copy that knows nothing about the
 * league. Delegating to `importActual` cannot rot the same way.
 */
vi.mock('@/lib/trade-intel/marketValueService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-intel/marketValueService')>(
    '@/lib/trade-intel/marketValueService',
  )
  return { ...actual, getMarketValues: mockGetMarketValues }
})

/*
 * 🛑 ONLY THE CONSTRUCTION IS MOCKED — `gradeDeal` IS THE REAL ONE, so the unpriceable-asset refusal
 * and the null-grader answer are exercised, not restated. The old engine stays mocked too: it must
 * never be called again, and a mock is the only way to prove that.
 */
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/leagueTradeGrader')>(
    '@/lib/decision-os/trade/leagueTradeGrader',
  )
  return { ...actual, createLeagueTradeGrader: mockCreateGrader }
})
vi.mock('@/lib/engine/trade', () => ({ runTradeAnalysis: mockRunTradeAnalysis }))

import { getPlayerTradeVisual, marketContextFor, recommendedPackage } from '@/lib/core-app/playerTradeVisual'
import type { FairnessBand } from '@/lib/trade-discovery/redraftTradeDiscovery'

const KINCAID = '10236'

const LEAGUE = {
  id: 'L-gang',
  name: 'Gridiron Gang',
  platform: 'espn',
  platformLeagueId: '888',
  season: 2026,
  leagueType: 'Keeper',
  settings: { scoring_settings: { rec: 0.5 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN'] },
}

const TASHA = { externalId: '1', platformUserId: 'u-tasha', claimedByUserId: null, ownerName: 'tashaR', teamName: "Tasha's Titans", wins: 4, losses: 2, ties: 0, pointsFor: 812 }
const ME = { externalId: '2', platformUserId: 'u-me', claimedByUserId: 'me', ownerName: 'guap', teamName: 'Cafe Con Chimmy', wins: 5, losses: 1, ties: 0, pointsFor: 860 }

/* Me: four running backs (a surplus) and one thin tight end. Tasha: Kincaid plus a balanced roster. */
/* `faabRemaining` is deliberately NOT the league budget — a bid must be against what is left. */
const MY_ROSTER = { platformUserId: 'u-me', faabRemaining: 400, playerData: { players: ['qb1', 'rb1', 'rb2', 'rb3', 'rb4', 'wr1', 'wr2', 'te0'], starters: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te0', 'rb3'] } }
const THEIR_ROSTER = { platformUserId: 'u-tasha', playerData: { players: ['qb2', 'rb5', 'rb6', 'wr3', 'wr4', KINCAID, 'te2'], starters: ['qb2', 'rb5', 'rb6', 'wr3', 'wr4', KINCAID, 'te2'] } }

const PLAYERS = [
  ['qb1', 'Josh Allen', 'QB'], ['rb1', 'Bijan Robinson', 'RB'], ['rb2', 'Jahmyr Gibbs', 'RB'], ['rb3', 'Tony Pollard', 'RB'], ['rb4', 'Rhamondre Stevenson', 'RB'],
  ['wr1', 'Puka Nacua', 'WR'], ['wr2', 'Nico Collins', 'WR'], ['te0', 'Cade Otton', 'TE'],
  ['qb2', 'Jared Goff', 'QB'], ['rb5', 'Kenneth Walker', 'RB'], ['rb6', 'James Cook', 'RB'], ['wr3', 'Rome Odunze', 'WR'], ['wr4', 'DJ Moore', 'WR'], [KINCAID, 'Dalton Kincaid', 'TE'], ['te2', 'Jake Ferguson', 'TE'],
].map(([sleeperId, name, position]) => ({ sleeperId, name, position }))

const VALUES = {
  version: 1, fetchedAt: '2026-09-02T12:00:00Z', source: 'fantasycalc', mode: 'redraft', bestBallNote: null, numQbs: 1, numTeams: 12, ppr: 0.5,
  bySleeperId: Object.fromEntries([
    ['qb1', 9000], ['rb1', 8000], ['rb2', 7500], ['rb3', 3100], ['rb4', 2600], ['wr1', 8200], ['wr2', 6000], ['te0', 900],
    ['qb2', 4000], ['rb5', 5000], ['rb6', 5200], ['wr3', 4300], ['wr4', 3800], [KINCAID, 3000], ['te2', 2100],
    /*
     * ⚠ POSITION IS REAL HERE, AND IT HAD TO BECOME REAL. Every row carried `position: null`, and
     * a null position makes the scoring adjustment decline — so a fixture built that way passes
     * whether the league-aware pricing is wired or deleted. Measured on the live payload
     * (`market-values:v1:dynasty:1qb:16t:0.5ppr`, 397 rows): WR=153 RB=110 QB=69 TE=65, no nulls.
     */
  ].map(([id, value]) => [
    id,
    {
      name: String(id),
      sleeperId: String(id),
      position: PLAYERS.find((p) => p.sleeperId === id)?.position ?? null,
      value,
      overallRank: null,
      trend30Day: null,
    },
  ])),
  byPick: {},
}

/** A graded view as the one grader returns it — only the fields the card carries are asserted. */
function gradeView(letter: 'A' | 'B' | 'C' | 'D' | 'F', label: string) {
  const mirror = { A: 'F', B: 'D', C: 'C', D: 'B', F: 'A' } as const
  return {
    graded: true, letter, partnerLetter: mirror[letter], percentDiff: 0, label, sideAdvantage: 'even', action: 'accept',
    recommendation: `Recommendation for ${letter}`, giveValue: 3100, getValue: 3050, giveMarket: 3100, getMarket: 3000,
    basis: 'Keeper · 1QB · 2 teams · Half PPR', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [],
  }
}

beforeEach(() => {
  mockLeagueFindUnique.mockReset().mockResolvedValue(LEAGUE)
  mockTeamFindMany.mockReset().mockResolvedValue([TASHA, ME])
  mockRosterFindMany.mockReset().mockResolvedValue([MY_ROSTER, THEIR_ROSTER])
  mockSportsPlayerFindMany.mockReset().mockResolvedValue(PLAYERS)
  mockGetMarketValues.mockReset().mockResolvedValue(VALUES)
  mockGrade.mockReset().mockResolvedValue(gradeView('C', 'Even'))
  mockCreateGrader.mockReset().mockResolvedValue({ leagueId: 'L-gang', chart: null, leagueType: null, grade: mockGrade })
  mockRunTradeAnalysis.mockReset()
  mockWeeklyFindFirst.mockReset().mockResolvedValue(null)
  mockWeeklyFindMany.mockReset().mockResolvedValue([])
})

describe('marketContextFor', () => {
  it('reads format, superflex and dynasty off the league’s own settings', () => {
    const ctx = marketContextFor({ scoring_settings: { rec: 1 }, roster_positions: ['QB', 'SUPER_FLEX', 'DL'] }, 'Dynasty PPR', 10)
    expect(ctx.teams).toBe(10)
    expect(ctx.variant).toMatchObject({ dynasty: true, keeper: false, superflex: true, idp: true })
    expect(ctx.scoring.format).toBe('ppr')
    expect(marketContextFor({ scoring_settings: { rec: 0.5 } }, 'Keeper', 12).scoring.format).toBe('half_ppr')
    expect(marketContextFor({}, null, 12).scoring.format).toBe('std')
  })
})

describe('getPlayerTradeVisual', () => {
  it('builds a package for him from your surplus and grades every package through the ONE grader', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    const v = state.data
    expect(v.partner).toMatchObject({ teamName: "Tasha's Titans", ownerName: 'tashaR', externalId: '1' })
    expect(v.you).toMatchObject({ teamName: 'Cafe Con Chimmy', externalId: '2' })
    expect(v.target).toMatchObject({ name: 'Dalton Kincaid', position: 'TE', value: 3000 })
    expect(v.packages.length).toBeGreaterThan(0)
    expect(v.recommended).not.toBeNull()
    // Every package gets him, and gives from what I have too much of.
    for (const p of v.packages) {
      expect(p.receive.map((a) => a.playerId)).toContain(KINCAID)
      expect(p.give.length).toBeGreaterThan(0)
      for (const a of p.give) expect(['RB']).toContain(a.position)
    }
    const oneGrade = {
      available: true,
      data: {
        letter: 'C', partnerLetter: 'C', label: 'Even', recommendation: 'Recommendation for C',
        giveValue: 3100, getValue: 3050, basis: 'Keeper · 1QB · 2 teams · Half PPR',
      },
    }
    // The card's headline grade IS the recommended package's grade, and every package carries one.
    expect(v.grade).toEqual(oneGrade)
    expect(v.recommended!.grade).toEqual(oneGrade)
    for (const p of v.packages) expect(p.grade).toEqual(oneGrade)

    // One grader for this league and this viewer, then one grade per package, from your side.
    expect(mockCreateGrader).toHaveBeenCalledTimes(1)
    expect(mockCreateGrader).toHaveBeenCalledWith({ leagueId: 'L-gang', userId: 'me' })
    expect(mockGrade).toHaveBeenCalledTimes(v.packages.length)
    const call = mockGrade.mock.calls[0][0]
    expect(call.viewerSide).toBe(true)
    // Exactly the Trade Center builder's inputs: `{ playerId, name }`.
    expect(call.get).toEqual([{ kind: 'player', playerId: KINCAID, name: 'Dalton Kincaid' }])
    for (const a of call.give) expect(a).toMatchObject({ kind: 'player', playerId: expect.any(String), name: expect.any(String) })

    // 🛑 The second engine is never asked, and the finder's own fairness sentence is not printed.
    expect(mockRunTradeAnalysis).not.toHaveBeenCalled()
    for (const p of v.packages) {
      expect(p.reasons.join('\n')).not.toMatch(/Values are close|Slight value edge|Large value gap/)
    }
    expect(v.values).toMatchObject({ mode: 'redraft', ppr: 0.5, numQbs: 1 })
  })

  /*
   * 🛑 THE PACKAGE WE OPEN WITH IS CHOSEN BY THE ONE GRADE. The finder's band called the first
   * package balanced; if the letter the Trade Center will show calls it an overpay, the card must
   * not lead with it.
   */
  describe('recommendedPackage', () => {
    const graded = (letter: 'A' | 'B' | 'C' | 'D' | 'F') =>
      ({ available: true, data: { letter, partnerLetter: 'C', label: '', recommendation: '', giveValue: 0, getValue: 0, basis: '' } }) as const
    const miss = { available: false, reason: 'no' } as const
    const pkg = (id: string, fairness: FairnessBand, grade: typeof miss | ReturnType<typeof graded>) => ({ id, fairness, grade })

    it('leads with the first package the one grade calls C or B, over the finder’s own “balanced”', () => {
      const pkgs = [pkg('a', 'balanced', graded('D')), pkg('b', 'lopsided', graded('F')), pkg('c', 'slight edge partner', graded('B'))]
      expect(recommendedPackage(pkgs)?.id).toBe('c')
    })

    it('a graded D is not passed over for an UNGRADED “balanced” one', () => {
      const pkgs = [pkg('a', 'lopsided', graded('D')), pkg('b', 'balanced', miss)]
      expect(recommendedPackage(pkgs)?.id).toBe('a')
    })

    it('only when nothing was graded does the finder’s band choose', () => {
      const pkgs = [pkg('a', 'lopsided', miss), pkg('b', 'balanced', miss)]
      expect(recommendedPackage(pkgs)?.id).toBe('b')
    })

    it('[control] no packages, no recommendation', () => {
      expect(recommendedPackage([])).toBeNull()
    })
  })

  it('a grade the grader withholds is said, with its reason, and no other verdict stands in', async () => {
    mockGrade.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart.', basis: null })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected a visual')
    expect(state.data.recommended).not.toBeNull()
    expect(state.data.grade).toEqual({ available: false, reason: '1 asset has no value on this league’s chart' })
  })

  it('a league whose values cannot be loaded withholds every grade (the real gradeDeal on a null grader)', async () => {
    mockCreateGrader.mockResolvedValue(null)
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected a visual')
    expect(state.data.grade).toEqual({ available: false, reason: 'This league’s values could not be loaded just now' })
    expect(mockGrade).not.toHaveBeenCalled()
  })

  /* One game is not a season (2026-09-17): the loader carries whether each side's stance is settled. */
  it('a 0-1 partner is not a rebuilder yet, and the card is told so', async () => {
    mockTeamFindMany.mockResolvedValue([
      { ...TASHA, wins: 0, losses: 1 },
      { ...ME, wins: 1, losses: 0 },
    ])
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected a visual')
    expect(state.data.partner).toMatchObject({ stance: 'middle', stanceSettled: false })
    expect(state.data.you).toMatchObject({ stance: 'middle', stanceSettled: false })
  })

  it('a settled record still names the stance', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected a visual')
    expect(state.data.you).toMatchObject({ stance: 'contender', stanceSettled: true })
    expect(state.data.partner.stanceSettled).toBe(true)
  })

  it('keeps the package when the grader fails, and says so', async () => {
    mockCreateGrader.mockRejectedValue(new Error('grader down'))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(state.data.recommended).not.toBeNull()
    expect(state.data.grade).toEqual({ available: false, reason: 'this package could not be graded just now' })
  })

  it('keeps the package when the grader runs out of time, and says so', async () => {
    vi.useFakeTimers()
    try {
      mockCreateGrader.mockReturnValue(new Promise(() => {}))
      const pending = getPlayerTradeVisual('L-gang', KINCAID, 'me')
      await vi.advanceTimersByTimeAsync(6_000)
      const state = await pending
      if (!state.available) throw new Error('expected a visual')
      expect(state.data.recommended).not.toBeNull()
      expect(state.data.grade).toEqual({ available: false, reason: 'the trade grade did not answer in time' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses when he is already yours, unrostered, or you have no team here', async () => {
    mockRosterFindMany.mockResolvedValue([{ ...MY_ROSTER, playerData: { players: ['qb1', KINCAID] } }, THEIR_ROSTER])
    const mine = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(mine).toMatchObject({ available: false, reason: expect.stringMatching(/already on your roster/) })

    mockRosterFindMany.mockResolvedValue([MY_ROSTER, { ...THEIR_ROSTER, playerData: { players: ['qb2'] } }])
    const free = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(free).toMatchObject({ available: false, reason: expect.stringMatching(/claim him/) })

    mockTeamFindMany.mockResolvedValue([TASHA])
    mockRosterFindMany.mockResolvedValue([MY_ROSTER, THEIR_ROSTER])
    const noTeam = await getPlayerTradeVisual('L-gang', KINCAID, 'stranger')
    expect(noTeam).toMatchObject({ available: false, reason: expect.stringMatching(/claimed team/) })
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('refuses rather than prices when no market values exist for the format', async () => {
    mockGetMarketValues.mockResolvedValue(null)
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state).toMatchObject({ available: false, reason: expect.stringMatching(/no market values/) })
  })

  /*
   * ── The per-position reception rule the chart cannot express ────────────────────────────────
   *
   * FantasyCalc is fetched with ONE `ppr` and applies it to everybody, so a league paying tight
   * ends 1.0 and everyone else 0.5 is priced by a chart that models neither. `marketContextFor`
   * routes it to the 0.5 chart — correctly, off `rec` alone — and the tight ends then have to be
   * corrected here or not at all.
   */
  it('🛑 a TE-premium league prices tight ends above the chart, and SAYS SO', async () => {
    mockLeagueFindUnique.mockResolvedValue({
      ...LEAGUE,
      settings: { ...LEAGUE.settings, scoring_settings: { rec: 0.5, bonus_rec_te: 0.5 } },
    })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    const v = state.data

    // 3000 x sqrt(1.312) = 3436. The chart's number is 3000; this league's is not.
    expect(v.target.value).toBe(3436)

    /*
     * 🛑 AND IT MUST NOT BE SILENT. The payload carries adjusted prices, so a surface with no way
     * to say they were adjusted has shown a number the chart does not contain — the same objection
     * `applyFormat` records against folding a multiplier into a base value.
     */
    expect(v.values.scoringAdjustment).toMatch(/TE \+14\.5%/)

    /*
     * Control, and the half that catches a multiplier applied to everyone: the give side is all
     * running backs, whose reception weight matches the chart exactly. Not one of them may move.
     */
    for (const p of v.packages) {
      for (const a of p.give) {
        expect(a.position).toBe('RB')
        expect(a.value).toBe(VALUES.bySleeperId[a.playerId as string].value)
      }
    }
  })

  /*
   * ── A NO-TRADE ELIMINATION LEAGUE (SURVIVOR ALL-STARS GUILLOTINE) IS NOT A TRADE MARKET ─────────
   * "There are no trades allowed in this league." A package this surface could build is one the
   * manager can never send, so offering it is worse than offering nothing — it looks actionable.
   * These fixtures used a plain `leagueType: 'guillotine'` until 2026-09-28. A plain guillotine
   * TRADES (concept catalog), so they now carry the confirmed survivor-guillotine concept.
   */
  it('🛑 a survivor-guillotine league gets a BID, not a trade — and no package at all', async () => {
    mockLeagueFindUnique.mockResolvedValue({
      ...LEAGUE,
      leagueType: 'guillotine',
      settings: { ...LEAGUE.settings, faab_budget: 1000, leagueTypeConfirmation: { type: 'survivor_guillotine' } },
    })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    const v = state.data

    // Nothing tradeable is offered, and the grader is not asked to grade a trade that cannot happen.
    expect(v.packages).toEqual([])
    expect(v.recommended).toBeNull()
    expect(v.grade).toEqual({ available: false, reason: 'this league does not allow trades, so there is no package to grade' })
    expect(mockCreateGrader).not.toHaveBeenCalled()

    const bid = v.bidInstead!
    expect(bid.concept).toBe('guillotine')
    /*
     * Kincaid (3,000) over my TE starter Otton (900) is +2,100. The pool is his OWNER'S whole roster,
     * because that is what hits waivers when a team is chopped, and each man is measured against my
     * best lineup under the league's REAL slots (QB, RB ×2, WR ×2, TE, FLEX — `faabLineupGain.ts`).
     *
     * ⚠ THIS WAS 2,100 / 3,300 UNTIL 2026-09-28, AND 3,300 WAS WRONG. The fixed 1/2/2/1 table ignored
     * the FLEX seat, where my lineup starts Pollard (3,100). Against him Walker +1,900, Cook +2,100,
     * Odunze +1,200 and Moore +700 are real upgrades too, beside Kincaid +2,100 and Ferguson +1,200.
     * Supply is 9,200, and Kincaid is 2,100 of it.
     */
    expect(bid.marginalValue).toBe(2100)
    expect(bid.shareOfSupply).toBeCloseTo(2100 / 9200, 4)

    /*
     * 🛑 THE BID IS AGAINST WHAT HE HAS LEFT ($400), NOT THE LEAGUE'S SEASON BUDGET ($1000).
     * 400 x 2100/9200 = 91. Bidding the budget would tell a manager down to their last few
     * dollars to spend like they were untouched — and `rosters.faabRemaining` carries the real
     * number on 96% of rosters, so there is no excuse for using the wrong one.
     */
    expect(bid.budgetRemaining).toBe(400)
    expect(bid.budgetTotal).toBe(1000)
    expect(bid.ceilingAtRemaining).toBe(91)
    expect(bid.reason).toMatch(/No trades in this league/)
  })

  it('⚠ and with no faabRemaining on the roster it gives the share and REFUSES the dollars', async () => {
    /* 4% of rosters carry no FAAB figure. They get the share and an explicit refusal, never a
     * dollar invented from the league total. */
    mockRosterFindMany.mockResolvedValue([{ ...MY_ROSTER, faabRemaining: null }, THEIR_ROSTER])
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType: 'guillotine', settings: { ...LEAGUE.settings, faab_budget: 1000, leagueTypeConfirmation: { type: 'survivor_guillotine' } } })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    const bid = state.data.bidInstead!
    expect(bid.shareOfSupply).toBeCloseTo(2100 / 9200, 4)
    expect(bid.budgetRemaining).toBeNull()
    expect(bid.ceilingAtRemaining).toBeNull()
    // 🛑 The league budget is on file, and must NOT be substituted for what he has left.
    expect(bid.budgetTotal).toBe(1000)
    expect(bid.reason).toMatch(/do not hold your remaining FAAB/)
  })

  /*
   * ── THE PACED PATH, WHICH THE OTHER GUILLOTINE TESTS DO NOT REACH ──────────────────────────
   * They use `platformLeagueId: '888'`, which resolves no schedule — so they exercise the UNPACED
   * branch and would pass with the whole pacing wire deleted. This one uses the real Sleeper id
   * from the registry, which is the only way to prove the schedule is actually consulted.
   */
  it('🛑 a league WITH a published schedule is PACED — the bid shrinks to one week\'s share', async () => {
    const SURVIVOR_ALL_STARS_SLEEPER_ID = '1387654855463534592'
    mockLeagueFindUnique.mockResolvedValue({
      ...LEAGUE,
      platformLeagueId: SURVIVOR_ALL_STARS_SLEEPER_ID,
      leagueType: 'guillotine',
      settings: { ...LEAGUE.settings, faab_budget: 1000, leagueTypeConfirmation: { type: 'survivor_guillotine' } },
    })
    /* Week 11: 12 alive, the Gauntlet begins, E[weeks left] = 4.0. */
    mockWeeklyFindFirst.mockResolvedValue({ seasonYear: 2026, week: 11 })

    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    const bid = state.data.bidInstead!

    /*
     * Unpaced this is $91 (400 x 2100/9200). Paced across 4.0 expected weeks it is a quarter of
     * that — $23. The difference IS the schedule, and it is the whole point of the wire.
     */
    expect(bid.shareOfSupply).toBeCloseTo(2100 / 9200, 4)
    expect(bid.ceilingAtRemaining).toBe(23)
    expect(bid.reason).toMatch(/4\.0 more weeks/)
  })

  it('⚠ [control] an UNREGISTERED league gets the same share but is NOT paced', async () => {
    /* The registry's default is null, and that is what keeps every other league unchanged. */
    mockLeagueFindUnique.mockResolvedValue({
      ...LEAGUE,
      platformLeagueId: '999-not-in-the-registry',
      leagueType: 'guillotine',
      settings: { ...LEAGUE.settings, faab_budget: 1000, leagueTypeConfirmation: { type: 'survivor_guillotine' } },
    })
    mockWeeklyFindFirst.mockResolvedValue({ seasonYear: 2026, week: 11 })

    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    const bid = state.data.bidInstead!
    expect(bid.shareOfSupply).toBeCloseTo(2100 / 9200, 4)
    expect(bid.ceilingAtRemaining).toBe(91)
    expect(bid.reason).not.toMatch(/more weeks/)
  })

  it('[control] an ordinary league still gets packages and NO bid block', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.bidInstead).toBeNull()
    expect(state.data.packages.length).toBeGreaterThan(0)
  })

  it('and an ordinary league is left EXACTLY alone — no drift on the common case', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(state.data.target.value).toBe(3000)
    expect(state.data.values.scoringAdjustment).toBeNull()
  })
})

/*
 * 🛑 A NO-TRADE LEAGUE GETS NO PACKAGE WHETHER OR NOT A BID COULD BE WORKED OUT. The packages were
 * gated on the bid, so a guillotine league whose bid came back empty offered a trade the manager can
 * never send — and Chimmy's trade-target verdict would have said "yes, trade for him".
 */
describe('a league that does not allow trades', () => {
  it('🛑 gets no package even when no bid can be worked out', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType: 'guillotine', settings: { ...LEAGUE.settings, leagueTypeConfirmation: { type: 'survivor_guillotine' } } })
    // A negative remaining budget is unusable, so the allocator returns nothing and there is no bid.
    mockRosterFindMany.mockResolvedValue([{ ...MY_ROSTER, faabRemaining: -5 }, THEIR_ROSTER])
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.bidInstead).toBeNull()
    expect(state.data.tradesAllowed).toBe(false)
    expect(state.data.packages).toEqual([])
    expect(state.data.recommended).toBeNull()
    expect(state.data.grade.available).toBe(false)
  })

  it('[control] an ordinary league says trades are allowed', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.tradesAllowed).toBe(true)
    expect(state.data.recommended).not.toBeNull()
  })
})

describe('the target carries what a dynasty call needs', () => {
  it('his 30-day trend comes from the feed and his age from the player row', async () => {
    const kincaid = (VALUES.bySleeperId as Record<string, Record<string, unknown>>)[KINCAID]
    mockGetMarketValues.mockResolvedValue({
      ...VALUES,
      bySleeperId: { ...VALUES.bySleeperId, [KINCAID]: { ...kincaid, trend30Day: 212 } },
    })
    mockSportsPlayerFindMany.mockResolvedValue(PLAYERS.map((p) => ({ ...p, age: p.sleeperId === KINCAID ? 25 : null })))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.target.trend30Day).toBe(212)
    expect(state.data.target.age).toBe(25)
  })

  it('without them, both are null — never zero', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.target.trend30Day).toBeNull()
    expect(state.data.target.age).toBeNull()
  })
})

/*
 * 🛑 A FOREIGN LEAGUE'S ROSTER IDS COLLIDE WITH REAL SLEEPER IDS. A Fleaflicker roster holding
 * '10236' does not hold Sleeper's Dalton Kincaid — reading it raw named the wrong holder, told the
 * caller "he is already on your roster", and priced packages out of strangers. The roster rows carry
 * the league's platform (the relation `readLeagueTradeRows` selects).
 */
describe('foreign roster ids never reach a Sleeper-id read', () => {
  const onPlatform = (platform: string, ...rows: Array<Record<string, unknown>>) =>
    rows.map((r) => ({ ...r, league: { platform } }))

  it('[control] the same rows in a Sleeper league find the holder and name the players', async () => {
    mockRosterFindMany.mockResolvedValue(onPlatform('sleeper', MY_ROSTER, THEIR_ROSTER))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.partner.teamName).toBe("Tasha's Titans")
    expect(state.data.target.name).toBe('Dalton Kincaid')
  })

  it('a Fleaflicker league does not name a holder for a colliding id, nor price anyone', async () => {
    mockRosterFindMany.mockResolvedValue(onPlatform('fleaflicker', MY_ROSTER, THEIR_ROSTER))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(false)
    expect(JSON.stringify(state)).not.toContain('Tasha')
    expect(mockSportsPlayerFindMany).not.toHaveBeenCalled()
  })

  it('a Fleaflicker roster holding a colliding id is not called "already on your roster"', async () => {
    const mine = { ...MY_ROSTER, playerData: { players: [...MY_ROSTER.playerData.players, KINCAID], starters: [] } }
    mockRosterFindMany.mockResolvedValue(onPlatform('fleaflicker', mine, THEIR_ROSTER))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(false)
    if (state.available) return
    expect(state.reason).not.toContain('already on your roster')
  })

  it('a Fleaflicker league says it cannot tell who holds him — never "claim him"', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'fleaflicker' })
    mockRosterFindMany.mockResolvedValue(onPlatform('fleaflicker', MY_ROSTER, THEIR_ROSTER))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(false)
    if (state.available) return
    expect(state.reason).not.toMatch(/claim him/)
    expect(state.reason).toMatch(/can't tell who holds him/)
  })
})

/*
 * 🛑 WHETHER A LEAGUE TRADES IS THE CONCEPT CATALOG'S ANSWER (`lib/league-rules/tradeLegality.ts`).
 * Until 2026-09-28 this surface refused packages in every guillotine and survivor league. The
 * catalog marks trading LEGAL in both; only survivor-guillotine and tournament forbid it. Production
 * then had 16 leagues refused packages they could send, and 18 tournament leagues offered packages
 * they could not.
 */
describe('trade legality follows the concept catalog', () => {
  it.each([
    ['a plain guillotine league', { leagueType: 'guillotine', settings: { ...LEAGUE.settings, faab_budget: 1000 } }],
    ['a confirmed guillotine league', { leagueType: 'guillotine', settings: { ...LEAGUE.settings, leagueTypeConfirmation: { type: 'guillotine' } } }],
    ['a survivor league', { leagueType: 'survivor', settings: { ...LEAGUE.settings } }],
  ])('%s trades: packages, and no bid card', async (_name, over) => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, ...over })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.tradesAllowed).toBe(true)
    expect(state.data.bidInstead).toBeNull()
    expect(state.data.packages.length).toBeGreaterThan(0)
    expect(state.data.recommended).not.toBeNull()
  })

  it('🛑 a tournament does not trade: no packages, no bid, and the catalog\'s reason', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType: 'tournament', settings: { ...LEAGUE.settings, leagueTypeConfirmation: { type: 'tournament' } } })
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    if (!state.available) throw new Error('expected available')
    expect(state.data.tradesAllowed).toBe(false)
    expect(state.data.bidInstead).toBeNull()
    expect(state.data.packages).toEqual([])
    expect(state.data.recommended).toBeNull()
    expect(state.data.tradeBan).toMatch(/not rosters that trade/)
  })
})
