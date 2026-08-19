// @vitest-environment node
/**
 * server/api-route-modules/legacy/fantrax/route.ts — the Import Security Closure phase's
 * write-side fix, done for real this time. Uses a real, filtering in-memory Prisma fake (not
 * just call-argument assertions) so the ownership/scoping logic is genuinely exercised: an
 * unauthenticated caller is rejected before touching the store, a fresh upload is stamped with
 * the session's own userId (never the client-supplied `username` field), re-uploading over a
 * different account's snapshot is rejected, and GET only ever returns the caller's own rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, store, requireVerifiedUserMock, parseFantraxFilesMock } = vi.hoisted(() => {
  type FantraxUserRow = { id: string; fantraxUsername: string; displayName: string }
  type FantraxLeagueRow = {
    id: string
    userId: string
    appUserId: string | null
    leagueName: string
    season: number
    sport: string
    teamCount: number
    userTeam: string
    isChampion: boolean
    champion: string | null
    isDevy: boolean
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    finalRank: number | null
    playoffFinish: string | null
    standings: unknown
    matchups: unknown
    roster: unknown
    transactions: unknown
  }

  const store = {
    users: new Map<string, FantraxUserRow>(),
    leagues: new Map<string, FantraxLeagueRow>(),
  }
  const leagueKey = (userId: string, leagueName: string, season: number) => `${userId}:${leagueName}:${season}`
  let nextId = 1

  const prismaMock = {
    fantraxUser: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const user = store.users.get(where.fantraxUsername)
        if (!user) return null
        if (!include?.leagues) return user
        let leagues = Array.from(store.leagues.values()).filter((l) => l.userId === user.id)
        const leagueWhere = include.leagues.where
        if (leagueWhere?.appUserId !== undefined) {
          leagues = leagues.filter((l) => l.appUserId === leagueWhere.appUserId)
        }
        leagues = leagues.sort((a, b) => b.season - a.season)
        return { ...user, leagues }
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: FantraxUserRow = { id: `fu-${nextId++}`, fantraxUsername: data.fantraxUsername, displayName: data.displayName }
        store.users.set(data.fantraxUsername, row)
        return row
      }),
    },
    fantraxLeague: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = leagueKey(where.userId_leagueName_season.userId, where.userId_leagueName_season.leagueName, where.userId_leagueName_season.season)
        return store.leagues.get(key) ?? null
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const key = leagueKey(where.userId_leagueName_season.userId, where.userId_leagueName_season.leagueName, where.userId_leagueName_season.season)
        const existing = store.leagues.get(key)
        const row: FantraxLeagueRow = existing
          ? { ...existing, ...update }
          : { id: `fl-${nextId++}`, ...create }
        store.leagues.set(key, row)
        return row
      }),
    },
  }

  const requireVerifiedUserMock = vi.fn()
  const parseFantraxFilesMock = vi.fn()
  return { prismaMock, store, requireVerifiedUserMock, parseFantraxFilesMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))
vi.mock('@/lib/fantrax-parser', () => ({ parseFantraxFiles: parseFantraxFilesMock }))

import { POST, GET } from '@/server/api-route-modules/legacy/fantrax/route'

const ROUTE_URL = 'http://localhost/api/legacy/fantrax'

function fakeParseResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    leagueName: 'Dynasty Devy League',
    season: 2025,
    userTeam: 'The Uploader',
    teamCount: 12,
    standings: [],
    matchups: [],
    roster: [],
    userStats: {
      record: { wins: 8, losses: 5, ties: 0 },
      pointsFor: 1500,
      pointsAgainst: 1400,
      rank: 3,
      playoffFinish: 'Semifinalist',
      isChampion: false,
    },
    champion: 'Someone Else',
    errors: [],
    transactions: { claims: [], drops: [], trades: [], lineupChanges: [], userTransactions: [] },
    ...overrides,
  }
}

function postRequest(fields: Record<string, string>, files: { name: string; content: string }[] = [{ name: 'standings.csv', content: 'a,b\n1,2' }]) {
  const formData = new FormData()
  for (const [k, v] of Object.entries(fields)) formData.append(k, v)
  files.forEach((f, i) => formData.append(`file_${i}`, new File([f.content], f.name)))
  return new NextRequest(ROUTE_URL, { method: 'POST', body: formData })
}

function getRequest(username: string) {
  return new NextRequest(`${ROUTE_URL}?username=${encodeURIComponent(username)}`, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.users.clear()
  store.leagues.clear()
  requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-1' })
  parseFantraxFilesMock.mockReturnValue(fakeParseResult())
})

describe('POST /api/legacy/fantrax — auth + ownership', () => {
  it('rejects an unauthenticated upload without ever touching the store', async () => {
    requireVerifiedUserMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
    })

    const res = await POST(postRequest({ username: 'realfan22', season: '2025' }))
    expect(res.status).toBe(401)
    expect(prismaMock.fantraxLeague.upsert).not.toHaveBeenCalled()
    expect(parseFantraxFilesMock).not.toHaveBeenCalled()
  })

  it('stamps appUserId from the session, never from the client-supplied username field', async () => {
    const res = await POST(postRequest({ username: 'realfan22', season: '2025' }))
    expect(res.status).toBe(200)

    const stored = store.leagues.get(
      Array.from(store.leagues.keys())[0]!
    )!
    expect(stored.appUserId).toBe('app-user-1')
    expect(stored.appUserId).not.toBe('realfan22')
  })

  it('lets the same owner re-upload (update) their own snapshot', async () => {
    await POST(postRequest({ username: 'realfan22', season: '2025' }))
    parseFantraxFilesMock.mockReturnValue(fakeParseResult({ userStats: { record: { wins: 9, losses: 5, ties: 0 }, pointsFor: 1600, pointsAgainst: 1400, rank: 2, playoffFinish: 'Finalist', isChampion: false } }))

    const res = await POST(postRequest({ username: 'realfan22', season: '2025' }))
    expect(res.status).toBe(200)
    expect(store.leagues.size).toBe(1)
    const stored = Array.from(store.leagues.values())[0]!
    expect(stored.wins).toBe(9)
    expect(stored.appUserId).toBe('app-user-1')
  })

  it('rejects re-uploading the same username/league/season when it is owned by a different account', async () => {
    await POST(postRequest({ username: 'realfan22', season: '2025' }))

    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-2-attacker' })
    const res = await POST(postRequest({ username: 'realfan22', season: '2025' }))

    expect(res.status).toBe(403)
    const stored = Array.from(store.leagues.values())[0]!
    expect(stored.appUserId).toBe('app-user-1')
  })

  it('lets a different authenticated account claim a legacy row with a null appUserId (pre-fix data)', async () => {
    await POST(postRequest({ username: 'realfan22', season: '2025' }))
    const key = Array.from(store.leagues.keys())[0]!
    store.leagues.set(key, { ...store.leagues.get(key)!, appUserId: null })

    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-3-claimer' })
    const res = await POST(postRequest({ username: 'realfan22', season: '2025' }))

    expect(res.status).toBe(200)
    expect(store.leagues.get(key)!.appUserId).toBe('app-user-3-claimer')
  })
})

describe('GET /api/legacy/fantrax — auth + owner-scoping', () => {
  it('rejects an unauthenticated read', async () => {
    requireVerifiedUserMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
    })

    const res = await GET(getRequest('realfan22'))
    expect(res.status).toBe(401)
  })

  it("returns only the authenticated caller's own leagues under that username, never another account's", async () => {
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-1' })
    await POST(postRequest({ username: 'sharedname', season: '2024' }))

    // A different real AllFantasy account uploads under a DIFFERENT username that happens to
    // map to a distinct FantraxUser row — separate identity, separate ownership.
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-2' })
    await POST(postRequest({ username: 'sharedname', season: '2025' }))
    // app-user-2's re-upload of the SAME username/season as app-user-1 would 403 (covered above);
    // use a different season here so this call succeeds as its own claim... but ownership of
    // 'sharedname' already belongs to app-user-1 for 2024. Confirm app-user-2 cannot see it.

    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-1' })
    const res1 = await GET(getRequest('sharedname'))
    const body1 = await res1.json()
    expect(body1.leagues.map((l: any) => l.season)).toEqual([2024])

    // app-user-2 legitimately owns the 2025 row under this same username — their own read
    // returns it, but never app-user-1's 2024 row.
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'app-user-2' })
    const res2 = await GET(getRequest('sharedname'))
    const body2 = await res2.json()
    expect(body2.leagues.map((l: any) => l.season)).toEqual([2025])
  })

  it('never returns a legacy row with a null appUserId to anyone', async () => {
    await POST(postRequest({ username: 'realfan22', season: '2025' }))
    const key = Array.from(store.leagues.keys())[0]!
    store.leagues.set(key, { ...store.leagues.get(key)!, appUserId: null })

    const res = await GET(getRequest('realfan22'))
    const body = await res.json()
    expect(body.leagues).toEqual([])
  })

  it('returns an empty list for an unknown username rather than erroring', async () => {
    const res = await GET(getRequest('nobody-has-uploaded-this'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ leagues: [] })
  })
})
