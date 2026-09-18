import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ session: vi.fn(), live: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
vi.mock('@/lib/live/espnGameSummary', () => ({ getEspnGameSummary: vi.fn(async () => ({})) }))
vi.mock('@/lib/live/liveScoresPage', () => ({ getLivePageData: h.live }))

import { GET } from '@/app/api/dashboard/live-scores/route'

/*
 * Conditional polling on `/api/dashboard/live-scores?view=live`.
 *
 * ⚠ WHY A ROUTE TEST AND NOT JUST THE HASH SUITE. `livePayloadEtag` being correct
 * says nothing about whether the route ever consults the request header, or
 * whether it returns a 304 without a body. Both are easy to get wrong in ways
 * that produce a perfectly working page — it just silently re-sends the entire
 * scoreboard every 20 seconds, which is the exact cost this change exists to
 * remove and is invisible from the UI.
 */

const PAYLOAD = {
  sport: 'NFL',
  scope: 'my' as const,
  counts: [],
  games: [],
  impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
  lockAlerts: [],
  fetchedAt: '2026-09-17T17:00:00.000Z',
  hasRosterData: true,
  loadFailed: false,
  rosterFailed: false,
}

function request(ifNoneMatch?: string): NextRequest {
  return new NextRequest('https://allfantasy.ai/api/dashboard/live-scores?view=live&sport=NFL&scope=my', {
    headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.live.mockResolvedValue(PAYLOAD)
})

describe('view=live conditional polling', () => {
  it('serves the payload with a validator on a first, unconditional poll', async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toMatch(/^"[A-Za-z0-9_-]+"$/)
    await expect(res.json()).resolves.toMatchObject({ sport: 'NFL' })
  })

  it('answers 304 with no body when the client already holds this payload', async () => {
    const first = await GET(request())
    const tag = first.headers.get('ETag')!

    const second = await GET(request(tag))
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
    // Repeated so the client can keep revalidating rather than dropping back to
    // unconditional polling after the first match.
    expect(second.headers.get('ETag')).toBe(tag)
  })

  it('serves the full payload again once a score moves', async () => {
    const first = await GET(request())
    const tag = first.headers.get('ETag')!

    h.live.mockResolvedValue({ ...PAYLOAD, fetchedAt: '2026-09-17T17:00:20.000Z' })
    const second = await GET(request(tag))
    expect(second.status).toBe(200)
    expect(second.headers.get('ETag')).not.toBe(tag)
  })

  /*
   * ⚠ THE WORK IS NOT SKIPPED, AND THE COMMENT IN THE ROUTE SAYS SO. Pinned here
   * because a future reader looking to save server time will be tempted to move
   * the validator check above the loader — which cannot work, since the payload
   * has to exist before it can be hashed.
   */
  it('still builds the payload on a 304, because the hash requires it', async () => {
    const tag = (await GET(request())).headers.get('ETag')!
    h.live.mockClear()
    await GET(request(tag))
    expect(h.live).toHaveBeenCalledTimes(1)
  })

  /*
   * ⚠ THE PAYLOAD NAMES THE LEAGUES YOU ROSTER IN, SO A SHARED CACHE MUST NOT HOLD
   * IT. Without `private`, a proxy could serve one user's slate to another under a
   * matching validator — a data leak, not a stale page.
   */
  it('marks the response private so no shared cache can hold it', async () => {
    for (const res of [await GET(request()), await GET(request((await GET(request())).headers.get('ETag')!))]) {
      expect(res.headers.get('Cache-Control')).toContain('private')
    }
  })

  /*
   * `/live` renders signed out — scores are public and only the tie-ins need a
   * user — so the conditional path must not start demanding a session.
   */
  it('works signed out, like the branch it sits in', async () => {
    h.session.mockResolvedValue(null)
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(h.live).toHaveBeenCalledWith(expect.objectContaining({ userId: null }))
  })
})
