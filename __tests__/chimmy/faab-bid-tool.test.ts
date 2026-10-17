import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `get_faab_bid_plan` (2026-09-28). "Should I spend FAAB this week?" was asked live in a guillotine
 * league and Chimmy had no tool for it. Prisma and the market-value FETCH are mocked; the pool
 * builder (`faabPoolFor`, shared with the Player Finder), the allocator and the value lookups are
 * the real ones, so these numbers are the calculator's, not a copy of it.
 *
 * The fixture: four free agents beside my roster. A TE worth 3000 over my weakest TE starter (900)
 * is +2100; a QB worth 9500 over mine (9000) is +500. A WR worth 5000 below my weakest WR starter
 * (6000) and an RB worth 3000 below mine (7500) are NOT upgrades. Supply is 2600, so with $400 left
 * and no schedule the TE gets 2100/2600 of $400 = $323 and the QB 500/2600 = $77.
 */

const h = vi.hoisted(() => ({
  league: vi.fn(), teams: vi.fn(), rosters: vi.fn(), players: vi.fn(), values: vi.fn(), weekly: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    leagueTeam: { findMany: h.teams },
    roster: { findMany: h.rosters },
    sportsPlayer: { findMany: h.players },
    // `resolveCurrentWeekForLeague` reads this; without it the paced path would silently unpace.
    weeklyMatchup: { findFirst: h.weekly, findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/trade-intel/marketValueService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-intel/marketValueService')>('@/lib/trade-intel/marketValueService')
  return { ...actual, getMarketValues: h.values }
})

import { buildFaabBidContext, computeFaabBidPlan } from '@/lib/chimmy/tools/faabBidTool'
import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'
import { faabCardFromPlan, faabPlanVerdict } from '@/lib/chimmy/answerPolishBuild'

const LEAGUE = {
  id: 'L1', name: 'Test League', platform: 'sleeper', platformLeagueId: '999', season: 2026,
  leagueType: 'guillotine', settings: { faab_budget: 1000, scoring_settings: { rec: 1 } },
}
const ME = { externalId: '2', platformUserId: 'u-me', claimedByUserId: 'me', ownerName: 'me', teamName: 'Mine', wins: 1, losses: 1, ties: 0, pointsFor: 200 }
const OTHER = { externalId: '1', platformUserId: 'u-x', claimedByUserId: null, ownerName: 'x', teamName: 'Theirs', wins: 1, losses: 1, ties: 0, pointsFor: 190 }
const MY_ROSTER = { platformUserId: 'u-me', faabRemaining: 400, playerData: { players: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te0'], starters: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te0'] } }
const OTHER_ROSTER = { platformUserId: 'u-x', faabRemaining: 900, playerData: { players: ['qb2'], starters: ['qb2'] } }

const ROWS: Array<[string, string, string, number]> = [
  ['qb1', 'My QB', 'QB', 9000], ['rb1', 'My RB1', 'RB', 8000], ['rb2', 'My RB2', 'RB', 7500], ['wr1', 'My WR1', 'WR', 8200], ['wr2', 'My WR2', 'WR', 6000], ['te0', 'My TE', 'TE', 900],
  ['qb2', 'Their QB', 'QB', 7000],
  ['fa-te', 'Free TE', 'TE', 3000], ['fa-qb', 'Free QB', 'QB', 9500], ['fa-wr', 'Free WR', 'WR', 5000], ['fa-rb', 'Free RB', 'RB', 3000],
]
const VALUES = {
  version: 1, fetchedAt: '2026-09-28T12:00:00Z', source: 'fantasycalc', mode: 'redraft', bestBallNote: null, numQbs: 1, numTeams: 12, ppr: 1,
  bySleeperId: Object.fromEntries(ROWS.map(([id, name, position, value]) => [id, { name, sleeperId: id, position, value, overallRank: null, trend30Day: null }])),
  pickBySlot: {}, pickByRound: {}, faab: { anchorRank: 150, anchorValue: 189, formula: '' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue(LEAGUE)
  h.teams.mockResolvedValue([OTHER, ME])
  h.rosters.mockResolvedValue([MY_ROSTER, OTHER_ROSTER])
  h.players.mockResolvedValue(ROWS.map(([sleeperId, name, position]) => ({ sleeperId, name, position })))
  h.values.mockResolvedValue(VALUES)
  h.weekly.mockResolvedValue(null)
})

describe('get_faab_bid_plan', () => {
  it('in a guillotine league, splits the remaining budget across the real upgrades only', async () => {
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain('The user has $400 FAAB left of a $1000 season budget.')
    expect(text).toContain('- Free TE (TE): bid up to $323')
    expect(text).toContain('- Free QB (QB): bid up to $77')
    // The non-upgrades are named as "bid nothing", never given a dollar figure.
    expect(text).not.toMatch(/Free WR|Free RB/)
    expect(text).toContain('2 other valued unrostered players would not improve the lineup: bid nothing on them.')
    // A player on another roster is not in the pool.
    expect(text).not.toContain('Their QB')
    expect(text).toContain('Unrostered is not the same as claimable')
  })

  it('paces against a PUBLISHED elimination schedule: week 11 of Survivor All-Stars is a quarter of the budget', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, platformLeagueId: '1387654855463534592' })
    h.weekly.mockResolvedValue({ seasonYear: 2026, week: 11 })
    const text = await buildFaabBidContext('L1', 'me')
    // $400 over about 4.0 expected weeks is $100 this week; the TE is 2100/2600 of it.
    expect(text).toContain('- Free TE (TE): bid up to $81')
    expect(text).toMatch(/about 4\.0 more weeks/)
  })

  it('in an ordinary league, ranks the upgrades and refuses dollar amounts, saying why', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, leagueType: 'redraft' })
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain('This is not an elimination league, so NO dollar amounts')
    expect(text).toContain('- Free TE (TE): adds 2100 value')
    expect(text).not.toMatch(/bid up to \$/)
  })

  it('with no remaining FAAB on file, gives shares and never dollars', async () => {
    h.rosters.mockResolvedValue([{ ...MY_ROSTER, faabRemaining: null }, OTHER_ROSTER])
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain('remaining FAAB is NOT on file')
    expect(text).not.toMatch(/bid up to \$/)
    expect(text).toContain("- Free TE (TE): 81% of this week's share")
  })

  it('says to save the budget when nobody improves the lineup', async () => {
    const onlyDowngrades = { ...VALUES, bySleeperId: Object.fromEntries(Object.entries(VALUES.bySleeperId).filter(([id]) => !['fa-te', 'fa-qb'].includes(id))) }
    h.values.mockResolvedValue(onlyDowngrades)
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain('do not spend FAAB this week; save it.')
  })

  it('refuses plainly when the user holds no team in the league', async () => {
    h.teams.mockResolvedValue([OTHER])
    h.rosters.mockResolvedValue([OTHER_ROSTER])
    expect(await buildFaabBidContext('L1', 'someone-else')).toContain('no claimed team in this league')
  })

  it('refuses when no values are loaded, rather than pricing at zero', async () => {
    h.values.mockResolvedValue(null)
    expect(await buildFaabBidContext('L1', 'me')).toContain('no player values are loaded')
  })

  /*
   * The league's real slots (2026-09-28 live miss). FLEX ×4 + SUPER_FLEX over this roster starts
   * My QB (SUPER_FLEX), My WR1, My RB1, My RB2, My WR2 — My TE (900) sits. So the free TE that was
   * "+2100 over your weakest TE starter" under the fixed table cannot crack the lineup at all, and
   * the only upgrade is the free QB, who replaces My QB in the one seat a QB may take.
   */
  it('measures upgrades against the league\'s real slots, naming who leaves the lineup', async () => {
    h.league.mockResolvedValue({
      ...LEAGUE,
      settings: { ...LEAGUE.settings, roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'] },
    })
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain("under this league's slots (FLEX ×4, SUPER_FLEX)")
    expect(text).toContain('- Free QB (QB): bid up to $400; would start in place of My QB, raising the best lineup\'s value by 500')
    expect(text).not.toContain('Free TE')
    expect(text).toContain('3 other valued unrostered players would not improve the lineup')
  })

  it('says when the slots are missing and the standard lineup was assumed', async () => {
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain("This league's starting slots are NOT on file")
    expect(text).toContain("- Free TE (TE): bid up to $323; adds 2100 value over the user's weakest TE starter (assumed lineup)")
  })

  it('paces a plain guillotine with no published schedule at one chop a week from the teams alive', async () => {
    // 14 more live teams (one player each, none valued) and 2 chopped ones (no players): 16 alive.
    const live = Array.from({ length: 14 }, (_, i) => ({ platformUserId: `u-${i}`, faabRemaining: 200, playerData: { players: [`x${i}`], starters: [`x${i}`] } }))
    const chopped = [0, 1].map((i) => ({ platformUserId: `c-${i}`, faabRemaining: 200, playerData: { players: [], starters: [] } }))
    h.rosters.mockResolvedValue([MY_ROSTER, OTHER_ROSTER, ...live, ...chopped])
    const text = await buildFaabBidContext('L1', 'me')
    expect(text).toContain('16 teams still alive and no published schedule, so one chop a week is assumed: about 8.4 more weeks')
    // $400 over 135/16 weeks is $47.41 this week; the TE is 2100/2600 of it and the QB 500/2600.
    expect(text).toContain('- Free TE (TE): bid up to $38')
    expect(text).toContain('- Free QB (QB): bid up to $9')
  })

  it('is reachable from the tool loop, and needs a league in scope', async () => {
    const text = await executeChimmyTool('get_faab_bid_plan', {}, { leagueId: 'L1', userId: 'me' } as never)
    expect(text).toContain('- Free TE (TE): bid up to $323')
    const noLeague = await executeChimmyTool('get_faab_bid_plan', {}, { leagueId: null, userId: 'me' } as never)
    expect(noLeague).not.toContain('FAAB BID PLAN')
  })
})

/*
 * The plan as DATA, for the chat's bid card and the chop-release alert. The text above is a pure
 * rendering of it, so these are the same numbers the model is given.
 */
describe('computeFaabBidPlan', () => {
  it('returns every upgrade with its ceiling, share and effect, best first', async () => {
    const plan = await computeFaabBidPlan('L1', 'me')
    expect(plan).toMatchObject({ status: 'ok', outcome: 'bid', elimination: true, remaining: 400, seasonBudget: 1000, seatsLabel: null, nonUpgrades: 2 })
    if (plan.status !== 'ok') throw new Error('expected a plan')
    expect(plan.upgrades.map((b) => [b.name, b.ceiling, b.marginalValue])).toEqual([['Free TE', 323, 2100], ['Free QB', 77, 500]])
    expect(plan.upgrades[0].shareOfSupply).toBeCloseTo(2100 / 2600, 6)
  })

  it('names who leaves the lineup when the slots are real, and gives no ceiling outside an elimination league', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, leagueType: 'redraft', settings: { ...LEAGUE.settings, roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN'] } })
    const plan = await computeFaabBidPlan('L1', 'me')
    if (plan.status !== 'ok') throw new Error('expected a plan')
    expect(plan.outcome).toBe('rank')
    expect(plan.upgrades).toEqual([expect.objectContaining({ name: 'Free QB', ceiling: null, displacedName: 'My QB', marginalValue: 500 })])
  })

  it('says save, and refuses with the same line the model is given', async () => {
    const onlyDowngrades = { ...VALUES, bySleeperId: Object.fromEntries(Object.entries(VALUES.bySleeperId).filter(([id]) => !['fa-te', 'fa-qb'].includes(id))) }
    h.values.mockResolvedValue(onlyDowngrades)
    expect(await computeFaabBidPlan('L1', 'me')).toMatchObject({ status: 'ok', outcome: 'save', upgrades: [] })
    h.values.mockResolvedValue(null)
    expect(await computeFaabBidPlan('L1', 'me')).toEqual({ status: 'refused', line: expect.stringContaining('no player values are loaded') })
  })
})

/*
 * Answer polish (2026-09-28): the chat's bid card and HOLD / BID chip are built from the SAME plan
 * object the model's text was rendered from — computed once, in the tool, handed to the route through
 * the tool context. Real allocator, real pool builder; only Prisma and the value fetch are mocked.
 */
describe('the bid plan reaches the chat as data', () => {
  it('hands the route the plan it rendered, once, and records the run for "Newer answer below"', async () => {
    const ctx: ChimmyToolContext = { leagueId: 'L1', userId: 'me', faabPlans: [], toolRuns: [] }
    const text = await executeChimmyTool('get_faab_bid_plan', {}, ctx)
    expect(text).toBe(await buildFaabBidContext('L1', 'me'))
    expect(ctx.faabPlans).toHaveLength(1)
    expect(ctx.faabPlans![0]).toMatchObject({ leagueId: 'L1', plan: { status: 'ok', outcome: 'bid' } })
    expect(ctx.toolRuns).toEqual([{ tool: 'get_faab_bid_plan', leagueId: 'L1' }])
  })

  it('records nothing when no league is in scope — nothing was computed', async () => {
    const ctx: ChimmyToolContext = { leagueId: null, userId: 'me', faabPlans: [], toolRuns: [] }
    await executeChimmyTool('get_faab_bid_plan', {}, ctx)
    expect(ctx.faabPlans).toEqual([])
    expect(ctx.toolRuns).toEqual([])
  })

  it('renders the card from the plan: dollars, shares, the verified Sleeper waiver screen, and BID', async () => {
    const plan = await computeFaabBidPlan('L1', 'me')
    const card = faabCardFromPlan(plan, 'L1')
    expect(card).toMatchObject({ outcome: 'bid', remaining: 400, seasonBudget: 1000, lineupAssumed: true, nonUpgrades: 2, moreCount: 0 })
    expect(card!.bids.map((b) => [b.name, b.ceiling, b.sharePct])).toEqual([['Free TE', 323, 81], ['Free QB', 77, 19]])
    expect(card!.waiverLink).toEqual({ href: 'https://sleeper.com/leagues/999/players', label: 'Open waivers on Sleeper' })
    expect(faabPlanVerdict(plan)).toEqual({ key: 'bid', source: 'faab_plan', detail: null })
  })

  it('names who is benched when the slots are real, and gives HOLD with an empty card when nobody helps', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, settings: { ...LEAGUE.settings, roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN'] } })
    const real = faabCardFromPlan(await computeFaabBidPlan('L1', 'me'), 'L1')
    expect(real!.bids).toEqual([{ name: 'Free QB', position: 'QB', ceiling: 400, sharePct: 100, displacedName: 'My QB' }])
    expect(real!.lineupAssumed).toBe(false)

    const onlyDowngrades = { ...VALUES, bySleeperId: Object.fromEntries(Object.entries(VALUES.bySleeperId).filter(([id]) => !['fa-te', 'fa-qb'].includes(id))) }
    h.values.mockResolvedValue(onlyDowngrades)
    const save = await computeFaabBidPlan('L1', 'me')
    expect(faabPlanVerdict(save)).toEqual({ key: 'hold', source: 'faab_plan', detail: 'Save your FAAB' })
    expect(faabCardFromPlan(save, 'L1')).toMatchObject({ outcome: 'save', bids: [], pricedCount: 2 })
  })

  it('gives an ordinary league a ranked card with no dollars and no chip', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, leagueType: 'redraft' })
    const plan = await computeFaabBidPlan('L1', 'me')
    expect(faabPlanVerdict(plan)).toBeNull()
    const card = faabCardFromPlan(plan, 'L1')
    expect(card!.outcome).toBe('rank')
    expect(card!.bids.every((b) => b.ceiling == null)).toBe(true)
  })

  it('gives a refusal no card and no chip', async () => {
    h.values.mockResolvedValue(null)
    const plan = await computeFaabBidPlan('L1', 'me')
    expect(faabCardFromPlan(plan, 'L1')).toBeNull()
    expect(faabPlanVerdict(plan)).toBeNull()
  })
})
