import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Yahoo discovery lists only leagues the Yahoo import will accept.
 *
 * The Yahoo league list asks for `game_keys=nfl,nba,mlb,nhl`. The route used to keep any league
 * whose sport matched the request OR had no sport at all, so an unreadable sport was listed as
 * whatever was asked for. Now a league must name the requested sport AND pass the same
 * `checkImportSportSupported` the import runs. Yahoo stays switched off (`available: false`); the
 * discovery switch is forced on here only so the Yahoo branch can be reached in a test.
 */

const requireVerifiedUserMock = vi.fn()
const listYahooLeaguesForAccountMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deletedLeagueTombstone: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))

vi.mock('@/lib/league-import/provider-ui-config', async (orig) => ({
  ...(await orig<object>()),
  supportsImportProviderDiscovery: () => true,
}))

vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', async (orig) => ({
  ...(await orig<object>()),
  listYahooLeaguesForAccount: listYahooLeaguesForAccountMock,
}))

function discover(body: Record<string, unknown>) {
  return new Request('http://localhost/api/leagues/import/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
  listYahooLeaguesForAccountMock.mockResolvedValue([
    { leagueKey: '461.l.1', season: 2026, sport: 'NFL', name: 'Football', numTeams: 12 },
    { leagueKey: '466.l.2', season: 2026, sport: 'NBA', name: 'Hoops', numTeams: 10 },
    { leagueKey: '999.l.3', season: 2026, sport: null, name: 'Unknown', numTeams: 8 },
  ])
})

describe('POST /api/leagues/import/discover — Yahoo sport filter', () => {
  it('lists only the NFL league: not the NBA one, not the one with no sport', async () => {
    const { POST } = await import('@/app/api/leagues/import/discover/route')
    const res = await POST(discover({ provider: 'yahoo', sport: 'nfl' }) as never)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { leagues: Array<{ sourceId: string }> }
    expect(data.leagues.map((l) => l.sourceId)).toEqual(['461.l.1'])
  })

  it('refuses a request for a sport Yahoo import does not support, before calling Yahoo', async () => {
    const { POST } = await import('@/app/api/leagues/import/discover/route')
    const res = await POST(discover({ provider: 'yahoo', sport: 'nba' }) as never)
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: string }
    expect(data.error).toContain('Yahoo imports support NFL leagues right now')
    expect(listYahooLeaguesForAccountMock).not.toHaveBeenCalled()
  })
})
