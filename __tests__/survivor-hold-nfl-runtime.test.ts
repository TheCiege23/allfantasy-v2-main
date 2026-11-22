import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Survivor "if the trade check can't run: hold it for the commissioner" at the NFL trade runtime's
 * SETTLEMENT (`actOnNflRedraftTradeProposal` → `applyExecutedTrade`): a receiver's accept is refused
 * with the hold message in the league language and the proposal stays pending — nothing is claimed,
 * no FAAB moves. The commissioner's approval (the override) still executes it. Built on the harness of
 * redraft/trade-runtime-faab-override.test.ts, with a FAAB amount the sender can afford.
 */

const lang = vi.hoisted(() => ({ value: 'es' as string | null }))
const sv = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/survivor/survivorTradeRuleHook', () => ({ checkSurvivorTradeRules: sv.check }))

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
      { id: 'asset-1', fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, pickNumber: null, metadata: { amount: 5 } },
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

  const claim = vi.fn(async () => ({ count: 1 }))
  const tx = {
    redraftTradeProposal: { updateMany: claim },
    redraftRosterPlayer: { updateMany: async () => ({ count: 1 }) },
    redraftRoster,
    redraftLeagueTransaction: { create: async () => ({}) },
    redraftTradeDecision: { upsert: async () => ({}) },
  }

  const prisma = {
    redraftSeason: { findFirst: async () => season },
    league: { findUnique: async () => ({ settings: {}, language: lang.value }) },
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

  return { faab, rules, prisma, claim }
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
  h.claim.mockClear()
  sv.check.mockClear()
  lang.value = 'es'
  sv.check.mockResolvedValue({ ok: true, skipped: 'error', holdForCommissioner: true })
})

describe('NFL runtime settlement, when the Survivor check could not run and the league holds', () => {
  it('a receiver accept is refused with the Spanish hold message and stays pending — nothing moves', async () => {
    await expect(actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'accept', actorUserId: 'user-b' }))
      .rejects.toThrow('queda retenido hasta que el comisionado lo apruebe o lo vete')
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.faab).toEqual({ alpha: 10, beta: 100 })
  })

  it('an English league reads the English message', async () => {
    lang.value = null
    await expect(actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'accept', actorUserId: 'user-b' }))
      .rejects.toThrow('The Survivor trade check could not run, so this trade is held for the commissioner')
  })

  it("the commissioner's approval (the override) executes it", async () => {
    await actOnNflRedraftTradeProposal({ proposalId: 'proposal-1', action: 'commissioner_approve', actorUserId: 'commish' }).catch(() => undefined)
    expect(h.claim).toHaveBeenCalled()
    expect(sv.check).not.toHaveBeenCalled()
  })
})
