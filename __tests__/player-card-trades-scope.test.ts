import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * The player card's trade history is scoped to the viewer.
 *
 * 🛑 WHAT THIS PINS: `/api/core/player-card` does not require a session, and the universal card used
 * to call `loadTrades` with no scope at all — so a signed-out request got every trade involving the
 * player across every league we hold, with those leagues' names. Every call now carries a scope,
 * and a signed-out or league-less viewer is refused before any trade row is read.
 */

const tradeFindMany = vi.fn()
const leagueFindMany = vi.fn()
const playerFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTrade: { findMany: (...a: unknown[]) => tradeFindMany(...a) },
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    sportsPlayer: { findMany: (...a: unknown[]) => playerFindMany(...a) },
  },
}))

const gradeRows = vi.fn()
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: (...a: unknown[]) => gradeRows(...a) }))

beforeEach(() => {
  vi.resetModules()
  tradeFindMany.mockReset().mockResolvedValue([])
  leagueFindMany.mockReset().mockResolvedValue([])
  playerFindMany.mockReset().mockResolvedValue([])
  gradeRows.mockReset().mockResolvedValue(new Map())
})

const trade = (transactionId: string, leagueId: string) => ({
  transactionId,
  platform: 'sleeper',
  tradeDate: new Date('2026-09-10T12:00:00Z'),
  playersGiven: ['111'],
  playersReceived: ['6813'],
  picksGiven: [],
  picksReceived: [],
  history: { sleeperLeagueId: leagueId },
})

describe('loadTrades — every read is scoped', () => {
  it('refuses a signed-out viewer without reading any trade', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { viewerLeagueIds: null })
    expect(out.available).toBe(false)
    expect(out.available === false && out.reason).toMatch(/sign in/i)
    expect(tradeFindMany).not.toHaveBeenCalled()
    expect(leagueFindMany).not.toHaveBeenCalled()
  })

  it('refuses a malformed scope the same way, never falling through to a query', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', {} as never)
    expect(out.available).toBe(false)
    expect(tradeFindMany).not.toHaveBeenCalled()
  })

  it('refuses a signed-in viewer with no leagues without reading any trade', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { viewerLeagueIds: [] })
    expect(out.available).toBe(false)
    expect(out.available === false && out.reason).not.toMatch(/sign in/i)
    expect(tradeFindMany).not.toHaveBeenCalled()
  })

  it("reads only the viewer's leagues", async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    leagueFindMany.mockResolvedValue([{ platformLeagueId: 'L1', name: 'My League' }])
    const { loadTrades } = await import('@/lib/core-app/playerCard')

    const out = await loadTrades('6813', { viewerLeagueIds: ['L1', 'L2'] })

    expect(tradeFindMany).toHaveBeenCalledTimes(1)
    const where = tradeFindMany.mock.calls[0][0].where
    expect(where.history).toEqual({ sleeperLeagueId: { in: ['L1', 'L2'] } })
    expect(out.available).toBe(true)
    expect(out.available && out.data.map((t) => t.leagueName)).toEqual(['My League'])
  })

  it('reads only the one league when the route has checked it', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    await loadTrades('6813', { leagueId: 'L9' })
    const where = tradeFindMany.mock.calls[0][0].where
    expect(where.history).toEqual({ sleeperLeagueId: 'L9' })
  })

  /*
   * 🛑 A FOREIGN LEAGUE'S TRADE IDS COLLIDE WITH REAL SLEEPER IDS. `persistTradesForSeason` writes
   * Fleaflicker/MFL/Yahoo trades into `LeagueTrade` with the provider's own ids, so a Fleaflicker
   * trade of its '6813' matched Sleeper's 6813 by `array_contains`, and its other ids were named via
   * the Sleeper-id name read. The same trade on a Sleeper row is the control.
   */
  it('[control] a Sleeper trade holding the id is listed and its players named', async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    playerFindMany.mockResolvedValue([{ sleeperId: '6813', name: 'Real Man' }, { sleeperId: '111', name: 'Wrong Player' }])
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { leagueId: 'L1' })
    expect(out.available && out.data[0]!.sent).toEqual(['Wrong Player'])
  })

  it('🛑 a Fleaflicker trade holding a colliding id is not shown, and names no stranger', async () => {
    tradeFindMany.mockResolvedValue([{ ...trade('t1', 'L1'), platform: 'fleaflicker' }])
    playerFindMany.mockResolvedValue([{ sleeperId: '6813', name: 'Real Man' }, { sleeperId: '111', name: 'Wrong Player' }])
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { leagueId: 'L1' })
    expect(out.available).toBe(false)
    expect(JSON.stringify(out)).not.toContain('Wrong Player')
  })

  it('has no call site without a scope object', () => {
    const src = readFileSync(resolve(__dirname, '../lib/core-app/playerCard.ts'), 'utf8')
    const calls = [...src.matchAll(/loadTrades\(([^)]*)\)/g)]
      .map((m) => m[1])
      .filter((args) => !args.includes('TradeScope')) // the definition itself
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const args of calls) expect(args, `loadTrades(${args}) must pass a scope object`).toMatch(/,\s*\{/)
    // The universal card resolves the viewer's own leagues first.
    expect(src).toMatch(/memberLeaguePlatformIdsFor\(req\.userId[^)]*\)[\s\S]{0,120}loadTrades\(player\.sleeperId, \{ viewerLeagueIds[,\s}]/)
  })
})

/*
 * 🛑 THE GRADE ON THE CARD (2026-09-27). The card listed who got whom and never said whether it was
 * a good deal. Each trade now carries THE grade — from `archivedTradeGrade.ts`, the same function
 * as the /core Trades list — oriented to the side that ACQUIRED the player, on an AF row the viewer
 * is entitled to.
 */
describe('loadTrades — the grade', () => {
  /* THE grade from the ROW's side: the row received 6813 and gave 111, and came out ahead. */
  const ROW_GRADE = { graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 20, label: 'Slightly favors you', sideAdvantage: 'you',
    action: 'accept', recommendation: 'x', giveValue: 4000, getValue: 5000, giveMarket: 4000, getMarket: 5000,
    basis: 'b', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [] }

  it('grades on the VIEWER’s own AF row, by the same four membership paths, from the side that got him', async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    leagueFindMany.mockImplementation(async (args: { where: { OR?: unknown } }) =>
      args.where.OR ? [{ id: 'af-mine', platformLeagueId: 'L1' }] : [{ platformLeagueId: 'L1', name: 'My League' }])
    gradeRows.mockResolvedValue(new Map([['t1', { grade: ROW_GRADE, picksIn: [], picksOut: [] }]]))
    const { loadTrades } = await import('@/lib/core-app/playerCard')

    const out = await loadTrades('6813', { viewerLeagueIds: ['L1'], viewerUserId: 'u1' })

    const own = leagueFindMany.mock.calls.map((c) => c[0]).find((a) => a.where.OR)
    expect(own.where.OR).toEqual([
      { userId: 'u1' },
      { redraftMembers: { some: { userId: 'u1' } } },
      { rosters: { some: { platformUserId: 'u1' } } },
      { teams: { some: { claimedByUserId: 'u1' } } },
    ])
    expect(gradeRows).toHaveBeenCalledWith(expect.objectContaining({ afLeagueId: 'af-mine', platformLeagueId: 'L1' }))
    // `frozenAt` null: ROW_GRADE is a live grade (no frozen original — see frozenCompletedGrade.ts).
    expect(out.available && out.data[0]!.grade).toEqual({ graded: true, acquirerLetter: 'B', senderLetter: 'D', got: 5000, gave: 4000, frozenAt: null })
  })

  it('mirrors the grade when the surviving row is the SENDER’s copy, so the dedupe cannot flip a letter', async () => {
    tradeFindMany.mockResolvedValue([{ ...trade('t1', 'L1'), playersGiven: ['6813'], playersReceived: ['111'] }])
    gradeRows.mockResolvedValue(new Map([['t1', { grade: ROW_GRADE, picksIn: [], picksOut: [] }]]))
    const { loadTrades } = await import('@/lib/core-app/playerCard')

    const out = await loadTrades('6813', { leagueId: 'L1', afLeagueId: 'af-checked' })

    expect(gradeRows).toHaveBeenCalledWith(expect.objectContaining({ afLeagueId: 'af-checked' }))
    // The row (sender) got B for giving him away; the side that GOT him reads the mirror.
    expect(out.available && out.data[0]!.grade).toEqual({ graded: true, acquirerLetter: 'D', senderLetter: 'B', got: 4000, gave: 5000, frozenAt: null })
  })

  it('no AF row to grade on: listed, never graded — and nothing guessed', async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { viewerLeagueIds: ['L1'] })
    expect(gradeRows).not.toHaveBeenCalled()
    expect(out.available && out.data[0]!.grade).toBeNull()
  })

  it('a withheld grade carries its reason, and a grading failure costs the letter, never the list', async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    gradeRows.mockResolvedValue(new Map([['t1', { grade: { graded: false, reason: 'a used pick could not be matched', basis: null }, picksIn: [], picksOut: [] }]]))
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const withheld = await loadTrades('6813', { leagueId: 'L1', afLeagueId: 'af-checked' })
    expect(withheld.available && withheld.data[0]!.grade).toEqual({ graded: false, withheld: 'a used pick could not be matched' })

    gradeRows.mockRejectedValue(new Error('chart down'))
    const failed = await loadTrades('6813', { leagueId: 'L1', afLeagueId: 'af-checked' })
    expect(failed.available && failed.data).toHaveLength(1)
    expect(failed.available && failed.data[0]!.grade).toBeNull()
  })
})

describe('memberLeaguePlatformIdsFor — the viewer set', () => {
  it('returns null for a signed-out viewer without querying', async () => {
    const { memberLeaguePlatformIdsFor } = await import('@/lib/league-access')
    expect(await memberLeaguePlatformIdsFor(null)).toBeNull()
    expect(await memberLeaguePlatformIdsFor(undefined)).toBeNull()
    expect(await memberLeaguePlatformIdsFor('')).toBeNull()
    expect(leagueFindMany).not.toHaveBeenCalled()
  })

  it('asks by all four membership paths and returns provider ids, de-duplicated', async () => {
    leagueFindMany.mockResolvedValue([
      { platformLeagueId: 'P1' },
      { platformLeagueId: 'P1' },
      { platformLeagueId: null },
      { platformLeagueId: 'P2' },
    ])
    const { memberLeaguePlatformIdsFor } = await import('@/lib/league-access')

    const out = await memberLeaguePlatformIdsFor('u1')

    expect(out).toEqual(['P1', 'P2'])
    const args = leagueFindMany.mock.calls[0][0]
    expect(args.where.OR).toEqual([
      { userId: 'u1' },
      { redraftMembers: { some: { userId: 'u1' } } },
      { rosters: { some: { platformUserId: 'u1' } } },
      { teams: { some: { claimedByUserId: 'u1' } } },
    ])
    expect(args.select).toEqual({ platformLeagueId: true })
  })

  it('mirrors the models resolveLeagueMembership checks (tripwire: update both together)', () => {
    const src = readFileSync(resolve(__dirname, '../lib/league-access.ts'), 'utf8')
    const start = src.indexOf('export async function resolveLeagueMembership')
    const end = src.indexOf('export async function memberLeaguePlatformIdsFor')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const models = new Set([...src.slice(start, end).matchAll(/prisma\.(\w+)\??\./g)].map((m) => m[1]))
    expect([...models].sort()).toEqual(['league', 'leagueTeam', 'redraftLeagueMember', 'roster'])
  })
})
