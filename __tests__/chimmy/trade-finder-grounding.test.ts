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
  createGrader: vi.fn(),
  gradeDeal: vi.fn(),
  gradeValue: { fn: null as null | ((id: string) => number | null), pick: null as null | ((year: number, round: number) => number | null) },
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
/*
 * 2026-11-26: every value and band said is THE grade's. The grader is mocked at its module boundary
 * and, by default, prices each asset at the fixture's chart value (`h.gradeValue`), so the ranking
 * below is the same one a real grade on these values would give. Tests that need the grade and the
 * market chart to DISAGREE override `h.gradeValue`.
 */
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => h.createGrader(...a),
  gradeDeal: (...a: unknown[]) => h.gradeDeal(...a),
}))

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
  h.gradeValue.fn = (id) => VALUES.bySleeperId[id as keyof typeof VALUES.bySleeperId]?.value ?? null
  h.gradeValue.pick = () => null
  h.createGrader.mockReset().mockResolvedValue({ leagueId: 'L1' })
  h.gradeDeal.mockReset().mockImplementation(async (grader: unknown, args: { give: { assets: Array<{ playerId?: string; name?: string }> }; get: { assets: Array<{ playerId?: string; name?: string }> } }) => {
    if (!grader) return { graded: false, reason: 'This league’s values could not be loaded just now.', basis: null }
    const price = (a: { playerId?: string; kind?: string; year?: number; round?: number }) =>
      a.kind === 'pick' ? h.gradeValue.pick!(a.year!, a.round!) : a.playerId ? h.gradeValue.fn!(a.playerId) : null
    const all = [...args.give.assets, ...args.get.assets]
    if (all.some((a) => price(a) == null)) return { graded: false, reason: '1 asset has no value on this league’s chart.', basis: null }
    const giveValue = args.give.assets.reduce((t, a) => t + price(a)!, 0)
    const getValue = args.get.assets.reduce((t, a) => t + price(a)!, 0)
    const lines = [
      ...args.give.assets.map((a) => ({ side: 'give', name: a.name ?? '', marketValue: price(a), leagueValue: price(a) })),
      ...args.get.assets.map((a) => ({ side: 'get', name: a.name ?? '', marketValue: price(a), leagueValue: price(a) })),
    ]
    const percentDiff = ((getValue - giveValue) / Math.max(giveValue, getValue, 1)) * 100
    const letter = Math.abs(percentDiff) <= 8 ? 'C' : percentDiff > 0 ? 'B' : 'D'
    return { graded: true, letter, partnerLetter: letter === 'B' ? 'D' : letter === 'D' ? 'B' : 'C', percentDiff, label: `graded ${letter}`, giveValue, getValue, lines }
  })
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
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType: 'tournament' })
    expect(await find()).toEqual({ status: 'unavailable', reason: 'this league does not allow trades' })
  })

  it.each(['survivor', 'guillotine'])('a %s league trades, so it is not refused as a no-trade league', async (leagueType) => {
    h.leagueFindUnique.mockResolvedValue({ ...LEAGUE, leagueType })
    expect(await find()).not.toEqual({ status: 'unavailable', reason: 'this league does not allow trades' })
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

/*
 * "find me 3 win now trades using my draft picks and a lesser player" (owner's Versuz league,
 * 2026-10-31) came back as dynasty-value player swaps with no pick, each a step down THIS season.
 * Here the league is dynasty: the finder prices on the dynasty chart, and a win-now ask also reads
 * the redraft chart (NOW below; a player it omits is worth the same on both).
 */
describe('buildTradeFinder — win now and draft picks', () => {
  const DYNASTY_LEAGUE = { ...LEAGUE, leagueType: 'dynasty' }
  const NOW: Record<string, number> = { rb3: 2000, te2: 1500, rb7: 5500, wr4: 5200, te3: 2500, rb5: 4600 }
  const chart = (mode: 'dynasty' | 'redraft') => ({
    ...VALUES,
    mode,
    bySleeperId: Object.fromEntries(
      P.map(([id, name, position, value]) => [
        id,
        { name, sleeperId: id, position, value: mode === 'redraft' ? (NOW[id] ?? value) : value, overallRank: null, trend30Day: null },
      ]),
    ),
    pickBySlot: {},
    pickByRound: mode === 'dynasty' ? { '2026:1': 9999, '2027:1': 2500, '2027:2': 1200, '2027:3': 600, '2028:1': 2400, '2028:2': 1100, '2029:1': 2300 } : {},
  })

  beforeEach(() => {
    h.leagueFindUnique.mockResolvedValue(DYNASTY_LEAGUE)
    h.getMarketValues.mockImplementation(async (ctx: { variant: { dynasty: boolean } }) => chart(ctx.variant.dynasty ? 'dynasty' : 'redraft'))
    h.gradeValue.pick = (year, round) => (chart('dynasty').pickByRound as Record<string, number>)[`${year}:${round}`] ?? null
  })

  it('a win-now ask returns only packages that raise this season’s value, never the dynasty-only swap', async () => {
    const r = await buildTradeFinder({ leagueId: 'L1', userId: 'me', goal: 'win_now' })
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.ideas.length).toBeGreaterThan(0)
    for (const idea of r.ideas) {
      expect(idea.nowGet!).toBeGreaterThan(idea.nowGive!)
      expect(idea.fairness).not.toBe('lopsided')
    }
    expect(r.asked).toMatchObject({ goal: 'win_now', picks: false })
  })

  /*
   * The case that pins the filter: shopping Bijan (8,000 both charts) for win now. LaPorta is 6,500 —
   * inside the fairness band, so the dynasty search would offer him — and a step down this season.
   * Nothing in the league beats Bijan this season, so the honest answer is none. (Verified red with
   * the `nowGain <= 0` filter removed; the test above stays green without it, because ranking alone
   * keeps upgrades on top there.)
   */
  it('never offers a current-season downgrade, and says so when nothing is an upgrade', async () => {
    const r = await buildTradeFinder({ leagueId: 'L1', userId: 'me', goal: 'win_now', tradeAway: 'Bijan Robinson' })
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.ideas).toEqual([])
    expect(r.noIdeasReason).toMatch(/raise your current-season value/)
  })

  it('with picks offered, adds one of the user’s next two seasons of picks and says ownership is assumed', async () => {
    const r = await buildTradeFinder({ leagueId: 'L1', userId: 'me', goal: 'win_now', includePicks: true })
    if (r.status !== 'ready') throw new Error(r.reason)
    const picks = r.ideas.flatMap((i) => i.give.filter((a) => a.position === 'PICK'))
    expect(picks.length).toBeGreaterThan(0)
    // 2026 is this season's (already drafted) and 2029 is past the two-season horizon.
    for (const p of picks) expect(p.name).toMatch(/^(2027|2028) (1st|2nd|3rd)$/)
    expect(r.pickNote).toMatch(/assumes you still own that pick/)
    for (const idea of r.ideas) expect(idea.giveTotal).toBe(idea.give.reduce((s, a) => s + (a.value ?? 0), 0))
  })

  it('says picks cannot be priced in a league with no pick market, and still answers with players', async () => {
    h.leagueFindUnique.mockResolvedValue(LEAGUE)
    h.getMarketValues.mockResolvedValue(VALUES)
    const r = await buildTradeFinder({ leagueId: 'L1', userId: 'me', includePicks: true })
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.pickNote).toMatch(/no market price/)
    expect(r.ideas.flatMap((i) => i.give).some((a) => a.position === 'PICK')).toBe(false)
    expect(r.ideas.length).toBeGreaterThan(0)
  })

  it('refuses a win-now search rather than ranking on the dynasty chart when no current-season values load', async () => {
    h.getMarketValues.mockImplementation(async (ctx: { variant: { dynasty: boolean } }) => (ctx.variant.dynasty ? chart('dynasty') : null))
    const r = await buildTradeFinder({ leagueId: 'L1', userId: 'me', goal: 'win_now' })
    expect(r).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/current-season values/) })
  })

  it('tells the model the goal, this season’s values and the pick caveat', async () => {
    const block = renderTradeFinderBlock(await buildTradeFinder({ leagueId: 'L1', userId: 'me', goal: 'win_now', includePicks: true }))
    expect(block).toContain('Asked for: WIN NOW.')
    // 2026-11-26: the redraft chart only FILTERS a win-now search; the numbers said are THE grade's.
    expect(block).not.toMatch(/This season \(redraft chart\)/)
    expect(block).toMatch(/League grade: [A-F] for you, [A-F] for them/)
    expect(block).toMatch(/Draft picks: offered by the user — .*assumes you still own that pick/)
    expect(block).toMatch(/grade that version with evaluate_trade/)
  })
})

describe('buildTradeFinder — every value and band is THE grade’s (2026-11-26)', () => {
  it('grades with ONE grader for the league, from the asker’s side', async () => {
    const r = await find()
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(h.createGrader).toHaveBeenCalledTimes(1)
    expect(h.createGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'me' })
    expect(h.gradeDeal.mock.calls.length).toBeGreaterThan(0)
    for (const [grader, args] of h.gradeDeal.mock.calls) {
      expect(grader).toEqual({ leagueId: 'L1' })
      expect(args.viewerSide).toBe(true)
    }
    for (const idea of r.ideas) expect(idea.grade?.graded).toBe(true)
  })

  it('when THE grade disagrees with the market chart, the grade decides the values, the band and the order', async () => {
    const before = await find()
    if (before.status !== 'ready') throw new Error(before.reason)
    const lead = before.ideas[0]!
    const leadGetId = lead.get[0]!.name
    // The grade prices the lead idea's target at triple the chart — lopsided on the grade only.
    const idOf = Object.fromEntries(P.map(([id, name]) => [name, id]))
    const targetId = idOf[leadGetId]!
    h.gradeValue.fn = (id) => (VALUES.bySleeperId[id as keyof typeof VALUES.bySleeperId]?.value ?? 0) * (id === targetId ? 3 : 1)
    const after = await find()
    if (after.status !== 'ready') throw new Error(after.reason)
    const moved = after.ideas.find((i) => i.get.some((a) => a.name === leadGetId))
    expect(after.ideas[0]!.get[0]!.name).not.toBe(leadGetId)
    if (moved) {
      expect(moved.fairness).toBe('lopsided')
      expect(moved.getTotal).toBe(VALUES.bySleeperId[targetId as keyof typeof VALUES.bySleeperId]!.value * 3)
      expect(moved.sendable).toBe(false)
    }
    const block = renderTradeFinderBlock(after)
    expect(block).toMatch(/League grade: [A-F] for you/)
  })

  it('a withheld grade is said as not graded, with no value or balance quoted', async () => {
    h.gradeDeal.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart.', basis: null })
    const r = await find()
    if (r.status !== 'ready') throw new Error(r.reason)
    expect(r.ideas.length).toBeGreaterThan(0)
    for (const idea of r.ideas) {
      expect(idea).toMatchObject({ giveTotal: null, getTotal: null, fairness: 'low confidence', sendable: false })
      for (const a of [...idea.give, ...idea.get]) expect(a.value).toBeNull()
    }
    const block = renderTradeFinderBlock(r)
    expect(block).toContain('Not graded: 1 asset has no value on this league’s chart. Quote no value or balance for this one.')
    expect(block).not.toMatch(/   Value: you give/)
  })
})
