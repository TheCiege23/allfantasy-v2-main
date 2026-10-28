import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  membership: vi.fn(),
  seedClaims: vi.fn(),
  dashboard: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique } } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commissioner' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/pirate/service', () => ({ seedPirateClaims: h.seedClaims, getPirateDashboard: h.dashboard }))

import { GET } from '@/app/api/leagues/[leagueId]/pirate/route'

const ctx = { params: Promise.resolve({ leagueId: 'league' }) }

describe('Pirate rules before the season exists', () => {
  beforeEach(() => {
    h.findUnique.mockReset()
    h.membership.mockReset().mockResolvedValue({ ok: true })
    h.seedClaims.mockReset().mockRejectedValue(new Error('The league season has not been created yet.'))
    h.dashboard.mockReset()
  })

  it('loads saved commissioner rules without seeding claims or needing a season', async () => {
    h.findUnique.mockResolvedValue({ leagueType: 'pirate', leagueVariant: null,
      settings: { conceptRules: { extensions: { pirate: { protectionLimit: 4, selectionHours: 12,
        claimHours: 24, overflowGraceHours: 18, playoffClaims: true } } } } })
    const response = await GET(new NextRequest('http://localhost/api/leagues/league/pirate?view=rules'), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ rules: { protectionLimit: 4, selectionHours: 12,
      claimHours: 24, overflowGraceHours: 18, playoffClaims: true } })
    expect(h.seedClaims).not.toHaveBeenCalled()
    expect(h.dashboard).not.toHaveBeenCalled()
  })

  it('keeps the full deck endpoint season-dependent', async () => {
    const response = await GET(new NextRequest('http://localhost/api/leagues/league/pirate'), ctx)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('season has not been created')
    expect(h.seedClaims).toHaveBeenCalledOnce()
  })

  it('does not expose rules for a non-Pirate league', async () => {
    h.findUnique.mockResolvedValue({ leagueType: 'redraft', leagueVariant: null, settings: {} })
    const response = await GET(new NextRequest('http://localhost/api/leagues/league/pirate?view=rules'), ctx)
    expect(response.status).toBe(404)
  })
})
