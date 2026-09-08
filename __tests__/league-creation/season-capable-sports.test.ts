/**
 * Which sports can actually run a season.
 *
 * 🛑 THE WIZARD OFFERS SEVEN SPORTS AND ONE OF THEM WORKS. A league in any other
 * sport can be created, drafted and scheduled, and then nothing ever happens to
 * it: `syncPlayerWeeklyScoresForRedraftSeason` THROWS for a non-NFL sport
 * ("Weekly stat sync is currently wired for NFL only"), so its matchups never
 * finalize, so `advance_week` refuses forever, so it never reaches playoffs, a
 * champion or an offseason. Nothing goes red — the league just sits at week 1.
 *
 * That is the same silent dead end the whole season-lifecycle effort exists to
 * remove, except this one is reached by a user following the happy path.
 *
 * ⚠ THE PER-SPORT `lib/{nba,mlb,nhl,ncaab,ncaaf}-scoring` MODULES LOOK LIKE THEY
 * CLOSE THIS AND DO NOT. Their own headers say "Read/write NBA scoring
 * configuration from League.settings JSON" — they define what a stat is worth,
 * they do not fetch stat lines. Checked before writing this, because "there is a
 * scoring module for that sport" is exactly the plausible-but-wrong reason to
 * widen the list.
 */
import { describe, expect, it } from 'vitest'

import {
  SEASON_CAPABLE_SPORTS,
  SUPPORTED_SPORTS,
  canRunSeasonForSport,
} from '@/lib/sport-scope'

describe('canRunSeasonForSport', () => {
  it('is NFL only, because that is the only wired stat provider', () => {
    expect([...SEASON_CAPABLE_SPORTS]).toEqual(['NFL'])
    expect(canRunSeasonForSport('NFL')).toBe(true)
  })

  it('refuses every sport whose weekly stat sync throws', () => {
    for (const sport of ['NBA', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'SOCCER']) {
      expect(canRunSeasonForSport(sport), `${sport} must not claim season capability`).toBe(false)
    }
  })

  it('is case-insensitive and safe on absent input', () => {
    // League rows carry 'NFL'; some callers hand through lowercase sport keys.
    expect(canRunSeasonForSport('nfl')).toBe(true)
    expect(canRunSeasonForSport(null)).toBe(false)
    expect(canRunSeasonForSport(undefined)).toBe(false)
    expect(canRunSeasonForSport('')).toBe(false)
  })

  it('every offered sport has an explicit answer, so a new one cannot default to capable', () => {
    // 🛑 The failure this guards: adding a sport to SUPPORTED_SPORTS and getting
    // season capability for free. The wizard would then offer a league that
    // silently cannot run — which is the bug, not the fix.
    for (const sport of SUPPORTED_SPORTS) {
      expect(typeof canRunSeasonForSport(sport)).toBe('boolean')
    }
    expect(SEASON_CAPABLE_SPORTS.length).toBeLessThan(SUPPORTED_SPORTS.length)
  })
})
