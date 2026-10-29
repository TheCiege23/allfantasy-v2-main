import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Survivor share cards API: privacy rules from the handoff README, enforced at the routes.
 *  - the out card is never offered (listed, previewed, published) to anyone but the eliminated manager
 *  - a league with shareCardsEnabled = false 404s the image, the page and the list
 *  - a moment that is not final 404s
 */

const h = vi.hoisted(() => ({
  session: { user: { id: 'viewer' } } as { user?: { id?: string } } | null,
  leagueSettings: {} as Record<string, unknown>,
  moments: [] as Array<Record<string, unknown>>,
  updateMany: vi.fn(async () => ({ count: 1 })),
  chatCreate: vi.fn(async () => ({})),
  render: vi.fn(async (_m: unknown, _f: string, cacheControl: string) => new Response('png', { status: 200, headers: { 'cache-control': cacheControl, 'content-type': 'image/png' } })),
  member: true,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueMembership: vi.fn(async (leagueId: string, userId: string | null) =>
    userId && h.member ? { ok: true, access: { leagueId, isMember: true } } : { ok: false, reason: 'not_member', status: 403 }),
}))
vi.mock('@/lib/survivor/shareCards/renderCard', () => ({ renderShareCard: h.render }))
vi.mock('@/lib/survivor/shareCards/momentCapture', () => ({ syncLeagueShareMoments: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: h.leagueSettings })) },
    survivorShareMoment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.moments.find(m => m.id === where.id) ?? null),
      findMany: vi.fn(async () => h.moments),
      updateMany: h.updateMany,
    },
    survivorPlayer: { findUnique: vi.fn(async () => ({ displayName: 'Viewer Team' })) },
    survivorChatChannel: { findFirst: vi.fn(async () => ({ id: 'chan-1' })) },
    survivorChatMessage: { create: h.chatCreate },
  },
}))

import { GET as imageGET } from '@/app/api/share/survivor/[momentId]/route'
import { GET as listGET, POST as listPOST } from '@/app/api/share/survivor/route'
import { loadPublicShareMoment } from '@/lib/survivor/shareCards/momentStore'

const payload = { v: 1, displayName: 'Voted Team', leagueName: 'Blah Survivor', sport: 'NFL', season: 2026, tribeName: 'Vela', crestPath: null, tally: '2–1', weeks: 6 }
function moment(over: Record<string, unknown>) {
  return { id: 'm-out', leagueId: 'league-1', type: 'out', week: 6, subjectUserId: 'voted-out', subjectRosterId: 'r-1', dedupeKey: 'out:c1', payload, final: true, publishedAt: null, createdAt: new Date(), ...over }
}
const imageReq = (id: string, f = 'post') => imageGET(new Request(`https://x.test/api/share/survivor/${id}?f=${f}`), { params: Promise.resolve({ momentId: id }) })

beforeEach(() => {
  h.session = { user: { id: 'viewer' } }
  h.leagueSettings = {}
  h.member = true
  h.moments = [
    moment({}),
    moment({ id: 'm-champ', type: 'champ', subjectUserId: 'winner', dedupeKey: 'champ', week: 13, payload: { ...payload, displayName: 'Winner Team' } }),
    moment({ id: 'm-imm', type: 'immunity', subjectUserId: 'viewer', dedupeKey: 'immunity:6', payload: { ...payload, displayName: 'Viewer Team' } }),
  ]
  h.updateMany.mockClear()
  h.chatCreate.mockClear()
  h.render.mockClear()
})

describe('GET /api/share/survivor (moment list)', () => {
  it('never lists another manager’s out card', async () => {
    const res = await listGET(new Request('https://x.test/api/share/survivor?leagueId=league-1'))
    const body = await res.json()
    expect(body.enabled).toBe(true)
    const ids = body.moments.map((m: { id: string }) => m.id)
    expect(ids).toContain('m-imm')
    expect(ids).toContain('m-champ')
    expect(ids).not.toContain('m-out')
  })

  it('lists the out card for the eliminated manager', async () => {
    h.session = { user: { id: 'voted-out' } }
    const body = await (await listGET(new Request('https://x.test/api/share/survivor?leagueId=league-1'))).json()
    expect(body.moments.map((m: { id: string }) => m.id)).toContain('m-out')
  })

  it('returns nothing when the league turned share cards off', async () => {
    h.leagueSettings = { survivorFoundationSettings: { shareCardsEnabled: false } }
    const body = await (await listGET(new Request('https://x.test/api/share/survivor?leagueId=league-1'))).json()
    expect(body).toEqual({ enabled: false, moments: [] })
  })
})

describe('GET /api/share/survivor/[momentId] (card image)', () => {
  it('404s an unpublished out card for anyone but the eliminated manager', async () => {
    const res = await imageReq('m-out')
    expect(res.status).toBe(404)
    expect(h.render).not.toHaveBeenCalled()
  })

  it('serves the eliminated manager a private, uncached preview', async () => {
    h.session = { user: { id: 'voted-out' } }
    const res = await imageReq('m-out', 'story')
    expect(res.status).toBe(200)
    expect(h.render).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-out' }), 'story', 'private, no-store')
  })

  it('serves a published final moment publicly with immutable caching, even signed out', async () => {
    h.session = null
    h.moments[0] = moment({ publishedAt: new Date() })
    const res = await imageReq('m-out', 'link')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('404s every moment when the league disabled share cards', async () => {
    h.leagueSettings = { survivorFoundationSettings: { shareCardsEnabled: false } }
    h.moments[0] = moment({ publishedAt: new Date() })
    h.session = { user: { id: 'voted-out' } }
    expect((await imageReq('m-out')).status).toBe(404)
  })

  it('404s a moment that is not final', async () => {
    h.session = { user: { id: 'voted-out' } }
    h.moments[0] = moment({ final: false, publishedAt: new Date() })
    expect((await imageReq('m-out')).status).toBe(404)
  })
})

describe('POST /api/share/survivor (publish / league chat)', () => {
  const post = (body: unknown) => listPOST(new Request('https://x.test/api/share/survivor', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))

  it('refuses to publish someone else’s out card', async () => {
    const res = await post({ momentId: 'm-out', action: 'publish' })
    expect(res.status).toBe(404)
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('lets the eliminated manager publish, and posts to league chat as a system message', async () => {
    h.session = { user: { id: 'voted-out' } }
    const res = await post({ momentId: 'm-out', action: 'chat' })
    expect(res.status).toBe(200)
    expect(h.updateMany).toHaveBeenCalledTimes(1)
    const message = (h.chatCreate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(message.isSystemMessage).toBe(true)
    expect(message.channelType).toBe('league')
    expect(String(message.content)).toContain('/l/league-1/moment/m-out')
    expect(JSON.stringify(message)).not.toMatch(/voter|ballot/i)
  })
})

describe('public moment page loader', () => {
  it('404s (null) when sharing is off, the moment is unpublished, not final, or under the wrong league', async () => {
    h.moments[0] = moment({ publishedAt: new Date() })
    expect(await loadPublicShareMoment('league-1', 'm-out')).not.toBeNull()
    expect(await loadPublicShareMoment('other-league', 'm-out')).toBeNull()
    h.leagueSettings = { survivorFoundationSettings: { shareCardsEnabled: false } }
    expect(await loadPublicShareMoment('league-1', 'm-out')).toBeNull()
    h.leagueSettings = {}
    h.moments[0] = moment({ publishedAt: null })
    expect(await loadPublicShareMoment('league-1', 'm-out')).toBeNull()
    h.moments[0] = moment({ final: false, publishedAt: new Date() })
    expect(await loadPublicShareMoment('league-1', 'm-out')).toBeNull()
  })
})
