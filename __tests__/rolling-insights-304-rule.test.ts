import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The 304 rule, from CLAUDE.md and contracts/rolling-insights/ENDPOINTS.yaml.
 *
 * What a Rolling Insights 304 MEANS is disputed and unresolved: the skill repo
 * calls it a cache artefact, the OpenAPI spec declares it "valid request, empty
 * result set". The rule exists to be correct under BOTH readings, and the one
 * response that is wrong either way is returning `[]` — because then "no data"
 * and "cache hit" are the same value and nothing downstream can tell them apart.
 *
 * This provider used to do exactly that, and only for `scores` and `schedule` —
 * the live paths, where giving up costs the most.
 */
const ORIGINAL_ENV = { ...process.env }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Only the calls that actually asked for game data, not token/auth traffic. */
function dataCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/live/') || u.includes('/scores'))
}

describe('Rolling Insights 304 handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.ROLLING_INSIGHTS_CLIENT_ID = 'test-client-id'
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET = 'test-client-secret'
    process.env.ROLLING_INSIGHTS_RSC_TOKEN = 'test-rsc-token'
    process.env.ROLLING_INSIGHTS_REST_BASE_URL = 'https://ri.test'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retries a 304 with a FRESH cache-buster and uses the retry payload', async () => {
    const games = [{ game_ID: 1, status: 'inprogress', home_team: 'BUF', away_team: 'PIT' }]
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input)
      if (!url.includes('/live/') && !url.includes('/scores')) return jsonResponse({}, 401)
      const call = dataCalls(fetchMock).length
      return call <= 1 ? jsonResponse(null, 304) : jsonResponse({ NFL: games })
    })

    const { rollingInsightsProvider } = await import('@/lib/workers/providers/rolling-insights')
    const result = await rollingInsightsProvider({ sport: 'nfl', dataType: 'scores' } as never)

    const urls = dataCalls(fetchMock)
    expect(urls.length, 'a 304 must trigger exactly one retry').toBeGreaterThanOrEqual(2)

    // The whole point of retrying: a repeated buster would be the same request.
    const busters = urls.slice(0, 2).map((u) => new URL(u).searchParams.get('_'))
    expect(busters[0]).toBeTruthy()
    expect(busters[1]).toBeTruthy()
    expect(busters[0], 'retry reused the cache-buster').not.toBe(busters[1])

    expect(result.data).not.toBeNull()
    expect(result.error).toBeUndefined()
  })

  it('never reports a surviving 304 as an empty result set', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input)
      if (!url.includes('/live/') && !url.includes('/scores')) return jsonResponse({}, 401)
      return jsonResponse(null, 304)
    })

    const { rollingInsightsProvider } = await import('@/lib/workers/providers/rolling-insights')
    const result = await rollingInsightsProvider({ sport: 'nfl', dataType: 'scores' } as never)

    // The regression: this used to be `data: []` with no error, which a caller
    // cannot distinguish from "there are genuinely no games".
    expect(result.data, 'a 304 was laundered into an empty slate').not.toEqual([])
    expect(result.data).toBeNull()
    expect(String(result.error)).toMatch(/304/)
  })

  it('sends the contract-mandated no-cache headers on data requests', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input)
      if (!url.includes('/live/') && !url.includes('/scores')) return jsonResponse({}, 401)
      return jsonResponse({ NFL: [] })
    })

    const { rollingInsightsProvider } = await import('@/lib/workers/providers/rolling-insights')
    await rollingInsightsProvider({ sport: 'nfl', dataType: 'scores' } as never)

    const dataCall = fetchMock.mock.calls.find((c) => {
      const u = String(c[0])
      return u.includes('/live/') || u.includes('/scores')
    })
    expect(dataCall, 'no data request was made').toBeTruthy()
    const headers = (dataCall?.[1] as { headers?: Record<string, string> })?.headers ?? {}
    expect(headers['Cache-Control']).toBe('no-cache, no-store')
    expect(headers.Pragma).toBe('no-cache')
  })

  it('puts a cache-buster on every data request, not just the retry', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input)
      if (!url.includes('/live/') && !url.includes('/scores')) return jsonResponse({}, 401)
      return jsonResponse({ NFL: [] })
    })

    const { rollingInsightsProvider } = await import('@/lib/workers/providers/rolling-insights')
    await rollingInsightsProvider({ sport: 'nfl', dataType: 'scores' } as never)

    const urls = dataCalls(fetchMock)
    // Without this the loop below passes on an empty list, which is exactly the
    // shape of a test that proves nothing.
    expect(urls.length, 'no data request was made at all').toBeGreaterThan(0)
    for (const url of urls) {
      expect(new URL(url).searchParams.get('_'), `no buster on ${url}`).toBeTruthy()
    }
  })
})

describe('vendorToday — the Eastern date the /live endpoint is keyed on', () => {
  // The bug this pins: a UTC date is TOMORROW in Eastern terms from 00:00Z
  // until 04:00Z, and the vendor answers 404 "You cannot request live data for
  // future dates". That window is NFL primetime and the whole evening college
  // slate, so the live feed went dark exactly when games are played.
  it('returns the EASTERN day during primetime, not the UTC day', async () => {
    vi.useFakeTimers()
    try {
      // 00:34Z = 8:34pm Eastern the PREVIOUS day. The measured failure.
      vi.setSystemTime(new Date('2026-08-28T00:34:00Z'))
      const { vendorToday } = await import('@/lib/workers/providers/rolling-insights')
      expect(new Date().toISOString().slice(0, 10), 'sanity: UTC really is the 28th').toBe('2026-08-28')
      expect(vendorToday()).toBe('2026-08-27')
    } finally {
      vi.useRealTimers()
    }
  })

  it('agrees with UTC during the day, when there is no offset to trip over', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-27T16:00:00Z')) // noon Eastern
      const { vendorToday } = await import('@/lib/workers/providers/rolling-insights')
      expect(vendorToday()).toBe('2026-08-27')
    } finally {
      vi.useRealTimers()
    }
  })

  it('offsets whole days without drifting across the month boundary', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-01T02:00:00Z')) // 10pm ET Aug 31
      const { vendorToday } = await import('@/lib/workers/providers/rolling-insights')
      expect(vendorToday()).toBe('2026-08-31')
      expect(vendorToday(-1)).toBe('2026-08-30')
    } finally {
      vi.useRealTimers()
    }
  })
})
