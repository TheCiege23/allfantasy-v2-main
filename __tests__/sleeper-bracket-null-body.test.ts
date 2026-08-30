/**
 * Sleeper answers 200 with a literal `null` body for a bracket that does not exist.
 *
 * 🛑 THE FAILURE THIS GUARDS, AND WHY NOTHING CAUGHT IT. `getPlayoffBracket` is declared
 * `Promise<SleeperPlayoffBracket[]>` and its guards cover `!response.ok` and `catch`. Neither
 * fires here: the request succeeds, the body parses, and `null` is returned from a function
 * typed as an array. TypeScript cannot see across a `json()` boundary, so the lie survives to
 * the first caller that touches it — `parseChampionFromBracket` doing `bracket.length`.
 *
 * Measured 2026-08-29 while backfilling league history: 13 of 69 Sleeper leagues died on
 * exactly this, every one an elimination format (Guillotine, Survivor, Elimination Station,
 * Chopped, Zombie). Those leagues have no winners bracket. Verified against the live API:
 * `/winners_bracket` for "Elimination Station 2" is 200 with body `null`, while
 * "NFL Dreaming!" returns a populated array from the same endpoint.
 *
 * The cost was not a visible error. One missing bracket aborted that league's entire
 * `previous_league_id` walk, so a guillotine league could never record its season history at
 * all. After the fix the same 13 completed, one of them with seven seasons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPlayoffBracket, getLosersBracket } from '@/lib/sleeper-client'

function respond(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPlayoffBracket — a 200 with a null body', () => {
  it('returns an empty array, not null', async () => {
    respond(null)
    const bracket = await getPlayoffBracket('123')
    expect(bracket).toEqual([])
    expect(Array.isArray(bracket)).toBe(true)
  })

  it('survives the exact operation that used to throw', async () => {
    /*
     * `parseChampionFromBracket` opens with `if (!bracket.length)`. That is the line that threw
     * "Cannot read properties of null (reading 'length')" for 13 leagues.
     */
    respond(null)
    const bracket = await getPlayoffBracket('123')
    expect(() => bracket.length).not.toThrow()
    expect(bracket.length).toBe(0)
  })

  it('still passes a real bracket through untouched', async () => {
    const real = [{ r: 1, m: 1, w: 4, l: 7 }]
    respond(real)
    await expect(getPlayoffBracket('123')).resolves.toEqual(real)
  })

  it('coerces other non-array bodies too, not just null', async () => {
    for (const body of [undefined, {}, 'oops', 0]) {
      respond(body)
      await expect(getPlayoffBracket('123')).resolves.toEqual([])
    }
  })

  it('applies to the losers bracket as well — same endpoint family', async () => {
    respond(null)
    await expect(getLosersBracket('123')).resolves.toEqual([])
  })

  it('keeps returning [] on a non-ok response', async () => {
    respond(null, false, 404)
    await expect(getPlayoffBracket('123')).resolves.toEqual([])
  })
})
