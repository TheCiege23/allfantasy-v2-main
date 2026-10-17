/**
 * `evaluateStoredTrade()` — an existing trade → the one engine → one receipt, with real rosters,
 * the pending-trade roster rule, freshness, and the viewer's perspective.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  canonicalAssets,
  checkRosters,
  evaluateStoredTrade,
  gradeInputsOf,
  rostersAreStale,
  withCanonicalRosters,
  type EvaluateStoredTradeDeps,
} from '@/lib/decision-os/trade/evaluateStoredTrade'
import type { LoadTradeDeps } from '@/lib/decision-os/trade/loadTrade'
import type { LoadedTrade } from '@/lib/decision-os/trade/tradeRecord'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

const NOW = new Date('2026-09-27T12:00:00Z')

const trade = (over: Partial<LoadedTrade> = {}): LoadedTrade => ({
  id: 'T1', leagueId: 'L1', sport: 'NFL', status: 'proposed',
  origin: { source: 'af', platform: 'native', externalLeagueId: null, externalTradeId: null, deepLink: null, rostersSyncedAt: NOW.toISOString(), rawStatus: 'pending' },
  sideA: { teamId: 'r1', rosterId: 'r1', gives: [{ kind: 'player', playerId: '4984', name: 'Josh Allen', position: 'QB' }] },
  sideB: { teamId: 'r2', rosterId: 'r2', gives: [{ kind: 'pick', season: 2027, round: 1, originalTeamId: 'r2', label: '2027 1st' }, { kind: 'faab', amount: 10 }] },
  proposedAt: null, completedAt: null,
  ...over,
})

const world = (rosters: Array<{ rosterId: string; teamId: string; playerIds: string[] }>, teams: Array<{ teamId: string; sourceTeamId: string }> = []) =>
  ({
    league: { season: 2026 },
    teams: teams.map((t) => ({ teamId: t.teamId, source: { sourceTeamId: t.sourceTeamId } })),
    rosters,
  }) as unknown as CanonicalWorld

describe('pure pieces', () => {
  it('grade input is by NAME for players; picks and FAAB as themselves', () => {
    expect(gradeInputsOf(trade().sideB.gives)).toEqual({ assets: [{ kind: 'pick', year: 2027, round: 1, label: '2027 1st' }, { kind: 'faab', amount: 10 }], unpriceable: [] })
    // The stored roster id rides along for a college redraft grade; the chart path never reads it.
    expect(gradeInputsOf(trade().sideA.gives).assets).toEqual([{ kind: 'player', name: 'Josh Allen', rosterPlayerId: '4984' }])
  })

  it('a Sleeper ledger trade gets canonical rosters through the world’s team source ids', () => {
    const t = trade({
      origin: { ...trade().origin, source: 'provider', platform: 'sleeper' },
      sideA: { teamId: '3', rosterId: null, gives: [] },
      sideB: { teamId: '7', rosterId: null, gives: [{ kind: 'pick', season: 2027, round: 1, originalTeamId: '7', label: '2027 1st' }] },
    })
    const w = world([{ rosterId: 'R3', teamId: 'T3', playerIds: [] }, { rosterId: 'R7', teamId: 'T7', playerIds: [] }], [{ teamId: 'T3', sourceTeamId: '3' }, { teamId: 'T7', sourceTeamId: '7' }])
    const out = withCanonicalRosters(t, w)
    expect([out.sideA.rosterId, out.sideB.rosterId]).toEqual(['R3', 'R7'])
    expect(out.sideB.gives[0]).toMatchObject({ originalTeamId: 'R7' })
  })

  it('roster rule: a pending trade whose player has left the sending roster fails; settled trades are not checked', () => {
    const w = world([{ rosterId: 'r1', teamId: 't1', playerIds: ['111'] }, { rosterId: 'r2', teamId: 't2', playerIds: [] }])
    expect(checkRosters(trade(), w)).toEqual({ check: 'unverified', moved: ['Josh Allen'] })
    expect(checkRosters(trade({ status: 'completed' }), w)).toEqual({ check: 'not_applicable', moved: [] })
    const held = world([{ rosterId: 'r1', teamId: 't1', playerIds: ['4984'] }, { rosterId: 'r2', teamId: 't2', playerIds: [] }])
    expect(checkRosters(trade(), held)).toEqual({ check: 'passed', moved: [] })
    expect(checkRosters(trade(), null)).toEqual({ check: 'unverified', moved: [] })
  })

  it('imported rosters older than 10 minutes are stale; native never is', () => {
    const imported = (at: string | null) => trade({ origin: { ...trade().origin, platform: 'sleeper', rostersSyncedAt: at } })
    expect(rostersAreStale(imported('2026-09-27T11:55:00Z'), NOW)).toBe(false)
    expect(rostersAreStale(imported('2026-09-27T11:45:00Z'), NOW)).toBe(true)
    expect(rostersAreStale(imported(null), NOW)).toBe(true)
    expect(rostersAreStale(trade(), NOW)).toBe(false)
  })

  it('canonical asset rows carry the side’s Roster ids and each asset’s identity', () => {
    const rows = canonicalAssets(trade().sideA, trade().sideB)
    expect(rows).toEqual([expect.objectContaining({ fromRosterId: 'r1', toRosterId: 'r2', assetType: 'player', playerId: '4984', playerName: 'Josh Allen' })])
  })
})

describe('evaluateStoredTrade', () => {
  const loadOk = (side: 'A' | 'B' | null, t = trade()) =>
    ({
      now: () => NOW,
      isMember: async () => true,
      isCommissioner: async () => side === null,
      viewerIdentity: async () => ({ rosterId: side === 'B' ? 'r2' : side === 'A' ? 'r1' : 'r9', redraftRosterId: null, externalTeamIds: [] }),
      loadLeague: async () => ({ id: 'L1', platform: 'manual', platformLeagueId: '', sport: 'NFL', season: 2026, lastSyncedAt: null, name: null }),
      loadAfTrade: async () => ({
        id: t.id, leagueId: 'L1', status: t.status === 'completed' ? 'processed' : 'pending', proposerRosterId: 'r1', receiverRosterId: 'r2',
        createdAt: NOW, processedAt: null, expiresAt: null, metadata: {},
        items: [
          { itemType: 'player', itemReference: '4984', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: null, metadata: null },
          { itemType: 'future_pick', itemReference: 'fdp:2027:1:r2', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: null, metadata: {} },
        ],
      }),
      resolvePlayers: async (ids: readonly string[]) => new Map(ids.map((id) => [id, { ok: true as const, name: 'Josh Allen', position: 'QB' }])),
    }) satisfies Partial<LoadTradeDeps>

  const run = (side: 'A' | 'B' | null, over: Partial<EvaluateStoredTradeDeps> = {}) => {
    const evaluate = vi.fn(async (input: Parameters<EvaluateStoredTradeDeps['evaluate']>[0]) => ({ receiptFor: input }) as never)
    return {
      evaluate,
      result: evaluateStoredTrade(
        { leagueId: 'L1', ref: { kind: 'af', tradeId: 'T1' }, userId: 'u1' },
        {
          now: () => NOW,
          loadDeps: loadOk(side),
          resolveWorld: async () => world([{ rosterId: 'r1', teamId: 't1', playerIds: ['4984'] }, { rosterId: 'r2', teamId: 't2', playerIds: [] }]),
          evaluate,
          ...over,
        },
      ),
    }
  }

  it('grades from the viewer’s side, with real rosters, lineup impact for a pending trade, and the trade on the receipt', async () => {
    const { evaluate, result } = run('A')
    expect(await result).toMatchObject({ ok: true, perspectiveTeamId: 'r1', viewerInTrade: true })
    const input = evaluate.mock.calls[0]![0]
    expect(input).toMatchObject({
      leagueId: 'L1',
      viewerSide: true,
      give: { assets: [{ kind: 'player', name: 'Josh Allen' }] },
      get: { assets: [{ kind: 'pick', year: 2027, round: 1 }] },
      canonical: { proposerRosterId: 'r1', receiverRosterId: 'r2', includeRosterImpact: true, currentSeason: 2026 },
      stored: { tradeId: 'T1', source: 'af', status: 'proposed', rostersStale: false, rosterCheck: 'passed', ref: { kind: 'af', tradeId: 'T1' } },
    })
  })

  it('the receiving manager is graded from THEIR side — give and get swap', async () => {
    const { evaluate, result } = run('B')
    expect(await result).toMatchObject({ ok: true, perspectiveTeamId: 'r2' })
    const input = evaluate.mock.calls[0]![0]
    expect(input.give.assets).toEqual([{ kind: 'pick', year: 2027, round: 1, label: '2027 1st' }])
    expect(input.canonical).toMatchObject({ proposerRosterId: 'r2', receiverRosterId: 'r1' })
  })

  it('a commissioner reads a pending trade from side A, as a neutral read with no roster need', async () => {
    const { evaluate, result } = run(null)
    expect(await result).toMatchObject({ ok: true, viewerInTrade: false, perspectiveTeamId: 'r1' })
    expect(evaluate.mock.calls[0]![0].viewerSide).toBe(false)
  })

  it('refuses a pending trade whose player already left the sending roster — and grades nothing', async () => {
    const { evaluate, result } = run('A', {
      resolveWorld: async () => world([{ rosterId: 'r1', teamId: 't1', playerIds: [] }, { rosterId: 'r2', teamId: 't2', playerIds: [] }]),
    })
    expect(await result).toMatchObject({ ok: false, refusal: { code: 'asset_moved', missingAssets: ['Josh Allen'] } })
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('no world: still graded by name, no canonical half, roster rule marked unverified', async () => {
    const { evaluate, result } = run('A', { resolveWorld: async () => null })
    expect(await result).toMatchObject({ ok: true })
    expect(evaluate.mock.calls[0]![0]).toMatchObject({ canonical: null, stored: { rosterCheck: 'unverified' } })
  })

  it('a loadTrade refusal comes straight back, and nothing is graded', async () => {
    const { evaluate, result } = run('A', { loadDeps: { ...loadOk('A'), isMember: async () => false } })
    expect(await result).toMatchObject({ ok: false, refusal: { code: 'not_member' } })
    expect(evaluate).not.toHaveBeenCalled()
  })
})

describe('evaluateStoredTrade — the team-benefit shadow', () => {
  it('runs the model from the perspective side and hands its result to the engine', async () => {
    const teamBenefit = vi.fn(async () => ({ ok: false as const, reason: 'nfl only', missingAssets: [] }))
    const evaluate = vi.fn(async () => ({}) as never)
    await evaluateStoredTrade(
      { leagueId: 'L1', ref: { kind: 'af', tradeId: 'T1' }, userId: 'u1' },
      {
        now: () => NOW,
        loadDeps: {
          now: () => NOW, isMember: async () => true, isCommissioner: async () => false,
          viewerIdentity: async () => ({ rosterId: 'r2', redraftRosterId: null, externalTeamIds: [] }),
          loadLeague: async () => ({ id: 'L1', platform: 'manual', platformLeagueId: '', sport: 'NFL', season: 2026, lastSyncedAt: null, name: null }),
          loadAfTrade: async () => ({
            id: 'T1', leagueId: 'L1', status: 'pending', proposerRosterId: 'r1', receiverRosterId: 'r2', createdAt: NOW, processedAt: null, expiresAt: null, metadata: {},
            items: [
              { itemType: 'player', itemReference: '4984', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: null, metadata: null },
              { itemType: 'player', itemReference: '5000', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: null, metadata: null },
            ],
          }),
          resolvePlayers: async (ids: readonly string[]) => new Map(ids.map((id) => [id, { ok: true as const, name: `P${id}`, position: 'RB' }])),
        },
        resolveWorld: async () => world([{ rosterId: 'r1', teamId: 't1', playerIds: ['4984'] }, { rosterId: 'r2', teamId: 't2', playerIds: ['5000'] }]),
        evaluate,
        teamBenefit,
      },
    )
    // The viewer is r2, so r2 is "me".
    expect(teamBenefit).toHaveBeenCalledWith(expect.objectContaining({ me: expect.objectContaining({ rosterId: 'r2' }), them: expect.objectContaining({ rosterId: 'r1' }) }))
    expect(evaluate.mock.calls[0]![0]).toMatchObject({ teamBenefit: { ok: false, reason: 'nfl only' } })
  })
})
