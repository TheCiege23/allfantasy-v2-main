// @vitest-environment node
/**
 * The NFL redraft trade runtime posts Chimmy's trade card (with the take) once a trade EXECUTES —
 * hooked exactly the way tradeService.ts hooks an AllFantasy league trade: fire-and-forget through a
 * dynamic import, after the trade is committed, never able to fail the trade.
 *
 * Runs the real `actOnNflRedraftTradeProposal` over the same small in-memory fixture the FAAB
 * settlement test uses (__tests__/redraft/trade-runtime-faab-override.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const faab: Record<string, number | null> = { alpha: 100, beta: 100 }
  const status = { value: 'pending' }
  const season = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2, status: 'in_season' }
  const rosters = () => [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: faab.alpha, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: faab.beta, waiverPriority: 2, playoffSeed: 2 },
  ]
  const proposalRow = () => ({
    id: 'proposal-1',
    leagueId: 'league-1',
    seasonId: 'season-1',
    proposerRosterId: 'alpha',
    receiverRosterId: 'beta',
    status: status.value,
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
  })
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
  type Data = { faabBalance: number | { increment?: number; decrement?: number } }
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
    updateMany: async ({ where, data }: { where: { id: string }; data: Data }) => {
      apply(where.id, data)
      return { count: 1 }
    },
  }
  const tx = {
    redraftTradeProposal: {
      updateMany: async () => {
        status.value = 'accepted'
        return { count: 1 }
      },
    },
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
      findMany: async () => [proposalRow()],
      update: async () => ({}),
    },
    redraftTradeDecision: { upsert: async () => ({}) },
    redraftLeagueTransaction: { findMany: async () => [], create: async () => ({}) },
    leagueEvent: { createMany: async () => ({ count: 0 }) },
    $transaction: async (cb: (client: typeof tx) => unknown) => cb(tx),
  }
  return { faab, status, rules, prisma, post: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => h.rules),
}))
vi.mock('@/lib/league-chat/chimmyTradeMoment', () => ({ postRedraftTradeMoment: h.post }))

import { actOnNflRedraftTradeProposal } from '@/lib/trade-runtime/resolveNflRedraftTradeRuntime'

beforeEach(() => {
  h.faab.alpha = 100
  h.faab.beta = 100
  h.status.value = 'pending'
  h.post.mockReset().mockResolvedValue({ posted: true, messageId: 'm1' })
})

describe('an executed redraft trade reaches league chat as Chimmy’s trade card', () => {
  it('accepting it posts the card once, for that proposal', async () => {
    const out = await actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'accept', actorUserId: 'user-b' })
    expect(out.resolved).toBe(true)
    await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(1))
    expect(h.post).toHaveBeenCalledWith({ proposalId: 'proposal-1' })
  })

  it('a commissioner approval executes it too, and posts', async () => {
    await actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'commissioner_approve', actorUserId: 'commish' })
    await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(1))
  })

  it('a rejected trade never posts', async () => {
    await actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'reject', actorUserId: 'user-b' })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.post).not.toHaveBeenCalled()
  })

  it('🛑 a chat path that rejects never fails the trade', async () => {
    h.post.mockRejectedValue(new Error('chat down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const out = await actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'accept', actorUserId: 'user-b' })
    expect(out.resolved).toBe(true)
    expect(h.faab).toEqual({ alpha: 70, beta: 130 })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[redraftTradeRuntime] league chat trade card failed', expect.anything()))
    warn.mockRestore()
  })
})
