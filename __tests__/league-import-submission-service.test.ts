import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ⚠ THESE ASSERTED THE ENTIRE OPTIONS OBJECT, so adding a request timeout broke
 * them. "Fleaflicker/ESPN imports: ...a button with no timeout" gave every call
 * an AbortSignal, which is a fix, not a regression - but an exact-match
 * assertion cannot tell those apart and went red on main.
 *
 * They now pin what the call MEANS: the route, the method, the body, and that a
 * signal is present. The signal is asserted deliberately rather than waved past
 * with expect.anything() - a request that silently loses its timeout is the
 * regression this file should catch next time.
 */
describe('LeagueCreationImportSubmissionService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('submits Sleeper imports through the canonical commit route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        league: { id: 'league-1', name: 'Imported League', sport: 'NFL' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { submitImportCreation } = await import(
      '@/lib/league-import/LeagueCreationImportSubmissionService'
    )
    await submitImportCreation('sleeper', '12345', 'u1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leagues/import/commit',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'sleeper',
          sourceId: '12345',
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('calls the provider discovery route with the account identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ leagues: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { discoverProviderLeagues } = await import(
      '@/lib/league-import/LeagueCreationImportSubmissionService'
    )
    await discoverProviderLeagues('sleeper', 'theciege24', {
      season: '2026',
      sport: 'nfl',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leagues/import/discover',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'sleeper',
          accountIdentifier: 'theciege24',
          season: '2026',
          sport: 'nfl',
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
