/**
 * The hourly run that answers trade offers made to Chimmy teams: which offers it touches, that it
 * answers through the shared accept/decline (never a path of its own), and when it stands down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    ownerHasPlan: true,
    proposals: [] as Array<Record<string, unknown>>,
    rosterOwner: 'orphan-r1' as string | null,
  }
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      league: { findUnique: vi.fn(async () => ({ id: 'L', userId: 'owner', settings: state.settings })) },
      redraftTradeProposal: { findMany: vi.fn(async () => state.proposals), count: vi.fn(async () => 0) },
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 's', sport: 'NFL', season: 2026, league: { leagueVariant: null } })) },
      roster: {
        findFirst: vi.fn(async () => ({ playerData: { lineup_sections: { starters: [{ id: 'os1', position: 'WR' }], bench: [{ id: 'ob1', position: 'WR', name: 'Other Bench' }, { id: 'ob2', position: 'WR', name: 'Big Bench' }], ir: [], taxi: [], devy: [] } } })),
        findMany: vi.fn(async () => [
          { id: 'r1', platformUserId: state.rosterOwner, redraftRosterId: 'rr-chimmy', playerData: { lineup_sections: { starters: [{ id: 's1', position: 'WR' }], bench: [{ id: 'b1', position: 'WR' }], ir: [], taxi: [], devy: [] } } },
        ]),
      },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'rr-chimmy', ownerId: 'orphan-r1', teamName: 'Ghosts' }, { id: 'rr-other', ownerId: 'uA', teamName: 'Dana' }]) },
    },
    accept: vi.fn(async () => ({ status: 200, body: { resolved: false } })),
    reject: vi.fn(async () => ({ status: 200, body: { resolved: true } })),
    log: vi.fn(async () => ({ id: 'a' })),
    create: vi.fn(async () => ({ ok: true, created: { id: 'p-counter' } })),
    price: vi.fn(async () => ({ sides: [{ assets: [
      { playerId: 'ob1', playerName: 'Other Bench', position: 'WR', valuationBasis: 'market', internalValue: 150 },
      { playerId: 'ob2', playerName: 'Big Bench', position: 'WR', valuationBasis: 'market', internalValue: 900 },
    ] }] })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/redraft/tradeDecision', () => ({ acceptRedraftTrade: m.accept, rejectRedraftTrade: m.reject }))
vi.mock('@/lib/redraft/createTradeProposal', () => ({ createRedraftTradeProposal: m.create }))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({ computeRedraftTradeValueSnapshot: m.price }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: m.state.ownerHasPlan }))
  },
}))

import {
  CHIMMY_TRADE_ACTOR,
  TRADE_ACCEPT_ACTION,
  TRADE_COUNTER_ACTION,
  MAX_COUNTERS_PER_WEEK,
  TRADE_REJECT_ACTION,
  runAutopilotTradeAnswers,
} from '@/lib/inactive-manager/autopilotTradeService'
import { TRADE_ANSWER_DELAY_MS } from '@/lib/inactive-manager/autopilotTrades'

const asset = (from: string, to: string, v: number, playerId: string) => ({ kind: 'player', playerId, position: 'WR', valuationBasis: 'market', fromRosterId: from, toRosterId: to, internalValue: v })
const offer = (give: number, get: number, over: Record<string, unknown> = {}) => ({
  id: 'p-1', leagueId: 'L', seasonId: 's', proposerRosterId: 'rr-other', receiverRosterId: 'rr-chimmy',
  additionalRosterIds: [], acceptedRosterIds: [], status: 'pending', acceptedAt: null, vetoMode: 'commissioner',
  votes: [], assets: [],
  valueSnapshot: {
    payload: {
      grade: { insufficientData: false },
      sides: [
        { rosterId: 'rr-other', total: get, assets: [asset('rr-other', 'rr-chimmy', get, 'in1')] },
        { rosterId: 'rr-chimmy', total: give, assets: [asset('rr-chimmy', 'rr-other', give, 'b1')] },
      ],
    },
  },
  ...over,
})
const chimmy = (autopilot: Record<string, unknown> = {}) => ({ af_managed_lineups: { r1: { since: 's', byUserId: 'u', ownerUserId: 'orphan-r1', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'u', personality: 'BALANCED', ...autopilot } } } })

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = chimmy()
  m.state.ownerHasPlan = true
  m.state.rosterOwner = 'orphan-r1'
  m.state.proposals = [offer(1000, 2000)]
})

describe('runAutopilotTradeAnswers', () => {
  it('accepts a good offer through the shared accept, as Chimmy, and logs it', async () => {
    const r = await runAutopilotTradeAnswers()
    expect(r).toMatchObject({ offers: 1, accepted: 1, rejected: 0 })
    expect(m.reject).not.toHaveBeenCalled()
    expect(m.accept).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: CHIMMY_TRADE_ACTOR, actorName: 'Chimmy', multiTeam: false,
      proposerOwnerId: 'uA', receiverOwnerId: 'orphan-r1',
      proposal: expect.objectContaining({ id: 'p-1' }),
    }))
    // The snapshot is not part of the proposal the shared code is handed.
    expect(m.accept.mock.calls[0]![0].proposal).not.toHaveProperty('valueSnapshot')
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TRADE_ACCEPT_ACTION, entityId: 'r1', metadata: expect.objectContaining({ proposalId: 'p-1', code: 'accepted', personality: 'BALANCED' }) }))
  })

  it('declines a bad offer with a plain reason', async () => {
    m.state.proposals = [offer(2000, 500)]
    const r = await runAutopilotTradeAnswers()
    expect(r).toMatchObject({ accepted: 0, rejected: 1 })
    expect(m.accept).not.toHaveBeenCalled()
    expect(m.reject).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: CHIMMY_TRADE_ACTOR, reason: expect.stringMatching(/a bit more/) }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TRADE_REJECT_ACTION }))
  })

  describe('counter-offers', () => {
    // Gives 1000, gets 950: balanced needs 130 more. The other team's bench has a 150 and a 900.
    const close = () => { m.state.proposals = [offer(1000, 950, { assets: [
      { fromRosterId: 'rr-chimmy', toRosterId: 'rr-other', assetType: 'player', playerId: 'b1', playerName: 'Mine', metadata: {} },
      { fromRosterId: 'rr-other', toRosterId: 'rr-chimmy', assetType: 'player', playerId: 'in1', playerName: 'Theirs', metadata: {} },
    ] })] }

    it('declines a close offer with a counter: the same deal plus the smallest bench player that closes it', async () => {
      close()
      const r = await runAutopilotTradeAnswers()
      expect(r).toMatchObject({ accepted: 0, rejected: 1, countered: 1 })
      const made = (m.create.mock.calls[0] as unknown as [Record<string, any>])[0]
      // From the Chimmy team to the team that made the offer, as Chimmy.
      expect(made).toMatchObject({ proposer: { id: 'rr-chimmy' }, receiver: { id: 'rr-other' }, actorUserId: CHIMMY_TRADE_ACTOR, proposerName: 'Chimmy (Ghosts)', additionalRosterIds: [] })
      expect(made.assets.map((a: { playerId: string }) => a.playerId)).toEqual(['b1', 'in1', 'ob1'])
      expect(made.assets[2]).toMatchObject({ fromRosterId: 'rr-other', toRosterId: 'rr-chimmy', assetType: 'player' })
      // Only the other team's BENCH was priced.
      expect((m.price.mock.calls[0] as unknown as [{ assets: Array<{ playerId: string }> }])[0].assets.map((a) => a.playerId)).toEqual(['ob1', 'ob2'])
      expect(m.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Chimmy would do this deal with Other Bench added. It sent you a counter-offer.' }))
      expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TRADE_COUNTER_ACTION, metadata: expect.objectContaining({ counterProposalId: 'p-counter', counter: 'add_on' }) }))
    })

    it('just declines when the weekly limit is reached, an offer of its own is waiting, or the counter cannot be made', async () => {
      close()
      m.prisma.redraftTradeProposal.count.mockResolvedValueOnce(MAX_COUNTERS_PER_WEEK)
      expect(await runAutopilotTradeAnswers()).toMatchObject({ rejected: 1, countered: 0 })
      m.prisma.redraftTradeProposal.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
      expect(await runAutopilotTradeAnswers()).toMatchObject({ rejected: 1, countered: 0 })
      expect(m.create).not.toHaveBeenCalled()
      m.create.mockResolvedValueOnce({ ok: false, status: 400, body: { error: 'no' } } as never)
      expect(await runAutopilotTradeAnswers()).toMatchObject({ rejected: 1, countered: 0 })
      expect(m.reject).toHaveBeenLastCalledWith(expect.objectContaining({ reason: expect.stringMatching(/a bit more/) }))
      m.price.mockRejectedValueOnce(new Error('pricing down'))
      expect(await runAutopilotTradeAnswers()).toMatchObject({ rejected: 1, countered: 0, failures: [] })
    })

    it('does not counter an offer that is nowhere near', async () => {
      m.state.proposals = [offer(2000, 500)]
      expect(await runAutopilotTradeAnswers()).toMatchObject({ rejected: 1, countered: 0 })
      expect(m.create).not.toHaveBeenCalled()
    })
  })

  it('declines any offer involving a team that is out of the league, and sends no counter', async () => {
    m.prisma.redraftRoster.findMany.mockResolvedValueOnce([{ id: 'rr-chimmy', ownerId: 'orphan-r1', isEliminated: true }, { id: 'rr-other', ownerId: 'uA' }] as never)
    const r = await runAutopilotTradeAnswers()
    expect(r).toMatchObject({ accepted: 0, rejected: 1, countered: 0 })
    expect(m.accept).not.toHaveBeenCalled()
    expect(m.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: 'One of these teams is out of the league, so Chimmy passed.' }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ code: 'eliminated' }) }))
  })

  it('only looks at pending, unaccepted offers old enough to have been withdrawn', async () => {
    const now = new Date('2026-11-25T12:00:00Z')
    await runAutopilotTradeAnswers({ now })
    const where = (m.prisma.redraftTradeProposal.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where).toMatchObject({ status: 'pending', acceptedAt: null, leagueId: { in: ['L'] } })
    expect((where.createdAt as { lte: Date }).lte.getTime()).toBe(now.getTime() - TRADE_ANSWER_DELAY_MS)
  })

  it('leaves alone an offer to a team Chimmy does not run, and a team whose trades are off', async () => {
    m.state.proposals = [offer(1000, 2000, { receiverRosterId: 'rr-someone-else' })]
    expect(await runAutopilotTradeAnswers()).toMatchObject({ offers: 0, accepted: 0 })

    m.state.proposals = [offer(1000, 2000)]
    m.state.settings = chimmy({ trades: 'off' })
    expect(await runAutopilotTradeAnswers()).toMatchObject({ offers: 0, accepted: 0 })
    expect(m.accept).not.toHaveBeenCalled()
  })

  it('does not answer for a team that has a new owner', async () => {
    m.state.rosterOwner = 'new-human'
    expect(await runAutopilotTradeAnswers()).toMatchObject({ offers: 0 })
    expect(m.accept).not.toHaveBeenCalled()
  })

  it("an accept the league's rules refuse is counted and left pending, not logged as accepted", async () => {
    m.accept.mockResolvedValueOnce({ status: 409, body: { code: 'TRADE_DEADLINE_PASSED' } } as never)
    const r = await runAutopilotTradeAnswers()
    expect(r).toMatchObject({ offers: 1, accepted: 0, rejected: 0, skipped: { TRADE_DEADLINE_PASSED: 1 } })
    expect(m.reject).not.toHaveBeenCalled()
    expect(m.log).not.toHaveBeenCalled()
  })

  it('one failing offer does not stop the next', async () => {
    m.state.proposals = [offer(1000, 2000, { id: 'p-bad' }), offer(1000, 2000, { id: 'p-ok' })]
    m.accept.mockRejectedValueOnce(new Error('boom'))
    const r = await runAutopilotTradeAnswers()
    expect(r.failures).toEqual([{ leagueId: 'L', proposalId: 'p-bad', error: 'boom' }])
    expect(r.accepted).toBe(1)
  })

  it('does nothing when no league has a managed team', async () => {
    m.prisma.$queryRaw.mockResolvedValueOnce([])
    expect(await runAutopilotTradeAnswers()).toMatchObject({ offers: 0 })
    expect(m.prisma.redraftTradeProposal.findMany).not.toHaveBeenCalled()
  })
})
