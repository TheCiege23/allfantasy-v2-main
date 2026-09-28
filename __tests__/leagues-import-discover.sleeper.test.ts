import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireVerifiedUserMock = vi.fn()
const lookupSleeperUserMock = vi.fn()
const getUserLeaguesMock = vi.fn()

/*
 * ⚠ THE DISCOVER ROUTE NOW READS TOMBSTONES (de9bda225), so it needs prisma.
 * Without this the route's lookup throws "Cannot read properties of null (reading
 * 'deletedLeagueTombstone')", is caught, and silently defaults previouslyDeleted to
 * false — so the assertion below would pass through the ERROR path rather than the real
 * one. Mocking it means the field is measured, not defaulted.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    deletedLeagueTombstone: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/sleeper/user-lookup', () => ({
  lookupSleeperUser: lookupSleeperUserMock,
}))

vi.mock('@/lib/sleeper-client', () => ({
  getUserLeagues: getUserLeaguesMock,
}))

describe('POST /api/leagues/import/discover Sleeper account discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({
      ok: true,
      userId: 'u1',
    })
  })

  it('discovers leagues from a provider account identifier', async () => {
    lookupSleeperUserMock.mockResolvedValue({
      status: 'found',
      user: {
        user_id: 'sleeper-user-1',
        username: 'theciege24',
        display_name: 'TheCiege24',
      },
    })
    getUserLeaguesMock.mockResolvedValue([
      {
        league_id: 'league-123',
        name: 'Main Event',
        sport: 'nfl',
        season: '2026',
        status: 'pre_draft',
        total_rosters: 12,
        settings: { type: 2 },
        avatar: 'abc123',
      },
    ])

    const { POST } = await import('@/app/api/leagues/import/discover/route')
    const req = new Request('http://localhost/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sleeper',
        accountIdentifier: 'theciege24',
        season: '2026',
        sport: 'nfl',
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      provider: 'sleeper',
      sport: 'nfl',
      season: '2026',
      account: {
        providerUserId: 'sleeper-user-1',
        accountIdentifier: 'theciege24',
        displayName: 'TheCiege24',
      },
      leagues: [
        {
          previouslyDeleted: false,
          sourceId: 'league-123',
          name: 'Main Event',
          sport: 'nfl',
          season: '2026',
          status: 'pre_draft',
          totalTeams: 12,
          isDynasty: true,
          avatarUrl: 'https://sleepercdn.com/avatars/thumbs/abc123',
        },
      ],
    })
    expect(lookupSleeperUserMock).toHaveBeenCalledWith('theciege24')
    expect(getUserLeaguesMock).toHaveBeenCalledWith(
      'sleeper-user-1',
      'nfl',
      '2026',
    )
  })

  it('returns 404 when the provider account cannot be found', async () => {
    lookupSleeperUserMock.mockResolvedValue({
      status: 'not_found',
    })

    const { POST } = await import('@/app/api/leagues/import/discover/route')
    const req = new Request('http://localhost/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sleeper',
        accountIdentifier: 'missing-user',
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      error: 'Provider account not found.',
    })
    expect(getUserLeaguesMock).not.toHaveBeenCalled()
  })

  /*
   * 🛑 A SLEEPER HANDLE ALREADY LINKED TO ANOTHER ALLFANTASY LOGIN. The stamp's unique violation was
   * swallowed, discovery listed the leagues, and the preview then said "Link your Sleeper account" —
   * advice this login can never follow. The route now says so, and only for that failure.
   */
  describe('the discovered handle is already linked to a different login', () => {
    async function discoverWithStampError(error: unknown) {
      const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: Record<string, unknown> }
      prisma.userProfile = {
        upsert: vi.fn().mockResolvedValue({ userId: 'u1', sleeperUserId: null }),
        update: vi.fn().mockRejectedValue(error),
      }
      lookupSleeperUserMock.mockResolvedValue({
        status: 'found',
        user: { user_id: 'sleeper-user-1', username: 'theciege24', display_name: 'TheCiege24' },
      })
      getUserLeaguesMock.mockResolvedValue([])
      const { POST } = await import('@/app/api/leagues/import/discover/route')
      const res = await POST(
        new Request('http://localhost/api/leagues/import/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'sleeper', accountIdentifier: 'theciege24' }),
        }) as any,
      )
      delete prisma.userProfile
      return res
    }

    it('reports handleLinkedElsewhere on a unique violation of the Sleeper id', async () => {
      const res = await discoverWithStampError(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['sleeperUserId'] } }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ handleLinkedElsewhere: true })
    })

    it('stays silent for any other stamp failure', async () => {
      const res = await discoverWithStampError(new Error('connection reset'))
      expect(res.status).toBe(200)
      expect(await res.json()).not.toHaveProperty('handleLinkedElsewhere')
    })
  })
})
