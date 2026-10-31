// @vitest-environment node
/**
 * The waiver PROCESSOR re-checks a `fantrax:` NHL prospect claim when it is about to award it
 * (lib/waiver-wire/process-engine.ts → resolveNhlProspectClaimAward in nhlProspectFreeAgency.ts).
 * Submit-time validation (#3063) is not enough: the weekly Fantrax link can attach him to an NHL
 * identity while the claim waits, and another team may then hold the same man under his pro id.
 *
 *   still a free prospect          → awarded as `fantrax:X`
 *   linked, his pro player free    → awarded under his pro roster id (rollingInsightsId)
 *   rostered elsewhere (either id) → failed, `player_no_longer_available`, no FAAB spent
 *   refused by the rule            → failed the same way
 *   universe / registry unreadable → failed (closed)
 *   a non-prospect claim           → untouched: no new read, awarded as before
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITIES, prospectDb } from './nhl-prospect-fixture'

type Claim = {
  id: string
  leagueId: string
  rosterId: string
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number
  priorityOrder: number
  status: string
  metadata: unknown
  roster: { id: string; platformUserId: string; playerData: unknown; faabRemaining: number; waiverPriority: number }
}

const h = vi.hoisted(() => ({
  claims: [] as unknown[],
  rosters: [] as Array<{ id: string; playerData: unknown; waiverPriority: number; faabRemaining: number }>,
  league: {} as Record<string, unknown>,
  identities: null as null | Array<Record<string, unknown>>,
  sportsPlayers: [] as Array<{ id: string; externalId: string }>,
  sportsPlayerThrows: false,
  db: null as null | ReturnType<typeof import('./nhl-prospect-fixture').prospectDb>,
  leagueFindUnique: vi.fn(),
  claimUpdate: vi.fn(),
  rosterUpdate: vi.fn(),
  txnCreate: vi.fn(),
  resultCreateMany: vi.fn(),
  tx: vi.fn(),
  moves: vi.fn(),
  hook: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    waiverClaim: { findMany: async () => h.claims, update: h.claimUpdate },
    roster: { findMany: async () => h.rosters, update: h.rosterUpdate, findUnique: async () => null },
    leagueTeam: { findMany: async () => [] },
    waiverRun: { create: async () => ({ id: 'run' }), update: async () => ({}) },
    waiverTransaction: { create: h.txnCreate, findMany: async () => [] },
    waiverResult: { createMany: h.resultCreateMany },
    sportsDataCache: { findUnique: (a: never) => h.db!.sportsDataCache.findUnique(a) },
    playerIdentityMap: { findMany: (a: never) => h.db!.playerIdentityMap.findMany(a) },
    sportsPlayer: { findMany: h.sportsPlayerFindMany },
    $transaction: h.tx,
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'faab', normalizedWaiverType: 'faab', waiverEngineConfig: {}, allowZeroFaabBid: true }),
}))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: h.hook }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverRunPhaseGate: async () => () => null }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/redraft/tradeMoveLock', () => ({ isRedraftLeagueMovesLocked: async () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NHL' }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ planRedraftRosterMoveWrites: h.moves }))
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: async () => null }))
vi.mock('@/lib/league/faabMirror', () => ({ copyGenericFaabToRedraft: async () => {} }))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import {
  AWARD_TAKEN_BY_OTHER_MESSAGE,
  PROSPECT_AWARD_AMBIGUOUS_LINK_MESSAGE,
  PROSPECT_AWARD_NOT_IN_LEAGUE_MESSAGE,
  PROSPECT_AWARD_NOT_ON_LIST_MESSAGE,
  PROSPECT_AWARD_UNREADABLE_MESSAGE,
} from '@/lib/waiver-wire/nhlProspectFreeAgency'

const NHL_DYNASTY = { id: 'L', rosterSize: 20, sport: 'NHL', isDynasty: true, leagueType: 'dynasty', settings: {}, timezone: null, waiverHours: 0 }
const NHL_REDRAFT = { ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' }

function claim(rosterId: string, addPlayerId: string, faabBid: number, waiverPriority = 1): Claim {
  return {
    id: `c-${rosterId}-${addPlayerId}`, leagueId: 'L', rosterId, addPlayerId, dropPlayerId: null, faabBid, priorityOrder: 1,
    status: 'pending', metadata: null,
    roster: { id: rosterId, platformUserId: `u${rosterId}`, playerData: [], faabRemaining: 100, waiverPriority },
  }
}

function setRosters(held: Record<string, string[]> = {}) {
  h.rosters = ['A', 'B', 'C'].map((id, i) => ({ id, playerData: held[id] ?? [], waiverPriority: i + 1, faabRemaining: 100 }))
}

const run = () => processWaiverClaimsForLeague('L', { runType: 'manual' })

/** What the processor wrote for one claim: its `waiverClaim.update` data. */
function claimWrite(claimId: string) {
  const call = h.claimUpdate.mock.calls.find((c) => c[0].where.id === claimId)
  return call?.[0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = prospectDb()
  h.league = NHL_DYNASTY
  h.leagueFindUnique.mockImplementation(async () => h.league)
  h.claimUpdate.mockReturnValue({})
  h.rosterUpdate.mockReturnValue({})
  h.txnCreate.mockReturnValue({})
  h.tx.mockResolvedValue([])
  h.moves.mockResolvedValue([])
  h.hook.mockResolvedValue(undefined)
  h.sportsPlayers = [{ id: 'sp-uuid-5001', externalId: '5001' }]
  h.sportsPlayerThrows = false
  h.sportsPlayerFindMany.mockImplementation(async (args: { where: { OR: Array<{ externalId?: { in: string[] } }> } }) => {
    if (h.sportsPlayerThrows) throw new Error('db down')
    const ids = args.where.OR.flatMap((o) => o.externalId?.in ?? [])
    return h.sportsPlayers.filter((p) => ids.includes(p.externalId)).map((p) => ({ id: p.id }))
  })
  setRosters()
})

describe('award-time re-check of a fantrax: prospect claim', () => {
  it('still a free prospect: awarded as fantrax:X, FAAB spent', async () => {
    h.claims = [claim('A', 'fantrax:04qyh', 7)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: 'fantrax:04qyh', faabSpent: 7, outcomeCode: 'won' })
    expect(h.rosterUpdate.mock.calls[0][0].data).toMatchObject({ playerData: ['fantrax:04qyh'], faabRemaining: 93 })
    expect(h.txnCreate.mock.calls[0][0].data.addPlayerId).toBe('fantrax:04qyh')
    expect(h.moves.mock.calls[0][1].moves[0].playerId).toBe('fantrax:04qyh')
    expect(claimWrite('c-A-fantrax:04qyh')).toMatchObject({ status: 'processed', resultMessage: 'Awarded' })
  })

  it('linked to an NHL identity whose pro player is free: awarded under his pro id, not the stale fantrax: id', async () => {
    h.claims = [claim('A', 'fantrax:04lnk', 9)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '5001', faabSpent: 9 })
    const playerData = h.rosterUpdate.mock.calls[0][0].data.playerData
    expect(playerData).toEqual(['5001'])
    expect(JSON.stringify(playerData)).not.toContain('fantrax:')
    expect(h.txnCreate.mock.calls[0][0].data.addPlayerId).toBe('5001')
    // The scoring row is written for the pro id (redraftRosterMoveSync resolves his SportsPlayer).
    expect(h.moves.mock.calls[0][1].moves[0]).toEqual({ playerId: '5001', fromRosterId: null, toRosterId: 'A' })
    const rows = h.resultCreateMany.mock.calls[0][0].data
    expect(rows[0]).toMatchObject({ addPlayerId: '5001', resultType: 'awarded', metadata: { claimedPlayerId: 'fantrax:04lnk' } })
  })

  it.each([
    ['his Rolling Insights id (a draft)', '5001'],
    ['his pool row id (a free-agent add)', 'sp-uuid-5001'],
    ['his identity id', 'idm-linked'],
  ])('linked, and another team holds him under %s: failed as an unavailable player, no FAAB spent', async (_label, heldId) => {
    setRosters({ B: [heldId] })
    h.claims = [claim('A', 'fantrax:04lnk', 9)]
    const [r] = await run()
    expect(r).toMatchObject({ success: false, message: AWARD_TAKEN_BY_OTHER_MESSAGE, outcomeCode: 'player_no_longer_available' })
    expect(claimWrite('c-A-fantrax:04lnk')).toMatchObject({
      status: 'failed',
      resultMessage: AWARD_TAKEN_BY_OTHER_MESSAGE,
      metadata: { outcomeCode: 'player_no_longer_available', competingRosterId: 'B' },
    })
    expect(h.tx).not.toHaveBeenCalled()
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    // The manager is told through the run hook's "not awarded" notice, like any lost claim.
    expect(h.hook.mock.calls[0][1]).toEqual([expect.objectContaining({ success: false, rosterId: 'A' })])
  })

  it('rostered elsewhere under the fantrax: id itself: failed by the existing check', async () => {
    setRosters({ C: ['fantrax:04qyh'] })
    h.claims = [claim('A', 'fantrax:04qyh', 3)]
    const [r] = await run()
    expect(r).toMatchObject({ success: false, outcomeCode: 'player_no_longer_available' })
    expect(h.tx).not.toHaveBeenCalled()
  })

  it('in one run: the winner gets him under his pro id, and the next claim on either id loses', async () => {
    // C claims him by his pool row id — a different string from the one A was awarded under.
    h.claims = [claim('A', 'fantrax:04lnk', 20, 1), claim('B', 'fantrax:04lnk', 10, 2), claim('C', 'sp-uuid-5001', 5, 3)]
    const results = await run()
    expect(results.map((r) => [r.rosterId, r.success, r.addPlayerId])).toEqual([
      ['A', true, '5001'],
      ['B', false, 'fantrax:04lnk'],
      ['C', false, 'sp-uuid-5001'],
    ])
    expect(results[1]).toMatchObject({ message: AWARD_TAKEN_BY_OTHER_MESSAGE, outcomeCode: 'player_no_longer_available' })
    expect(h.tx).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['outside NHL dynasty', () => { h.league = NHL_REDRAFT }, 'fantrax:04qyh', PROSPECT_AWARD_NOT_IN_LEAGUE_MESSAGE, 'player_no_longer_available'],
    ['not on the stored list', () => {}, 'fantrax:zzzzz', PROSPECT_AWARD_NOT_ON_LIST_MESSAGE, 'player_no_longer_available'],
    ['his Fantrax id carried by two identities', () => {
      h.db!.playerIdentityMap.findMany.mockImplementation(async () => [
        { ...IDENTITIES[0] },
        { ...IDENTITIES[0], id: 'idm-other', rollingInsightsId: '5002' },
      ])
    }, 'fantrax:04lnk', PROSPECT_AWARD_AMBIGUOUS_LINK_MESSAGE, 'player_no_longer_available'],
    ['the universe unreadable', () => { h.db = prospectDb({ universe: 'throw' }) }, 'fantrax:04qyh', PROSPECT_AWARD_UNREADABLE_MESSAGE, 'failed'],
    ['the identity registry unreadable', () => {
      h.db!.playerIdentityMap.findMany.mockImplementation(async () => { throw new Error('db down') })
    }, 'fantrax:04qyh', PROSPECT_AWARD_UNREADABLE_MESSAGE, 'failed'],
    ['the pool rows unreadable', () => { h.sportsPlayerThrows = true }, 'fantrax:04lnk', PROSPECT_AWARD_UNREADABLE_MESSAGE, 'failed'],
    ['the league unreadable', () => { h.leagueFindUnique.mockImplementation(async (a: { select: Record<string, true> }) => {
      if (a.select.isDynasty) throw new Error('db down')
      return NHL_DYNASTY
    }) }, 'fantrax:04qyh', PROSPECT_AWARD_UNREADABLE_MESSAGE, 'failed'],
  ])('refused (%s): failed, nothing awarded, no FAAB spent', async (_label, arrange, addId, message, outcomeCode) => {
    arrange()
    h.claims = [claim('A', addId, 4)]
    const [r] = await run()
    expect(r).toMatchObject({ success: false, message, outcomeCode })
    expect(claimWrite(`c-A-${addId}`)).toMatchObject({ status: 'failed', resultMessage: message })
    expect(h.tx).not.toHaveBeenCalled()
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })
})

describe('a non-prospect claim is untouched', () => {
  it('awards as before and reads nothing the prospect rule reads', async () => {
    h.claims = [claim('A', '7001', 5)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001', faabSpent: 5 })
    expect(h.leagueFindUnique).toHaveBeenCalledTimes(1)
    expect(h.leagueFindUnique.mock.calls[0][0].select.isDynasty).toBeUndefined()
    expect(h.db!.sportsDataCache.findUnique).not.toHaveBeenCalled()
    expect(h.db!.playerIdentityMap.findMany).not.toHaveBeenCalled()
    expect(h.sportsPlayerFindMany).not.toHaveBeenCalled()
    expect(h.resultCreateMany.mock.calls[0][0].data[0].metadata).toBeUndefined()
  })
})
