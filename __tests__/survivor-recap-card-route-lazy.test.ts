import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Torch Ceremony post names the week recap by its council-fixed id. If someone opens the picture
 * before the capture hook has run, the card route captures it on the spot instead of returning 404.
 */
const h = vi.hoisted(() => ({ stored: null as Record<string, unknown> | null, captured: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'member' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorTribalCouncil: { findUnique: vi.fn(async () => ({ leagueId: 'L1' })) } } }))
vi.mock('@/lib/survivor/shareCards/momentStore', () => ({
  getShareMoment: vi.fn(async () => h.stored),
  readShareCardsEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/survivor/shareCards/momentCapture', () => ({
  captureCouncilShareMoments: vi.fn(async (_league: string, councilId: string) => {
    h.captured.push(councilId)
    h.stored = { id: `recap-${councilId}`, leagueId: 'L1', type: 'recap', week: 5, subjectUserId: 'league', subjectRosterId: null, final: true, publishedAt: null, createdAt: new Date(), payload: {} }
    return 1
  }),
}))
vi.mock('@/lib/survivor/shareCards/renderCard', () => ({ renderShareCard: vi.fn(async () => new Response('png', { status: 200 })) }))

import { GET } from '@/app/api/share/survivor/[momentId]/route'
import { councilIdOfRecapMoment, recapMomentId } from '@/lib/survivor/shareCards/types'

beforeEach(() => { h.stored = null; h.captured = [] })

describe('recap card route', () => {
  it('captures a recap named by its council on first view, and serves it to a member', async () => {
    const res = await GET(new Request('https://x/api/share/survivor/recap-c9?f=post'), { params: Promise.resolve({ momentId: 'recap-c9' }) })
    expect(h.captured).toEqual(['c9'])
    expect(res.status).toBe(200)
  })

  it('CONTROL: an unknown non-recap id is still a 404 and captures nothing', async () => {
    const res = await GET(new Request('https://x/api/share/survivor/abc?f=post'), { params: Promise.resolve({ momentId: 'abc' }) })
    expect(h.captured).toEqual([])
    expect(res.status).toBe(404)
  })

  it('recap ids round-trip to their council', () => {
    expect(recapMomentId('c9')).toBe('recap-c9')
    expect(councilIdOfRecapMoment('recap-c9')).toBe('c9')
    expect(councilIdOfRecapMoment('recap-')).toBeNull()
    expect(councilIdOfRecapMoment('out-c9')).toBeNull()
  })
})
