import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/shared/chat/league-mates — the DM / huddle picker's people list.
 *
 * Prisma is replaced by a small in-memory fake that EVALUATES the where clauses the route sends
 * (the four membership paths, `id in`, `contains` search, the either-way block OR) and honours
 * `select`. So these are behavioural: a dropped membership path, a missing block direction, or a
 * select that lets `email` through each changes what comes back, not just what was called.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; email: string }>,
  leagues: [] as Array<{
    id: string
    name: string | null
    userId: string
    redraftMembers: Array<{ userId: string }>
    rosters: Array<{ platformUserId: string }>
    teams: Array<{ claimedByUserId: string | null }>
  }>,
  blocks: [] as Array<{ blockerUserId: string; blockedUserId: string }>,
  blockFails: false,
  calls: { league: 0, appUser: 0, block: 0 },
  lastUserSelect: null as Record<string, unknown> | null,
  viewer: 'me' as string | null,
}))

function pick(row: Row, select: Record<string, unknown> | undefined): Row {
  // No select → every column, email included. That is the leak the select exists to stop.
  if (!select) return { ...row }
  const out: Row = {}
  for (const [k, v] of Object.entries(select)) if (v) out[k] = row[k]
  return out
}

function leagueMatches(l: (typeof db.leagues)[number], clause: Record<string, any>): boolean {
  if ('userId' in clause) return l.userId === clause.userId
  if (clause.redraftMembers) return l.redraftMembers.some((m) => m.userId === clause.redraftMembers.some.userId)
  if (clause.rosters) return l.rosters.some((r) => r.platformUserId === clause.rosters.some.platformUserId)
  if (clause.teams) return l.teams.some((t) => t.claimedByUserId === clause.teams.some.claimedByUserId)
  return false
}

function textMatch(value: string | null, cond: { contains: string; mode?: string } | undefined): boolean {
  if (!cond) return false
  return String(value ?? '').toLowerCase().includes(cond.contains.toLowerCase())
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async (args: any) => {
        db.calls.league += 1
        const ors: Array<Record<string, any>> = args?.where?.OR ?? []
        return db.leagues
          .filter((l) => ors.some((c) => leagueMatches(l, c)))
          .map((l) => {
            const s = args.select ?? {}
            const out: Row = {}
            if (s.name) out.name = l.name
            if (s.userId) out.userId = l.userId
            if (s.redraftMembers) out.redraftMembers = l.redraftMembers.map((m) => ({ userId: m.userId }))
            if (s.rosters) out.rosters = l.rosters.map((r) => ({ platformUserId: r.platformUserId }))
            if (s.teams) {
              const notNull = s.teams.where?.claimedByUserId?.not === null
              out.teams = l.teams.filter((t) => !notNull || t.claimedByUserId != null).map((t) => ({ claimedByUserId: t.claimedByUserId }))
            }
            return out
          })
      }),
    },
    appUser: {
      findMany: vi.fn(async (args: any) => {
        db.calls.appUser += 1
        db.lastUserSelect = args?.select ?? null
        const ids: string[] = args?.where?.id?.in ?? []
        const or: Array<Record<string, any>> | undefined = args?.where?.OR
        return db.users
          .filter((u) => ids.includes(u.id))
          .filter((u) => !or || or.some((c) => textMatch(u.username, c.username) || textMatch(u.displayName, c.displayName)))
          .slice(0, args?.take ?? Infinity)
          .map((u) => pick(u, args?.select))
      }),
    },
    platformBlockedUser: {
      findMany: vi.fn(async (args: any) => {
        db.calls.block += 1
        if (db.blockFails) throw Object.assign(new Error('connection reset'), { code: 'P1001' })
        const ors: Array<Record<string, string>> = args?.where?.OR ?? []
        return db.blocks
          .filter((b) => ors.some((c) => (c.blockerUserId ? b.blockerUserId === c.blockerUserId : b.blockedUserId === c.blockedUserId)))
          .map((b) => pick(b, args?.select))
      }),
    },
  },
}))

vi.mock('@/lib/platform/current-user', () => ({
  resolvePlatformUser: vi.fn(async () => ({ appUserId: db.viewer, legacyUsername: null })),
}))

import { GET } from '@/app/api/shared/chat/league-mates/route'

const user = (id: string, displayName: string | null, avatarUrl: string | null = null) => ({
  id,
  username: id,
  displayName,
  avatarUrl,
  email: `${id}.private@example.test`,
})

async function get(q?: string) {
  const url = `https://x.test/api/shared/chat/league-mates${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`
  const res = await GET(new Request(url))
  const body = (await res.json()) as { mates?: Array<{ id: string; displayName: string; username: string; avatarUrl: string | null; sharedLeagues: string[] }>; error?: string }
  return { res, body, ids: (body.mates ?? []).map((m) => m.id) }
}

beforeEach(() => {
  db.viewer = 'me'
  db.blockFails = false
  db.calls = { league: 0, appUser: 0, block: 0 }
  db.lastUserSelect = null
  db.blocks = []
  db.users = [
    user('me', 'Me Myself'),
    user('jo', 'Jo Allen', 'https://cdn.test/jo.png'),
    user('kai', 'Kai'),
    user('ben', 'Ben Bruiser'),
    user('sam', null),
    user('dee', 'Dee Jackson'),
    user('owner2', 'Other Commish'),
    user('stranger', 'Total Stranger'),
    user('stranger2', 'Also Unknown'),
  ]
  db.leagues = [
    // The viewer is in each of these by a DIFFERENT membership path.
    { id: 'L1', name: 'Dynasty Degens', userId: 'me', redraftMembers: [], rosters: [], teams: [{ claimedByUserId: 'jo' }, { claimedByUserId: 'kai' }, { claimedByUserId: null }] },
    { id: 'L2', name: 'Redraft Rumble', userId: 'owner2', redraftMembers: [{ userId: 'me' }, { userId: 'ben' }], rosters: [], teams: [] },
    { id: 'L3', name: 'Roster Rodeo', userId: 'owner2', redraftMembers: [], rosters: [{ platformUserId: 'me' }, { platformUserId: 'sam' }, { platformUserId: '8877665544' }], teams: [] },
    { id: 'L4', name: 'Claim Crew', userId: 'owner2', redraftMembers: [], rosters: [], teams: [{ claimedByUserId: 'me' }, { claimedByUserId: 'dee' }, { claimedByUserId: 'kai' }] },
    // Not the viewer's league: nobody here may be suggested.
    { id: 'L9', name: 'Somebody Else', userId: 'stranger', redraftMembers: [], rosters: [{ platformUserId: 'stranger2' }], teams: [] },
  ]
})

describe('GET /api/shared/chat/league-mates', () => {
  it('401 without a session, and reads nothing', async () => {
    db.viewer = null
    const { res } = await get()
    expect(res.status).toBe(401)
    expect(db.calls).toEqual({ league: 0, appUser: 0, block: 0 })
  })

  it('returns only people who share a league — through all four membership paths — with the league names', async () => {
    const { res, body, ids } = await get()
    expect(res.status).toBe(200)
    expect(new Set(ids)).toEqual(new Set(['jo', 'kai', 'ben', 'sam', 'dee', 'owner2']))
    expect(ids).not.toContain('stranger')
    expect(ids).not.toContain('stranger2')
    const byId = Object.fromEntries((body.mates ?? []).map((m) => [m.id, m]))
    expect(byId.kai!.sharedLeagues).toEqual(['Claim Crew', 'Dynasty Degens'])
    expect(byId.ben!.sharedLeagues).toEqual(['Redraft Rumble'])
    expect(byId.sam!.sharedLeagues).toEqual(['Roster Rodeo'])
    expect(byId.owner2!.sharedLeagues).toEqual(['Claim Crew', 'Redraft Rumble', 'Roster Rodeo'])
    expect(byId.jo).toEqual({ id: 'jo', displayName: 'Jo Allen', username: 'jo', avatarUrl: 'https://cdn.test/jo.png', sharedLeagues: ['Dynasty Degens'] })
    // No display name falls back to the handle — never to anything else.
    expect(byId.sam!.displayName).toBe('sam')
    // Most shared leagues first when nothing is typed.
    expect(ids[0]).toBe('owner2')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('excludes the viewer', async () => {
    const { ids } = await get()
    expect(ids).not.toContain('me')
    const { ids: searched } = await get('me')
    expect(searched).not.toContain('me')
  })

  it('🛑 excludes anyone blocked, in EITHER direction', async () => {
    db.blocks = [
      { blockerUserId: 'me', blockedUserId: 'kai' }, // I blocked kai
      { blockerUserId: 'jo', blockedUserId: 'me' }, // jo blocked me
      { blockerUserId: 'ben', blockedUserId: 'stranger' }, // not about me — changes nothing
    ]
    const { res, ids } = await get()
    expect(res.status).toBe(200)
    expect(ids).not.toContain('kai')
    expect(ids).not.toContain('jo')
    expect(new Set(ids)).toEqual(new Set(['ben', 'sam', 'dee', 'owner2']))
    // Searching for them by name does not bring them back.
    expect((await get('jo')).ids).toEqual([])
    expect((await get('kai')).ids).toEqual([])
  })

  it('🛑 fails CLOSED: an unreadable block list suggests nobody (503), never everybody', async () => {
    db.blockFails = true
    const { res, body } = await get()
    expect(res.status).toBe(503)
    expect(body.mates).toBeUndefined()
    expect(body.error).toMatch(/league-mates/)
    expect(db.calls.block).toBe(2) // one retry, then refuse
  })

  it('🛑 never selects or returns an email', async () => {
    const { res, body } = await get()
    const text = JSON.stringify(body)
    expect(res.status).toBe(200)
    expect(text).not.toMatch(/@example\.test/)
    expect(text).not.toMatch(/email/i)
    expect(db.lastUserSelect).toEqual({ id: true, username: true, displayName: true, avatarUrl: true })
  })

  it('searches display names and handles, case-insensitively, a leading @ ignored', async () => {
    expect((await get('jack')).ids).toEqual(['dee'])
    expect((await get('@KAI')).ids).toEqual(['kai'])
    expect((await get('b')).ids).toEqual(['ben']) // "Ben Bruiser" — not "Jo Allen"
    // A word inside the name ranks with a prefix match; a mid-word hit comes after.
    const { ids } = await get('al')
    expect(ids[0]).toBe('jo') // "Jo *Al*len" — a word start
    expect((await get('stranger')).ids).toEqual([]) // exists, shares nothing
  })

  it('caps the answer at 20', async () => {
    for (let i = 0; i < 30; i += 1) {
      db.users.push(user(`p${i}`, `Player ${i}`))
      db.leagues[0]!.teams.push({ claimedByUserId: `p${i}` })
    }
    const { ids } = await get()
    expect(ids).toHaveLength(20)
  })

  it('one query shape: three reads however many leagues, and no provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (let i = 0; i < 12; i += 1) {
      db.leagues.push({ id: `X${i}`, name: `League ${i}`, userId: 'me', redraftMembers: [], rosters: [], teams: [{ claimedByUserId: 'jo' }] })
    }
    await get()
    expect(db.calls).toEqual({ league: 1, appUser: 1, block: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('a league a person is in across several seasons is named once', async () => {
    db.leagues.push({ id: 'L1-2025', name: 'Dynasty Degens', userId: 'me', redraftMembers: [], rosters: [], teams: [{ claimedByUserId: 'jo' }] })
    const { body } = await get('jo')
    expect(body.mates![0]!.sharedLeagues).toEqual(['Dynasty Degens'])
  })
})
