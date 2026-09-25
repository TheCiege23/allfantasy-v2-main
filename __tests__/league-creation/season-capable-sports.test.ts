/**
 * Which sports can actually run a season.
 *
 * 🛑 THE WIZARD OFFERS SEVEN SPORTS AND TWO OF THEM WORK. A league in any other
 * sport can be created, drafted and scheduled, and then nothing ever happens to
 * it: its matchups never finalize, so `advance_week` refuses forever, so it never
 * reaches playoffs, a champion or an offseason. Nothing goes red — the league just
 * sits at week 1.
 *
 * That is the same silent dead end the whole season-lifecycle effort exists to
 * remove, except this one is reached by a user following the happy path.
 *
 * ⚠ NHL WAS ADDED 2026-09-24 ON MEASUREMENTS, NOT ON A READING OF THE CODE. The
 * previous version of this comment said the stat sync "THROWS for a non-NFL sport
 * (wired for NFL only)" — by then it already said "wired for NFL, NBA and NHL" and
 * carried a daily-sport branch. What was actually checked, on production:
 * `player_game_stats` held 733 NHL rows / 693 players; `thesportsdb` held 1,373 NHL
 * 2026 schedule rows and is a ranked live source; `normalizeGameStatus` maps its
 * `FT`/`AOT`/`AP` to `final`; the 2026 opener is recorded (2026-09-29); and the
 * finalizer can close a date-windowed week (`DATE_WINDOWED_SPORTS`).
 *
 * ⚠ NBA JOINED 2026-09-25, AHEAD OF ITS 2026-10-20 OPENER, ON CODE AND FIXTURES. Its
 * season has not started, so nothing was checked against a real NBA slate — see the
 * NBA entry in lib/sport-scope.ts for what was checked instead, and why waiting for
 * the opener would have stranded week 1 (the finalizer sweeps only three weeks back).
 * Before this, every NBA league could be created and drafted and then sat on week 1.
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
  it('is the set whose stat path AND finalizer were both measured', () => {
    expect([...SEASON_CAPABLE_SPORTS]).toEqual(['NFL', 'NHL', 'NBA', 'NCAAB'])
    expect(canRunSeasonForSport('NFL')).toBe(true)
    expect(canRunSeasonForSport('NHL')).toBe(true)
    expect(canRunSeasonForSport('NBA')).toBe(true)
  })

  it('refuses every sport that cannot yet run one', () => {
    // MLB's game logs are ingested, but it has no weekly normalizer, no recorded opener
    // and no finalizer window; NCAAF and SOCCER have no stat path to a weekly score here.
    for (const sport of ['MLB', 'NCAAF', 'SOCCER']) {
      expect(canRunSeasonForSport(sport), `${sport} must not claim season capability`).toBe(false)
    }
  })

  it('is case-insensitive and safe on absent input', () => {
    // League rows carry 'NFL'; some callers hand through lowercase sport keys.
    expect(canRunSeasonForSport('nfl')).toBe(true)
    expect(canRunSeasonForSport('nhl')).toBe(true)
    expect(canRunSeasonForSport('nba')).toBe(true)
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
