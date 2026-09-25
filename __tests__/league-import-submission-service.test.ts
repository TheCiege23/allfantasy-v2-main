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

  /*
   * ⚠ `code` IS THE SERVER'S OWN CLASSIFICATION, NOT ONE THE CLIENT RE-DERIVES.
   * The commit route now distinguishes LEAGUE_NOT_FOUND / PROVIDER_UNAVAILABLE /
   * ATTESTATION_REQUIRED / NOT_COMMISSIONER in its response body (see
   * mapGateFailureStatus in app/api/leagues/import/commit/route.ts). Before this,
   * `status` (the bare HTTP number) was the only signal that crossed the wire, and
   * a caller wanting the specific reason had to re-implement the mapping itself —
   * exactly the two-implementations-of-one-rule shape this repo has been bitten by
   * before with FantasyCalc/SQL normalizers.
   */
  it('surfaces the server\'s `code` alongside `status` on a failed commit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: 'Sleeper is rate-limiting us right now — this league is fine. Wait about a minute and retry.',
        code: 'PROVIDER_UNAVAILABLE',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { submitImportCreation } = await import(
      '@/lib/league-import/LeagueCreationImportSubmissionService'
    )
    const result = await submitImportCreation('sleeper', '12345', 'u1')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(429)
    expect(result.code).toBe('PROVIDER_UNAVAILABLE')
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

  /*
   * 🛑 AN EMPTY-BODY 500 USED TO REACH THE SCREEN AS A JAVASCRIPT PARSE ERROR:
   * "Failed to execute 'json' on 'Response': Unexpected end of JSON input". These use REAL
   * `Response` objects, because the bug lives in how a real body is read.
   */
  describe('a response that is not JSON', () => {
    const HUMAN = 'Import failed on our side — nothing was changed. Try again in a minute.'

    it('commit: an empty 500 becomes a human sentence, not a parse error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
      const { submitImportCreation } = await import(
        '@/lib/league-import/LeagueCreationImportSubmissionService'
      )
      const res = await submitImportCreation('fleaflicker', '349505', 'u1')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(500)
      expect(res.error).toBe(HUMAN)
      expect(res.error).not.toMatch(/JSON|Unexpected/)
    })

    it('preview: an HTML error page becomes a human sentence', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      )
      const { fetchImportPreview } = await import(
        '@/lib/league-import/LeagueCreationImportSubmissionService'
      )
      const res = await fetchImportPreview('fleaflicker', '349505')
      expect(res.ok).toBe(false)
      expect(res.error).toBe(HUMAN)
    })

    it('discover: an empty 200 is not reported as success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))
      const { discoverProviderLeagues } = await import(
        '@/lib/league-import/LeagueCreationImportSubmissionService'
      )
      const res = await discoverProviderLeagues('sleeper', 'someone')
      expect(res.ok).toBe(false)
      expect(res.error).toBe(HUMAN)
    })

    it('a JSON error body still wins — the server’s own sentence is shown', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'League not found', code: 'LEAGUE_NOT_FOUND' }), {
            status: 404,
          }),
        ),
      )
      const { submitImportCreation } = await import(
        '@/lib/league-import/LeagueCreationImportSubmissionService'
      )
      const res = await submitImportCreation('fleaflicker', '349505', 'u1')
      expect(res.error).toBe('League not found')
      expect(res.code).toBe('LEAGUE_NOT_FOUND')
    })
  })

  it('sends the chosen team as claimSourceTeamId when one is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ leagueId: 'l1', name: 'x', sport: 'NFL' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { submitImportCreation } = await import(
      '@/lib/league-import/LeagueCreationImportSubmissionService'
    )
    await submitImportCreation('fleaflicker', '349505', '', { accepted: true }, { claimSourceTeamId: '1002' })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.claimSourceTeamId).toBe('1002')
  })
})
