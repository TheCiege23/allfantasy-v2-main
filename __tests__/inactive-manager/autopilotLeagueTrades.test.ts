/**
 * Chimmy answering offers made on the league page (the league trade engine): accept, decline with its
 * reason, or counter through the engine's own counter — and every reason it declines without pricing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    trades: [] as Array<Record<string, unknown>>,
    eliminated: [] as string[],
    season: true,
    counts: 0,
  }
  const lineup = (starters: string[], bench: string[]) => ({ lineup_sections: { starters: starters.map((id) => ({ id, name: `N ${id}` })), bench: bench.map((id) => ({ id, name: `N ${id}` })), ir: [], taxi: [], devy: [] } })
  return {
    state,
    lineup,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      afLeagueTrade: { findMany: vi.fn(async () => state.trades), count: vi.fn(async () => state.counts) },
      league: { findUnique: vi.fn(async () => ({ settings: { af_managed_lineups: { rC: { since: 's', byUserId: 'commish', ownerUserId: 'orphan-c', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'commish', personality: 'BALANCED' } } } } })) },
      roster: {
        findMany: vi.fn(async () => [
          { id: 'rC', redraftRosterId: 'rr-c', playerData: lineup(['s1'], ['b1']) },
          { id: 'rA', redraftRosterId: 'rr-a', playerData: lineup(['as1'], ['ob1', 'ob2']) },
        ]),
      },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'rr-c', seasonId: 's', isEliminated: state.eliminated.includes('rr-c') }, { id: 'rr-a', seasonId: 's', isEliminated: state.eliminated.includes('rr-a') }]) },
      redraftSeason: { findFirst: vi.fn(async () => (state.season ? { id: 's', sport: 'NFL', season: 2026 } : null)) },
    },
    teams: vi.fn(async () => new Map([['rC', { rosterId: 'rC', actorUserId: 'commish', trades: 'answer' }]])),
    accept: vi.fn(async () => ({ status: 'awaiting_commissioner' })),
    reject: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'counter-1' })),
    log: vi.fn(async () => ({ id: 'a' })),
    values: {} as Record<string, number>,
    grade: vi.fn(async () => ({ graded: true, giveValue: 100, getValue: 200 }) as Record<string, unknown>),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/league-trade-engine/chimmyActor', () => ({ chimmyTradeTeams: m.teams }))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ acceptAfLeagueTrade: m.accept, rejectAfLeagueTrade: m.reject, createAfLeagueTrade: m.create }))
vi.mock('@/lib/league-trade-engine/serverTradeDecision', () => ({ proposalOneGrade: m.grade }))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({
  computeRedraftTradeValueSnapshot: vi.fn(async (input: { assets: Array<{ fromRosterId: string; toRosterId: string; playerId?: string; assetType: string }> }) => ({
    grade: { insufficientData: false },
    sides: [{ rosterId: 'x', total: 0, assets: input.assets.map((a) => ({ kind: a.assetType, playerId: a.playerId ?? null, playerName: `N ${a.playerId}`, position: 'WR', valuationBasis: 'market', fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, internalValue: m.values[a.playerId ?? ''] ?? 0 })) }],
  })),
}))

import { computeRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import { LEAGUE_TRADE_ACCEPT_ACTION, LEAGUE_TRADE_COUNTER_ACTION, LEAGUE_TRADE_REJECT_ACTION, pricingAsset, runAutopilotLeagueTradeAnswers } from '@/lib/inactive-manager/autopilotLeagueTrades'

const item = (itemReference: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ itemType: 'player', itemReference, fromRosterId: from, toRosterId: to, faabAmount: null, metadata: {}, ...extra })
const trade = (items: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({ id: 't1', leagueId: 'L', status: 'pending', proposerRosterId: 'rA', receiverRosterId: 'rC', items, metadata: {}, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  m.state.eliminated = []
  m.state.season = true
  m.state.counts = 0
  m.values = { b1: 1000, in1: 2000, low: 400, close: 950, ob1: 150, ob2: 900 }
  m.state.trades = [trade([item('b1', 'rC', 'rA'), item('in1', 'rA', 'rC')])]
})

describe('runAutopilotLeagueTradeAnswers', () => {
  it('answers any deal carrying a draft pick on the trade screen grade, in every sport and league type', async () => {
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('fdp:2027:1:rA', 'rA', 'rC', { itemType: 'future_pick' })])]
    m.grade.mockResolvedValueOnce({ graded: false, reason: 'Draft picks are not part of a redraft league — there is no next season for them to be used in — so a deal carrying one is not graded.', basis: null })
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ accepted: 0, rejected: 1, countered: 0 })
    expect(m.grade).toHaveBeenCalledWith(expect.objectContaining({ proposerRosterId: 'rC' }))
    expect(computeRedraftTradeValueSnapshot).not.toHaveBeenCalled()
    expect(m.reject).toHaveBeenCalledWith(expect.objectContaining({ note: expect.stringMatching(/not part of a redraft league/) }))
    expect(m.create).not.toHaveBeenCalled()
  })

  it('in a devy or C2C league answers on the trade screen grade, from its own side, and never counters', async () => {
    const settings = (await m.prisma.league.findUnique()).settings
    m.prisma.league.findUnique.mockResolvedValue({ settings, leagueType: 'c2c', leagueVariant: null } as never)
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('espn:ncaab:4433', 'rA', 'rC')])]
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ accepted: 1, rejected: 0, countered: 0 })
    expect(m.grade).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', proposerRosterId: 'rC', proposedByUserId: null }))
    expect(computeRedraftTradeValueSnapshot).not.toHaveBeenCalled()

    m.grade.mockResolvedValueOnce({ graded: true, giveValue: 100, getValue: 101 })
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ accepted: 0, rejected: 1, countered: 0 })
    expect(m.create).not.toHaveBeenCalled()
    m.prisma.league.findUnique.mockResolvedValue({ settings } as never)
  })

  it('accepts a good offer through the engine, as the team, answered by the commissioner who handed it over', async () => {
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ offers: 1, accepted: 1, rejected: 0, countered: 0 })
    expect(m.accept).toHaveBeenCalledWith({ tradeId: 't1', leagueId: 'L', userId: 'commish', chimmyForRosterId: 'rC' })
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: LEAGUE_TRADE_ACCEPT_ACTION, entityId: 'rC', metadata: expect.objectContaining({ tradeId: 't1', code: 'accepted' }) }))
  })

  it('declines a bad offer with its reason', async () => {
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('low', 'rA', 'rC')])]
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ accepted: 0, rejected: 1, countered: 0 })
    expect(m.reject).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't1', chimmyForRosterId: 'rC', note: expect.stringMatching(/a bit more/) }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: LEAGUE_TRADE_REJECT_ACTION }))
  })

  it('counters a close offer through the engine: the same deal plus one bench player, linked to the original', async () => {
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('close', 'rA', 'rC')])]
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ rejected: 1, countered: 1 })
    const made = (m.create.mock.calls[0] as unknown as [Record<string, any>])[0]
    expect(made).toMatchObject({ leagueId: 'L', proposedByUserId: 'commish', chimmyForRosterId: 'rC', proposerRosterId: 'rC', receiverRosterId: 'rA', parentTradeId: 't1' })
    expect(made.assets.map((a: { itemReference: string }) => a.itemReference)).toEqual(['b1', 'close', 'ob1'])
    expect(made.assets[2]).toMatchObject({ itemType: 'player', fromRosterId: 'rA', toRosterId: 'rC' })
    // The engine's counter closes the original: no separate decline.
    expect(m.reject).not.toHaveBeenCalled()
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: LEAGUE_TRADE_COUNTER_ACTION, metadata: expect.objectContaining({ counterTradeId: 'counter-1' }) }))
  })

  it('just declines a close offer when the counter cannot be made', async () => {
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('close', 'rA', 'rC')])]
    m.create.mockRejectedValueOnce(new Error('roster full'))
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ rejected: 1, countered: 0, failures: [] })
    expect(m.reject).toHaveBeenCalled()
    m.state.counts = 3
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ rejected: 1, countered: 0 })
  })

  it('declines without pricing: a multi-team trade, a team that is out, no season, an asset it cannot read', async () => {
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('in1', 'rA', 'rB'), item('x', 'rB', 'rC')])]
    await runAutopilotLeagueTradeAnswers()
    expect(m.reject).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Chimmy only does two-team trades.' }))
    m.state.trades = [trade([item('b1', 'rC', 'rA'), item('in1', 'rA', 'rC')])]
    m.state.eliminated = ['rr-a']
    await runAutopilotLeagueTradeAnswers()
    expect(m.reject).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'One of these teams is out of the league, so Chimmy passed.' }))
    m.state.eliminated = []
    m.state.season = false
    await runAutopilotLeagueTradeAnswers()
    expect(m.reject).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Chimmy could not put a value on this deal, so it passed.' }))
    m.state.season = true
    m.state.trades = [trade([item('b1', 'rC', 'rA'), { itemType: 'specialty_asset', itemReference: 'idol', fromRosterId: 'rA', toRosterId: 'rC', faabAmount: null, metadata: {} }])]
    await runAutopilotLeagueTradeAnswers()
    expect(m.reject).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Chimmy could not put a value on this deal, so it passed.' }))
    expect(m.accept).not.toHaveBeenCalled()
  })

  it("a rule the engine enforces is counted and the offer left as it was", async () => {
    m.accept.mockRejectedValueOnce(Object.assign(new Error('past the deadline'), { code: 'TRADE_DEADLINE' }))
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ accepted: 0, skipped: { TRADE_DEADLINE: 1 } })
    expect(m.log).not.toHaveBeenCalled()
  })

  it('leaves alone an offer to a team Chimmy does not take offers for, and reads only old-enough pending offers', async () => {
    m.teams.mockResolvedValueOnce(new Map())
    expect(await runAutopilotLeagueTradeAnswers()).toMatchObject({ offers: 0 })
    expect(m.accept).not.toHaveBeenCalled()
    const where = (m.prisma.afLeagueTrade.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where).toMatchObject({ leagueId: { in: ['L'] }, status: 'pending' })
  })
})

describe('pricingAsset', () => {
  const ids = (id: string) => ({ rA: 'rr-a', rC: 'rr-c' } as Record<string, string>)[id]
  it('reads players, FAAB and picks with a season and round; nothing else', () => {
    expect(pricingAsset(item('p', 'rA', 'rC') as never, ids)).toMatchObject({ fromRosterId: 'rr-a', toRosterId: 'rr-c', assetType: 'player', playerId: 'p' })
    expect(pricingAsset({ itemType: 'faab', itemReference: null, fromRosterId: 'rA', toRosterId: 'rC', faabAmount: 12, metadata: {} }, ids)).toMatchObject({ assetType: 'faab', metadata: { amount: 12 } })
    expect(pricingAsset({ itemType: 'rookie_pick', itemReference: 'k', fromRosterId: 'rA', toRosterId: 'rC', faabAmount: null, metadata: { pickSeason: 2027, pickRound: 1 } }, ids)).toMatchObject({ assetType: 'draft_pick', pickSeason: 2027, pickRound: 1 })
    expect(pricingAsset({ itemType: 'future_pick', itemReference: 'k', fromRosterId: 'rA', toRosterId: 'rC', faabAmount: null, metadata: {} }, ids)).toBeNull()
    expect(pricingAsset({ itemType: 'specialty_asset', itemReference: 'idol', fromRosterId: 'rA', toRosterId: 'rC', faabAmount: null, metadata: {} }, ids)).toBeNull()
    expect(pricingAsset(item('p', 'rA', 'rZ') as never, ids)).toBeNull()
  })
})
