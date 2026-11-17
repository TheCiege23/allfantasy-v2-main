/**
 * The commissioner's draft playlist (lib/draft-room/draftPlaylist.ts and its route): only a curated station is
 * stored, members can read it, and only a commissioner holding AF Commissioner or AF Supreme can set it.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftPlaylistOffered, parsePlaylistChoice, readDraftPlaylist } from '@/lib/draft-room/draftPlaylist'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  commish: vi.fn(),
  refusal: vi.fn(),
  plan: vi.fn(),
  findUnique: vi.fn(),
  executeRaw: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: h.commish, commissionerAccessResponse: h.refusal }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: h.plan }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique }, $executeRaw: h.executeRaw } }))

type Route = typeof import('@/app/api/leagues/[leagueId]/draft/playlist/route')
let route: Route
beforeAll(async () => {
  route = await import('@/app/api/leagues/[leagueId]/draft/playlist/route')
}, 120_000)

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const put = (body: unknown) =>
  route.PUT(new Request('http://localhost/api/leagues/L1/draft/playlist', { method: 'PUT', body: JSON.stringify(body) }), ctx)
const sqlText = (call: unknown[]) => (call[0] as string[]).join('?')

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u1', email: 'c@example.test' } })
  h.access.mockResolvedValue(true)
  h.commish.mockResolvedValue(false)
  h.refusal.mockResolvedValue(null)
  h.plan.mockResolvedValue(true)
  h.findUnique.mockResolvedValue({ settings: { draft_room_playlist: { stationId: 'game-day', setAt: 'x', setBy: 'u1' } } })
  h.executeRaw.mockResolvedValue(1)
})

describe('the stored playlist', () => {
  it('reads a curated station, and nothing else', () => {
    expect(readDraftPlaylist({ draft_room_playlist: { stationId: 'game-day' } })).toEqual({ stationId: 'game-day', label: 'Game day hype', channel: 'Stadium anthems' })
    expect(readDraftPlaylist({ draft_room_playlist: { stationId: 'https://youtube.com/watch?v=x' } })).toBeNull()
    expect(readDraftPlaylist({ draft_room_playlist: 'game-day' })).toBeNull()
    expect(readDraftPlaylist(null)).toBeNull()
  })

  it('a request may name a station or clear it; a link is refused', () => {
    expect(parsePlaylistChoice({ stationId: 'game-day' })).toBe('game-day')
    expect(parsePlaylistChoice({ stationId: null })).toBeNull()
    expect(parsePlaylistChoice({ stationId: '' })).toBeNull()
    expect(parsePlaylistChoice({ stationId: 'https://youtube.com/playlist?list=PLx' })).toBeUndefined()
    expect(parsePlaylistChoice({})).toBeUndefined()
  })

  it('is offered until the draft is complete', () => {
    expect(draftPlaylistOffered('pre_draft')).toBe(true)
    expect(draftPlaylistOffered('in_progress')).toBe(true)
    expect(draftPlaylistOffered('paused')).toBe(true)
    expect(draftPlaylistOffered('completed')).toBe(false)
  })
})

describe('GET', () => {
  it('a member reads the playlist and may not set it', async () => {
    const body = await (await route.GET(new Request('http://localhost'), ctx)).json()
    expect(body).toEqual({ playlist: { stationId: 'game-day', label: 'Game day hype', channel: 'Stadium anthems' }, isCommissioner: false, canSet: false, planRequired: false })
    expect(h.plan).not.toHaveBeenCalled()
  })

  it('a commissioner without the plan is told the plan is required', async () => {
    h.commish.mockResolvedValue(true)
    h.plan.mockResolvedValue(false)
    const body = await (await route.GET(new Request('http://localhost'), ctx)).json()
    expect(body).toMatchObject({ isCommissioner: true, canSet: false, planRequired: true })
  })

  it('someone outside the draft reads nothing', async () => {
    h.access.mockResolvedValue(false)
    expect((await route.GET(new Request('http://localhost'), ctx)).status).toBe(403)
    expect(h.findUnique).not.toHaveBeenCalled()
  })
})

describe('PUT', () => {
  it('🛑 a commissioner without AF Commissioner or AF Supreme cannot set it', async () => {
    h.plan.mockResolvedValue(false)
    const res = await put({ stationId: 'game-day' })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ upgrade: true, upgradeUrl: '/commissioner-upgrade' })
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('🛑 a member who is not a commissioner cannot set it', async () => {
    h.refusal.mockResolvedValue(new Response(JSON.stringify({ error: 'Only the commissioner' }), { status: 403 }))
    expect((await put({ stationId: 'game-day' })).status).toBe(403)
    expect(h.plan).not.toHaveBeenCalled()
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('🛑 a link is refused; only a station id is stored', async () => {
    const res = await put({ stationId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(res.status).toBe(400)
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('sets one key, leaving every other league setting alone', async () => {
    const res = await put({ stationId: 'game-day' })
    expect(res.status).toBe(200)
    expect((await res.json()).playlist).toMatchObject({ stationId: 'game-day' })
    expect(h.refusal).toHaveBeenCalledWith('L1', 'u1', 'league')
    const call = h.executeRaw.mock.calls[0]
    expect(sqlText(call)).toMatch(/jsonb_set\(/)
    expect(call).toContain('draft_room_playlist')
    expect(JSON.parse(call.find((v: unknown) => typeof v === 'string' && v.startsWith('{')) as string)).toMatchObject({ stationId: 'game-day', setBy: 'u1' })
  })

  it('clears it', async () => {
    h.findUnique.mockResolvedValue({ settings: {} })
    const res = await put({ stationId: null })
    expect((await res.json()).playlist).toBeNull()
    expect(sqlText(h.executeRaw.mock.calls[0])).toMatch(/settings - /)
  })
})
