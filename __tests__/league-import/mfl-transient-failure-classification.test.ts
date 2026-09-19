import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * MFL: a throttle or an outage is not a missing league.
 *
 * 🛑 THE DEFECT THESE PIN. `fetchMflEndpoint` had no timeout and no retry, and every MFL
 * failure that was not worded as an auth or missing-league error arrived at
 * `fetchMflLeagueForImport`'s catch as an internal `MflApiResponseError` — which it
 * re-threw as `MflImportLeagueNotFoundError`, message `MFL league "X" was not found for
 * season Y`. So a single 429, a 503, or one dropped connection told the importing user
 * their league id was wrong.
 *
 * It is worse on the scheduled path. `lib/import-os/collector/normalizedLoader.ts` acts on
 * the pipeline's code: `LEAGUE_NOT_FOUND` means "the league is gone — stop, skip, note it",
 * while `PROVIDER_UNAVAILABLE` means "throttled — retry later". Sleeper and Fleaflicker each
 * grew a dedicated unavailable error after this exact misdiagnosis; MFL was the last
 * provider still collapsing the two.
 *
 * MFL has no committed contract under `contracts/`, and this repo forbids probing a vendor
 * to learn a response shape — so nothing here asserts an MFL payload layout. Every case is
 * built from HTTP semantics (429/5xx/network) plus the error wording the existing parser
 * already handles.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { playerIdentityMap: { findMany: vi.fn(async () => []) } },
}))

vi.mock('@/lib/league-sync-core', () => ({
  getDecryptedAuth: vi.fn(async () => ({ apiKey: 'test-api-key' })),
}))

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => body,
  } as unknown as Response
}

const realFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = realFetch
})

describe('MFL transient failures', () => {
  it('reports a 429 as unavailable, never as a missing league', async () => {
    global.fetch = vi.fn(async () => textResponse('rate limit exceeded', 429)) as unknown as typeof fetch

    const { fetchMflUserLeagues, MflImportUnavailableError, MflImportLeagueNotFoundError } =
      await import('@/lib/league-import/mfl/MflLeagueFetchService')

    const err = await fetchMflUserLeagues('test-api-key', 2026).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MflImportUnavailableError)
    expect(err).not.toBeInstanceOf(MflImportLeagueNotFoundError)
    expect((err as InstanceType<typeof MflImportUnavailableError>).status).toBe(429)
    expect((err as Error).message).toMatch(/rate-limiting/i)
  })

  it('retries a 503 and succeeds when MFL recovers', async () => {
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts++
      if (attempts < 3) return textResponse('<html>Service Unavailable</html>', 503)
      return textResponse(JSON.stringify({ leagues: { league: [{ league_id: '12345', franchise_id: '0003' }] } }))
    }) as unknown as typeof fetch

    const { fetchMflUserLeagues } = await import('@/lib/league-import/mfl/MflLeagueFetchService')

    await expect(fetchMflUserLeagues('test-api-key', 2026)).resolves.toEqual([
      { leagueId: '12345', franchiseId: '0003' },
    ])
    expect(attempts).toBe(3)
  })

  it('retries a dropped connection, then reports it as unavailable with no status', async () => {
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts++
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    const { fetchMflUserLeagues, MflImportUnavailableError } = await import(
      '@/lib/league-import/mfl/MflLeagueFetchService'
    )

    const err = await fetchMflUserLeagues('test-api-key', 2026).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MflImportUnavailableError)
    expect((err as InstanceType<typeof MflImportUnavailableError>).status).toBeNull()
    /* Bounded — a provider that is down must not be hammered indefinitely. */
    expect(attempts).toBe(3)
  })

  /*
   * ⚠ THE CONTROL FOR THE FIX ITSELF. Retrying MFL's settled "no" would triple the request
   * count for every bad league id — exactly the load a 429 is asking us to shed.
   */
  it('does NOT retry an error MFL words into a 200 body', async () => {
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts++
      return textResponse(JSON.stringify({ error: 'League not found' }))
    }) as unknown as typeof fetch

    const { fetchMflUserLeagues, MflImportLeagueNotFoundError } = await import(
      '@/lib/league-import/mfl/MflLeagueFetchService'
    )

    const err = await fetchMflUserLeagues('test-api-key', 2026).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MflImportLeagueNotFoundError)
    expect(attempts).toBe(1)
  })

  /*
   * ⚠ AND THE CONTROL IN THE OTHER DIRECTION — that the status-before-wording ordering did
   * not swallow the real missing-league answer. A 404 is settled, so the wording still decides.
   */
  it('still reports a genuine 404 as a missing league', async () => {
    global.fetch = vi.fn(async () =>
      textResponse(JSON.stringify({ error: 'Invalid league ID' }), 404),
    ) as unknown as typeof fetch

    const { fetchMflUserLeagues, MflImportLeagueNotFoundError } = await import(
      '@/lib/league-import/mfl/MflLeagueFetchService'
    )

    await expect(fetchMflUserLeagues('test-api-key', 2026)).rejects.toBeInstanceOf(
      MflImportLeagueNotFoundError,
    )
  })

  it('does not rewrite a throttled league import into "not found"', async () => {
    global.fetch = vi.fn(async () => textResponse('too many requests', 429)) as unknown as typeof fetch

    const { fetchMflLeagueForImport, MflImportUnavailableError, MflImportLeagueNotFoundError } =
      await import('@/lib/league-import/mfl/MflLeagueFetchService')

    const err = await fetchMflLeagueForImport('user-1', '2026:12345').catch((e: unknown) => e)

    /*
     * ⚠ THE WORDING ASSERTION COMES FIRST ON PURPOSE. It is the one that fails for a
     * BEHAVIOURAL reason against the unfixed code ("MFL league "12345" was not found for
     * season 2026") rather than merely because a new class does not exist yet — which is
     * what makes this a control and not just a compile check.
     */
    expect((err as Error).message).not.toMatch(/was not found/i)
    expect(err).toBeInstanceOf(MflImportUnavailableError)
    expect(err).not.toBeInstanceOf(MflImportLeagueNotFoundError)
  })
})

describe('the pipeline code the collector acts on', () => {
  it('maps an unavailable MFL provider to PROVIDER_UNAVAILABLE, not LEAGUE_NOT_FOUND', async () => {
    /*
     * ⚠ THE REAL ERROR CLASSES, MOCKED FETCHER. `importActual` keeps
     * `MflImportUnavailableError` the same constructor the pipeline's `instanceof` tests
     * against — a hand-written stand-in would pass this test while the shipped mapping fell
     * through to NORMALIZATION_FAILED.
     */
    vi.doMock('@/lib/league-import/mfl/MflLeagueFetchService', async () => {
      const actual = await vi.importActual<
        typeof import('@/lib/league-import/mfl/MflLeagueFetchService')
      >('@/lib/league-import/mfl/MflLeagueFetchService')
      return {
        ...actual,
        fetchMflLeagueForImport: vi.fn(async () => {
          throw new actual.MflImportUnavailableError('MyFantasyLeague is rate-limiting us.', 429)
        }),
      }
    })

    const { runImportedLeagueNormalizationPipeline } = await import(
      '@/lib/league-import/ImportedLeagueNormalizationPipeline'
    )

    const result = await runImportedLeagueNormalizationPipeline({
      provider: 'mfl',
      sourceId: '2026:12345',
      userId: 'user-1',
    })

    expect(result.success).toBe(false)
    expect((result as { code?: string }).code).toBe('PROVIDER_UNAVAILABLE')

    vi.doUnmock('@/lib/league-import/mfl/MflLeagueFetchService')
  })
})
