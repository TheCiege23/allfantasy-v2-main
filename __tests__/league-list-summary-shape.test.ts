/**
 * `/api/league/list?summary=1` — a smaller shape for callers that only render scalars.
 *
 * ⚠ THE POINT OF THESE TESTS IS THE DEFAULT, NOT THE OPT-IN. Twelve-plus surfaces read this
 * endpoint (dashboard, trade evaluator, trade finder, waiver-ai, season strategy, career share,
 * settings, legacy…). Shrinking the default response would be a silent breaking change across
 * all of them, so the un-parameterised call must stay byte-for-byte what it was.
 *
 * Why it exists: measured on production, the response is 5.28 MB across 557 leagues, of which
 * `settings` is 3.90 MB (74%) and `rosters` 1.06 MB (20%). The power-rankings picker reads
 * neither — `normalizeLeagueFromList` touches only top-level scalars.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockSession, mockList } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockList: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: mockList,
}))

import { GET } from '@/app/api/league/list/route'

const FULL = {
  leagues: [
    {
      id: 'l1',
      name: 'IDP Glory',
      season: 2026,
      scoring: 'PPR',
      leagueSize: 12,
      avatarUrl: null,
      settings: { roster_positions: ['QB', 'RB', 'K'], huge: 'x'.repeat(200) },
      rosters: [{ players: ['1', '2', '3'] }],
    },
  ],
  extraTopLevelKey: 'preserved',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'u1' } })
  mockList.mockResolvedValue(structuredClone(FULL))
})

async function call(url: string) {
  const res = await GET(new Request(url))
  return { status: res.status, body: await res.json() }
}

describe('/api/league/list default shape', () => {
  it('is unchanged when no summary flag is passed', async () => {
    const { status, body } = await call('https://x.test/api/league/list')
    expect(status).toBe(200)
    expect(body).toEqual(FULL)
    expect(body.leagues[0].settings).toBeDefined()
    expect(body.leagues[0].rosters).toBeDefined()
  })

  it('is unchanged for any value other than exactly "1"', async () => {
    for (const q of ['?summary=0', '?summary=true', '?summary=', '?other=1']) {
      const { body } = await call(`https://x.test/api/league/list${q}`)
      expect(body.leagues[0].settings, `summary query ${q}`).toBeDefined()
    }
  })
})

describe('/api/league/list?summary=1', () => {
  it('drops exactly the two heavy fields and keeps every other one', async () => {
    const { body } = await call('https://x.test/api/league/list?summary=1')
    const l = body.leagues[0]
    expect(l.settings).toBeUndefined()
    expect(l.rosters).toBeUndefined()
    // Everything the picker actually renders survives.
    expect(l).toMatchObject({
      id: 'l1',
      name: 'IDP Glory',
      season: 2026,
      scoring: 'PPR',
      leagueSize: 12,
    })
    expect('avatarUrl' in l).toBe(true) // null, but present — not silently dropped
  })

  it('preserves top-level keys other than leagues', async () => {
    const { body } = await call('https://x.test/api/league/list?summary=1')
    expect(body.extraTopLevelKey).toBe('preserved')
  })

  it('actually makes the payload smaller', async () => {
    const full = await call('https://x.test/api/league/list')
    const slim = await call('https://x.test/api/league/list?summary=1')
    expect(JSON.stringify(slim.body).length).toBeLessThan(JSON.stringify(full.body).length)
  })

  it('still refuses an unauthenticated caller', async () => {
    mockSession.mockResolvedValue(null)
    const { status } = await call('https://x.test/api/league/list?summary=1')
    expect(status).toBe(401)
  })
})
