/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids must never be read as Sleeper ids by the waiver assistant.
 *
 * A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
 * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). The recommender
 * (`generateWaiverRecommendations`) reads them as Sleeper ids: needs from a stranger's position, a
 * colliding id hiding a real free agent, the league's actual players never subtracted. It is a
 * standing decision-engine-boundary violation, so the gate lives at its caller: the route refuses a
 * foreign league before the recommender runs, and says why. The control shows a Sleeper league
 * still reaches it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, mockGenerate } = vi.hoisted(() => ({
  state: { platform: 'fleaflicker' as string | null },
  mockGenerate: vi.fn(async () => ({
    recommendations: [],
    rosterNeeds: [],
    leagueContext: { leagueId: 'L1', waiverType: 'faab', faabBudget: 100, faabRemaining: 100 },
    generatedAt: '2026-09-28T00:00:00.000Z',
    meta: { dataGaps: [], mode: 'quick' as const },
  })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/entitlements/afAccess', () => ({
  getUserAfProStatus: vi.fn(async () => true),
  AfProRequiredError: class {
    toResponse() {
      return {}
    }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: vi.fn(async () => ({ platform: state.platform })) } },
}))
vi.mock('@/lib/ai/waivers/waiverRecommendationService', () => ({ generateWaiverRecommendations: mockGenerate }))

import { POST } from '@/app/api/ai/waivers/recommend/route'

const call = () =>
  POST(new Request('http://x/api/ai/waivers/recommend', { method: 'POST', body: JSON.stringify({ leagueId: 'L1' }) }))

beforeEach(() => {
  state.platform = 'fleaflicker'
  mockGenerate.mockClear()
})

describe('POST /api/ai/waivers/recommend — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker league never reaches the recommender, and the response says why', async () => {
    const body = await (await call()).json()
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(body.recommendations).toEqual([])
    expect(body.insufficientData).toBe(true)
    expect(body.meta.dataGaps).toContain('roster_ids_not_readable_for_platform')
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      state.platform = platform
      await call()
    }
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('CONTROL: a Sleeper league (and a native one) reaches the recommender', async () => {
    for (const platform of ['sleeper', 'native']) {
      state.platform = platform
      const body = await (await call()).json()
      expect(body.meta.dataGaps).not.toContain('roster_ids_not_readable_for_platform')
    }
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })
})
