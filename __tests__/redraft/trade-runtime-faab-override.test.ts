import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The trade runtime's settlement must not mint FAAB (audit #23).
 *
 * 🛑 `applyExecutedTrade` wrote `Math.max(0, balance + delta)`. `commissioner_approve` executes with
 * `commissionerOverride`, and the runtime validator lets an override skip the FAAB sufficiency check — so a
 * trade sending 30 from a roster holding 10 floored the sender at 0 and credited the receiver the full 30.
 * Twenty FAAB came from nowhere, silently. It is now refused, and neither balance moves.
 *
 * Runs the real `actOnNflRedraftTradeProposal` against a prisma fixture whose roster table is a small
 * in-memory store honouring `updateMany` conditions, so the balances asserted are the ones written.
 */

const h = vi.hoisted(() => {
  const faab: Record<string, number | null> = { alpha: 10, beta: 100 }
  const season = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2, status: 'in_season' }
  const rosters = () => [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: faab.alpha, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: faab.beta, waiverPriority: 2, playoffSeed: 2 },
  ]
  const proposalRow = {
    id: 'proposal-1',
    leagueId: 'league-1',
    seasonId: 'season-1',
    proposerRosterId: 'alpha',
    receiverRosterId: 'beta',
    status: 'pending',
    vetoMode: 'commissioner',
    vetoThreshold: 4,
    reason: null,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    acceptedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    processedAt: null,
    assets: [
      { id: 'asset-1', fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, pickNumber: null, metadata: { amount: 30 } },
    ],
    votes: [],
  }
  const rules = {
    version: 1,
    leagueId: 'league-1',
    generatedAtIso: '2026-09-01T00:00:00.000Z',
    source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings', effectiveResolvers: [], settingsSnapshotVersion: 1, presetKey: 'af:v2|concept=redraft|sport=NFL' },
    general: { name: 'FAAB League', sport: 'NFL', season: 2026, format: 'redraft', variant: null, teamCount: 2, rosterSize: 4, lifecycleState: 'active', status: 'active', locked: false, emergencyPaused: false, timezone: 'America/New_York', language: 'en' },
    draft: {},
    scoring: { templateId: 'nfl_half_ppr', presetId: 'nfl_half_ppr', formatType: 'redraft', sport: 'NFL', activeRuleCount: 0, overriddenRuleCount: 0, activeRules: [] },
    roster: { size: 4, starters: ['QB', 'RB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
    waivers: {},
    trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
    playoffs: {},
    schedule: {},
    permissions: { settingsEditableByRoles: ['commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
    intelligence: {},
  }

  type Where = { id: string; faabBalance?: null | { gte?: number; not?: null } }
  type Data = { faabBalance: number | { increment?: number; decrement?: number } }
  const matches = (where: Where) => {
    const balance = faab[where.id]
    const cond = where.faabBalance
    if (balance === undefined) return false
    if (cond === undefined) return true
    if (cond === null) return balance === null
    if (cond.not === null && balance === null) return false
    if (cond.gte !== undefined && (balance === null || balance < cond.gte)) return false
    return true
  }
  const apply = (id: string, data: Data) => {
    const v = data.faabBalance
    if (typeof v === 'number') faab[id] = v
    else if (v.increment !== undefined) faab[id] = (faab[id] as number) + v.increment
    else if (v.decrement !== undefined) faab[id] = (faab[id] as number) - v.decrement
  }
  const redraftRoster = {
    findMany: async () => rosters(),
    findUnique: async ({ where }: { where: { id: string } }) => ({ faabBalance: faab[where.id] ?? null }),
    update: async ({ where, data }: { where: { id: string }; data: Data }) => {
      apply(where.id, data)
      return {}
    },
    updateMany: async ({ where, data }: { where: Where; data: Data }) => {
      if (!matches(where)) return { count: 0 }
      apply(where.id, data)
      return { count: 1 }
    },
  }

  const tx = {
    redraftTradeProposal: { updateMany: async () => ({ count: 1 }) },
    redraftRosterPlayer: { updateMany: async () => ({ count: 1 }) },
    redraftRoster,
    redraftLeagueTransaction: { create: async () => ({}) },
    redraftTradeDecision: { upsert: async () => ({}) },
  }

  const prisma = {
    redraftSeason: { findFirst: async () => season },
    league: { findUnique: async () => ({ settings: {} }) },
    redraftRoster,
    redraftRosterPlayer: { findMany: async () => [] },
    sportsGame: { findMany: async () => [] },
    redraftTradeProposal: {
      findUnique: async () => ({ seasonId: 'season-1' }),
      findMany: async () => [proposalRow],
    },
    redraftLeagueTransaction: { findMany: async () => [] },
    leagueEvent: { createMany: async () => ({ count: 0 }) },
    $transaction: async (cb: (client: typeof tx) => unknown) => cb(tx),
  }

  return { faab, rules, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => h.rules),
}))

import { actOnNflRedraftTradeProposal } from '@/lib/trade-runtime/resolveNflRedraftTradeRuntime'

beforeEach(() => {
  h.faab.alpha = 10
  h.faab.beta = 100
})

describe('trade runtime settlement does not mint FAAB', () => {
  it('🛑 refuses a commissioner-approved trade sending more FAAB than the sender holds, and moves nothing', async () => {
    await expect(
      actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'commissioner_approve', actorUserId: 'commish' }),
    ).rejects.toThrow(/Insufficient FAAB/)

    // Not alpha 0 / beta 130: the 20 FAAB alpha never had must not appear on beta.
    expect(h.faab).toEqual({ alpha: 10, beta: 100 })
  })
})
