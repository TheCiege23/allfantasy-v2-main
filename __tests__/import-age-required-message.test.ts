/**
 * AGE_REQUIRED must reach the user as a sentence, not as an enum.
 *
 * ⚠ THIS IS A REGRESSION TEST FOR A COMMENT, NOT JUST FOR CODE. The mapping was
 * deliberately removed, with a note asserting: "That code is emitted only by the
 * brackets product (app/api/bracket/**) … No import endpoint returns it." That was
 * false. Observed 2026-08-29 driving a real Sleeper import against the staging
 * deployment: `POST /api/leagues/import/discover` answered
 * `403 {"error":"AGE_REQUIRED"}` and the import screen rendered the literal string
 * `AGE_REQUIRED` where the error message goes.
 *
 * The gate is `lib/auth-guard.ts` — `isAgeConfirmed(profile)` is false whenever
 * `profile.ageConfirmedAt` is null, and the shared guard the import routes use
 * returns AGE_REQUIRED at 403. A user in that state is not stuck for a mysterious
 * reason; they simply have not confirmed their date of birth, and /verify is where
 * that is done.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { discoverProviderLeagues, fetchImportPreview } from '@/lib/league-import/LeagueCreationImportSubmissionService'

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('the import age gate speaks English', () => {
  it('turns a discover 403 AGE_REQUIRED into an actionable sentence', async () => {
    stubFetch(403, { error: 'AGE_REQUIRED' })
    const res = await discoverProviderLeagues('sleeper', 'theciege24', { sport: 'nfl' })

    expect(res.ok).toBe(false)
    /* The exact failure seen live: the raw enum reaching the screen. */
    expect(res.error).not.toBe('AGE_REQUIRED')
    expect(res.error).toMatch(/date of birth/i)
  })

  it('does the same on the preview path, which shares the guard', async () => {
    stubFetch(403, { error: 'AGE_REQUIRED' })
    const res = await fetchImportPreview('sleeper', '123456', '')

    expect(res.ok).toBe(false)
    expect(res.error).not.toBe('AGE_REQUIRED')
    expect(res.error).toMatch(/date of birth/i)
  })

  /*
   * The neighbouring gate, kept alongside so a future edit cannot "simplify" one
   * of the two into the other — they are different problems with different fixes.
   */
  it('still distinguishes VERIFICATION_REQUIRED', async () => {
    stubFetch(403, { error: 'VERIFICATION_REQUIRED' })
    const res = await discoverProviderLeagues('sleeper', 'theciege24', { sport: 'nfl' })

    expect(res.error).toMatch(/verify your email or phone/i)
    expect(res.error).not.toMatch(/date of birth/i)
  })
})
