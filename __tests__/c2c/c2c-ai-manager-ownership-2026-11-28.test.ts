// @vitest-environment node
/**
 * Owner follow-up 2026-11-28: C2C `roster_balance` and `transition_advice` (and `draft_advice`, the same
 * `managerId` hole) read `managerId` straight off the body, so any member could ask Chimmy about another
 * manager's roster. A member may only ask about their own team; a commissioner may ask about any team in
 * their league; anything else is a 403 — and a refused request reads nothing and calls no model.
 *
 * The plan and cap run for real (AF Pro through tierMatrixHarness, the day counter replaced). The c2cChimmy
 * module is spied (every export records and resolves), so "the action ran" is a recorded call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setTier } from '../monetization/tierMatrixHarness'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  spend: vi.fn(),
  members: new Set<string>(),
  commissioner: false,
}))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => h.session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('../monetization/tierMatrixHarness')).resolverModule())
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: async () => ({ success: true, retryAfterSec: 0 }) }))
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  consumeRateLimit: () => ({ success: true, remaining: 99, retryAfterSec: 0, resetTimeMs: 0 }),
}))
vi.mock('@/lib/c2c/ai/c2cChimmy', async (orig) => {
  const mod = (await (orig as () => Promise<Record<string, unknown>>)())
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (...a: unknown[]) => {
            h.spend(k, a)
            return Promise.resolve({ ok: true })
          }
        : v,
    ]),
  )
})
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: async (_leagueId: string, userId: string) =>
    h.members.has(userId) ? { ok: true, league: { id: 'L1' } } : { ok: false, status: 403 },
}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => h.commissioner }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: async () => 'member' }))
vi.mock('@/lib/ai-result-cache', () => ({
  buildAiCacheKey: () => ({ resultKey: 'k', inputHash: 'h' }),
  readAiResultCache: async () => null,
  writeAiResultCache: async () => undefined,
  isAiResultCacheSmokeProviderEnabled: () => false,
  createSmokeAiResult: () => ({ text: '', json: {} }),
}))
vi.mock('@/lib/prisma', () => {
  const dbProxy: unknown = new Proxy(() => undefined, {
    get: (_t, k) => (k === 'then' ? undefined : dbProxy),
    apply: () => Promise.resolve(null),
  })
  return { prisma: dbProxy }
})

import { POST } from '@/app/api/c2c/ai/route'

async function ask(action: string, extra: Record<string, unknown>) {
  const res = await POST(
    new Request('http://localhost/api/c2c/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ action, leagueId: 'L1', playerId: 'p1', ...extra }),
    }) as never,
  )
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

const ACTIONS: Array<[string, string]> = [
  ['roster_balance', 'getRosterBalanceAnalysis'],
  ['transition_advice', 'getShouldITransitionAnalysis'],
  ['draft_advice', 'getDraftAdvice'],
]

beforeEach(() => {
  h.session.mockReset()
  h.session.mockResolvedValue({ user: { id: 'me', email: null } })
  h.spend.mockReset()
  h.members = new Set(['me', 'rival'])
  h.commissioner = false
  setTier('pro')
})

describe('C2C manager-scoped actions: your own team, or any team in your league as its commissioner', () => {
  for (const [action, engine] of ACTIONS) {
    describe(action, () => {
      it('your own team (managerId omitted) → runs', async () => {
        const r = await ask(action, {})
        expect(r.status, JSON.stringify(r)).not.toBe(403)
        expect(h.spend.mock.calls.map(([k]) => k)).toContain(engine)
      })

      it('your own team (managerId = you) → runs', async () => {
        const r = await ask(action, { managerId: 'me' })
        expect(r.status).not.toBe(403)
        expect(h.spend.mock.calls.map(([k]) => k)).toContain(engine)
      })

      it('another manager, as a plain member → 403, nothing read, no model', async () => {
        const r = await ask(action, { managerId: 'rival' })
        expect(r.status).toBe(403)
        expect(String(r.json.error)).toMatch(/your own team/)
        expect(h.spend).not.toHaveBeenCalled()
      })

      it('another manager in the league, as its commissioner → runs', async () => {
        h.commissioner = true
        const r = await ask(action, { managerId: 'rival' })
        expect(r.status).not.toBe(403)
        expect(h.spend.mock.calls.map(([k]) => k)).toContain(engine)
      })

      it('a manager who is NOT in this league, even as its commissioner → 403', async () => {
        h.commissioner = true
        const r = await ask(action, { managerId: 'stranger' })
        expect(r.status).toBe(403)
        expect(h.spend).not.toHaveBeenCalled()
      })
    })
  }
})
