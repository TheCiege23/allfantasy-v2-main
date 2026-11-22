/**
 * Multi-team (3- and 4-team) native redraft trades: the pure pieces and the settlement.
 *
 *   - lib/redraft/tradeParticipants.ts — who is in the trade, who still has to accept
 *   - validateNflRedraftTradeProposal — the creation validator, run for EVERY team of the trade
 *   - settleRedraftTradeAssets — every asset lands on the roster it was sent to, FAAB across 3 rosters
 *   - voidPendingRedraftTradesForRoster — finds a trade the roster is only a third team in
 *
 * Every two-team behaviour these touch is pinned by the existing suites (trade-settlement,
 * g39-nfl-redraft-trade-runtime, trade-proposal-validation), which run unchanged.
 */
import { describe, expect, it, vi } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import {
  buildNflRedraftTradeRuntimeState,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeRosterInput,
} from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import {
  MAX_REDRAFT_TRADE_TEAMS,
  allTradePartiesAccepted,
  isMultiTeamTrade,
  normalizeAdditionalRosterIds,
  tradeParticipantRosterIds,
  tradePartiesPendingAcceptance,
  tradePartiesToAccept,
  uninvolvedTradeParticipants,
} from '@/lib/redraft/tradeParticipants'
import { settleRedraftTradeAssets, type SettlementAssetRow } from '@/lib/redraft/tradeSettlement'

const voidDb = vi.hoisted(() => ({
  proposalUpdateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
  legacyUpdateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S' })) },
    redraftTradeProposal: { updateMany: voidDb.proposalUpdateMany },
    redraftLeagueTrade: { updateMany: voidDb.legacyUpdateMany },
  },
}))

// ── participants ────────────────────────────────────────────────────────────────────────────────

describe('tradeParticipants', () => {
  const three = { proposerRosterId: 'A', receiverRosterId: 'B', additionalRosterIds: ['C'] }

  it('a two-team trade is the pair it always was, and only the receiver accepts', () => {
    const two = { proposerRosterId: 'A', receiverRosterId: 'B' }
    expect(isMultiTeamTrade(two)).toBe(false)
    expect(tradeParticipantRosterIds(two)).toEqual(['A', 'B'])
    expect(tradePartiesToAccept(two)).toEqual(['B'])
  })

  it('a three-team trade needs both non-proposer teams', () => {
    expect(isMultiTeamTrade(three)).toBe(true)
    expect(tradeParticipantRosterIds(three)).toEqual(['A', 'B', 'C'])
    expect(tradePartiesPendingAcceptance({ ...three, acceptedRosterIds: ['B'] })).toEqual(['C'])
    expect(allTradePartiesAccepted({ ...three, acceptedRosterIds: ['B'] })).toBe(false)
    expect(allTradePartiesAccepted({ ...three, acceptedRosterIds: ['C', 'B'] })).toBe(true)
  })

  it('caps a trade at four teams and refuses a team listed twice', () => {
    expect(MAX_REDRAFT_TRADE_TEAMS).toBe(4)
    expect(normalizeAdditionalRosterIds(undefined, 'A', 'B')).toEqual({ ok: true, ids: [] })
    expect(normalizeAdditionalRosterIds(['C', 'D'], 'A', 'B')).toEqual({ ok: true, ids: ['C', 'D'] })
    expect(normalizeAdditionalRosterIds(['C', 'D', 'E'], 'A', 'B').ok).toBe(false)
    expect(normalizeAdditionalRosterIds(['B'], 'A', 'B').ok).toBe(false)
    expect(normalizeAdditionalRosterIds(['C', 'C'], 'A', 'B').ok).toBe(false)
    expect(normalizeAdditionalRosterIds('C', 'A', 'B').ok).toBe(false)
  })

  it('names a team that neither sends nor receives', () => {
    expect(uninvolvedTradeParticipants(['A', 'B', 'C'], [{ fromRosterId: 'A', toRosterId: 'B' }])).toEqual(['C'])
    expect(
      uninvolvedTradeParticipants(['A', 'B', 'C'], [
        { fromRosterId: 'A', toRosterId: 'B' },
        { fromRosterId: 'B', toRosterId: 'C' },
      ]),
    ).toEqual([])
  })
})

// ── creation validator ──────────────────────────────────────────────────────────────────────────

const rules = {
  version: 1,
  leagueId: 'L',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings' },
  scoring: { templateId: 'x', presetId: 'x', formatType: 'redraft', sport: 'NFL', activeRuleCount: 0, overriddenRuleCount: 0, activeRules: [] },
  roster: { size: 3, starters: ['QB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: false },
  draft: { pickTradingEnabled: false },
  playoffs: {} as CanonicalLeagueRules['playoffs'],
  schedule: {
    unit: 'week', regularSeasonLength: 14, matchupFrequency: 'weekly', matchupCadence: 'weekly', generationStrategy: 'round_robin',
    playoffTransitionPoint: 15, headToHeadBehavior: 'standard', lockTimeBehavior: 'per_player_kickoff', lockWindowBehavior: 'nfl_week',
    scoringPeriodBehavior: 'weekly', rescheduleHandling: null, doubleheaderHandling: null,
  },
  permissions: { settingsEditableByRoles: ['commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

const team = (rosterId: string, faabBalance: number, playerIds: string[]): NflRedraftTradeRosterInput => ({
  rosterId,
  displayName: rosterId.toUpperCase(),
  ownerId: `u-${rosterId}`,
  faabBalance,
  waiverPriority: 1,
  players: playerIds.map((playerId) => ({ playerId, playerName: playerId, position: 'WR', sport: 'NFL', slotType: 'BENCH' })),
})

function runtimeState(rosters = [team('a', 50, ['a1', 'a2']), team('b', 50, ['b1', 'b2']), team('c', 10, ['c1', 'c2'])]) {
  return buildNflRedraftTradeRuntimeState({
    leagueId: 'L', seasonId: 'S', season: 2026, week: 6, rules, rosters, proposals: [],
    activeRosterLimit: 3, pickInventorySupported: false, now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

describe('validateNflRedraftTradeProposal with additional teams', () => {
  const ring = [
    { fromRosterId: 'a', toRosterId: 'b', assetType: 'player' as const, playerId: 'a1' },
    { fromRosterId: 'b', toRosterId: 'c', assetType: 'player' as const, playerId: 'b1' },
    { fromRosterId: 'c', toRosterId: 'a', assetType: 'player' as const, playerId: 'c1' },
  ]

  it('accepts a valid three-team ring and reports every team', () => {
    const r = validateNflRedraftTradeProposal({ state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', additionalRosterIds: ['c'], assets: ring })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rosterImpact.map((i) => i.rosterId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('without the third team the same assets are an invalid direction (two-team behaviour unchanged)', () => {
    const r = validateNflRedraftTradeProposal({ state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', assets: ring })
    expect(r).toMatchObject({ ok: false, code: 'ASSET_DIRECTION_INVALID', message: 'Trade asset direction must move between the two trade rosters.' })
  })

  it('checks ownership on the third team', () => {
    const r = validateNflRedraftTradeProposal({
      state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', additionalRosterIds: ['c'],
      assets: [...ring.slice(0, 2), { fromRosterId: 'c', toRosterId: 'a', assetType: 'player', playerId: 'b2' }],
    })
    expect(r).toMatchObject({ ok: false, code: 'PLAYER_NOT_OWNED' })
  })

  it("checks the third team's FAAB and roster limit", () => {
    const faab = validateNflRedraftTradeProposal({
      state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', additionalRosterIds: ['c'],
      assets: [...ring, { fromRosterId: 'c', toRosterId: 'b', assetType: 'faab', metadata: { amount: 25 } }],
    })
    expect(faab).toMatchObject({ ok: false, code: 'INSUFFICIENT_FAAB' })
    const limit = validateNflRedraftTradeProposal({
      state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', additionalRosterIds: ['c'],
      assets: [
        { fromRosterId: 'a', toRosterId: 'c', assetType: 'player', playerId: 'a1' },
        { fromRosterId: 'b', toRosterId: 'c', assetType: 'player', playerId: 'b1' },
      ],
    })
    expect(limit).toMatchObject({ ok: false, code: 'ROSTER_LIMIT' })
  })

  it('refuses a third team that is not in the season', () => {
    const r = validateNflRedraftTradeProposal({ state: runtimeState(), proposerRosterId: 'a', receiverRosterId: 'b', additionalRosterIds: ['zz'], assets: ring })
    expect(r).toMatchObject({ ok: false, code: 'ROSTER_NOT_FOUND' })
  })
})

// ── settlement ──────────────────────────────────────────────────────────────────────────────────

type Store = Record<string, number | null>
function settlementTx(store: Store) {
  const moves: Array<{ playerId: string; from: string; to: string }> = []
  const tx = {
    redraftRosterPlayer: {
      updateMany: vi.fn(async ({ where, data }: { where: { rosterId: string; playerId: string }; data: { rosterId: string } }) => {
        moves.push({ playerId: where.playerId, from: where.rosterId, to: data.rosterId })
        return { count: 1 }
      }),
    },
    roster: { updateMany: vi.fn(async () => ({ count: 1 })) },
    redraftRoster: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, faabBalance: store[id] }))),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; faabBalance?: { gte?: number; not?: null } | null }; data: { faabBalance: number | { increment?: number; decrement?: number } } }) => {
        const bal = store[where.id]
        if (where.faabBalance?.gte !== undefined && (bal == null || bal < where.faabBalance.gte)) return { count: 0 }
        if (where.faabBalance && 'not' in where.faabBalance && bal == null) return { count: 0 }
        const d = data.faabBalance
        store[where.id] = typeof d === 'number' ? d : (bal ?? 0) + (d.increment ?? 0) - (d.decrement ?? 0)
        return { count: 1 }
      }),
    },
  }
  return { tx: tx as never, moves }
}

describe('settleRedraftTradeAssets across three teams', () => {
  const assets: SettlementAssetRow[] = [
    { fromRosterId: 'A', toRosterId: 'B', assetType: 'player', playerId: 'a1' },
    { fromRosterId: 'B', toRosterId: 'C', assetType: 'player', playerId: 'b1' },
    { fromRosterId: 'C', toRosterId: 'A', assetType: 'player', playerId: 'c1' },
    { fromRosterId: 'A', toRosterId: 'C', assetType: 'faab', playerId: null, metadata: { amount: 10 } },
    { fromRosterId: 'B', toRosterId: 'A', assetType: 'faab', playerId: null, metadata: { amount: 4 } },
  ]

  it('moves every asset to the roster it was sent to, FAAB included', async () => {
    const store: Store = { A: 50, B: 20, C: 0 }
    const { tx, moves } = settlementTx(store)
    const res = await settleRedraftTradeAssets(tx, { proposerRosterId: 'A', receiverRosterId: 'B', additionalRosterIds: ['C'], assets })
    expect(res.playersMoved).toBe(3)
    expect(moves).toEqual([
      { playerId: 'a1', from: 'A', to: 'B' },
      { playerId: 'b1', from: 'B', to: 'C' },
      { playerId: 'c1', from: 'C', to: 'A' },
    ])
    // A: 50 - 10 + 4 = 44 · B: 20 - 4 = 16 · C: 0 + 10 = 10
    expect(store).toEqual({ A: 44, B: 16, C: 10 })
  })

  it('without the third team the same trade is refused before anything moves', async () => {
    const store: Store = { A: 50, B: 20, C: 0 }
    const { tx, moves } = settlementTx(store)
    await expect(settleRedraftTradeAssets(tx, { proposerRosterId: 'A', receiverRosterId: 'B', assets })).rejects.toThrow(/invalid roster direction/)
    expect(store).toEqual({ A: 50, B: 20, C: 0 })
    expect(moves.length).toBeLessThan(3)
  })
})

// ── void on elimination ─────────────────────────────────────────────────────────────────────────

describe('voidPendingRedraftTradesForRoster', () => {
  it('voids a pending trade the eliminated roster is an additional team in', async () => {
    const { voidPendingRedraftTradesForRoster } = await import('@/lib/redraft/voidPendingTradesForElimination')
    await voidPendingRedraftTradesForRoster('L', 'rC')
    const where = (voidDb.proposalUpdateMany.mock.calls[0]![0] as { where: { OR: unknown[] } }).where
    expect(where.OR).toContainEqual({ additionalRosterIds: { has: 'rC' } })
    expect(where.OR).toContainEqual({ proposerRosterId: 'rC' })
    expect(where.OR).toContainEqual({ receiverRosterId: 'rC' })
  })
})
