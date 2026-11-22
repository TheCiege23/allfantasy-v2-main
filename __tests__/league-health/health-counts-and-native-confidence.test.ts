// @vitest-environment node
/**
 * League health reads the activity native leagues write, and a native league is not "never synced" (2026-11-15).
 *   - the in-league health page built its snapshot with no counts, so everything read 0;
 *   - the counts read only NFL-redraft tables, missing AfLeagueTrade (the main trade flow) and WaiverClaim (the wire);
 *   - only imports write lastSyncedAt, so every native league's score was withheld as "never synced".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Where = Record<string, unknown>
const tables = vi.hoisted(() => {
  const calls: Array<{ model: string; where: Record<string, unknown> }> = []
  const groupBy = (model: string, rows: (where: Record<string, unknown>) => Array<{ leagueId: string; _count: { _all: number } }>) =>
    async ({ where }: { where: Record<string, unknown> }) => {
      calls.push({ model, where })
      return rows(where)
    }
  const hasStatus = (w: Record<string, unknown>) => 'status' in w
  return { calls, groupBy, hasStatus }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { groupBy: tables.groupBy('redraftTradeProposal', () => []) },
    redraftLeagueTrade: { groupBy: tables.groupBy('redraftLeagueTrade', () => []) },
    afLeagueTrade: { groupBy: tables.groupBy('afLeagueTrade', (w) => [{ leagueId: 'L1', _count: { _all: tables.hasStatus(w) ? 2 : 5 } }]) },
    redraftWaiverClaim: { groupBy: tables.groupBy('redraftWaiverClaim', () => []) },
    waiverClaim: { groupBy: tables.groupBy('waiverClaim', (w) => [{ leagueId: 'L1', _count: { _all: tables.hasStatus(w) ? 4 : 9 } }]) },
    leagueChatMessage: { groupBy: tables.groupBy('leagueChatMessage', () => [{ leagueId: 'L1', _count: { _all: 30 } }]) },
    leagueAuditLog: { groupBy: tables.groupBy('leagueAuditLog', () => []) },
    aiCommissionerAlert: { groupBy: tables.groupBy('aiCommissionerAlert', () => []) },
    decisionOsImportedActivity: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    league: { findMany: vi.fn(async () => []) },
  },
}))

import { buildCommissionerHealthSnapshot, loadCommissionerHealthCounts } from '@/lib/commissioner-hub/commissionerHubHealth'

beforeEach(() => {
  tables.calls.length = 0
})

describe('the activity a health snapshot is scored on', () => {
  it('counts the main trade flow and the waiver wire, not only the NFL-redraft tables', async () => {
    const counts = (await loadCommissionerHealthCounts(['L1'], new Date('2026-11-08'))).get('L1')!
    expect(counts).toMatchObject({ tradeActivity: 5, pendingTrades: 2, waiverActivity: 9, pendingWaiverClaims: 4, chatMessagesLast7Days: 30 })
    const openTrades = tables.calls.find((c) => c.model === 'afLeagueTrade' && 'status' in c.where)!
    expect(openTrades.where.status).toEqual({ in: ['pending', 'awaiting_commissioner', 'awaiting_votes'] })
  })

  it('a league with nothing reads zeros rather than failing', async () => {
    expect((await loadCommissionerHealthCounts(['L9'], new Date())).get('L9')).toMatchObject({ tradeActivity: 0, waiverActivity: 0 })
  })
})

describe('a league AllFantasy runs', () => {
  const roster = (id: string) => ({ id, platformUserId: `owner-${id}`, updatedAt: new Date(), playerData: { players: [], starters: [] } })
  it('is scored even though it never syncs; an imported league that never synced is not', () => {
    const native = buildCommissionerHealthSnapshot({ league: { id: 'L1', platform: 'allfantasy', lastSyncedAt: null, rosters: [roster('a'), roster('b')] }, source: 'database' })
    expect(native.dataConfidence).toBe('high')
    const imported = buildCommissionerHealthSnapshot({ league: { id: 'L2', platform: 'sleeper', lastSyncedAt: null, rosters: [roster('a'), roster('b')] }, source: 'database' })
    expect(imported.dataConfidence).toBe('low')
  })
})
