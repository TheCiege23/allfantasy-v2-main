/**
 * Creating a MULTI-TEAM (3- or 4-team) trade on `POST /api/redraft/trade-proposals`.
 *
 * The extra teams travel as `additionalRosterIds`. Every asset must move between two teams of the
 * trade, every team must send or receive something, a trade holds at most four teams, every team must
 * be in the season and not on Chimmy autopilot, and the validator sees every team. A two-team request
 * (no `additionalRosterIds`) is pinned by the existing proposal suites, which run unchanged.
 *
 * Harness modelled on __tests__/inactive-manager/autopilotTradeGuard.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  onAutopilot: vi.fn(async (_l: string, _owner: string) => false),
  validate: vi.fn(async (_input: unknown) => ({ ok: true, warnings: [] })),
  snapshot: vi.fn(async () => null),
  dispatch: vi.fn(async (_input: unknown) => undefined),
  postOffer: vi.fn(async () => ({ posted: true })),
  created: [] as Array<Record<string, unknown>>,
  capConfig: null as null | { id: string },
  rosters: {
    'r-1': { id: 'r-1', ownerId: 'uA', ownerName: 'Ann', teamName: 'Ann FC' },
    'r-2': { id: 'r-2', ownerId: 'uB', ownerName: 'Bob', teamName: null },
    'r-3': { id: 'r-3', ownerId: 'uC', ownerName: 'Cy', teamName: null },
    'r-4': { id: 'r-4', ownerId: 'uD', ownerName: 'Di', teamName: null },
  } as Record<string, { id: string; ownerId: string; ownerName: string; teamName: string | null }>,
}))

vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ isOwnerOnAutopilot: h.onAutopilot }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'uA' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 's-1', leagueId: 'l-1', sport: 'NFL', season: 2026 })), findUnique: vi.fn(async () => null) },
    redraftRoster: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => h.rosters[where.id] ?? null),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => h.rosters[id]).filter(Boolean)),
      count: vi.fn(async () => 4),
    },
    iDPCapConfig: { findUnique: vi.fn(async () => h.capConfig) },
    redraftTradeValueSnapshot: { findUnique: vi.fn(async () => null) },
    userProfile: { findUnique: vi.fn(async () => null) },
    league: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ name: 'L' })) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        redraftTradeProposal: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            h.created.push(data)
            return { id: 'p-1' }
          }),
          findUnique: vi.fn(async () => ({ id: 'p-1', status: 'pending', assets: [], votes: [], decision: null })),
        },
        redraftTradeAsset: { createMany: vi.fn(async () => ({ count: 1 })) },
      }),
    ),
  },
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true, status: 200 })) }))
vi.mock('@/lib/team-coowners/access', () => ({ isAcceptedCoOwnerForRedraftRoster: vi.fn(async () => false) }))
vi.mock('@/server/services/postDraftRosterLockService', () => ({ postDraftRosterMoveRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/redraft/tradeProposalValidation', () => ({ validateRedraftTradeProposalAtCreation: h.validate }))
vi.mock('@/lib/redraft/tradeGovernance', () => ({
  REDRAFT_TRADE_GOVERNANCE_REFUSAL: 'no',
  prohibitedRedraftGovernanceFields: () => [],
  resolveRedraftTradeGovernance: vi.fn(async () => ({ vetoMode: 'commissioner', vetoThreshold: null })),
}))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({ captureRedraftTradeValueSnapshot: h.snapshot }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => null) }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn(async () => null) }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: h.postOffer }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadRedraftTradeOffer: vi.fn() }))

const P = (from: string, to: string, playerId: string) => ({ fromRosterId: from, toRosterId: to, assetType: 'player', playerId, playerName: playerId })
const ring3 = [P('r-1', 'r-2', 'a1'), P('r-2', 'r-3', 'b1'), P('r-3', 'r-1', 'c1')]

async function propose(extra: Record<string, unknown>) {
  const { POST } = await import('@/app/api/redraft/trade-proposals/route')
  const res = await POST(
    createMockNextRequest('http://localhost/api/redraft/trade-proposals', {
      method: 'POST',
      body: { leagueId: 'l-1', seasonId: 's-1', proposerRosterId: 'r-1', receiverRosterId: 'r-2', ...extra },
    }) as never,
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

/** Fire-and-forget work (dynamic imports) settles before notices are asserted. */
const flush = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  vi.clearAllMocks()
  h.created = []
  h.capConfig = null
  h.onAutopilot.mockResolvedValue(false)
})

describe('creating a three-team trade', () => {
  it('stores the extra team, validates every team, and notifies both partners', async () => {
    const r = await propose({ additionalRosterIds: ['r-3'], assets: ring3 })
    expect(r.status).toBe(200)
    expect(h.created[0]).toMatchObject({ proposerRosterId: 'r-1', receiverRosterId: 'r-2', additionalRosterIds: ['r-3'] })
    expect(h.validate.mock.calls[0]![0]).toMatchObject({ additionalRosterIds: ['r-3'] })
    expect(h.onAutopilot).toHaveBeenCalledWith('l-1', 'uB')
    expect(h.onAutopilot).toHaveBeenCalledWith('l-1', 'uC')
    // Two-sided valuation is not captured for a multi-team trade.
    expect(h.snapshot).not.toHaveBeenCalled()
    await flush()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect((h.dispatch.mock.calls[0]![0] as { userIds: string[] }).userIds.sort()).toEqual(['uB', 'uC'])
    expect(h.postOffer).not.toHaveBeenCalled()
  })

  it('refuses an asset that moves to a team outside the trade', async () => {
    const r = await propose({ additionalRosterIds: ['r-3'], assets: [...ring3, P('r-1', 'r-4', 'a2')] })
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Asset roster direction is invalid')
    expect(h.created).toHaveLength(0)
  })

  it('refuses a team that neither sends nor receives anything', async () => {
    const r = await propose({ additionalRosterIds: ['r-3'], assets: [P('r-1', 'r-2', 'a1'), P('r-2', 'r-1', 'b1')] })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('TEAM_NOT_IN_TRADE')
    expect(h.created).toHaveLength(0)
  })

  it('refuses a fifth team', async () => {
    const r = await propose({ additionalRosterIds: ['r-3', 'r-4', 'r-5'], assets: ring3 })
    expect(r.status).toBe(400)
    expect(String(r.json.error)).toMatch(/at most 4 teams/)
    expect(h.created).toHaveLength(0)
  })

  it('accepts a four-team trade', async () => {
    const r = await propose({ additionalRosterIds: ['r-3', 'r-4'], assets: [...ring3, P('r-1', 'r-4', 'a2')] })
    expect(r.status).toBe(200)
    expect(h.created[0]).toMatchObject({ additionalRosterIds: ['r-3', 'r-4'] })
  })

  it('refuses an extra team that is not in the season', async () => {
    const r = await propose({ additionalRosterIds: ['r-9'], assets: ring3 })
    expect(r.status).toBe(404)
    expect(h.created).toHaveLength(0)
  })

  it('refuses when the extra team is on Chimmy autopilot', async () => {
    h.onAutopilot.mockImplementation(async (_l: string, owner: string) => owner === 'uC')
    const r = await propose({ additionalRosterIds: ['r-3'], assets: ring3 })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('RECEIVER_ON_AUTOPILOT')
    expect(h.created).toHaveLength(0)
  })

  it('refuses a multi-team trade in an IDP salary-cap league', async () => {
    h.capConfig = { id: 'cap-1' }
    const r = await propose({ additionalRosterIds: ['r-3'], assets: ring3 })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('MULTI_TEAM_CAP_LEAGUE')
    expect(h.created).toHaveLength(0)
  })

  it('a two-team request stores no extra teams and passes none to the validator', async () => {
    const r = await propose({ assets: [P('r-1', 'r-2', 'a1')] })
    expect(r.status).toBe(200)
    expect(h.created[0]).not.toHaveProperty('additionalRosterIds')
    expect(h.validate.mock.calls[0]![0]).not.toHaveProperty('additionalRosterIds')
  })
})
