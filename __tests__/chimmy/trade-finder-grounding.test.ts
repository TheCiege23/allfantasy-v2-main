import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Find me a trade" across the whole league. Prisma, the market-value fetch and the trade block are
 * mocked at their module boundaries; the partner scorer, the package finder, the team-profile builder
 * and the value lookups are the REAL ones — so a change in how partners are matched or packages are
 * banded shows up here rather than in a hand-written copy.
 */

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  getMarketValues: vi.fn(),
  readTradeBlock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    roster: { findMany: h.rosterFindMany },
    sportsPlayer: { findMany: h.sportsPlayerFindMany },
  },
}))
vi.mock('@/lib/trade-intel/marketValueService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-intel/marketValueService')>('@/lib/trade-intel/marketValueService')
  return { ...actual, getMarketValues: h.getMarketValues }
})
vi.mock('@/lib/trade-block/importedTradeBlock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-block/importedTradeBlock')>('@/lib/trade-block/importedTradeBlock')
  return { ...actual, readTradeBlock: h.readTradeBlock }
})
vi.mock('@/lib/engine/trade', () => ({ runTradeAnalysis: vi.fn() }))

import {
  buildTradeFinder,
  readTradeFinderPosition,
  renderTradeFinderBlock,
  MAX_TRADE_IDEAS,
} from '@/lib/chimmy/tradeFinderGrounding'

const LEAGUE = {
  id: 'L1',
  name: 'Gridiron Gang',
  platform: 'sleeper',
  platformLeagueId: '999',
  sport: 'NFL',
  season: 2026,
  leagueType: 'redraft',
  settings: { scoring_settings: { rec: 0.5 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'] },
}

const team = (platformUserId: string, teamName: string, ownerName: string, claimedByUserId: string | null, wins: number) => ({
  externalId: platformUserId,
  platformUserId,
  claimedByUserId,
  ownerName,
  teamName,
  wins,
  losses: 5 - wins,
  ties: 0,
  pointsFor: 600 + wins * 20,
})

/*
 * Me: three running backs (depth) and no tight end (a hole).
 * Tasha: one running back (a hole) and two tight ends (depth) — the complementary partner.
 * Bo: a spare quarterback and one tight end — can deal, but fits less.
 */
const ME = team('u-me', 'Cafe Con Chimmy', 'guap', 'me', 3)
const TASHA = team('u-tasha', "Tasha's Titans", 'tashaR', null, 2)
const BO = team('u-bo', 'Bo Knows', 'bo', null, 4)

const roster = (platformUserId: string, players: string[]) => ({ platformUserId, faabRemaining: 100, playerData: { players, starters: [] } })
const ROSTERS = [
  roster('u-me', ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2']),
  roster('u-tasha', ['qb2', 'rb5', 'wr3', 'wr4', 'te1', 'te2']),
  roster('u-bo', ['qb3', 'qb4', 'rb6', 'rb7', 'wr5', 'wr6', 'te3']),
  /* A native league's unclaimed seat. Nobody to trade with. */
  roster('open-slot-4', ['rb9', 'te9']),
]

const P: Array<[string, string, string, number]> = [
  ['qb1', 'Josh Allen', 'QB', 9000], ['rb1', 'Bijan Robinson', 'RB', 8000], ['rb2', 'Jahmyr Gibbs', 'RB', 7500],
  ['rb3', 'Tony Pollard', 'RB', 3100], ['wr1', 'Puka Nacua', 'WR', 8200], ['wr2', 'Nico Collins', 'WR', 6000],
  ['qb2', 'Jared Goff', 'QB', 4000], ['rb5', 'Kenneth Walker', 'RB', 5000], ['wr3', 'Rome Odunze', 'WR', 4300],
  ['wr4', 'DJ Moore', 'WR', 3800], ['te1', 'Sam LaPorta', 'TE', 6500], ['te2', 'Jake Ferguson', 'TE', 3000],
  ['qb3', 'Jordan Love', 'QB', 5000], ['qb4', 'Justin Fields', 'QB', 3200], ['rb6', 'James Cook', 'RB', 5200],
  ['rb7', 'Aaron Jones', 'RB', 4800], ['wr5', 'Zay Flowers', 'WR', 4000], ['wr6', 'Jordan Addison', 'WR', 3900],
  ['te3', 'Dalton Kincaid', 'TE', 3050], ['rb9', 'Zack Moss', 'RB', 2000], ['te9', 'Cole Kmet', 'TE', 1500],
]
const PLAYERS = P.map(([sleeperId, name, position]) => ({ sleeperId, name, position, age: 26 }))
const VALUES = {
  version: 1, fetchedAt: '2026-09-24T12:00:00Z', source: 'fantasycalc', mode: 'redraft', bestBallNote: null, numQbs: 1, numTeams: 12, ppr: 0.5,
  bySleeperId: Object.fromEntries(
    P.map(([id, name, position, value]) => [id, { name, sleeperId: id, position, value, overallRank: null, trend30Day: null }]),
  ),
  byPick: {},
}

beforeEach(() => {
  h.leagueFindUnique.mockReset().mockResolvedValue(LEAGUE)
  h.teamFindMany.mockReset().mockResolvedValue([ME, TASHA, BO])
  h.rosterFindMany.mockReset().mockResolvedValue(ROSTERS)
  h.sportsPlayerFindMany.mockReset().mockResolvedValue(PLAYERS)
  h.getMarketValues.mockReset().mockResolvedValue(VALUES)
  h.readTradeBlock.mockReset().mockResolvedValue({ support: { supported: true }, listings: [] })
})

const find = (extra: { position?: 'QB' | 'RB' | 'WR' | 'TE' | null; tradeAway?: string | null } = {}) =>
  buildTradeFinder({ leagueId: 'L1', userId: 'me', ...extra })

describe('buildTradeFinder', () => {
  it('leads with the partner whose needs and depth complement yours, and prices the offer both ways', async () => {
    const r = await find()
    expect(r.status).toBe('ready')
    if (r.status !== 'ready') return
    expect(r.you).toMatchObject({ teamName: 'Cafe Con Chimmy', needs: ['TE'], surpluses: ['RB'] })
    const first = r.ideas[0]!
    expect(first.partnerTeam).toBe("Tasha's Titans")
    expect(first.give.map((a) => a.name)).toEqual(['Tony Pollard'])
    expect(first.get.map((a) => a.name)).toEqual(['Jake Ferguson'])
    expect(first).toMatchObject({ giveTotal: 3100, getTotal: 3000, fairness: 'balanced', fillsNeed: true, sendable: true })
    expect(first.why).toEqual(expect.arrayContaining(['You have surplus RB they need', 'They have TE you need']))
  })

  it('offers at most one idea per partner, never the unclaimed seat, never more than three', async () => {
    const r = await find()
    if (r.status !== 'ready') throw new Error(r.reason)
    const partners = r.ideas.map((i) => i.partnerTeam)
    expect(new Set(partners).size).toBe(partners.length)
    expect(partners).not.toContain('Another manager')
    expect(r.ideas.length).toBeLessThanOrEqual(MAX_TRADE_IDEAS)
    for (const idea of r.ideas) for (const a of [...idea.give, ...idea.get]) expect(['Zack Moss', 'Cole Kmet']).not.toContain(a.name)
  })

  it('answers a position ask with that position coming back in every idea', async () => {
    const r = await find({ position: 'QB' })
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.ideas.length).toBeGreaterThan(0)
    for (const idea of r.ideas) expect(idea.get.some((a) => a.position === 'QB')).toBe(true)
    expect(r.asked.position).toBe('QB')
  })

  it('shops one named player: every idea gives him and only him', async () => {
    const r = await find({ tradeAway: 'jahmyr gibbs' })
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.asked.tradeAway).toBe('Jahmyr Gibbs')
    expect(r.ideas.length).toBeGreaterThan(0)
    for (const idea of r.ideas) expect(idea.give.map((a) => a.name)).toEqual(['Jahmyr Gibbs'])
  })

  it('refuses to shop a player who is not on your roster rather than picking someone else', async () => {
    const r = await find({ tradeAway: 'Sam LaPorta' })
    expect(r).toEqual({ status: 'unavailable', reason: '"Sam LaPorta" is not on your roster in this league' })
  })

  it('marks a player his manager has listed on the trade block, and says so in the reasons', async () => {
    h.readTradeBlock.mockResolvedValue({
      support: { supported: true },
      listings: [{ sleeperId: 'te2', playerName: 'Jake Ferguson', position: 'TE', nflTeam: 'DAL', rosterId: 2, teamName: "Tasha's Titans", ownerName: 'tashaR', since: '2026-09-20' }],
    })
    const r = await find()
    if (r.status !== 'ready') throw new Error(r.reason)
    const tasha = r.ideas.find((i) => i.partnerTeam === "Tasha's Titans")!
    expect(tasha.get[0]).toMatchObject({ name: 'Jake Ferguson', onTradeBlock: true })
    expect(tasha.why.some((w) => /trade block/i.test(w))).toBe(true)
  })

  it('still finds trades when the trade block cannot be read', async () => {
    h.readTradeBlock.mockRejectedValue(new Error('down'))
    const r = await find()
    expect(r.status).toBe('ready')
  })

  it('says why there is nothing when you have no depth to deal from', async () => {
    h.rosterFindMany.mockResolvedValue([roster('u-me', ['qb1', 'rb1', 'rb2', 'wr1', 'wr2']), ROSTERS[1], ROSTERS[2]])
    const r = await find()
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.ideas).toEqual([])
    expect(r.noIdeasReason).toMatch(/no depth beyond your starters/)
  })

  it('refuses outside the NFL, where no market values exist to price a package', async () => {
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, sport: 'NBA' })
    const r = await find()
    expect(r.status).toBe('unavailable')
    if (r.status === 'unavailable') expect(r.reason).toMatch(/NFL leagues for now.*NBA/)
    expect(h.rosterFindMany).not.toHaveBeenCalled()
  })

  it('offers nothing in a league that does not allow trades', async () => {
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType: 'guillotine' })
    expect(await find()).toEqual({ status: 'unavailable', reason: 'this league does not allow trades' })
  })

  it('needs a claimed team to trade from', async () => {
    h.teamFindMany.mockResolvedValue([{ ...ME, claimedByUserId: null }, TASHA, BO])
    h.rosterFindMany.mockResolvedValue(ROSTERS.slice(1))
    expect(await find()).toEqual({ status: 'unavailable', reason: 'you need a claimed team in this league to trade from' })
  })

  it('does not guess prices when no market values are loaded', async () => {
    h.getMarketValues.mockResolvedValue(null)
    const r = await find()
    expect(r.status).toBe('unavailable')
  })
})

describe('renderTradeFinderBlock', () => {
  it('writes out every name and number the model may use, and forbids calling an idea a win', async () => {
    const block = renderTradeFinderBlock(await find())
    expect(block).toContain('TRADE IDEAS — Gridiron Gang')
    expect(block).toContain("1. With Tasha's Titans (tashaR)")
    expect(block).toContain('You give: Tony Pollard (RB, 3,100)')
    expect(block).toContain('You get: Jake Ferguson (TE, 3,000)')
    expect(block).toContain('Value: you give 3,100, you get 3,000 — balanced')
    expect(block).toContain('Thin at: TE. Depth to deal from: RB.')
    expect(block).toMatch(/offer to grade one with evaluate_trade/)
  })

  it('turns a refusal into a sentence that forbids trades from general knowledge', () => {
    expect(renderTradeFinderBlock({ status: 'unavailable', reason: 'this league does not allow trades' })).toMatch(
      /^TRADE IDEAS: none — this league does not allow trades\. .*Do not suggest trades from general knowledge\.$/,
    )
  })
})

describe('readTradeFinderPosition', () => {
  it('reads the four positions in any spelling and rejects the rest', () => {
    expect(readTradeFinderPosition('rb')).toBe('RB')
    expect(readTradeFinderPosition('Running Backs')).toBe('RB')
    expect(readTradeFinderPosition('wide receiver')).toBe('WR')
    expect(readTradeFinderPosition('TEs')).toBe('TE')
    expect(readTradeFinderPosition('kicker')).toBeNull()
    expect(readTradeFinderPosition(3)).toBeNull()
  })
})
