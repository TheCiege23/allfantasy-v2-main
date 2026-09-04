/**
 * Two subsystems write `AFProjectionSnapshot`, keyed on the same `snapshotLookupKey`, and they
 * disagree about the SHAPE of `adjustmentFactors`.
 *
 * 🛑 THE COLLISION THIS PINS. `lib/af-projections/writeAfProjectionSnapshots.ts` (the scheduled
 * engine) writes an OBJECT — `{ basis, idpPreset, idp, kicker, perGameRates }` — and the IDP and
 * kicker rescore-at-read paths depend on it: `rescoreIdpForLeague` reads
 * `factors.idp.componentAmounts` to reprice a defender under a league's own tackle scoring.
 *
 * `lib/weather/afProjectionService.ts` (on-demand, reached from `/api/weather/af-projection`)
 * upserts the SAME row with `adjustmentFactors: WeatherAdjustmentFactor[]` — an ARRAY. Prisma
 * replaces the whole JSON column, so the engine's object is gone.
 *
 * Nothing throws. `rescoreIdpForLeague` reads `.idp` off an array, finds `undefined`, and returns
 * null — which every caller correctly treats as "no better information, keep the stored value".
 * So a linebacker in a tackle-heavy league silently reverts to the balanced-preset number, which
 * is roughly half right, and the only evidence is that a weather lookup happened first.
 */

import { describe, expect, it } from 'vitest'
import { rescoreIdpForLeague, type StoredProjectionFactors } from '@/lib/af-projections/rescoreForLeague'

/** What the engine persists for a linebacker. */
const ENGINE_BLOB = {
  basis: 'weekly_idp_components',
  idpPreset: 'balanced',
  idp: { componentAmounts: { soloTackle: 6, assistTackle: 3, sack: 0.5, passDefended: 0.4 } },
  kicker: null,
}

/** What the weather service overwrites it with. */
const WEATHER_BLOB = [
  { label: 'Wind', value: '18mph', direction: 'neg' },
  { label: 'Precipitation', value: '60%', direction: 'neg' },
]

/** A tackle-heavy league: solo tackles worth double the balanced preset. */
const TACKLE_HEAVY = { idp_tkl_solo: 2, idp_tkl_ast: 1, idp_sack: 4, idp_pass_def: 1.5 }

describe('🛑 the weather service must not destroy the engine blob', () => {
  it('the engine blob rescores under a league ruleset', () => {
    const r = rescoreIdpForLeague(ENGINE_BLOB as StoredProjectionFactors, TACKLE_HEAVY)
    expect(r).not.toBeNull()
    // 6 solo x2 + 3 assist x1 + 0.5 sack x4 + 0.4 pd x1.5 = 12 + 3 + 2 + 0.6
    expect(r!.points).toBeCloseTo(17.6, 5)
    expect(r!.storedPreset).toBe('balanced')
  })

  it('🛑 the weather array rescores to NOTHING — silently, with no throw', () => {
    /*
     * This is the bug, stated as an assertion. It is not that an error is raised; it is that the
     * function returns the one value every caller reads as "nothing better available", so the
     * league's own scoring is dropped and the balanced number stands in for it.
     */
    const r = rescoreIdpForLeague(WEATHER_BLOB as unknown as StoredProjectionFactors, TACKLE_HEAVY)
    expect(r).toBeNull()
  })

  it('🛑 and the two shapes are mutually unreadable, which is why one had to give', () => {
    // The weather reader's own test: `Array.isArray` is how it decides it has weather factors.
    expect(Array.isArray(WEATHER_BLOB)).toBe(true)
    expect(Array.isArray(ENGINE_BLOB)).toBe(false)
    // So each subsystem reads the other's write as "I have nothing", in both directions.
  })
})

describe('the fix: weather nests, the engine blob survives', () => {
  it('🛑 merging keeps idp.componentAmounts intact, so the rescore still works', async () => {
    const { mergeWeatherFactors } = await import('@/lib/weather/afProjectionService')
    const merged = mergeWeatherFactors(ENGINE_BLOB, WEATHER_BLOB as never)

    // The engine's branch is untouched...
    const r = rescoreIdpForLeague(merged as StoredProjectionFactors, TACKLE_HEAVY)
    expect(r).not.toBeNull()
    expect(r!.points).toBeCloseTo(17.6, 5)
    // ...and it is the SAME answer as before any weather write, which is the whole point.
    expect(r!.points).toBe(rescoreIdpForLeague(ENGINE_BLOB as StoredProjectionFactors, TACKLE_HEAVY)!.points)
  })

  it('and the weather factors are readable back out', async () => {
    const { mergeWeatherFactors, readWeatherFactors } = await import('@/lib/weather/afProjectionService')
    const merged = mergeWeatherFactors(ENGINE_BLOB, WEATHER_BLOB as never)
    expect(readWeatherFactors(merged)).toHaveLength(2)
    expect(readWeatherFactors(merged)[0]).toMatchObject({ label: 'Wind' })
  })

  it('every other engine key survives, not just idp', async () => {
    const { mergeWeatherFactors } = await import('@/lib/weather/afProjectionService')
    const merged = mergeWeatherFactors(ENGINE_BLOB, WEATHER_BLOB as never) as Record<string, unknown>
    expect(merged.basis).toBe('weekly_idp_components')
    expect(merged.idpPreset).toBe('balanced')
    expect('kicker' in merged).toBe(true)
  })

  it('a legacy bare-array row still renders its weather', async () => {
    const { readWeatherFactors } = await import('@/lib/weather/afProjectionService')
    // Rows this service wrote before the fix. The engine data is already gone; this only keeps
    // the weather half readable until the next scheduled pass rewrites the row.
    expect(readWeatherFactors(WEATHER_BLOB)).toHaveLength(2)
  })

  it('a legacy bare-array row is DISCARDED on merge rather than preserved', async () => {
    const { mergeWeatherFactors } = await import('@/lib/weather/afProjectionService')
    const merged = mergeWeatherFactors(WEATHER_BLOB, [] as never) as Record<string, unknown>
    // It carries no engine data, so preserving it would only keep the broken shape alive.
    expect(Array.isArray(merged)).toBe(false)
    expect(merged.weather).toEqual([])
  })

  it('handles the empty cases without inventing a shape', async () => {
    const { mergeWeatherFactors, readWeatherFactors } = await import('@/lib/weather/afProjectionService')
    expect(readWeatherFactors(null)).toEqual([])
    expect(readWeatherFactors(undefined)).toEqual([])
    expect(readWeatherFactors({})).toEqual([])
    expect(readWeatherFactors({ weather: 'not an array' })).toEqual([])
    expect(mergeWeatherFactors(null, WEATHER_BLOB as never)).toEqual({ weather: WEATHER_BLOB })
  })
})
