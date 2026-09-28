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

import { buildFaabBidContext } from '@/lib/chimmy/tools/faabBidTool'
import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

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

  it('is reachable from the tool loop, and needs a league in scope', async () => {
    const text = await executeChimmyTool('get_faab_bid_plan', {}, { leagueId: 'L1', userId: 'me' } as never)
    expect(text).toContain('- Free TE (TE): bid up to $323')
    const noLeague = await executeChimmyTool('get_faab_bid_plan', {}, { leagueId: null, userId: 'me' } as never)
    expect(noLeague).not.toContain('FAAB BID PLAN')
  })
})
