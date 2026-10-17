// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * GET /api/league/invite?token= carries the Zombie join preview for a Zombie league, so /join/[token] can
 * show the hero — and a failure building it must never break the invite itself.
 */

const h = vi.hoisted(() => ({ findFirst: vi.fn(), preview: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueInvite: { findFirst: h.findFirst } } }))
vi.mock('@/lib/league-invite/claimIdentity', () => ({
  resolveLinkedPlatformUserIds: vi.fn(async () => new Set()),
  getInviteClaimEligibility: vi.fn(() => 'open'),
}))
vi.mock('@/lib/zombie/zombieJoinPreview', () => ({ getZombieJoinPreview: h.preview }))

import { GET } from '@/app/api/league/invite/route'

const get = async () => {
  const { NextRequest } = await import('next/server')
  const res = await GET(new NextRequest('http://localhost/api/league/invite?token=TOK123'))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findFirst.mockResolvedValue({
    leagueId: 'L1',
    expiresAt: null,
    useCount: 0,
    maxUses: 50,
    league: { name: 'Tip-Off Outbreak', sport: 'NBA', leagueSize: 12, platform: 'native', teams: [] },
  })
})

describe('GET /api/league/invite — Zombie preview', () => {
  it('returns the zombie block for a Zombie league', async () => {
    h.preview.mockResolvedValue({ teamCount: 12, joined: 3, reviveSerums: 3 })
    const res = await get()
    expect(res.status).toBe(200)
    expect(h.preview).toHaveBeenCalledWith('L1')
    expect(res.body.zombie).toMatchObject({ teamCount: 12, reviveSerums: 3 })
  })

  it('returns zombie: null for any other league', async () => {
    h.preview.mockResolvedValue(null)
    expect((await get()).body.zombie).toBeNull()
  })

  it('still serves the invite when the preview throws', async () => {
    h.preview.mockRejectedValue(new Error('db hiccup'))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.leagueName).toBe('Tip-Off Outbreak')
    expect(res.body.zombie).toBeNull()
  })
})
