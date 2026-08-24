import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script, no types.
import { isInSeason, PROBES } from '../scripts/cron-freshness-check.mjs'

/**
 * A seasonal job cannot have new data out of season, so judging it against a three-day freshness
 * allowance year-round guarantees a months-long false alarm every offseason.
 *
 * ⚠ THAT IS NOT COSMETIC. cron-freshness failed hourly for 61 hours while live scoring was dead and
 * nobody looked — because it had already been failing on seasonal probes for weeks. A monitor that
 * is permanently red is one people stop reading, which is the failure mode this guards.
 */

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('isInSeason — NFL', () => {
  it('is in season through the regular season months', () => {
    expect(isInSeason('NFL', at('2026-09-15'))).toBe(true)
    expect(isInSeason('NFL', at('2026-11-20'))).toBe(true)
    expect(isInSeason('NFL', at('2026-01-10'))).toBe(true)
  })

  it('is OUT of season during preseason, which is the case that motivated this', () => {
    // August: preseason games are being played, but no regular-season stat exists to import.
    expect(isInSeason('NFL', at('2026-08-01'))).toBe(false)
    expect(isInSeason('NFL', at('2026-08-23'))).toBe(false)
  })

  it('is out of season in the deep offseason', () => {
    expect(isInSeason('NFL', at('2026-03-05'))).toBe(false)
    expect(isInSeason('NFL', at('2026-06-01'))).toBe(false)
  })

  it('grants TRAILING grace only — the symmetric version re-armed the alarm all preseason', () => {
    // After the season, January's data is legitimately still fresh into February.
    expect(isInSeason('NFL', at('2026-02-10'))).toBe(true)
    // Before it, there is no data yet BY DEFINITION, so leading grace would manufacture the very
    // false alarm this exists to remove. 23 August is three weeks from September and must stay out.
    expect(isInSeason('NFL', at('2026-08-23'))).toBe(false)
  })

  it('judges an unknown sport normally rather than silently exempting it', () => {
    // Defaulting to "in season" means a typo'd sport keeps its alarm instead of muting it.
    expect(isInSeason('QUIDDITCH', at('2026-06-01'))).toBe(true)
  })
})

describe('which probes are marked seasonal', () => {
  it('marks import-player-game-stats, the one with measured evidence', () => {
    expect(PROBES['/api/cron/import-player-game-stats'].seasonal).toEqual({ sport: 'NFL' })
  })

  it('does NOT mark import-season-stats, which has not been shown to need it', () => {
    // Marking a probe seasonal suppresses a real alarm for months. It is done per job, on evidence,
    // never speculatively — exempting a healthy job is how a monitor quietly stops monitoring.
    expect(PROBES['/api/cron/import-season-stats'].seasonal).toBeUndefined()
  })

  it('keeps the seasonal set small, so this cannot quietly become a blanket exemption', () => {
    const seasonal = Object.entries(PROBES).filter(([, p]) => (p as { seasonal?: unknown }).seasonal)
    expect(seasonal.length).toBeLessThanOrEqual(2)
  })
})
