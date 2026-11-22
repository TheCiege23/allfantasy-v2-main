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
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: h.commish, commissionerAccessResponse: h.refusal }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: h.plan }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.queryRaw, $executeRaw: h.executeRaw } }))

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
  h.queryRaw.mockResolvedValue([{ playlist: { stationId: "game-day", setAt: "x", setBy: "u1" } }])
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
    expect(h.queryRaw).not.toHaveBeenCalled()
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
    h.queryRaw.mockResolvedValue([{ playlist: null }])
    const res = await put({ stationId: null })
    expect((await res.json()).playlist).toBeNull()
    expect(sqlText(h.executeRaw.mock.calls[0])).toMatch(/settings - /)
  })
})

describe('a playlist change reaching an open room (2026-11-17)', () => {
  it('reads the playlist the settings poll carries; a missing key means "keep what you have"', async () => {
    const { readLivePlaylist } = await import('@/lib/draft-room/draftPlaylist')
    expect(readLivePlaylist({ stationId: 'game-day', label: 'whatever' })).toMatchObject({ stationId: 'game-day', label: 'Game day hype' })
    expect(readLivePlaylist(null)).toBeNull()
    expect(readLivePlaylist(undefined)).toBeUndefined()
    expect(readLivePlaylist({ stationId: 'not-a-station' })).toBeNull()
  })

  it('someone playing the room playlist follows it: switched, or stopped when it is removed', async () => {
    const { followPlaylistChange, readDraftPlaylist } = await import('@/lib/draft-room/draftPlaylist')
    const podcast = readDraftPlaylist({ draft_room_playlist: { stationId: 'ff-podcast' } })!
    expect(followPlaylistChange('draft-playlist:game-day', podcast)).toEqual({ action: 'play', stationId: 'ff-podcast' })
    expect(followPlaylistChange('draft-playlist:game-day', null)).toEqual({ action: 'stop' })
    expect(followPlaylistChange('draft-playlist:ff-podcast', podcast)).toEqual({ action: 'none' })
  })

  it('🛑 music a member chose, and a quiet room, are never touched', async () => {
    const { followPlaylistChange, readDraftPlaylist } = await import('@/lib/draft-room/draftPlaylist')
    const podcast = readDraftPlaylist({ draft_room_playlist: { stationId: 'ff-podcast' } })!
    expect(followPlaylistChange('game-day', podcast)).toEqual({ action: 'none' })
    expect(followPlaylistChange('game-day', null)).toEqual({ action: 'none' })
    expect(followPlaylistChange(null, podcast)).toEqual({ action: 'none' })
    expect(followPlaylistChange(undefined, podcast)).toEqual({ action: 'none' })
  })

  it('the one-key read asks Postgres for the playlist key only', async () => {
    const { readLeagueDraftPlaylist } = await import('@/lib/draft-room/draftPlaylistRead')
    h.queryRaw.mockResolvedValue([{ playlist: { stationId: 'game-day' } }])
    expect(await readLeagueDraftPlaylist('L1')).toMatchObject({ stationId: 'game-day' })
    const sql = (h.queryRaw.mock.calls.at(-1)![0] as string[]).join('?')
    expect(sql).toMatch(/settings -> \?::text AS playlist FROM leagues WHERE id = \?/)
    h.queryRaw.mockResolvedValue([])
    expect(await readLeagueDraftPlaylist('missing')).toBeNull()
  })
})

describe('autoplay for members (2026-11-17)', () => {
  it('starts the offered playlist in a quiet room', async () => {
    const { shouldAutoplayDraftPlaylist, readDraftPlaylist } = await import('@/lib/draft-room/draftPlaylist')
    const offered = readDraftPlaylist({ draft_room_playlist: { stationId: 'game-day' } })
    expect(shouldAutoplayDraftPlaylist({ offered, playingKey: null, optedOut: false, available: true })).toBe(true)
  })

  it('🛑 never over other music, never after a Stop, never with no playlist or no player', async () => {
    const { shouldAutoplayDraftPlaylist, readDraftPlaylist } = await import('@/lib/draft-room/draftPlaylist')
    const offered = readDraftPlaylist({ draft_room_playlist: { stationId: 'game-day' } })
    const base = { offered, playingKey: null, optedOut: false, available: true }
    expect(shouldAutoplayDraftPlaylist({ ...base, playingKey: 'ff-podcast' })).toBe(false)
    expect(shouldAutoplayDraftPlaylist({ ...base, playingKey: 'draft-playlist:game-day' })).toBe(false)
    expect(shouldAutoplayDraftPlaylist({ ...base, optedOut: true })).toBe(false)
    expect(shouldAutoplayDraftPlaylist({ ...base, offered: null })).toBe(false)
    expect(shouldAutoplayDraftPlaylist({ ...base, available: false })).toBe(false)
  })

  it('a Stop holds for three days per league; anything unreadable is not a Stop', async () => {
    const { optOutStillHolds, draftPlaylistOptOutKey, DRAFT_PLAYLIST_OPT_OUT_MS } = await import('@/lib/draft-room/draftPlaylist')
    const now = 1_800_000_000_000
    expect(optOutStillHolds(String(now - 1000), now)).toBe(true)
    expect(optOutStillHolds(String(now - DRAFT_PLAYLIST_OPT_OUT_MS - 1), now)).toBe(false)
    expect(optOutStillHolds(null, now)).toBe(false)
    expect(optOutStillHolds('yes', now)).toBe(false)
    expect(optOutStillHolds('0', now)).toBe(false)
    expect(draftPlaylistOptOutKey('L1')).not.toBe(draftPlaylistOptOutKey('L2'))
  })
})
