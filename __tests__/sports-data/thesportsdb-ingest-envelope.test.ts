import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Proves the wiring of parseV1Body into theSportsDbIngest's v1() helper.
 *
 * The parser has its own unit tests. What this covers is the thing that
 * actually bit: a rejected request arrives as HTTP 200 with the error message
 * occupying the data slot, and the old helper handed that straight back. Every
 * caller types the slot as an array, so a 24-character string flowed on as if
 * it were rows.
 */

// vi.mock factories are hoisted above the file, so the mock's state has to be
// created inside vi.hoisted rather than closed over from module scope.
const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsTeam: { upsert }, sportsPlayer: { upsert: vi.fn() } },
}))
vi.mock('@/lib/env/sports-media-keys', () => ({
  getTheSportsDbApiKeyOrFallback: () => 'test-key',
}))

import { ingestTeams } from '@/lib/sports-data/theSportsDbIngest'

const ERROR_BODY = '{"events":"Invalid League ID passed"}'
const TEAMS_ERROR_BODY = '{"teams":"Invalid League ID passed"}'

function mockFetchReturning(body: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => body,
  })) as unknown as typeof fetch
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  upsert.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('v1() envelope handling in ingestTeams', () => {
  it('reports zero fetched when the provider rejects the request', async () => {
    // Before the wiring this returned fetched: 24 -- the character count of
    // "Invalid League ID passed" -- which reads as a write failure rather than
    // a rejected request.
    vi.stubGlobal('fetch', mockFetchReturning(TEAMS_ERROR_BODY))

    const result = await ingestTeams('NFL', { season: '2026-2027' })

    expect(result.fetched).toBe(0)
    expect(result.written).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('surfaces the rejection instead of swallowing it', async () => {
    vi.stubGlobal('fetch', mockFetchReturning(TEAMS_ERROR_BODY))

    await ingestTeams('NFL', { season: '2026-2027' })

    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('Invalid League ID passed'))).toBe(true)
    // The key lives in the URL path for v1, so nothing may echo it.
    expect(messages.some((m) => m.includes('test-key'))).toBe(false)
  })

  it('treats a null data slot as no data, not as rows', async () => {
    vi.stubGlobal('fetch', mockFetchReturning('{"teams":null}'))

    const result = await ingestTeams('NFL', { season: '2026-2027' })

    expect(result.fetched).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('still ingests a well-formed response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchReturning(
        JSON.stringify({
          teams: [
            { idTeam: '134946', strTeam: 'Philadelphia Eagles', strTeamShort: 'PHI' },
            { idTeam: '134947', strTeam: 'Dallas Cowboys', strTeamShort: 'DAL' },
          ],
        })
      )
    )

    const result = await ingestTeams('NFL', { season: '2026-2027' })

    expect(result.fetched).toBe(2)
    expect(result.written).toBe(2)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('does not write rows that carry no id or name', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchReturning(JSON.stringify({ teams: [{ idTeam: '1' }, { strTeam: 'No Id FC' }] }))
    )

    const result = await ingestTeams('NFL', { season: '2026-2027' })

    expect(result.fetched).toBe(2)
    expect(result.written).toBe(0)
  })

  it('returns no data when the endpoint serves an HTML error page', async () => {
    // Retired endpoints answer with HTML and a 200.
    vi.stubGlobal('fetch', mockFetchReturning('<!DOCTYPE html><html>404</html>'))

    const result = await ingestTeams('NFL', { season: '2026-2027' })

    expect(result.fetched).toBe(0)
  })

  it('proves the pre-fix behaviour would have been 24', () => {
    // Guards the regression this wiring exists to prevent: `?? []` does not
    // fire on a string, so the old path measured the message, not rows.
    const slot = (JSON.parse(ERROR_BODY).events ?? []) as unknown as string
    expect(slot.length).toBe(24)
  })
})
