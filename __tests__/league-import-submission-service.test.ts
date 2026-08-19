import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sleeper',
        sourceId: '12345',
      }),
    })
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

    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sleeper',
        accountIdentifier: 'theciege24',
        season: '2026',
        sport: 'nfl',
      }),
    })
  })
})
