// @vitest-environment node
/**
 * The NATIVE waiver run (lib/waiver-wire/process-engine.ts) checks availability against `Roster.playerData`.
 * The redraft engine (the hourly window run, the waiver runtime's add) awards into `RedraftRosterPlayer`
 * only, so a player it put on team B still looked free to the run, which could award him to team A as
 * well: one player, two rosters. The run now asks the same cross-engine question the native instant add
 * asks (lib/waiver-wire/redraftRosterHolder.ts), with the same scope: native leagues, the newest season,
 * the claiming team's own row excluded. The real helper runs here against a fake DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

type RedraftRow = { rosterId: string; seasonId: string; playerId: string; ownerId: string; droppedAt: Date | null }

const h = vi.hoisted(() => ({
  claims: [] as unknown[],
  rosters: [] as Array<{ id: string; playerData: unknown; waiverPriority: number; faabRemaining: number; redraftRosterId: string | null; platformUserId: string }>,
  league: {} as Record<string, unknown>,
  seasons: [] as Array<{ id: string; createdAt: number }>,
  redraftRows: [] as RedraftRow[],
  redraftReadThrows: false,
  claimUpdate: vi.fn(),
  rosterUpdate: vi.fn(),
  txnCreate: vi.fn(),
  resultCreateMany: vi.fn(),
  tx: vi.fn(),
  moves: vi.fn(),
  hook: vi.fn(),
  holderRead: vi.fn(),
}))

vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: async () => ({ ok: true, backend: 'postgres' }),
  releaseAutomationLock: async () => {},
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => h.league },
    waiverClaim: { findMany: async () => h.claims, update: h.claimUpdate },
    roster: {
      findMany: async () => h.rosters,
      update: h.rosterUpdate,
      findUnique: async () => null,
      findFirst: async ({ where }: { where: { id: string } }) => {
        const r = h.rosters.find((x) => x.id === where.id)
        return r ? { id: r.id, redraftRosterId: r.redraftRosterId, platformUserId: r.platformUserId } : null
      },
    },
    leagueTeam: { findMany: async () => [] },
    waiverRun: { create: async () => ({ id: 'run' }), update: async () => ({}) },
    waiverTransaction: { create: h.txnCreate, findMany: async () => [] },
    waiverResult: { createMany: h.resultCreateMany },
    redraftSeason: {
      findFirst: async () => {
        const newest = [...h.seasons].sort((a, b) => b.createdAt - a.createdAt)[0]
        return newest ? { id: newest.id } : null
      },
    },
    redraftRosterPlayer: {
      findFirst: async ({ where }: { where: { playerId: string; droppedAt: null; roster: { seasonId: string; leagueId: string } } }) => {
        h.holderRead(where)
        if (h.redraftReadThrows) throw new Error('db down')
        const row = h.redraftRows.find(
          (r) => r.playerId === where.playerId && r.droppedAt === null && r.seasonId === where.roster.seasonId,
        )
        return row ? { rosterId: row.rosterId, roster: { ownerId: row.ownerId } } : null
      },
    },
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
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NFL' }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ planRedraftRosterMoveWrites: h.moves }))
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: async () => null }))
vi.mock('@/lib/guillotine/chopBeforeWaivers', () => ({ guillotineChopPendingForWaivers: async () => ({ hold: false }) }))
vi.mock('@/lib/league/faabMirror', () => ({ copyGenericFaabToRedraft: async () => {} }))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'

const NATIVE = { id: 'L', platform: 'allfantasy', rosterSize: 20, sport: 'NFL', isDynasty: false, leagueType: 'redraft', settings: {}, timezone: null, waiverHours: 0 }

function claim(rosterId: string, addPlayerId: string, faabBid: number, waiverPriority = 1): Claim {
  return {
    id: `c-${rosterId}-${addPlayerId}`, leagueId: 'L', rosterId, addPlayerId, dropPlayerId: null, faabBid, priorityOrder: 1,
    status: 'pending', metadata: null,
    roster: { id: rosterId, platformUserId: `u${rosterId}`, playerData: [], faabRemaining: 100, waiverPriority },
  }
}

/** Generic rosters A/B/C, linked to redraft rosters rA/rB/rC owned by uA/uB/uC. */
function setRosters(held: Record<string, string[]> = {}) {
  h.rosters = ['A', 'B', 'C'].map((id, i) => ({
    id, playerData: held[id] ?? [], waiverPriority: i + 1, faabRemaining: 100, redraftRosterId: `r${id}`, platformUserId: `u${id}`,
  }))
}

/** `player` live on redraft roster `r<team>` in `seasonId`, written by the redraft engine only. */
function redraftHeld(team: string, player: string, seasonId = 'S2', droppedAt: Date | null = null) {
  h.redraftRows.push({ rosterId: `r${team}`, seasonId, playerId: player, ownerId: `u${team}`, droppedAt })
}

const run = () => processWaiverClaimsForLeague('L', { runType: 'manual' })

function claimWrite(claimId: string) {
  return h.claimUpdate.mock.calls.find((c) => c[0].where.id === claimId)?.[0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  h.league = NATIVE
  h.seasons = [{ id: 'S1', createdAt: 1 }, { id: 'S2', createdAt: 2 }]
  h.redraftRows = []
  h.redraftReadThrows = false
  h.claimUpdate.mockReturnValue({})
  h.rosterUpdate.mockReturnValue({})
  h.txnCreate.mockReturnValue({})
  h.tx.mockResolvedValue([])
  h.moves.mockResolvedValue([])
  h.hook.mockResolvedValue(undefined)
  setRosters()
})

describe('native waiver run: a player the redraft engine put on another team', () => {
  it('fails the claim as no longer available; nothing awarded, no FAAB spent', async () => {
    redraftHeld('B', '7001')
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: false, message: 'Player no longer available.', outcomeCode: 'player_no_longer_available' })
    expect(claimWrite('c-A-7001')).toMatchObject({
      status: 'failed',
      resultMessage: 'Player no longer available.',
      metadata: { outcomeCode: 'player_no_longer_available', competingRedraftRosterId: 'rB' },
    })
    expect(h.tx).not.toHaveBeenCalled()
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    expect(h.moves).not.toHaveBeenCalled()
    // The read is scoped to the league's newest season.
    expect(h.holderRead).toHaveBeenCalledWith(expect.objectContaining({ playerId: '7001', roster: { seasonId: 'S2', leagueId: 'L' } }))
  })

  it('the next claim in priority order still runs: a different player is awarded', async () => {
    redraftHeld('B', '7001')
    h.claims = [claim('A', '7001', 12, 1), claim('C', '7002', 5, 3)]
    const results = await run()
    expect(results.map((r) => [r.rosterId, r.success])).toEqual([['A', false], ['C', true]])
    expect(h.tx).toHaveBeenCalledTimes(1)
  })

  it('a free player is awarded as before', async () => {
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001', faabSpent: 12 })
    expect(h.tx).toHaveBeenCalledTimes(1)
  })

  it("the claiming team's own redraft row does not block it", async () => {
    redraftHeld('A', '7001')
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001' })
  })

  it('a dropped redraft row, or one from last season, does not block it', async () => {
    redraftHeld('B', '7001', 'S2', new Date())
    redraftHeld('C', '7001', 'S1')
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001' })
  })

  it('an imported league is not cross-checked: its redraft rows are a shadow', async () => {
    h.league = { ...NATIVE, platform: 'sleeper' }
    redraftHeld('B', '7001')
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001' })
    expect(h.holderRead).not.toHaveBeenCalled()
  })

  it('an unreadable redraft roster does not stop the run (fail-open, like the instant add)', async () => {
    h.redraftReadThrows = true
    h.claims = [claim('A', '7001', 12)]
    const [r] = await run()
    expect(r).toMatchObject({ success: true, addPlayerId: '7001' })
  })
})
