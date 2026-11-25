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
      redraftTradeProposal: { findMany: vi.fn(async () => state.proposals) },
      roster: {
        findMany: vi.fn(async () => [
          { id: 'r1', platformUserId: state.rosterOwner, redraftRosterId: 'rr-chimmy', playerData: { lineup_sections: { starters: [{ id: 's1', position: 'WR' }], bench: [{ id: 'b1', position: 'WR' }], ir: [], taxi: [], devy: [] } } },
        ]),
      },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'rr-chimmy', ownerId: 'orphan-r1' }, { id: 'rr-other', ownerId: 'uA' }]) },
    },
    accept: vi.fn(async () => ({ status: 200, body: { resolved: false } })),
    reject: vi.fn(async () => ({ status: 200, body: { resolved: true } })),
    log: vi.fn(async () => ({ id: 'a' })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/redraft/tradeDecision', () => ({ acceptRedraftTrade: m.accept, rejectRedraftTrade: m.reject }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: m.state.ownerHasPlan }))
  },
}))

import {
  CHIMMY_TRADE_ACTOR,
  TRADE_ACCEPT_ACTION,
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
