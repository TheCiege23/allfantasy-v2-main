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
}))
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

import { PUT as devyPut } from '@/app/api/leagues/[leagueId]/devy/config/route'
import { PATCH as c2cPatch } from '@/app/api/leagues/[leagueId]/merged-devy-c2c/config/route'

const req = (method: string, body: unknown) =>
  new NextRequest('https://example.test/api/leagues/L1/x', { method, body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.order = []
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
