// @vitest-environment node
/**
 * The ESPN transport adapter: retries, public/private detection, format-change handling, caching,
 * and — the part that matters most — that the cookies never leave as anything but a header.
 * `fetch` is injected per call; nothing here reaches ESPN.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ESPN_FORMAT_CHANGED_MESSAGE,
  ESPN_UNAVAILABLE_MESSAGE,
  EspnApiResponseError,
  EspnFormatChangedError,
  EspnUnavailableError,
  buildEspnCookieHeader,
  clearEspnResponseCache,
  fetchEspnFantasyJson,
  probeEspnLeagueAccess,
  redactEspnSecrets,
  validateEspnCookieInput,
  fetchEspnLeagueJson,
} from '@/lib/league-import/espn/espnFantasyClient'

const SWID = '{ABCD1234-EF56-7890-ABCD-1234567890AB}'
const S2 = `AEB${'k3Pq9ZtW1xYv%2B7mN0rLs'.repeat(14)}%3D%3D`
const CREDS = { swid: SWID, espnS2: S2 }
/* Transport tests take any URL; the real one is built (and checked) only through the adapter below. */
const URL_ = 'https://espn.invalid/league'
const LEAGUE = { id: 123, seasonId: 2026, settings: { name: 'Test League', size: 10 }, teams: [] }
const noSleep = async () => {}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

beforeEach(() => clearEspnResponseCache())

describe('league URL', () => {
  it('builds repeated view params and never carries a credential', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json(LEAGUE))
    await fetchEspnLeagueJson(
      { season: 2026, leagueId: '123', views: ['mTeam', 'mSettings'] },
      { fetchImpl, cookieHeader: buildEspnCookieHeader(CREDS) },
    )
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toMatch(/\/apis\/v3\/games\/ffl\/seasons\/2026\/segments\/0\/leagues\/123\?view=mTeam&view=mSettings$/)
    expect(url).not.toMatch(/swid|espn_s2|ABCD1234/i)
  })

  it('builds the activity feed path for the communication read', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ topics: [] }))
    await fetchEspnLeagueJson(
      { season: 2025, leagueId: '77', views: ['kona_league_communication'], subPath: 'communication/' },
      { fetchImpl },
    )
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/leagues\/77\/communication\/\?view=kona_league_communication$/)
  })
})

describe('fetchEspnFantasyJson', () => {
  it('retries a 503 and a network error, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(LEAGUE))
    await expect(fetchEspnFantasyJson(URL_, { fetchImpl, sleep: noSleep })).resolves.toEqual(LEAGUE)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry a definitive 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ messages: ['not found'] }, 404))
    await expect(fetchEspnFantasyJson(URL_, { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(EspnApiResponseError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports exhausted retries with the user-facing "temporarily unavailable" message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 502))
    const error = await fetchEspnFantasyJson(URL_, { fetchImpl, sleep: noSleep }).catch((e) => e)
    expect(error).toBeInstanceOf(EspnUnavailableError)
    expect(error.message).toBe(ESPN_UNAVAILABLE_MESSAGE)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('turns an HTML or array 200 into a format-change error, not a parser crash', async () => {
    const html = vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const e1 = await fetchEspnFantasyJson(URL_, { fetchImpl: html, sleep: noSleep }).catch((e) => e)
    expect(e1).toBeInstanceOf(EspnFormatChangedError)
    expect(e1.message).toBe(ESPN_FORMAT_CHANGED_MESSAGE)

    const arr = vi.fn().mockResolvedValue(json([1, 2]))
    const e2 = await fetchEspnFantasyJson(URL_, { fetchImpl: arr, sleep: noSleep, expectObject: true }).catch((e) => e)
    expect(e2).toBeInstanceOf(EspnFormatChangedError)
  })

  it('sends cookies only as a Cookie header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(LEAGUE))
    await fetchEspnFantasyJson(URL_, { fetchImpl, cookieHeader: buildEspnCookieHeader(CREDS) })
    const [calledUrl, init] = fetchImpl.mock.calls[0]
    expect(String(calledUrl)).not.toContain(S2)
    expect(String(calledUrl)).not.toContain('ABCD1234')
    expect(init.headers.Cookie).toBe(`SWID=${SWID}; espn_s2=${S2}`)
  })

  it('keeps the cookies out of the error message even when ESPN echoes them in the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`bad request espn_s2=${S2} swid=${SWID}`, { status: 400 }))
    const error = (await fetchEspnFantasyJson(URL_, {
      fetchImpl,
      cookieHeader: buildEspnCookieHeader(CREDS),
    }).catch((e) => e)) as EspnApiResponseError
    expect(error.message).toBe('ESPN responded with HTTP 400.')
    expect(error.bodySnippet).not.toContain(S2)
    expect(error.bodySnippet).not.toContain('ABCD1234')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(S2)
  })

  it('caches a success when asked, and de-duplicates concurrent reads', async () => {
    // A fresh Response per call: a body can be read once, so reusing one would fail for the wrong reason.
    const fetchImpl = vi.fn().mockImplementation(async () => json(LEAGUE))
    const [a, b] = await Promise.all([
      fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000 }),
      fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000 }),
    ])
    await fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000 })
    expect(a).toEqual(b)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // A different credential is a different cache entry.
    await fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000, cookieHeader: buildEspnCookieHeader(CREDS) })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json(LEAGUE))
    await fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000 }).catch(() => null)
    await expect(fetchEspnFantasyJson(URL_, { fetchImpl, cacheTtlMs: 10_000 })).resolves.toEqual(LEAGUE)
  })
})

describe('probeEspnLeagueAccess — public vs private detection', () => {
  const args = { season: 2026, leagueId: '123', views: ['mTeam', 'mSettings'] }

  it('reads a public league without sending cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(LEAGUE))
    const result = await probeEspnLeagueAccess({ ...args, credentials: CREDS }, { fetchImpl })
    expect(result.access).toBe('public')
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined()
  })

  it.each([401, 403])('moves to the private step on %s when no cookies are available', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, status))
    expect((await probeEspnLeagueAccess(args, { fetchImpl })).access).toBe('private_needs_cookies')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries a private league with cookies and succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(LEAGUE))
    const result = await probeEspnLeagueAccess({ ...args, credentials: CREDS }, { fetchImpl })
    expect(result.access).toBe('private_ok')
    expect(fetchImpl.mock.calls[1][1].headers.Cookie).toContain('espn_s2=')
  })

  it('reports rejected (expired) cookies distinctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 401))
    expect((await probeEspnLeagueAccess({ ...args, credentials: CREDS }, { fetchImpl })).access).toBe('private_cookies_rejected')
  })

  it('reports a missing league as not_found', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 404))
    expect((await probeEspnLeagueAccess(args, { fetchImpl })).access).toBe('not_found')
  })

  it('flags a league object with none of the expected keys as a format change', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ somethingElse: true }))
    await expect(probeEspnLeagueAccess(args, { fetchImpl })).rejects.toBeInstanceOf(EspnFormatChangedError)
  })
})

describe('redactEspnSecrets', () => {
  it('removes the exact values, cookie pairs, GUIDs and long tokens', () => {
    const text = `Cookie: SWID=${SWID}; espn_s2=${S2} | swid ${SWID.slice(1, -1)} | ${encodeURIComponent(S2)}`
    const out = redactEspnSecrets(text, CREDS)
    expect(out).not.toContain(S2)
    expect(out).not.toContain('ABCD1234-EF56')
    expect(out).not.toContain(encodeURIComponent(S2))
    expect(out).toContain('[REDACTED]')
  })

  it('redacts cookie-shaped text even when the values are not known', () => {
    const out = redactEspnSecrets(`request failed: espn_s2=${S2}; SWID=${SWID}`)
    expect(out).not.toContain(S2)
    expect(out).not.toContain('ABCD1234')
  })

  it('leaves ordinary text alone', () => {
    expect(redactEspnSecrets('ESPN league 123 was not found for 2026.')).toBe('ESPN league 123 was not found for 2026.')
  })
})

describe('validateEspnCookieInput', () => {
  it('accepts real-shaped cookies and restores dropped braces', () => {
    expect(validateEspnCookieInput({ swid: SWID.slice(1, -1), espnS2: S2 })).toEqual({ ok: true, swid: SWID, espnS2: S2 })
  })

  it('strips a copied "name=" prefix and quotes', () => {
    expect(validateEspnCookieInput({ swid: `SWID=${SWID}`, espnS2: `"espn_s2=${S2}"` })).toMatchObject({ ok: true, espnS2: S2 })
  })

  it('catches the common paste mistakes', () => {
    expect(validateEspnCookieInput({ swid: '', espnS2: '' })).toMatchObject({ ok: false, field: 'both' })
    expect(validateEspnCookieInput({ swid: SWID, espnS2: '' })).toMatchObject({ ok: false, field: 'espnS2' })
    expect(validateEspnCookieInput({ swid: S2, espnS2: SWID })).toMatchObject({ ok: false, field: 'both' })
    expect(validateEspnCookieInput({ swid: 'not-a-guid', espnS2: S2 })).toMatchObject({ ok: false, field: 'swid' })
    expect(validateEspnCookieInput({ swid: SWID, espnS2: S2.slice(0, 50) })).toMatchObject({ ok: false, field: 'espnS2' })
    expect(validateEspnCookieInput({ swid: SWID, espnS2: `${S2.slice(0, 200)} ${S2.slice(200)}` })).toMatchObject({
      ok: false,
      field: 'espnS2',
    })
  })
})
