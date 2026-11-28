import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The missed-deadline rule ("AF keeps their best-value players") in the board sports — NBA, MLB, NHL
 * (owner 2026-11-28). AF ranks a board sport's players on the LEAGUE'S OWN value board, through the same
 * `loadKeeperMarketRanks(…, { includeBoardSports: true })` the player card and the Keepers tab read, and
 * it loads those ranks BEFORE the keeper lock's transaction (`preloadMissedDeadlineRanks`), never inside it.
 */

const db = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, unknown>,
    rosters: [] as Array<{ id: string; players: Array<Record<string, unknown>> }>,
    records: [] as Array<{ rosterId: string; playerId?: string }>,
    eligibility: [] as Array<Record<string, unknown>>,
  }
  const prisma = {
    league: { findFirst: vi.fn(async () => state.league) },
    redraftRoster: { findMany: vi.fn(async () => state.rosters), count: vi.fn(async () => state.rosters.length) },
    keeperRecord: {
      findMany: vi.fn(async () => state.records),
      create: vi.fn(async ({ data }: { data: { rosterId: string; playerId: string } }) => { state.records.push(data); return data }),
    },
    leagueAuditLog: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
    keeperEligibility: { findMany: vi.fn(async () => state.eligibility) },
    draftSession: { findFirst: vi.fn(async () => ({ rounds: 15 })) },
  }
  return { state, prisma }
})
const gate = vi.hoisted(() => vi.fn(async () => ({ allowed: true })))
const chart = vi.hoisted(() => vi.fn())
const board = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = gate } }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: chart }))
vi.mock('@/lib/keeper/eligibilityEngine', () => ({ computeKeeperEligibility: vi.fn(async () => []) }))
vi.mock('@/lib/sport-values/leagueValueBoard', async (orig) => ({
  ...(await orig<typeof import('@/lib/sport-values/leagueValueBoard')>()),
  loadLeagueValueBoard: board,
}))

import { applyMissedDeadlineRule, preloadMissedDeadlineRanks } from '@/lib/keeper/missedDeadlineService'
import type { BoardPlayer, PointsGradedSport, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import type { LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'

const bp = (id: string, name: string, position: string, perGame: number, aliases: string[] = []): BoardPlayer => ({
  id, name, position, perGame, sampleGames: 30, aliases,
})

const ctxFor = (sport: PointsGradedSport, pos: string, players: BoardPlayer[]): SportPointsContext => ({
  sport,
  board: players,
  replacementByPosition: new Map([[pos, { name: 'Wire', perGame: 20 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60, baselineSeasonLabel: '2025-26' },
  scoringBasis: 'league',
  teams: 12,
} as SportPointsContext)

const okBoard = (ctx: SportPointsContext): LeagueValueBoard => ({ kind: 'ok', sport: ctx.sport, ctx, byId: new Map(ctx.board.map((x) => [x.id, x])) })

/** Five players over a replacement of 20 per game: board ranks 1..5, each found by a Sleeper id of THIS sport. */
function fiveOn(sport: PointsGradedSport, pos: string, prefix: string): BoardPlayer[] {
  return [50, 45, 40, 35, 30].map((perGame, i) => bp(`pim-${prefix}${i + 1}`, `${sport} Player ${i + 1}`, pos, perGame, [`${prefix}${i + 1}`]))
}

const rosterPlayer = (playerId: string, playerName: string, position: string, sport: string) =>
  ({ playerId, playerName, position, team: 'X', sport, acquisitionType: 'drafted', droppedAt: null })

const league = (sport: string, settings: Record<string, unknown> = {}) => ({
  id: 'L', userId: 'commish', sport, leagueSize: 12, keeperCount: 2, keeperMissedDeadlineRule: 'auto_best_value',
  keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperConflictRule: 'player_chooses', settings,
})

const kept = () => db.prisma.keeperRecord.create.mock.calls.map((c) => [c[0].data.playerId, c[0].data.costRound])

beforeEach(() => {
  vi.clearAllMocks()
  db.state.records = []
  gate.mockResolvedValue({ allowed: true })
  chart.mockResolvedValue([])
})

/**
 * 12 teams, two keepers. Rank → cost round → the pick that round uses (its middle) → surplus:
 *   #1 → R1 (#6)   +5      #2 → R5 (#54) +52      #3 → R3 (#30) +27      #5 → R10 (#114) +109
 * AF keeps the two biggest surpluses: #5 then #2.
 */
describe.each([
  ['NBA', 'C', 'n'],
  ['MLB', 'SP', 'm'],
  ['NHL', 'D', 'h'],
] as const)('%s: a silent team keeps its top-surplus players off the league’s own board', (sport, pos, prefix) => {
  beforeEach(() => {
    db.state.league = league(sport)
    db.state.rosters = [{
      id: 'silent',
      players: [1, 2, 3, 5].map((i) => rosterPlayer(`${prefix}${i}`, `${sport} Player ${i}`, pos, sport)),
    }]
    db.state.eligibility = [
      { rosterId: 'silent', playerId: `${prefix}1`, isEligible: true, projectedCostRound: 1, projectedCost: 'Round 1' },
      { rosterId: 'silent', playerId: `${prefix}2`, isEligible: true, projectedCostRound: 5, projectedCost: 'Round 5' },
      { rosterId: 'silent', playerId: `${prefix}3`, isEligible: true, projectedCostRound: 3, projectedCost: 'Round 3' },
      { rosterId: 'silent', playerId: `${prefix}5`, isEligible: true, projectedCostRound: 10, projectedCost: 'Round 10' },
    ]
    board.mockResolvedValue(okBoard(ctxFor(sport, pos, fiveOn(sport, pos, prefix))))
  })

  it('keeps the two best values as pending records, and never reads the NFL chart', async () => {
    const preload = await preloadMissedDeadlineRanks('L', 'S')
    expect(preload.rankOf).not.toBeNull()
    const out = await applyMissedDeadlineRule('L', 'S', db.prisma as never, preload)
    expect(out.skippedReason).toBeNull()
    expect(out.applied.map((a) => [a.rosterId, a.keepers.map((k) => k.playerId)])).toEqual([['silent', [`${prefix}5`, `${prefix}2`]]])
    expect(kept()).toEqual([[`${prefix}5`, 10], [`${prefix}2`, 5]])
    expect(db.prisma.keeperRecord.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', sport })
    expect(chart).not.toHaveBeenCalled()
    expect(board).toHaveBeenCalledTimes(1)
  })
})

describe('a board that cannot be built, or ranks nobody, keeps today’s behaviour', () => {
  beforeEach(() => {
    db.state.league = league('NBA')
    db.state.rosters = [{ id: 'silent', players: [rosterPlayer('n5', 'NBA Player 5', 'C', 'NBA')] }]
    db.state.eligibility = [{ rosterId: 'silent', playerId: 'n5', isEligible: true, projectedCostRound: 10, projectedCost: 'Round 10' }]
  })

  it('an unbuildable board skips with no_market_values and records why', async () => {
    board.mockResolvedValue({ kind: 'unavailable', sport: 'NBA', reason: 'The league’s value board could not be read just now.' })
    const preload = await preloadMissedDeadlineRanks('L', 'S')
    expect(preload.rankOf).toBeNull()
    expect(await applyMissedDeadlineRule('L', 'S', db.prisma as never, preload)).toMatchObject({ applied: [], skippedReason: 'no_market_values' })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'keeper_missed_deadline_skipped', metadata: expect.objectContaining({ reason: 'no_market_values', sport: 'NBA', source: 'league_value_board' }) }),
    }))
  })

  it('a board load that throws is the same as an unbuildable one', async () => {
    board.mockRejectedValue(new Error('board exploded'))
    const preload = await preloadMissedDeadlineRanks('L', 'S')
    expect(await applyMissedDeadlineRule('L', 'S', db.prisma as never, preload)).toMatchObject({ applied: [], skippedReason: 'no_market_values' })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
  })

  it('a board on which none of the team’s players is ranked skips with no_ranked_players', async () => {
    board.mockResolvedValue(okBoard(ctxFor('NBA', 'C', [bp('pim-other', 'Someone Else', 'C', 50, ['777'])])))
    const preload = await preloadMissedDeadlineRanks('L', 'S')
    expect(preload.rankOf).not.toBeNull()
    expect(await applyMissedDeadlineRule('L', 'S', db.prisma as never, preload)).toMatchObject({ applied: [], skippedReason: 'no_ranked_players' })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'keeper_missed_deadline_skipped', metadata: expect.objectContaining({ reason: 'no_ranked_players' }) }),
    }))
  })

  it('inside a transaction with nothing preloaded, it never loads a board — it skips and says so', async () => {
    board.mockResolvedValue(okBoard(ctxFor('NBA', 'C', fiveOn('NBA', 'C', 'n'))))
    const tx = { ...db.prisma }
    expect(await applyMissedDeadlineRule('L', 'S', tx as never)).toMatchObject({ applied: [], skippedReason: 'no_market_values' })
    expect(board).not.toHaveBeenCalled()
    expect(chart).not.toHaveBeenCalled()
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ detail: 'ranks_not_preloaded' }) }),
    }))
  })

  it('a league that keeps nobody on a missed deadline loads no board at all', async () => {
    db.state.league = { ...league('NBA'), keeperMissedDeadlineRule: 'auto_no_keepers' }
    expect(await preloadMissedDeadlineRanks('L', 'S')).toEqual({ rankOf: null })
    expect(board).not.toHaveBeenCalled()
  })
})

describe('waiver stacking applies in a board sport exactly as in the NFL', () => {
  /** 170 players over replacement, so a late pickup's stacked pick can fall below his rank. */
  const deep = Array.from({ length: 170 }, (_, i) => bp(`pim-d${i + 1}`, `Deep ${i + 1}`, 'C', 200 - i, [`d${i + 1}`]))
  const pickup = (id: string, round: number) => ({ rosterId: 'silent', playerId: id, isEligible: true, projectedCostRound: round, projectedCost: `Round ${round} (not drafted)` })

  beforeEach(() => {
    db.state.rosters = [{ id: 'silent', players: ['d10', 'd20', 'd170'].map((id) => rosterPlayer(id, `Deep ${id.slice(1)}`, 'C', 'NBA')) }]
    board.mockResolvedValue(okBoard(ctxFor('NBA', 'C', deep)))
  })

  it('two pickups at the last round stack to Round 15 and Round 14, most surplus first', async () => {
    db.state.league = league('NBA')
    db.state.eligibility = [pickup('d10', 15), pickup('d20', 15)]
    const out = await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    expect(out.applied[0].keepers.map((k) => k.playerId)).toEqual(['d10', 'd20'])
    expect(kept()).toEqual([['d10', 15], ['d20', 14]])
  })

  it('the commissioner’s fixed waiver round is the first pickup’s cost, the next the round before', async () => {
    db.state.league = league('NBA', { keeper_waiver_cost_round: 10 })
    db.state.eligibility = [pickup('d10', 10), pickup('d20', 10)]
    await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    expect(kept()).toEqual([['d10', 10], ['d20', 9]])
  })

  it('a pickup is kept only while he is still worth more than his STACKED pick', async () => {
    // #170 is worth more than Round 15's #174, but not Round 14's #162 once #10 has taken Round 15.
    db.state.league = league('NBA')
    db.state.eligibility = [pickup('d10', 15), pickup('d170', 15)]
    await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    expect(kept()).toEqual([['d10', 15]])
  })

  it('keeper_waiver_stack: false prices both at the last round, so the refusing same-round rule keeps one', async () => {
    db.state.league = league('NBA', { keeper_waiver_stack: false })
    db.state.eligibility = [pickup('d10', 15), pickup('d20', 15)]
    await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    expect(kept()).toEqual([['d10', 15]])
  })
})

describe('🛑 Sleeper ids are per sport: NBA 1466 is JaVale McGee, NFL 1466 is Travis Kelce', () => {
  it('an NBA league prices 1466 on the NBA board, never as Kelce off the NFL chart', async () => {
    db.state.league = league('NBA')
    db.state.rosters = [{ id: 'silent', players: [rosterPlayer('1466', 'JaVale McGee', 'C', 'NBA')] }]
    // Kelce on the NFL chart would be the #1 player — a +100-pick keeper at Round 10. McGee on the NBA
    // board is #5, so at Round 1 (#6) he is +1, and at Round 1 he is what AF keeps, on HIS value.
    chart.mockResolvedValue([{ player: { sleeperId: '1466', name: 'Travis Kelce', position: 'TE' }, overallRank: 1 }])
    const players = [...fiveOn('NBA', 'C', 'n').slice(0, 4), bp('pim-mcgee', 'JaVale McGee', 'C', 30, ['1466'])]
    board.mockResolvedValue(okBoard(ctxFor('NBA', 'C', players)))

    db.state.eligibility = [{ rosterId: 'silent', playerId: '1466', isEligible: true, projectedCostRound: 1, projectedCost: 'Round 1' }]
    const preload = await preloadMissedDeadlineRanks('L', 'S')
    expect(preload.rankOf!({ playerId: '1466', name: 'JaVale McGee', position: 'C' })).toBe(5)
    const out = await applyMissedDeadlineRule('L', 'S', db.prisma as never, preload)
    expect(out.applied[0].keepers.map((k) => [k.playerId, k.name])).toEqual([['1466', 'JaVale McGee']])
    expect(chart).not.toHaveBeenCalled()
  })

  it('a player the NBA board does not know is not priced from the NFL chart either', async () => {
    db.state.league = league('NBA')
    db.state.rosters = [{ id: 'silent', players: [rosterPlayer('1466', 'JaVale McGee', 'C', 'NBA')] }]
    chart.mockResolvedValue([{ player: { sleeperId: '1466', name: 'Travis Kelce', position: 'TE' }, overallRank: 1 }])
    board.mockResolvedValue(okBoard(ctxFor('NBA', 'C', fiveOn('NBA', 'C', 'n'))))
    db.state.eligibility = [{ rosterId: 'silent', playerId: '1466', isEligible: true, projectedCostRound: 10, projectedCost: 'Round 10' }]
    const out = await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    expect(out).toMatchObject({ applied: [], skippedReason: 'no_ranked_players' })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
    expect(chart).not.toHaveBeenCalled()
  })
})

describe('control: the NFL path is unchanged', () => {
  it('ranks off FantasyCalc, keeps the same players at the same rounds, and never reads a board', async () => {
    db.state.league = league('NFL')
    db.state.rosters = [{ id: 'silent', players: [rosterPlayer('p1', 'Star Guy', 'WR', 'NFL'), rosterPlayer('p2', 'Bust Guy', 'WR', 'NFL'), rosterPlayer('p3', 'Name Match', 'WR', 'NFL')] }]
    db.state.eligibility = [
      { rosterId: 'silent', playerId: 'p1', isEligible: true, projectedCostRound: 9 },
      { rosterId: 'silent', playerId: 'p2', isEligible: true, projectedCostRound: 3 },
      { rosterId: 'silent', playerId: 'p3', isEligible: true, projectedCostRound: 7 },
    ]
    const fc = (sleeperId: string, name: string, overallRank: number) => ({ player: { sleeperId, name, position: 'WR' }, overallRank })
    chart.mockResolvedValue([fc('p1', 'Star Guy', 10), fc('xx', 'Bust Guy', 80), fc('zz', 'Name Match', 30)])

    const viaPreload = await applyMissedDeadlineRule('L', 'S', db.prisma as never, await preloadMissedDeadlineRanks('L', 'S'))
    const first = kept()
    vi.clearAllMocks()
    db.state.records = []
    const inline = await applyMissedDeadlineRule('L', 'S') // no transaction: loads in place, as before

    expect(viaPreload.applied).toEqual(inline.applied)
    expect(first).toEqual([['p1', 9], ['p3', 7]])
    expect(kept()).toEqual(first)
    expect(board).not.toHaveBeenCalled()
  })
})
