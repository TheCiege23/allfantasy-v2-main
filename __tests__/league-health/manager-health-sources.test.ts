// @vitest-environment node
/**
 * Each manager's numbers come from what the league actually stores (lib/commissioner-hub/managerHealth.ts, 2026-11-15):
 *   - an unclaimed team is named through LeagueTeam.externalId (the old legacyRosterId join could never match);
 *   - a processed claim is one move, not two (its transaction is not counted again);
 *   - NFL-redraft claims and trades count too;
 *   - remaining FAAB is shown.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const g = (rows: unknown[]) => ({ groupBy: async () => rows })
  return {
    rosters: [
      { id: 'r1', platformUserId: 'u1', playerData: {}, updatedAt: new Date(), redraftRosterId: 'rr1', faabRemaining: 63 },
      { id: 'r2', platformUserId: 'orphan-2', playerData: {}, updatedAt: new Date(), redraftRosterId: null, faabRemaining: null },
    ],
    txWhere: [] as unknown[],
    g,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ starters: null }) },
    roster: { findMany: async () => h.rosters },
    leagueTeam: {
      findMany: async () => [
        { platformUserId: 'u1', ownerName: 'pat', teamName: 'Pats', avatarUrl: null, externalId: 'r1' },
        { platformUserId: null, ownerName: '', teamName: 'Open Seat FC', avatarUrl: null, externalId: 'r2' },
      ],
    },
    waiverClaim: h.g([{ rosterId: 'r1', _count: { _all: 2 } }]),
    waiverTransaction: {
      groupBy: async (args: { where: unknown }) => {
        h.txWhere.push(args.where)
        return [{ rosterId: 'r1', _count: { _all: 1 } }]
      },
    },
    afLeagueTrade: h.g([]),
    redraftWaiverClaim: h.g([{ rosterId: 'rr1', _count: { _all: 3 } }]),
    redraftTradeProposal: h.g([{ proposerRosterId: 'rr1', receiverRosterId: 'rr1', _count: { _all: 1 } }]),
  },
}))

import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'

describe("a manager's numbers", () => {
  it('names an unclaimed team, counts each claim once, includes NFL-redraft activity, and shows FAAB', async () => {
    const out = await getLeagueManagerHealth('L1')
    const r1 = out.rows.find((r) => r.rosterId === 'r1')!
    const r2 = out.rows.find((r) => r.rosterId === 'r2')!
    expect(r2.teamName).toBe('Open Seat FC')
    // 2 wire claims + 1 free-agent add (claimId null) + 3 NFL-redraft claims
    expect(r1.moves).toBe(6)
    expect(h.txWhere[0]).toMatchObject({ claimId: null })
    // one NFL-redraft proposal it made, one it received
    expect(r1.trades).toBe(2)
    expect(r1.faabRemaining).toBe(63)
    expect(r2.faabRemaining).toBeNull()
  })
})
