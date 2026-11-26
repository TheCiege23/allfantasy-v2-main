// @vitest-environment node
/**
 * /core/decisions and GET /api/legacy/decision-log are AF Pro and AF Supreme only (2026-11-26,
 * `decision_log_history`): NOT AF Commissioner alone, NOT free, NOT AF Legacy.
 *
 * 🛑 THE PLAN MATRIX IS THE REAL ONE. Only the subscription READ is stubbed (EntitlementResolver
 * `resolveSnapshot` → the plans a viewer holds); the matrix, Supreme's inheritance
 * (SUPREME_INCLUDED_PLAN_IDS), FeatureGateService, requireFeatureEntitlement and the /core paywall all run
 * for real — so a key moved to `af_intelligence` (which Commissioner opens) turns this red.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))

const gateMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: (...args: unknown[]) => gateMock(...args),
}))

const db = vi.hoisted(() => ({
  findMany: vi.fn(async () => [] as unknown[]),
  legacyFindUnique: vi.fn(async () => ({ sleeperUserId: '730000000000000001' })),
  appUserFindUnique: vi.fn(async () => ({ email: null })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyUser: { findUnique: db.legacyFindUnique },
    appUser: { findUnique: db.appUserFindUnique },
    decisionLog: { findMany: db.findMany },
  },
}))

const summarySpy = vi.hoisted(() => vi.fn(async () => ({ total: 0 })))
vi.mock('@/lib/decision-log', async (orig) => ({
  ...(await orig<typeof import('@/lib/decision-log')>()),
  getDecisionSummary: summarySpy,
}))

import { GET } from '@/server/api-route-modules/legacy/decision-log/route'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { resolveCorePaywall } from '@/lib/core-app/corePaywall'
import { getRequiredPlanForFeature } from '@/lib/subscription/feature-access'

const snapshot = vi.spyOn(EntitlementResolver.prototype, 'resolveSnapshot')
const holds = (plans: string[]) =>
  snapshot.mockResolvedValue({ plans, status: plans.length ? 'active' : 'none', currentPeriodEnd: null, gracePeriodEnd: null } as never)

const get = (qs: string) => GET(new NextRequest(`http://localhost:3000/api/legacy/decision-log?${qs}`, { method: 'GET' }))

const MATRIX: Array<{ who: string; plans: string[]; allowed: boolean }> = [
  { who: 'free', plans: [], allowed: false },
  { who: 'AF Commissioner only', plans: ['commissioner'], allowed: false },
  { who: 'AF Legacy only', plans: ['war_room'], allowed: false },
  { who: 'AF Pro', plans: ['pro'], allowed: true },
  { who: 'AF Supreme', plans: ['supreme'], allowed: true },
]

beforeEach(() => {
  gateMock.mockResolvedValue({ ok: true, identity: { sleeperUsername: 'Sam', actorId: 'appuser-1', source: 'session' } })
  db.findMany.mockClear()
  summarySpy.mockClear()
})

describe('the key names AF Pro, the plan Supreme inherits', () => {
  it('decision_log_history is a single-plan AF Pro key', () => {
    expect(getRequiredPlanForFeature('decision_log_history')).toBe('pro')
  })
})

describe('GET /api/legacy/decision-log — the server gate, every view', () => {
  for (const m of MATRIX) {
    it(`${m.who} → ${m.allowed ? '200 with the list' : '403, and no row is read'}`, async () => {
      holds(m.plans)
      const res = await get('scope=mine&view=list&limit=100')
      if (m.allowed) {
        expect(res.status).toBe(200)
        expect(db.findMany).toHaveBeenCalledTimes(1)
      } else {
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ code: 'feature_not_entitled' })
        expect(db.findMany).not.toHaveBeenCalled()
      }
    })

    it(`${m.who} → summary ${m.allowed ? 'served' : 'refused'}`, async () => {
      holds(m.plans)
      const res = await get('scope=mine&view=summary')
      expect(res.status).toBe(m.allowed ? 200 : 403)
      expect(summarySpy).toHaveBeenCalledTimes(m.allowed ? 1 : 0)
    })
  }

  it('the older `userId=` form and the coach view are gated too (they return the same rows)', async () => {
    holds(['commissioner'])
    expect((await get('userId=Sam&view=coach')).status).toBe(403)
    expect((await get('userId=Sam')).status).toBe(403)
    expect(db.findMany).not.toHaveBeenCalled()
  })

  it('signing in still comes first: an anonymous caller gets the gate’s 401, before any plan read', async () => {
    gateMock.mockResolvedValueOnce({ ok: false, response: new Response(JSON.stringify({ error: 'Sign in to use this.' }), { status: 401 }) })
    const before = snapshot.mock.calls.length
    const res = await get('scope=mine&view=list')
    expect(res.status).toBe(401)
    expect(snapshot.mock.calls.length).toBe(before)
  })

  it('scope=mine reads BOTH of the caller’s own keys (username, case-insensitively, and the Sleeper user id)', async () => {
    holds(['pro'])
    await get('scope=mine&view=list&leagueId=L1')
    const where = (db.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where).toEqual({
      OR: [
        { userId: { equals: 'Sam', mode: 'insensitive' } },
        { userId: { equals: '730000000000000001', mode: 'insensitive' } },
      ],
      leagueId: 'L1',
    })
    await get('scope=mine&view=summary')
    expect(summarySpy).toHaveBeenCalledWith(['Sam', '730000000000000001'], undefined)
  })

  it('a named key that is not the caller’s is still a 403 for a plan holder', async () => {
    holds(['pro'])
    const res = await get('userId=victim&view=list')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'DECISION_LOG_USER_MISMATCH' })
    expect(db.findMany).not.toHaveBeenCalled()
  })
})

describe('/core/decisions — the page gate (the server paywall read the page draws its lock from)', () => {
  beforeAll(() => vi.stubEnv('AF_PAYWALL_STARTS_AT', '2026-10-15T04:00:00.000Z'))
  afterAll(() => vi.unstubAllEnvs())
  const AFTER = new Date('2026-11-26T12:00:00.000Z')

  for (const m of MATRIX) {
    it(`${m.who} → ${m.allowed ? 'unlocked' : 'locked'}`, async () => {
      holds(m.plans)
      const paywall = await resolveCorePaywall('appuser-1', { now: AFTER })
      expect(paywall.decision_history).toMatchObject({
        depth: 'decision_history',
        unlocked: m.allowed,
        planName: 'AF Pro',
        upgradePath: '/upgrade?plan=pro',
      })
    })
  }

  it('the page renders the screen `locked` (which fetches nothing) whenever that read is not unlocked', () => {
    const page = readFileSync(join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
    const branch = page.slice(page.indexOf(") : activeKey === 'decisions' ? ("), page.indexOf(") : activeKey === 'notifications' ? ("))
    expect(branch).toMatch(/^\s*corePaywall\?\.decision_history && !corePaywall\.decision_history\.unlocked \? \(\s*<DecisionLogScreen leagueNames=\{\{\}\} locked \/>/m)
  })
})
