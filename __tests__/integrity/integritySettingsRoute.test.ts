/** GET integrity settings: what an imported Sleeper league is offered next to a league run on AllFantasy. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => ({ platform: 'sleeper' as string | null, nativeSeason: null as { id: string } | null }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'owner') }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => 'commissioner') }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ userId: 'owner', platform: m.platform, settings: {} })) },
    leagueIntegritySettings: {
      upsert: vi.fn(async () => ({ leagueId: 'L', tankingMonitorEnabled: true, lastCollusionScanAt: null, lastTankingScanAt: null })),
    },
    integrityFlag: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    redraftSeason: { findFirst: vi.fn(async () => m.nativeSeason) },
  },
}))

import { GET } from '@/app/api/leagues/[leagueId]/integrity/handler'

const get = async () => {
  const res = await GET(createMockNextRequest('http://x/api/leagues/L/integrity') as never, { params: Promise.resolve({ leagueId: 'L' }) })
  return (await res.json()) as { settings: Record<string, unknown>; coverage: { tanking: { status: string } } }
}

beforeEach(() => vi.clearAllMocks())

describe('GET integrity settings', () => {
  it('an imported Sleeper league: tanking is monitored, and no pick penalty is offered', async () => {
    m.platform = 'sleeper'
    m.nativeSeason = null
    const body = await get()
    expect(body.coverage.tanking.status).toBe('never_scanned')
    expect(body.settings).not.toHaveProperty('tankingPenalties')
    expect(body.settings.holdFlaggedTradesSupported).toBe(false)
  })

  it('a league run on AllFantasy keeps its penalty settings', async () => {
    m.platform = 'allfantasy'
    m.nativeSeason = { id: 'S' }
    const body = await get()
    expect(body.coverage.tanking.status).toBe('never_scanned')
    expect(body.settings.tankingPenalties).toMatchObject({ enabled: expect.any(Boolean) })
  })
})
