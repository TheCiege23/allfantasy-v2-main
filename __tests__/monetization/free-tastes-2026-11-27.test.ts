// @vitest-environment node
/**
 * 🛑 FREE TASTES INSTEAD OF HARD LOCKS (owner's decision 2026-11-27), against all five tiers through the
 * REAL plan rules (tierMatrixHarness) and the real core paywall / cost gate:
 *
 *   Trade Finder — a viewer without the plan is SENT the top idea only (never the locked ones) plus a
 *                  `lock` saying how many more there were: /core finder, redraft partner search and
 *                  redraft package finder (only for the partner the free search showed).
 *   Start/sit AI — one AI answer a UTC day on the durable daily cap, then a 429 that names AF Pro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { TIERS, setTier, type Tier } from './tierMatrixHarness'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())

// ── /core finder fixtures ───────────────────────────────────────────────────────────────────────
const proposal = (n: number) => ({ partner: { name: `P${n}` }, give: { name: `G${n}` }, get: { name: `R${n}` }, rationale: [] })
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: async () => ({ id: 'L1', platform: 'sleeper', platformLeagueId: 'S1' }) },
    userProfile: { findUnique: async () => ({ sleeperUserId: 'su1' }) },
  },
}))
vi.mock('@/lib/trade-intel/tradeFinderService', () => ({
  getTradeFinder: async () => ({ proposals: [proposal(1), proposal(2), proposal(3)], contextNotes: [], missing: [] }),
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: async () => null, gradeDeal: async () => null }))

// ── redraft fixtures ────────────────────────────────────────────────────────────────────────────
const roster = (id: string) => ({ rosterId: id, players: [], faabBalance: 0, blockPlayerIds: [] as string[] })
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: true }) }))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: async () => false }))
vi.mock('@/lib/trade-discovery/assembleRosters', () => ({
  assembleDiscoveryLeague: async () => ({
    sport: 'NFL',
    draftPickTrading: true,
    ownerByRoster: new Map([['r1', 'u1'], ['r2', 'u2'], ['r3', 'u3'], ['r4', 'u4']]),
    rosters: [roster('r1'), roster('r2'), roster('r3'), roster('r4')],
  }),
}))
vi.mock('@/lib/trade-block/redraftTradeBlockService', () => ({
  discoverySignals: async () => ({ blockPlayerIdsByRoster: {}, myInterestPlayerIds: [], myInterestPositions: [], hasNativeBlock: true }),
}))
vi.mock('@/lib/trade-discovery/redraftTradeDiscovery', () => ({
  // Ranked: r3 is the top match.
  findPartners: () => ['r3', 'r2', 'r4'].map((id) => ({ rosterId: id, myNeeds: [], mySurpluses: [] })),
  findPackages: () => [1, 2, 3, 4].map((n) => ({ packageId: `k${n}`, canStartProposal: true })),
}))
vi.mock('@/lib/trade-discovery/packageGrades', () => ({ attachPackageGrades: async ({ packages }: { packages: unknown[] }) => packages }))

// ── the daily counter: a real count per subject, in memory ──────────────────────────────────────
const counts = new Map<string, number>()
vi.mock('@/lib/rate-limit-daily', () => ({
  consumeDailyLimit: async ({ endpoint, callsLimit }: { endpoint: string; callsLimit: number }) => {
    const n = (counts.get(endpoint) ?? 0) + 1
    counts.set(endpoint, n)
    return n <= callsLimit ? { success: true, remaining: callsLimit - n, retryAfterSec: 0 } : { success: false, remaining: 0, retryAfterSec: 3600 }
  },
}))

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  counts.clear()
})

const PRO_SUPREME: Tier[] = ['pro', 'supreme']

describe('Trade Finder: the top idea free, the rest never sent', () => {
  for (const tier of TIERS) {
    const full = PRO_SUPREME.includes(tier)
    it(`/core finder — ${tier}: ${full ? 'all 3 proposals' : '1 proposal + lock for 2'}`, async () => {
      setTier(tier)
      const { GET } = await import('@/app/api/league/trade-finder/route')
      const res = await GET(new NextRequest('http://localhost/api/league/trade-finder?leagueId=L1'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { finder: { proposals: Array<{ partner: { name: string } }> }; lock: { lockedCount: number; access: { planName: string } } | null }
      if (full) {
        expect(body.finder.proposals.map((p) => p.partner.name)).toEqual(['P1', 'P2', 'P3'])
        expect(body.lock).toBeNull()
      } else {
        expect(body.finder.proposals.map((p) => p.partner.name)).toEqual(['P1'])
        expect(body.lock).toMatchObject({ lockedCount: 2, shown: 1, access: { planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' } })
        expect(JSON.stringify(body)).not.toMatch(/P2|P3/)
      }
    })

    it(`redraft partner search — ${tier}: ${full ? 'all 3 partners' : 'top partner + lock for 2'}`, async () => {
      setTier(tier)
      const { GET } = await import('@/app/api/redraft/trades/discovery/route')
      const res = await GET(new NextRequest('http://localhost/api/redraft/trades/discovery?leagueId=L1&rosterId=r1'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { partners: Array<{ rosterId: string }>; lock: { lockedCount: number } | null; summary: { partnerCount: number } }
      expect(body.partners.map((p) => p.rosterId)).toEqual(full ? ['r3', 'r2', 'r4'] : ['r3'])
      expect(body.lock?.lockedCount ?? 0).toBe(full ? 0 : 2)
    })

    it(`redraft package finder — ${tier}: ${full ? 'any partner, 4 packages' : 'top partner only, 1 package + lock'}`, async () => {
      setTier(tier)
      const { POST } = await import('@/app/api/redraft/trades/package-finder/route')
      const post = (partnerRosterId: string) =>
        POST(new NextRequest('http://localhost/api/redraft/trades/package-finder', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', myRosterId: 'r1', partnerRosterId }) }))
      const top = await post('r3')
      expect(top.status).toBe(200)
      const topBody = (await top.json()) as { suggestedPackages: unknown[]; lock: { lockedCount: number } | null }
      expect(topBody.suggestedPackages).toHaveLength(full ? 4 : 1)
      expect(topBody.lock?.lockedCount ?? 0).toBe(full ? 0 : 3)
      const other = await post('r2')
      expect(other.status).toBe(full ? 200 : 403)
    })
  }
})

describe('Start/sit AI: one free answer a day, then AF Pro', () => {
  const ask = async () => {
    const { evaluateAiCostGate } = await import('@/lib/ai-protection/costGate')
    return evaluateAiCostGate(new Request('http://localhost/x'), 'start_sit_ai', 'u1', { now: new Date('2026-11-27T18:00:00Z') })
  }

  for (const tier of TIERS) {
    const paid = PRO_SUPREME.includes(tier)
    it(`${tier}: ${paid ? 'many answers' : '1 answer, then a 429 naming AF Pro'}`, async () => {
      setTier(tier)
      const first = await ask()
      expect(first.ok).toBe(true)
      const second = await ask()
      if (paid) {
        expect(second.ok).toBe(true)
        return
      }
      expect(second.ok).toBe(false)
      if (second.ok) return
      expect(second.reason).toBe('daily')
      expect(second.response.status).toBe(429)
      expect(await second.response.json()).toMatchObject({
        code: 'daily_limit_reached',
        limit: 1,
        upgradePath: '/upgrade?plan=pro',
        requiredPlan: 'AF Pro',
      })
    })
  }

  it('signed out is still refused (sign in for the free answer)', async () => {
    const { evaluateAiCostGate } = await import('@/lib/ai-protection/costGate')
    const r = await evaluateAiCostGate(new Request('http://localhost/x'), 'start_sit_ai', null, { now: new Date('2026-11-27T18:00:00Z') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('sign_in')
  })
})
