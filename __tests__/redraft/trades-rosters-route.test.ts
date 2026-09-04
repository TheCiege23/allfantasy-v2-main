/**
 * Regression lock for the new member-gated roster-listing endpoint that powers the native trade
 * proposal UI. `/api/league/roster?userId=` only lets the league owner view another manager's
 * roster, which would silently block a regular member from building a trade with a teammate who
 * isn't the commissioner. This endpoint is gated by `assertLeagueMember` instead — the same check
 * every other trade action route already uses — since roster composition isn't sensitive within a
 * league (it's already visible on the Matchups tab).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const assertLeagueMember = vi.fn()
const findManyRoster = vi.fn()
const findUniqueLeague = vi.fn()
const findManyAppUser = vi.fn()
const findManyLeagueTeam = vi.fn()
const findFirstLeagueTeam = vi.fn()
const findUniqueUserProfile = vi.fn()
const getNormalizedPlayerData = vi.fn()
const getPlayerValues = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
/*
 * ⚠ THE ROUTE READS `prisma.league` NOW, AND THE MOCK ONLY HAD `roster`. The
 * season lookup that decides rookie-vs-future on a draft pick was added to the
 * handler and this fake was not extended, so every call landed on undefined —
 * "Cannot read properties of undefined (reading 'findUnique')" — before a single
 * assertion ran. Stubbing the model rather than the whole call keeps the route's
 * own `.catch(() => null)` fallback exercised.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: (...args: unknown[]) => findManyRoster(...args) },
    league: { findUnique: (...args: unknown[]) => findUniqueLeague(...args) },
    appUser: { findMany: (...args: unknown[]) => findManyAppUser(...args) },
    leagueTeam: {
      findMany: (...args: unknown[]) => findManyLeagueTeam(...args),
      findFirst: (...args: unknown[]) => findFirstLeagueTeam(...args),
    },
    userProfile: { findUnique: (...args: unknown[]) => findUniqueUserProfile(...args) },
  },
}))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: (...args: unknown[]) => assertLeagueMember(...args),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: (...args: unknown[]) => getNormalizedPlayerData(...args),
}))
/*
 * ⚠ THE SERIALIZER IS MOCKED AS IDENTITY, DELIBERATELY. What is under test here is that the ROUTE
 * stops discarding fields — its previous mapping kept `{ id, name, position }` and dropped the
 * rest. Driving the real serializer instead means the fixture has to satisfy its whole
 * `UnifiedPlayerProductView` contract, and an incomplete one makes it throw into the route's
 * `catch`, which falls back to raw ids — so the test fails with nulls that look like the bug it is
 * checking for rather than like a bad fixture. Two different things, identical symptom.
 */
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({
  serializeUnifiedPlayerForApi: (row: Record<string, unknown>) => row,
}))
/*
 * Values come from the DB-first FantasyCalc snapshot. Mocked so these tests assert the ROUTE's
 * plumbing — that a miss stays null and a hit reaches the wire — without depending on a cached
 * valuation table that is empty in test and would make every value null for the wrong reason.
 */
vi.mock('@/lib/fantasycalc-db', () => ({
  getPlayerValuesForNamesDbFirst: (...args: unknown[]) => getPlayerValues(...args),
}))

import { GET } from '@/app/api/leagues/[leagueId]/trades/rosters/route'

function ctx(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) }
}

describe('GET /api/leagues/[leagueId]/trades/rosters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'user-a' } })
    /* Any real season will do here: these tests assert roster contents and the
       player-id fallback, not pick labelling. */
    findUniqueLeague.mockResolvedValue({ season: 2026 })
    /* Empty is the honest default: these tests are about rosters, and the route
       must degrade to raw ids rather than depending on display-name lookups. */
    findManyAppUser.mockResolvedValue([])
    findManyLeagueTeam.mockResolvedValue([])
    findFirstLeagueTeam.mockResolvedValue(null)
    findUniqueUserProfile.mockResolvedValue(null)
    getPlayerValues.mockResolvedValue(new Map())
  })

  it('rejects a non-member (403), matching every other trade route\'s access gate', async () => {
    assertLeagueMember.mockResolvedValue({ ok: false, status: 403 })
    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    expect(res.status).toBe(403)
  })

  it('returns every roster in the league (not just the owner\'s) for a real league member', async () => {
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['p1', 'p2'] } },
      { id: 'roster-b', platformUserId: 'user-b', playerData: { players: ['p3'] } },
    ])
    getNormalizedPlayerData.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === 'user-a') {
        return [
          { unified: {}, display: {} } as never, // enrichment lookup is best-effort; id mapping below covers the assertion
        ]
      }
      return []
    })

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const body = (await res.json()) as { rosters: Array<{ rosterId: string; platformUserId: string; players: Array<{ id: string }> }> }

    expect(res.status).toBe(200)
    expect(body.rosters).toHaveLength(2)
    expect(body.rosters.map((r) => r.rosterId)).toEqual(['roster-a', 'roster-b'])
    expect(body.rosters[0].players.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(body.rosters[1].players.map((p) => p.id)).toEqual(['p3'])
  })

  it('falls back to raw player ids as the name when enrichment fails (matches the placeholder convention used elsewhere)', async () => {
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findManyRoster.mockResolvedValue([{ id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['synthetic-id-1'] } }])
    getNormalizedPlayerData.mockRejectedValue(new Error('provider down'))

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const body = (await res.json()) as { rosters: Array<{ players: Array<{ id: string; name: string }> }> }
    /*
     * ⚠ THE FALLBACK MUST CARRY EVERY FIELD, NOT A NARROWER OBJECT. The picker renders a headshot
     * slot, a team logo, a bye week and an injury chip from this shape; a fallback that omitted
     * them would make the enrichment failure a RENDER failure too, on a row that should simply
     * show a name and blanks. Asserted exactly rather than with toMatchObject for that reason —
     * a missing key here is the bug, and toMatchObject would pass over it.
     */
    expect(body.rosters[0].players).toEqual([
      {
        id: 'synthetic-id-1',
        name: 'synthetic-id-1',
        position: null,
        team: null,
        imageUrl: null,
        byeWeek: null,
        injuryStatus: null,
        value: null,
      },
    ])
  })
})

describe('🛑 the payload the picker renders from', () => {
  /*
   * WHY THIS EXISTS. `getNormalizedPlayerData` + `serializeUnifiedPlayerForApi` already returned
   * team, headshot, bye week and injury status, and this route kept only `{ id, name, position }`.
   * That single narrowing is why the asset picker had to be a search box: there was nothing on the
   * wire to render as a browsable roster. These assert the fields survive the trip, because the
   * failure mode is silent — the UI just looks sparse, and no test noticed for as long as the
   * narrowing existed.
   */
  beforeEach(() => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findUniqueLeague.mockResolvedValue({ season: 2026 })
    findManyAppUser.mockResolvedValue([])
    findFirstLeagueTeam.mockResolvedValue(null)
    findUniqueUserProfile.mockResolvedValue(null)
    getPlayerValues.mockResolvedValue(new Map())
  })

  it('carries team, headshot, bye week and injury status through to the wire', async () => {
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['p1'] }, faabRemaining: 73 },
    ])
    findManyLeagueTeam.mockResolvedValue([
      { platformUserId: 'user-a', teamName: 'Dynasty Dogs', externalId: '4', avatarUrl: 'https://x/a.png', wins: 6, losses: 2, ties: 0 },
    ])
    /*
     * ⚠ NESTED UNDER `unified`, WHICH IS THE SHAPE THE SERIALIZER ACTUALLY READS. A flat fixture
     * silently yields nulls for every field — the serializer finds nothing and returns its
     * fallbacks, so the assertion fails against a plausible-looking payload rather than an error.
     * `byeWeek` sits on the entry itself, not under `unified`; the serializer reads them from
     * different levels and a fixture that guesses one shape for both proves nothing.
     */
    getNormalizedPlayerData.mockResolvedValue([
      { id: 'p1', name: 'Perry Vance', position: 'WR', team: 'GB', imageUrl: 'https://x/p1.png', byeWeek: 10, injuryStatus: 'Q' },
    ])

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const body = (await res.json()) as { rosters: Array<Record<string, unknown>> }
    const roster = body.rosters[0]!
    const player = (roster.players as Array<Record<string, unknown>>)[0]!

    expect(player.team).toBe('GB')
    expect(player.imageUrl).toBe('https://x/p1.png')
    expect(player.byeWeek).toBe(10)
    expect(player.injuryStatus).toBe('Q')
  })

  it('carries the manager avatar, record and FAAB', async () => {
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: [] }, faabRemaining: 73 },
    ])
    findManyLeagueTeam.mockResolvedValue([
      { platformUserId: 'user-a', teamName: 'Dynasty Dogs', externalId: '4', avatarUrl: 'https://x/a.png', wins: 6, losses: 2, ties: 1 },
    ])
    getNormalizedPlayerData.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const roster = ((await res.json()) as { rosters: Array<Record<string, unknown>> }).rosters[0]!

    expect(roster.avatarUrl).toBe('https://x/a.png')
    expect(roster).toMatchObject({ wins: 6, losses: 2, ties: 1 })
    expect(roster.faabRemaining).toBe(73)
  })

  it('🛑 a 0-0-0 record is reported, not omitted', async () => {
    // Pre-season every team genuinely IS 0-0-0. Treating that as "unknown" and hiding it would
    // make the picker look broken in exactly the month it gets the most use.
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: [] }, faabRemaining: null },
    ])
    findManyLeagueTeam.mockResolvedValue([
      { platformUserId: 'user-a', teamName: 'T', externalId: '4', avatarUrl: null, wins: 0, losses: 0, ties: 0 },
    ])
    getNormalizedPlayerData.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const roster = ((await res.json()) as { rosters: Array<Record<string, unknown>> }).rosters[0]!

    expect(roster).toMatchObject({ wins: 0, losses: 0, ties: 0 })
    // Null FAAB means the league tracks none — distinct from $0 available to offer.
    expect(roster.faabRemaining).toBeNull()
  })
})

describe('🛑 market value on the roster rows', () => {
  beforeEach(() => {
    /*
     * FIRST, and the reason is the assertion below. "resolves the whole league in ONE call" counts
     * invocations, and without a clear the count accumulates across every earlier test in this
     * describe — it read 4 for a route that calls it once. A call-count assertion on a shared mock
     * is only meaningful against a known-zero start.
     */
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findUniqueLeague.mockResolvedValue({ season: 2026 })
    findManyAppUser.mockResolvedValue([])
    findManyLeagueTeam.mockResolvedValue([])
    findFirstLeagueTeam.mockResolvedValue(null)
    findUniqueUserProfile.mockResolvedValue(null)
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['p1', 'p2'] }, faabRemaining: null },
    ])
    getNormalizedPlayerData.mockResolvedValue([
      { id: 'p1', name: 'Perry Vance', position: 'WR' },
      { id: 'p2', name: 'Nobody Onboard', position: 'RB' },
    ])
  })

  it('attaches the value and leaves a miss NULL, not 0', async () => {
    /*
     * The distinction the whole verdict rests on. A 0 reads as a worthless player; null means the
     * engine has no price, which is exactly what makes it decline to judge a deal. Collapsing them
     * here would hide the reason downstream.
     */
    getPlayerValues.mockResolvedValue(new Map([['perry vance', { value: 6552 }]]))

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const players = ((await res.json()) as { rosters: Array<{ players: Array<Record<string, unknown>> }> }).rosters[0]!.players

    expect(players[0]!.value).toBe(6552)
    expect(players[1]!.value).toBeNull()
  })

  it('🛑 resolves the whole league in ONE call, not one per roster', async () => {
    /*
     * Every roster draws from the same valuation snapshot. A lookup inside the per-roster loop would
     * read it 12-32 times for one answer, on a request that opens the trade UI.
     */
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['p1'] }, faabRemaining: null },
      { id: 'roster-b', platformUserId: 'user-b', playerData: { players: ['p2'] }, faabRemaining: null },
    ])
    getPlayerValues.mockResolvedValue(new Map())

    await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))

    expect(getPlayerValues).toHaveBeenCalledTimes(1)
  })

  it('🛑 uses the same settings as player-search, so one player cannot show two values', async () => {
    // The picker renders search results beside roster rows. Different settings would give the same
    // player two numbers on one screen with nothing saying which the engine used.
    getPlayerValues.mockResolvedValue(new Map())
    await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    expect(getPlayerValues.mock.calls[0][1]).toEqual({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 })
  })

  it('a valuation outage costs values and nothing else', async () => {
    getPlayerValues.mockRejectedValue(new Error('cache miss'))
    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    expect(res.status).toBe(200)
    const players = ((await res.json()) as { rosters: Array<{ players: Array<Record<string, unknown>> }> }).rosters[0]!.players
    expect(players[0]!.name).toBe('Perry Vance')
    expect(players[0]!.value).toBeNull()
  })
})
