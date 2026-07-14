import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn().mockResolvedValue({}),
}))

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const LEAGUE_BODY = {
  league_id: 'league-1',
  name: 'Test League',
  sport: 'nfl',
  season: '2026',
  total_rosters: 2,
  scoring_settings: { pts_ppr: 1 },
  roster_positions: ['QB', 'RB'],
}

describe('fetchSleeperLeagueForImport resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a full payload with no fetchWarnings when every request succeeds', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/league/league-1')) return jsonResponse(200, LEAGUE_BODY)
      if (url.endsWith('/users')) return jsonResponse(200, [])
      if (url.endsWith('/rosters')) return jsonResponse(200, [])
      if (url.endsWith('/drafts')) return jsonResponse(200, [])
      if (url.includes('/transactions/')) return jsonResponse(200, [])
      if (url.includes('/matchups/')) return jsonResponse(200, [])
      return jsonResponse(404)
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { fetchSleeperLeagueForImport } = await import('@/lib/league-import/sleeper/SleeperLeagueFetchService')
    const result = await fetchSleeperLeagueForImport('league-1', {
      maxTransactionWeeks: 1,
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })

    expect(result).not.toBeNull()
    expect(result?.league.league_id).toBe('league-1')
    expect(result?.fetchWarnings).toBeUndefined()
    expect(result?.fetchedAt).toEqual(expect.any(String))
  })

  it('records a tagged fetchWarning when a category fails after exhausting retries, without failing the whole import', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/league/league-1')) return jsonResponse(200, LEAGUE_BODY)
      if (url.endsWith('/users')) return jsonResponse(200, [])
      if (url.endsWith('/rosters')) return jsonResponse(200, [])
      if (url.endsWith('/drafts')) return jsonResponse(200, [])
      if (url.includes('/transactions/')) return jsonResponse(500) // persistent failure
      if (url.includes('/matchups/')) return jsonResponse(200, [])
      return jsonResponse(404)
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { fetchSleeperLeagueForImport } = await import('@/lib/league-import/sleeper/SleeperLeagueFetchService')
    const result = await fetchSleeperLeagueForImport('league-1', {
      maxTransactionWeeks: 1,
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })

    expect(result).not.toBeNull()
    expect(result?.fetchWarnings).toBeDefined()
    expect(result?.fetchWarnings?.some((w) => w.field === 'transactions')).toBe(true)
    // The rest of the payload is still usable — a failure in one category doesn't null out the whole import.
    expect(result?.league.league_id).toBe('league-1')
  })

  it('treats a 404 for a given week as legitimate no-data, not a warning', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/league/league-1')) return jsonResponse(200, LEAGUE_BODY)
      if (url.endsWith('/users')) return jsonResponse(200, [])
      if (url.endsWith('/rosters')) return jsonResponse(200, [])
      if (url.endsWith('/drafts')) return jsonResponse(200, [])
      if (url.includes('/transactions/')) return jsonResponse(404)
      if (url.includes('/matchups/')) return jsonResponse(200, [])
      return jsonResponse(404)
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { fetchSleeperLeagueForImport } = await import('@/lib/league-import/sleeper/SleeperLeagueFetchService')
    const result = await fetchSleeperLeagueForImport('league-1', {
      maxTransactionWeeks: 1,
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })

    expect(result?.fetchWarnings).toBeUndefined()
    expect(result?.transactions).toEqual([])
  })

  it('returns null and logs a warning when the top-level league fetch itself fails after retries', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500))
    vi.stubGlobal('fetch', fetchImpl)

    const { fetchSleeperLeagueForImport } = await import('@/lib/league-import/sleeper/SleeperLeagueFetchService')
    const result = await fetchSleeperLeagueForImport('league-1', {
      maxTransactionWeeks: 1,
      maxMatchupWeeks: 1,
      maxPreviousSeasons: 0,
    })

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null without warning when the league id genuinely does not exist (404)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404))
    vi.stubGlobal('fetch', fetchImpl)

    const { fetchSleeperLeagueForImport } = await import('@/lib/league-import/sleeper/SleeperLeagueFetchService')
    const result = await fetchSleeperLeagueForImport('does-not-exist')

    expect(result).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
