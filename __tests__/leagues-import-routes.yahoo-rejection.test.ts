import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The pasted-league path on /import, end to end on the server: ImportV4 normalises the pasted URL with
 * `toYahooLeagueKey` and posts it to /api/leagues/import/preview, and that route runs the REAL
 * commissioner gate before any preview work. Only the Yahoo HTTP call is replaced.
 *
 * Observed in production 2026-09-13: Yahoo refused with 403, and the red box on the import screen
 * rendered Yahoo's raw JSON body, including our own API path. The gate passed the error message
 * through as `reason`, and the route returns `reason` to the client.
 */

const {
  requireVerifiedUserMock,
  yahooFetchMock,
  orchestrateImportPreviewMock,
  getSleeperImportPreviewMock,
} = vi.hoisted(() => ({
  requireVerifiedUserMock: vi.fn(),
  yahooFetchMock: vi.fn(),
  orchestrateImportPreviewMock: vi.fn(),
  getSleeperImportPreviewMock: vi.fn(),
}))

class YahooImportLeagueNotFoundErrorMock extends Error {}
class YahooApiResponseErrorMock extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { userProfile: { findFirst: vi.fn() } },
}))

vi.mock('@/lib/league-sync-core', () => ({
  getDecryptedAuth: vi.fn(),
}))

vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', () => ({
  fetchYahooLeagueForImport: yahooFetchMock,
  YahooImportLeagueNotFoundError: YahooImportLeagueNotFoundErrorMock,
  YahooApiResponseError: YahooApiResponseErrorMock,
}))

vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({
  fetchEspnLeagueForImport: vi.fn(),
  EspnImportLeagueNotFoundError: class extends Error {},
}))

vi.mock('@/lib/league-import/mfl/MflLeagueFetchService', () => ({
  fetchMflUserLeagues: vi.fn(),
  parseMflSourceInput: (input: string) => ({ season: new Date().getFullYear(), leagueId: input }),
  MflImportLeagueNotFoundError: class extends Error {},
}))

vi.mock('@/lib/league-import/importOrchestrator', () => ({
  orchestrateImportPreview: orchestrateImportPreviewMock,
}))

vi.mock('@/lib/league-import/sleeper/SleeperImportPreviewService', () => ({
  getSleeperImportPreview: getSleeperImportPreviewMock,
}))

/* Byte for byte what Yahoo returned in production (the `\/` escapes are Yahoo's). */
const YAHOO_403_BODY =
  '{"error":{"xml:lang":"en-us","yahoo:uri":"\\/fantasy\\/v2\\/league\\/nfl.l.1361311?format=json",' +
  '"description":"This application is not authorized to perform this action.","detail":""}}'

const PASTED_URL = 'https://football.fantasysports.yahoo.com/f1/1361311'

describe('POST /api/leagues/import/preview — a Yahoo league pasted by URL that Yahoo refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
    yahooFetchMock.mockRejectedValue(new YahooApiResponseErrorMock(403, YAHOO_403_BODY))
  })

  it('shows the mapped sentence, not Yahoo\'s raw body or our API path', async () => {
    const { toYahooLeagueKey } = await import('@/lib/league-import/yahooLeagueKey')
    const sourceId = toYahooLeagueKey(PASTED_URL)
    expect(sourceId).toBe('nfl.l.1361311')

    const { describeYahooRejection } = await import('@/lib/league-import/yahoo/yahooRejection')
    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      new Request('http://localhost/api/leagues/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'yahoo', sourceId }),
      }) as any,
    )

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe(describeYahooRejection(403))

    const wire = JSON.stringify(json)
    for (const leak of ['yahoo:uri', '/fantasy/v2/', '\\/fantasy\\/v2', 'xml:lang', 'not authorized to perform']) {
      expect(wire).not.toContain(leak)
    }

    expect(yahooFetchMock).toHaveBeenCalledWith('u1', 'nfl.l.1361311')
    expect(orchestrateImportPreviewMock).not.toHaveBeenCalled()
  })
})
