import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ session: vi.fn(), summary: vi.fn(), starters: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
vi.mock('@/lib/sports-live-scores-service', () => ({ getEspnGameSummary: h.summary }))
vi.mock('@/lib/live/liveScoresPage', () => ({ getLivePageData: vi.fn(), getGameStarters: h.starters }))

import { GET } from '@/app/api/dashboard/live-scores/route'

/*
 * The clicked-game view's poll: `view=game` carries your starters when signed in,
 * so their points move with the game — and then it names a user, so it must not
 * be shared by any cache. Signed out it stays the public payload it always was.
 */

const DETAIL = { gameId: '401872925', home: { abbrev: 'CIN' }, away: { abbrev: 'TB' } }
const STARTERS = { tieIns: [{ leagueId: 'L1' }], hasRosterData: true, rosterFailed: false }

const req = () => new NextRequest('https://allfantasy.ai/api/dashboard/live-scores?view=game&sport=NFL&game=401872925')

beforeEach(() => {
  h.session.mockReset()
  h.summary.mockReset()
  h.starters.mockReset()
  h.summary.mockResolvedValue({ detail: DETAIL, stale: false, failed: false })
  h.starters.mockImplementation(async ({ userId }: { userId: string | null }) => (userId ? STARTERS : null))
})

describe('GET view=game', () => {
  it('signed in: carries your starters for this game, marked private', async () => {
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    const res = await GET(req())
    const body = await res.json()
    expect(body.starters).toEqual(STARTERS)
    expect(body.detail).toEqual(DETAIL)
    expect(h.starters).toHaveBeenCalledWith({ userId: 'u1', sport: 'NFL', gameId: '401872925', homeAbbrev: 'CIN', awayAbbrev: 'TB' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('signed out: no starters, and not marked private — the public payload is unchanged', async () => {
    h.session.mockResolvedValue(null)
    const res = await GET(req())
    const body = await res.json()
    expect(body.starters).toBeNull()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).not.toBe('private, no-store')
  })

  it('no game detail: does not read rosters at all', async () => {
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.summary.mockResolvedValue({ detail: null, stale: false, failed: true })
    const body = await (await GET(req())).json()
    expect(body.starters).toBeNull()
    expect(h.starters).not.toHaveBeenCalled()
  })
})
