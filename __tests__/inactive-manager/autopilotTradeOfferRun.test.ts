/**
 * The hourly run that SENDS a trade offer for a Chimmy team set to "answer and send": who it sends for,
 * that it goes through the shared offer creation, and every reason it stands down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    status: 'in_season',
    lockAllMoves: false,
    currentWeek: 5,
    counts: [0, 0] as number[],
    values: {} as Record<string, [string, number]>,
    eliminated: [] as string[],
    interests: [] as Array<{ fromRosterId: string; playerId: string }>,
    guillotine: false,
    tradesAllowed: true,
  }
  const lineup = (starters: string[], bench: string[]) => ({ lineup_sections: { starters: starters.map((id) => ({ id, name: `N ${id}` })), bench: bench.map((id) => ({ id, name: `N ${id}` })), ir: [], taxi: [], devy: [] } })
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      league: { findUnique: vi.fn(async () => ({ id: 'L', userId: 'owner', platform: 'allfantasy', status: state.status, lifecycleState: state.status, lockAllMoves: state.lockAllMoves, guillotineMode: state.guillotine, bestBallMode: false, settings: state.settings })) },
      roster: {
        findMany: vi.fn(async () => [
          { id: 'r1', platformUserId: 'orphan-r1', redraftRosterId: 'rr-chimmy', playerData: lineup(['qb', 'rb1', 'rb2'], ['bwr']) },
          { id: 'r2', platformUserId: 'uA', redraftRosterId: 'rr-other', playerData: lineup(['xs'], ['xrb']) },
          // Another Chimmy team and an empty seat: never offered to.
          { id: 'r3', platformUserId: 'orphan-r3', redraftRosterId: 'rr-chimmy2', playerData: lineup([], ['crb']) },
          { id: 'r4', platformUserId: 'orphan-r4', redraftRosterId: 'rr-empty', playerData: lineup([], ['crb']) },
        ]),
      },
      redraftTradeProposal: { count: vi.fn(async () => state.counts.shift() ?? 0) },
      redraftTradeBlockItem: { findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []) },
      redraftRoster: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, seasonId: 's', ownerId: where.id === 'rr-chimmy' ? 'orphan-r1' : 'uA', teamName: where.id === 'rr-chimmy' ? 'Ghosts' : 'Dana', isEliminated: state.eliminated.includes(where.id) })),
        findMany: vi.fn(async () => state.eliminated.map((id) => ({ id }))),
      },
      redraftTradeInterest: { findMany: vi.fn(async () => state.interests) },
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 's', sport: 'NFL', season: 2026, playoffStartWeek: 15, currentWeek: state.currentWeek, league: { leagueVariant: null } })) },
    },
    create: vi.fn(async () => ({ ok: true, created: { id: 'p-new' } })),
    price: vi.fn(async (input: { assets: Array<{ playerId: string; playerName: string }> }) => ({
      sides: [{ assets: input.assets.map((a) => ({ playerId: a.playerId, playerName: a.playerName, position: state.values[a.playerId]?.[0] ?? null, valuationBasis: 'market', internalValue: state.values[a.playerId]?.[1] ?? 0 })) }],
    })),
    log: vi.fn(async () => ({ id: 'a' })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/redraft/tradeDecision', () => ({ acceptRedraftTrade: vi.fn(), rejectRedraftTrade: vi.fn() }))
vi.mock('@/lib/redraft/createTradeProposal', () => ({ createRedraftTradeProposal: m.create }))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({ computeRedraftTradeValueSnapshot: m.price }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({ resolveLeagueTradeSettings: () => ({ tradesAllowed: m.state.tradesAllowed }) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: true }))
  },
}))

import { CHIMMY_TRADE_ACTOR, TRADE_SEND_ACTION, runAutopilotTradeOffers } from '@/lib/inactive-manager/autopilotTradeService'
import { offerHourFor } from '@/lib/inactive-manager/autopilotTradeOffers'
import { WEEKLY_OFFER_LIMIT } from '@/lib/inactive-manager/managerProfile'

const chimmy = (trades: string | undefined, personality = 'BALANCED') => ({
  since: 's', byUserId: 'u', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'u', personality, ...(trades ? { trades } : {}) },
})
const settings = (trades: string | undefined) => ({ af_managed_lineups: { r1: { ...chimmy(trades), ownerUserId: 'orphan-r1' }, r3: { ...chimmy('off'), ownerUserId: 'orphan-r3' } } })
/** A time inside r1's own hour. */
const myHour = new Date(Date.UTC(2026, 10, 25, offerHourFor('r1'), 10))
const otherHour = new Date(Date.UTC(2026, 10, 25, (offerHourFor('r1') + 1) % 24, 10))

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = settings('answer_and_send')
  m.state.status = 'in_season'
  m.state.lockAllMoves = false
  m.state.currentWeek = 5
  m.state.counts = [0, 0]
  m.state.eliminated = []
  m.state.interests = []
  m.state.guillotine = false
  m.state.tradesAllowed = true
  m.state.values = { qb: ['QB', 3000], rb1: ['RB', 2500], rb2: ['RB', 1000], bwr: ['WR', 1900], xrb: ['RB', 2000], xs: ['RB', 9000], crb: ['RB', 2000] }
})

describe('runAutopilotTradeOffers', () => {
  it('sends one bench-for-bench offer in its hour, as Chimmy, through the shared offer creation', async () => {
    const r = await runAutopilotTradeOffers({ now: myHour })
    expect(r).toMatchObject({ teams: 1, sent: 1, failures: [] })
    const made = (m.create.mock.calls[0] as unknown as [Record<string, any>])[0]
    expect(made).toMatchObject({ leagueId: 'L', seasonId: 's', proposer: { id: 'rr-chimmy' }, receiver: { id: 'rr-other' }, actorUserId: CHIMMY_TRADE_ACTOR, proposerName: 'Chimmy (Ghosts)', additionalRosterIds: [] })
    expect(made.assets).toEqual([
      expect.objectContaining({ fromRosterId: 'rr-chimmy', toRosterId: 'rr-other', assetType: 'player', playerId: 'bwr' }),
      expect.objectContaining({ fromRosterId: 'rr-other', toRosterId: 'rr-chimmy', assetType: 'player', playerId: 'xrb' }),
    ])
    expect(made.reason).toBe('Chimmy is offering N bwr for N xrb: it needs help at RB.')
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TRADE_SEND_ACTION, entityId: 'r1', metadata: expect.objectContaining({ proposalId: 'p-new', give: ['bwr'], get: 'xrb', replaces: 'rb2', onBlock: false }) }))
  })

  it('never prices or asks for the other team\'s starters, another Chimmy team, or an empty seat', async () => {
    await runAutopilotTradeOffers({ now: myHour })
    const pricedIds = m.price.mock.calls.flatMap((c) => (c as unknown as [{ assets: Array<{ playerId: string }> }])[0].assets.map((a) => a.playerId))
    expect(pricedIds).toContain('xrb')
    expect(pricedIds).not.toContain('xs')
    expect(pricedIds).not.toContain('crb')
  })

  it('may ask for a starter the other manager listed on the trade block', async () => {
    // xs starts for the other team and is worth 9000: far too much. Listed and priced at a fair 2100, he is askable.
    m.prisma.redraftTradeBlockItem.findMany.mockResolvedValueOnce([{ rosterId: 'rr-other', playerId: 'xl', playerName: 'N xl', askingForPositions: ['WR'] }])
    m.state.values = { qb: ['QB', 3000], rb1: ['RB', 2500], rb2: ['RB', 1000], bwr: ['WR', 1900], xrb: ['RB', 1200], xl: ['RB', 2050] }
    const r = await runAutopilotTradeOffers({ now: myHour })
    expect(r.sent).toBe(1)
    const made = (m.create.mock.calls[0] as unknown as [Record<string, any>])[0]
    expect(made.assets.map((a: { playerId: string }) => a.playerId)).toEqual(['bwr', 'xl'])
    expect(made.reason).toMatch(/you have him on the trade block/)
    // Only active, league-visible listings of the teams it shopped were read.
    expect((m.prisma.redraftTradeBlockItem.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).toMatchObject({ leagueId: 'L', status: 'active', visibility: 'league', rosterId: { in: ['rr-other'] } })
  })

  it('a team that is out makes no offers, and no offer goes to a team that is out', async () => {
    m.state.eliminated = ['rr-chimmy']
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { eliminated: 1 } })
    m.state.eliminated = ['rr-other']
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { nobody_to_trade_with: 1 } })
    expect(m.create).not.toHaveBeenCalled()
  })

  it('prices nothing in a Guillotine league whose trades are off, and trades normally in one where they are on', async () => {
    m.state.guillotine = true
    m.state.tradesAllowed = false
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { trades_disabled: 1 } })
    expect(m.price).not.toHaveBeenCalled()
    m.state.tradesAllowed = true
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 1 })
  })

  it('reads only league-visible interest in its own players, and says so in the offer', async () => {
    m.state.interests = [{ fromRosterId: 'rr-other', playerId: 'bwr' }]
    await runAutopilotTradeOffers({ now: myHour })
    expect((m.prisma.redraftTradeInterest.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).toMatchObject({ leagueId: 'L', status: 'active', visibility: 'league', interestType: 'player_interest', fromRosterId: { in: ['rr-other'] } })
    const made = (m.create.mock.calls[0] as unknown as [Record<string, any>])[0]
    expect(made.reason).toBe('Chimmy is offering N bwr for N xrb: you were interested in N bwr, and it needs help at RB.')
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ wanted: true }) }))
  })

  it('sends nothing outside its hour, or when its trades are not set to send', async () => {
    expect(await runAutopilotTradeOffers({ now: otherHour })).toMatchObject({ teams: 0, sent: 0 })
    for (const mode of ['answer', 'off', undefined]) {
      m.state.settings = settings(mode)
      expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ teams: 0, sent: 0 })
    }
    expect(m.create).not.toHaveBeenCalled()
    expect(m.price).not.toHaveBeenCalled()
  })

  it('stands down at its weekly limit, while an offer of its own is waiting, in the playoffs, and when moves are locked', async () => {
    m.state.counts = [WEEKLY_OFFER_LIMIT.normal, 0]
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { weekly_limit: 1 } })
    m.state.counts = [0, 1]
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { offer_waiting: 1 } })
    m.state.counts = [0, 0]
    m.state.currentWeek = 15
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { playoffs: 1 } })
    m.state.currentWeek = 5
    m.state.lockAllMoves = true
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { moves_locked: 1 } })
    m.state.lockAllMoves = false
    m.state.status = 'complete'
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { not_in_season: 1 } })
    expect(m.create).not.toHaveBeenCalled()
  })

  it("counts an offer the league's rules refuse, and logs nothing as sent", async () => {
    m.create.mockResolvedValueOnce({ ok: false, status: 400, body: { code: 'TRADE_DEADLINE_PASSED' } } as never)
    expect(await runAutopilotTradeOffers({ now: myHour })).toMatchObject({ sent: 0, skipped: { TRADE_DEADLINE_PASSED: 1 } })
    expect(m.log).not.toHaveBeenCalled()
  })

  it('a pricing failure is recorded for that team and does not throw', async () => {
    m.price.mockRejectedValueOnce(new Error('pricing down'))
    const r = await runAutopilotTradeOffers({ now: myHour })
    expect(r.failures).toEqual([{ leagueId: 'L', rosterId: 'r1', error: 'pricing down' }])
    expect(r.sent).toBe(0)
  })
})
