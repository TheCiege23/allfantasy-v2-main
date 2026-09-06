import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚠ THE LIVE BUG THIS PINS. `getJson` collapsed a 429, a 401, a 500, an empty
 * body and a parse error all into `null`, so every provider in
 * gameScoreProviders then reported some variant of "no games returned" — a
 * sentence about the slate when it was actually a sentence about our quota.
 *
 * Verified against the real CFBD key 2026-08-25:
 *
 *     HTTP 429  {"message":"Monthly call quota exceeded."}
 *
 * /api/cron/import-scores surfaces the provider's `error` string in
 * `bySource[...].error` and still answers `ok: true`, so that string was the one
 * place the truth could have appeared, and it said the wrong thing.
 */

const CFBD_QUOTA_BODY = '{"message":"Monthly call quota exceeded."}'

function mockResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  /*
   * ⚠ `unstubAllGlobals` DOES NOT UNDO A `vi.spyOn`. One test below drives `Date.now` from a
   * counter to make the mid-run deadline deterministic; without this the mocked clock leaks into
   * every test that runs after it in this file, which is the kind of pollution that shows up
   * later as an unrelated suite failing for no visible reason.
   */
  vi.restoreAllMocks()
})

async function loadProviders() {
  return import('@/lib/scores/gameScoreProviders')
}

describe('a refused request does not report as an empty slate', () => {
  it('CFBD quota exhaustion is named, not reported as "no games returned"', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, CFBD_QUOTA_BODY)))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.games).toEqual([])
    expect(result.error).toMatch(/quota exceeded/i)
    expect(result.error).not.toMatch(/no games returned/i)
  })

  /**
   * ⚠ CFBD uses 429 for two different things and only the body separates them.
   * Conflating them means either giving up for a month on a transient blip, or
   * hammering a wall that will not open until the month turns.
   */
  it('ordinary throttling is not reported as quota exhaustion', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, '{"message":"Too many requests"}')))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error).toMatch(/rate limited/i)
    expect(result.error).not.toMatch(/quota/i)
  })

  it('a rejected key says so rather than implying there were no games', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error).toMatch(/rejected our key/i)
  })

  it('a genuinely empty slate still reports as empty, which is the distinction', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, '[]')))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.games).toEqual([])
    /*
     * An empty ARRAY is a valid answer — the provider replied and had nothing —
     * so there is no error at all. That is exactly the distinction: a real empty
     * slate reports null, a refusal reports why.
     */
    expect(result.error).toBeNull()
  })

  it('a missing key is still reported before any request is made', async () => {
    vi.stubEnv('CFBD_KEY', '')
    vi.stubEnv('CFBD_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error).toMatch(/not configured/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the credential never leaks into a reported error', () => {
  it('the failure message carries no key and no URL', async () => {
    const KEY = 'super-secret-cfbd-key-value'
    vi.stubEnv('CFBD_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, CFBD_QUOTA_BODY)))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error ?? '').not.toContain(KEY)
    expect(result.error ?? '').not.toContain('collegefootballdata.com')
  })
})

/**
 * ⚠ THE 304 RULE IS LOAD-BEARING (CLAUDE.md). What a Rolling Insights 304 means
 * is disputed between two vendor sources, and the handling has to be correct
 * under BOTH readings: cache-bust every call, retry once, never conclude from
 * the status. A 304 must therefore NOT be reported as a failure.
 */
describe('a 304 is not an error under either reading of the dispute', () => {
  it('retries once and reports no failure', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(304, ''))
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    // Two attempts: the original and the cache-busted retry.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // Not a refusal, so the message stays the one about the slate.
    expect(result.error).toBe('no games returned')
  })

  it('each attempt carries a fresh cache-buster and no-cache headers', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(304, ''))
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchCfbdGames } = await loadProviders()
    await fetchCfbdGames(2026, 1)

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => /[?&]_=\d+/.test(u))).toBe(true)
    const init = fetchSpy.mock.calls[0][1] as any
    expect(init.headers['Cache-Control']).toMatch(/no-store/)
  })
})

/**
 * ⚠ THE HANG WAS THE ONE FAILURE MODE WITH NO CEILING AT ALL.
 *
 * Every request in gameScoreProviders funnelled through one `fetch()` that carried no signal, so
 * a provider which accepted a connection and then stopped talking held the whole handler until
 * the socket died. `import-scores` runs every two minutes and the fast-tier loop guarantees a job
 * never overlaps itself, so an overrun does not delay the next tick — it deletes it. Measured on
 * production 2026-09-06 across 663 runs: p50 10.0s, p95 137.0s, max 345.2s, and 663 runs against
 * the 720 the schedule asks for.
 *
 * The route's own RUN_BUDGET_MS could not have caught this: it is spent inside `persistGames`,
 * which runs AFTER the fetches, so it bounded the fast half and left the slow half open.
 */
describe('a provider that hangs cannot run forever', () => {
  /*
   * 🛑 THE LOAD-BEARING ASSERTION IS THAT THE SIGNAL IS ATTACHED, NOT THAT A TIMEOUT IS
   * CLASSIFIED. Classification is easy to get right while the ceiling is never wired, and that
   * combination passes every test that only inspects the error string — a guard that cannot fail
   * being cited as coverage. This one goes red if `signal:` is dropped from the fetch init.
   */
  it('every request carries an abort signal — the ceiling is wired, not just described', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, '[]'))
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchCfbdGames } = await loadProviders()
    await fetchCfbdGames(2026, 1)

    const init = fetchSpy.mock.calls[0][1] as any
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal.aborted).toBe(false)
  })

  it('a hang is reported as a timeout, not as an empty slate', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    // What AbortSignal.timeout actually rejects with: a DOMException named TimeoutError.
    const hang = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(hang))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.games).toEqual([])
    expect(result.error).toMatch(/did not respond within/i)
    expect(result.error).not.toMatch(/no games returned/i)
  })

  /*
   * ⚠ THE DISCRIMINATING CASE. Folding the timeout into `network` was the tempting shortcut, and
   * it destroys the only signal that says OUR ceiling fired rather than the provider's socket
   * dying. If this goes green while the test above also goes green, the two kinds are genuinely
   * separated; a single over-broad branch cannot satisfy both.
   */
  it('an ordinary network fault is still a network fault, not a timeout', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error).toMatch(/\(network\)/i)
    expect(result.error).not.toMatch(/did not respond within/i)
  })

  it('the timeout message leaks neither the key nor the host', async () => {
    const KEY = 'super-secret-cfbd-key-value'
    vi.stubEnv('CFBD_KEY', KEY)
    const hang = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(hang))

    const { fetchCfbdGames } = await loadProviders()
    const result = await fetchCfbdGames(2026, 1)

    expect(result.error ?? '').not.toContain(KEY)
    expect(result.error ?? '').not.toContain('collegefootballdata.com')
  })
})

/**
 * ⚠ UNDER A DEADLINE THE ORDER OF THIS LIST IS A PRODUCT DECISION, NOT A STYLE ONE.
 *
 * Whatever runs last is what gets dropped when a tick runs short. The original order ran the
 * primary first and ESPN last, so the feed most worth keeping was the first one lost — and ESPN
 * is, by this module's own comment, the only one of the three that reports in-progress state.
 * Guap's call 2026-09-06: ESPN, then TheSportsDB, then the primary.
 */
describe('provider priority decides what survives a short tick', () => {
  const withProviderEnv = () => {
    vi.stubEnv('THESPORTSDB_API_KEY', 'test-key-not-a-real-credential')
    vi.stubEnv('ROLLING_INSIGHTS_RSC_TOKEN', 'test-token-not-a-real-credential')
  }

  it('runs ESPN, then TheSportsDB, then Rolling Insights', async () => {
    withProviderEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, '[]')))

    const { fetchGamesForSport } = await loadProviders()
    const attempts = await fetchGamesForSport('NFL', 2026)

    expect(attempts.map((a) => a.source)).toEqual(['espn', 'thesportsdb', 'rolling_insights'])
  })

  /*
   * 🛑 A DROPPED PROVIDER IS REPORTED, NOT OMITTED. Returning a shorter array would make "we ran
   * out of time" indistinguishable from "that feed had nothing", which is the silent-truncation
   * failure the run budget exists to avoid. The route surfaces these strings in bySource.
   */
  it('a deadline already past skips every provider and says so, without calling out', async () => {
    withProviderEnv()
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, '[]'))
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchGamesForSport } = await loadProviders()
    const attempts = await fetchGamesForSport('NFL', 2026, undefined, { deadlineAt: Date.now() - 1 })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(attempts.map((a) => a.source)).toEqual(['espn', 'thesportsdb', 'rolling_insights'])
    expect(attempts.every((a) => /skipped: run budget exhausted/.test(a.error ?? ''))).toBe(true)
  })

  /*
   * The case the priority exists for: time runs out mid-run and exactly one provider fits.
   * Deterministic — the clock is driven by the mock rather than by wall time, so this cannot
   * flake on a loaded box.
   */
  it('when only one provider fits, the one that survives is ESPN', async () => {
    withProviderEnv()
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    // The first provider's request consumes the whole remaining budget.
    const fetchSpy = vi.fn().mockImplementation(async () => {
      clock += 10_000
      return mockResponse(200, '[]')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { fetchGamesForSport } = await loadProviders()
    const attempts = await fetchGamesForSport('NFL', 2026, undefined, { deadlineAt: clock + 5_000 })

    const skipped = attempts.filter((a) => /skipped: run budget exhausted/.test(a.error ?? ''))
    expect(skipped.map((a) => a.source)).toEqual(['thesportsdb', 'rolling_insights'])
    // ESPN ran: it is the one source NOT carrying the skip marker.
    expect(attempts[0].source).toBe('espn')
    expect(attempts[0].error ?? '').not.toMatch(/skipped/)
  })

  /*
   * 🛑 `/live/{date}` IS KEYED ON THE VENDOR'S US EASTERN DAY, AND A UTC DATE MISSES EVERY
   * PRIMETIME GAME. The window is 00:00-04:00 UTC — Sunday night, Monday night, Thursday night —
   * where the UTC calendar has already rolled over and Eastern has not, so the request asks for a
   * date on which those games had not been played. Kickoff below is 8:30pm ET on Sunday the 6th,
   * which is 00:30Z on Monday the 7th.
   */
  it('asks /live for the EASTERN date, not the UTC one, during a primetime game', async () => {
    withProviderEnv()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T00:30:00Z')) // Sun 8:30pm ET
    try {
      const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, '{}'))
      vi.stubGlobal('fetch', fetchSpy)

      const { fetchRollingInsightsNflGames } = await loadProviders()
      await fetchRollingInsightsNflGames()

      const liveUrl = fetchSpy.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/live/'))
      expect(liveUrl).toBeDefined()
      expect(liveUrl).toContain('/live/2026-09-06/NFL')
      expect(liveUrl).not.toContain('/live/2026-09-07/NFL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('NCAAF uses CFBD as its primary, in the same position', async () => {
    withProviderEnv()
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, '[]')))

    const { fetchGamesForSport } = await loadProviders()
    const attempts = await fetchGamesForSport('NCAAF', 2026)

    expect(attempts.map((a) => a.source)).toEqual(['espn', 'thesportsdb', 'cfbd'])
  })
})
