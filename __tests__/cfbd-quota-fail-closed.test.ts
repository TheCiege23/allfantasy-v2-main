import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cfbdGet, describeCfbdFailure, isRetryable } from '@/lib/cfbd-fetch'

/**
 * ⚠ THE LIVE FAILURE THESE PIN DOWN. Verified against the real key 2026-08-25:
 *
 *     HTTP 429  x-calllimit-remaining: 0  {"message":"Monthly call quota exceeded."}
 *
 * Every CFBD call in the repo was turning that into `[]` or skipping it, so a
 * quota wall and an empty draft class were the same value downstream. The API is
 * still over quota, so these mock fetch rather than call it — which is also the
 * only way to test the branch on demand.
 */

const KEY = 'test-key-not-a-real-credential'

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a quota wall is not an empty result', () => {
  it('classifies the real quota-exceeded body as quota, not a generic error', async () => {
    vi.stubGlobal('fetch', mockFetch(429, '{"message":"Monthly call quota exceeded."}'))
    const res = await cfbdGet('/draft/picks?year=2021', KEY)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('quota')
    expect(res.failure.status).toBe(429)
  })

  /**
   * ⚠ CFBD USES 429 FOR TWO DIFFERENT THINGS. Conflating them means either
   * giving up for weeks on a transient blip, or hammering a wall.
   */
  it('separates ordinary throttling from monthly exhaustion', async () => {
    vi.stubGlobal('fetch', mockFetch(429, '{"message":"Too many requests"}'))
    const res = await cfbdGet('/roster?team=Alabama&year=2024', KEY)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('rate_limit')
  })

  it('a quota wall is not retryable; a throttle is', async () => {
    vi.stubGlobal('fetch', mockFetch(429, '{"message":"Monthly call quota exceeded."}'))
    const quota = await cfbdGet('/x', KEY)
    vi.stubGlobal('fetch', mockFetch(429, '{"message":"slow down"}'))
    const throttle = await cfbdGet('/x', KEY)

    expect(quota.ok).toBe(false)
    expect(throttle.ok).toBe(false)
    if (quota.ok || throttle.ok) return
    expect(isRetryable(quota.failure)).toBe(false)
    expect(isRetryable(throttle.failure)).toBe(true)
  })

  it('a rejected key is unauthorized, not empty data', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', mockFetch(status, 'nope'))
      const res = await cfbdGet('/draft/picks?year=2021', KEY)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.failure.kind).toBe('unauthorized')
    }
  })

  it('a network failure is reported, never swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const res = await cfbdGet('/draft/picks?year=2021', KEY)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('network')
    expect(res.failure.status).toBeNull()
  })

  it('a missing key fails loudly rather than returning nothing', async () => {
    const res = await cfbdGet('/draft/picks?year=2021', '')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('unauthorized')
  })

  it('a genuinely empty result still succeeds — that is the whole distinction', async () => {
    vi.stubGlobal('fetch', mockFetch(200, '[]'))
    const res = await cfbdGet<unknown[]>('/draft/picks?year=1904', KEY)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual([])
  })
})

describe('the key never travels anywhere it could be logged', () => {
  it('sends the key as a Bearer header, never in the URL', async () => {
    const spy = mockFetch(200, '[]')
    vi.stubGlobal('fetch', spy)
    await cfbdGet('/draft/picks?year=2021', KEY)

    const [url, init] = spy.mock.calls[0]
    expect(String(url)).not.toContain(KEY)
    expect((init as any).headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('the loggable description carries the path but not the key', async () => {
    vi.stubGlobal('fetch', mockFetch(429, '{"message":"Monthly call quota exceeded."}'))
    const res = await cfbdGet('/draft/picks?year=2021', KEY)
    if (res.ok) return
    const text = describeCfbdFailure(res.failure)
    expect(text).toContain('/draft/picks?year=2021')
    expect(text).not.toContain(KEY)
  })
})

/**
 * ⚠ THE CORRUPTION PATH. devy-classification infers status from ABSENCE and then
 * writes graduatedToNFL for every player. Asserted at the source because the
 * function needs prisma and a live API to run, and the thing worth protecting is
 * that the guard exists at all.
 */
describe('the classifier refuses to write conclusions drawn from failed fetches', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'lib/devy-classification.ts'), 'utf8')

  it('counts how many draft years and rosters actually loaded', () => {
    expect(SRC).toContain('draftYearsLoaded')
    expect(SRC).toContain('teamsLoaded')
  })

  it('returns before the write loop when no draft year loaded', () => {
    expect(SRC).toMatch(/if \(draftYearsLoaded === 0\)[\s\S]{0,400}return result/)
  })

  it('returns before the write loop when no roster loaded', () => {
    expect(SRC).toMatch(/if \(teamsLoaded === 0\)[\s\S]{0,400}return result/)
  })

  /**
   * ⚠ SCOPED TO classifyDraftStatus DELIBERATELY. There are eight
   * `prisma.devyPlayer` write sites in this file across eight ingest functions,
   * so a whole-file search finds ingestCFBDStats first and proves nothing about
   * the guard.
   */
  const CLASSIFY = (() => {
    const start = SRC.indexOf('export async function classifyDraftStatus')
    const next = SRC.indexOf('\nexport async function', start + 1)
    return SRC.slice(start, next === -1 ? undefined : next)
  })()

  it('the slice really is the classifier and really does write', () => {
    // Guards the guard: if this function is renamed the assertions below would
    // silently pass against an empty string.
    expect(CLASSIFY).toContain('classifyDraftStatus')
    expect(CLASSIFY).toContain('prisma.devyPlayer.update')
  })

  it('aborts ahead of its own update, not after it', () => {
    const abort = CLASSIFY.indexOf('ABORTED before writing')
    const write = CLASSIFY.indexOf('prisma.devyPlayer.update')
    expect(abort).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(-1)
    expect(abort).toBeLessThan(write)
  })

  it('uses the result-returning fetches, so a failure is visible to it', () => {
    expect(SRC).toContain('getCFBDraftPicksResult')
    expect(SRC).toContain('getCFBTeamRosterResult')
  })
})
