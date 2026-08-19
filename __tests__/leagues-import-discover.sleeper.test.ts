import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireVerifiedUserMock = vi.fn()
const lookupSleeperUserMock = vi.fn()
const getUserLeaguesMock = vi.fn()

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
})
