// @vitest-environment node
/**
 * POST /api/injury-news/context — the on-demand X news refresh.
 *
 * This is a SPENDING endpoint: each player searched costs 8-15 billed
 * server-side x_search calls. The tests that matter here are the ones that stop
 * it spending more than intended — the cap, the auth gate, and the rate limit.
 * A regression in any of those is a bill, not a bug report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above const initialisation, so the mocks have to
// be hoisted with them or the factory throws on a temporal dead zone reference.
const { getServerSessionMock, ingestMock, resolveBatchMock, consumeRateLimitMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  ingestMock: vi.fn(),
  resolveBatchMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/x-news-ingestion', () => ({ ingestXNewsForPlayers: ingestMock }))
vi.mock('@/lib/news-injury-aggregation/resolveBatch', () => ({
  resolvePlayerInjuryNewsBatch: resolveBatchMock,
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: consumeRateLimitMock,
  getClientIp: () => '203.0.113.1',
  buildRateLimit429: ({ message }: { message?: string }) => ({ ok: false, error: 'COOLDOWN', message }),
}))

import { POST } from '@/app/api/injury-news/context/route'

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/injury-news/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const emptyIngest = {
  searched: 0,
  skipped: 0,
  newRecords: 0,
  duplicatesSkipped: 0,
  injuryRecords: 0,
  noNews: [] as string[],
  errors: [] as string[],
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  consumeRateLimitMock.mockReturnValue({ success: true, remaining: 3, retryAfterSec: 0, resetTimeMs: 0, key: 'k' })
  ingestMock.mockResolvedValue({ ...emptyIngest, searched: 1 })
  resolveBatchMock.mockResolvedValue(new Map())
})

describe('POST /api/injury-news/context', () => {
  it('rejects an unauthenticated caller before spending anything', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await post({ players: ['Ashton Jeanty'] })
    expect(res.status).toBe(401)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rejects a rate-limited caller before spending anything', async () => {
    consumeRateLimitMock.mockReturnValue({ success: false, remaining: 0, retryAfterSec: 60, resetTimeMs: 0, key: 'k' })
    const res = await post({ players: ['Ashton Jeanty'] })
    expect(res.status).toBe(429)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('keys the rate limit per user AND ip, not one global bucket', async () => {
    await post({ players: ['Ashton Jeanty'] })
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ sleeperUsername: 'user-1', includeIpInKey: true }),
    )
  })

  it('caps how many players it will search, however many are asked for', async () => {
    // The money guard. 12 asked, at most 5 searched.
    const many = Array.from({ length: 12 }, (_, i) => `Player ${i}`)
    await post({ players: many })
    const passed = ingestMock.mock.calls[0][0]
    expect(passed.players).toHaveLength(5)
    expect(passed.maxPlayers).toBe(5)
  })

  it('reports the names it refused to search, so "no news" is distinguishable from "never looked"', async () => {
    const many = Array.from({ length: 7 }, (_, i) => `Player ${i}`)
    const body = await (await post({ players: many })).json()
    expect(body.refresh.notSearched).toEqual(['Player 5', 'Player 6'])
  })

  it('rejects an empty player list without calling the provider', async () => {
    const res = await post({ players: [] })
    expect(res.status).toBe(400)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed body without calling the provider', async () => {
    const res = await post('not json')
    expect(res.status).toBe(400)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('still returns the stored view when the refresh itself failed', async () => {
    // Spend disabled, provider down — stale news beats a 500 on a surface the
    // user already opened.
    ingestMock.mockResolvedValue({ ...emptyIngest, errors: ['Ashton Jeanty: AI provider spend is disabled'] })
    const res = await post({ players: ['Ashton Jeanty'] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.refresh.errors).toHaveLength(1)
    expect(body.players).toHaveLength(1)
  })

  it('reads DB-only afterwards, so one request cannot fetch live from two providers', async () => {
    await post({ players: ['Ashton Jeanty'] })
    expect(resolveBatchMock).toHaveBeenCalledWith(expect.objectContaining({ skipNewsContext: true }))
  })
})
