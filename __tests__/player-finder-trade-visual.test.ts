import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Trade for him" — the visual's loader. Prisma, the market-value service and
 * the trade engine are mocked at their module boundaries; the package finder
 * and the team-profile builder are the real ones, so a change in how packages
 * are built or banded shows up here.
 */

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockGetMarketValues = vi.hoisted(() => vi.fn())
const mockRunTradeAnalysis = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    leagueTeam: { findMany: mockTeamFindMany },
    roster: { findMany: mockRosterFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
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

vi.mock('@/lib/engine/trade', () => ({ runTradeAnalysis: mockRunTradeAnalysis }))

import { getPlayerTradeVisual, marketContextFor } from '@/lib/core-app/playerTradeVisual'

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
const MY_ROSTER = { platformUserId: 'u-me', playerData: { players: ['qb1', 'rb1', 'rb2', 'rb3', 'rb4', 'wr1', 'wr2', 'te0'], starters: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te0', 'rb3'] } }
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

const ENGINE = {
  verdict: 'accept', verdictConfidence: 'medium',
  fairness: { score: 71, delta: 120, confidence: 'medium', drivers: [], explanations: ['Values within band', 'Fills your TE hole'] },
  lineupImpact: { starterDeltaPts: 2.6, note: 'Kincaid starts over Otton' },
  acceptanceProbability: { base: 0.5, final: 0.62, z: 0, confidence: 'medium', buckets: [], drivers: [] },
}

beforeEach(() => {
  mockLeagueFindUnique.mockReset().mockResolvedValue(LEAGUE)
  mockTeamFindMany.mockReset().mockResolvedValue([TASHA, ME])
  mockRosterFindMany.mockReset().mockResolvedValue([MY_ROSTER, THEIR_ROSTER])
  mockSportsPlayerFindMany.mockReset().mockResolvedValue(PLAYERS)
  mockGetMarketValues.mockReset().mockResolvedValue(VALUES)
  mockRunTradeAnalysis.mockReset().mockResolvedValue(ENGINE)
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
  it('builds a package for him from your surplus, bands it, and grades it through the engine', async () => {
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
    expect(v.grade).toEqual({
      available: true,
      data: {
        verdict: 'accept', verdictConfidence: 'medium', fairnessScore: 71, fairnessDelta: 120,
        starterDeltaPts: 2.6, lineupNote: 'Kincaid starts over Otton', acceptance: 0.62,
        explanations: ['Values within band', 'Fills your TE hole'],
      },
    })
    // The engine was asked about the recommended package, with both rosters for context.
    const req = mockRunTradeAnalysis.mock.calls[0][0]
    expect(req).toMatchObject({ sport: 'NFL', format: 'keeper', leagueId: 'L-gang', numTeams: 2, teamAName: 'Cafe Con Chimmy', teamBName: "Tasha's Titans" })
    expect(req.assetsB).toEqual([{ type: 'player', player: { id: KINCAID, name: 'Dalton Kincaid', pos: 'TE' } }])
    expect(req.rosterA).toHaveLength(8)
    expect(v.values).toMatchObject({ mode: 'redraft', ppr: 0.5, numQbs: 1 })
  })

  it('keeps the package when the engine fails or runs out of time, and says so', async () => {
    mockRunTradeAnalysis.mockRejectedValue(new Error('engine down'))
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(state.data.recommended).not.toBeNull()
    expect(state.data.grade).toEqual({ available: false, reason: 'the trade engine could not grade this package' })
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
    expect(mockRunTradeAnalysis).not.toHaveBeenCalled()
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

  it('and an ordinary league is left EXACTLY alone — no drift on the common case', async () => {
    const state = await getPlayerTradeVisual('L-gang', KINCAID, 'me')
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(state.data.target.value).toBe(3000)
    expect(state.data.values.scoringAdjustment).toBeNull()
  })
})
