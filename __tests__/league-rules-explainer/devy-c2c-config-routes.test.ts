// @vitest-environment node
/** Both panel routes mirror the rookie draft to the dynasty config and publish the card, after their own write. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  order: [] as string[],
  read: vi.fn(),
  mirror: vi.fn(),
  publish: vi.fn(),
  upsertDevy: vi.fn(),
  upsertC2C: vi.fn(),
  league: { leagueVariant: 'merged_devy_c2c', sport: 'NFL' } as { leagueVariant: string; sport: string },
}))
// The C2C route reads the league's sport: basketball refuses settings that stop it scoring (lib/c2c/basketballC2CRules.ts).
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => h.league) } } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'U1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/devy/DevyLeagueConfig', () => ({ isDevyLeague: vi.fn(async () => true), getDevyConfig: vi.fn(), upsertDevyConfig: h.upsertDevy }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ isC2CLeague: vi.fn(async () => true), getC2CConfig: vi.fn(), upsertC2CConfig: h.upsertC2C }))
vi.mock('@/lib/league-rules-explainer/variantConfigChange', () => ({
  readVariantConfigRules: h.read,
  mirrorRookieDraftToDynasty: h.mirror,
  publishVariantConfigChange: h.publish,
}))
// Routes ask lib/league/commissionerAccess.ts (2026-11-16); this defers to the old check this test mocks.
vi.mock('@/lib/league/commissionerAccess', async () => (await import('../helpers/commissionerAccessMock')).accessFromLegacyMocks())

import { PUT as devyPut } from '@/app/api/leagues/[leagueId]/devy/config/route'
import { PATCH as c2cPatch } from '@/app/api/leagues/[leagueId]/merged-devy-c2c/config/route'

const req = (method: string, body: unknown) =>
  new NextRequest('https://example.test/api/leagues/L1/x', { method, body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.order = []
  h.league = { leagueVariant: 'merged_devy_c2c', sport: 'NFL' }
  h.read.mockImplementation(async () => { h.order.push('read'); return { rookieDraftRounds: 4 } })
  h.mirror.mockImplementation(async () => { h.order.push('mirror') })
  h.publish.mockImplementation(async () => { h.order.push('publish') })
  h.upsertDevy.mockImplementation(async () => { h.order.push('write'); return { leagueId: 'L1' } })
  h.upsertC2C.mockImplementation(async () => { h.order.push('write'); return { leagueId: 'L1' } })
})

describe.each([
  ['devy PUT', () => devyPut(req('PUT', { rookieDraftRounds: 3, rookieDraftType: 'snake' }), ctx), 'devy'],
  ['C2C PATCH', () => c2cPatch(req('PATCH', { rookieDraftRounds: 3, rookieDraftType: 'snake' }), ctx), 'c2c'],
])('%s', (_name, call, section) => {
  it('reads, writes its config, mirrors the rookie draft, then publishes the card', async () => {
    expect((await call()).status).toBe(200)
    expect(h.order).toEqual(['read', 'write', 'mirror', 'publish'])
    expect(h.mirror).toHaveBeenCalledWith('L1', expect.objectContaining({ rookieDraftRounds: 3, rookieDraftType: 'snake' }))
    expect(h.publish).toHaveBeenCalledWith({ leagueId: 'L1', actorUserId: 'U1', section, before: { rookieDraftRounds: 4 } })
  })
})

describe('basketball Campus to Canton (lib/c2c/basketballC2CRules.ts)', () => {
  it('refuses college best ball and non-unified standings, and writes nothing', async () => {
    h.league = { leagueVariant: 'merged_devy_c2c', sport: 'NBA' }
    for (const body of [{ bestBallCollege: true }, { standingsModel: 'hybrid' }, { standingsModel: 'separate', taxiSize: 3 }]) {
      const res = await c2cPatch(req('PATCH', body), ctx)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('Basketball Campus to Canton')
    }
    expect(h.upsertC2C).not.toHaveBeenCalled()
  })
  it('lets a stuck league turn them back off, and leaves football alone', async () => {
    h.league = { leagueVariant: 'merged_devy_c2c', sport: 'NBA' }
    expect((await c2cPatch(req('PATCH', { bestBallCollege: false, standingsModel: 'unified' }), ctx)).status).toBe(200)
    h.league = { leagueVariant: 'merged_devy_c2c', sport: 'NFL' }
    expect((await c2cPatch(req('PATCH', { bestBallCollege: true, standingsModel: 'hybrid' }), ctx)).status).toBe(200)
  })
})
