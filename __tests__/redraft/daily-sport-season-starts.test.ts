/**
 * Regular-season anchors for the daily sports.
 *
 * The anchor is what makes a week a real date range AND what keeps preseason
 * out — `SportsGame.seasonType` is NULL on every NBA/NHL row and the ingest
 * never reads `season_type`, so nothing else can tell the two apart.
 *
 * Dates here were taken from each league's published schedule and separately
 * corroborated against game density in production, so these tests pin the
 * consequences rather than restating the dates.
 */
import { describe, expect, it } from 'vitest'
import {
  knownDailySportSeasons,
  resolveDailySportSeasonStart,
} from '@/lib/season-week/dailySportSeasonStarts'
import { weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'

describe('recorded regular-season openers', () => {
  it.each([
    ['NHL', 2026, '2026-09-29T00:00:00.000Z'],
    ['NBA', 2026, '2026-10-20T00:00:00.000Z'],
  ])('%s %i opens on %s', (sport, season, expected) => {
    expect(resolveDailySportSeasonStart(sport, season)).toBe(expected)
  })

  it('is case-insensitive on the sport', () => {
    expect(resolveDailySportSeasonStart('nhl', 2026)).toBe(resolveDailySportSeasonStart('NHL', 2026))
  })

  it('declines for a season that has not been recorded', () => {
    // Must be null, not a nearby year's date: a silently wrong anchor
    // mis-assigns every game in the season.
    expect(resolveDailySportSeasonStart('NHL', 2027)).toBeNull()
    expect(resolveDailySportSeasonStart('NBA', 2030)).toBeNull()
    expect(resolveDailySportSeasonStart('NFL', 2026)).toBeNull()
    expect(resolveDailySportSeasonStart(null, 2026)).toBeNull()
    expect(resolveDailySportSeasonStart('NHL', null)).toBeNull()
  })

  it('can report what it does know', () => {
    expect(knownDailySportSeasons('NHL')).toEqual([2026])
    expect(knownDailySportSeasons('NFL')).toEqual([])
  })
})

describe('the anchor excludes preseason as a property of the window', () => {
  // NHL preseason ran 19-27 September 2026. Those games ARE ingested — they
  // are real rows in player_game_stats with real stats — and must never score.
  const NHL_PRESEASON_DAYS = [
    '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
    '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
  ]

  it('places no NHL preseason day inside any regular-season week', () => {
    const start = resolveDailySportSeasonStart('NHL', 2026)!
    for (const day of NHL_PRESEASON_DAYS) {
      const played = new Date(`${day}T23:00:00.000Z`)
      for (let week = 1; week <= 30; week += 1) {
        const w = weekWindowFromSeasonStart(start, week)!
        expect(
          played >= w.start && played < w.end,
          `${day} fell inside NHL week ${week}`,
        ).toBe(false)
      }
    }
  })

  // NBA preseason ran to 17 October; opening night was the 20th.
  it('places no NBA preseason day inside any regular-season week', () => {
    const start = resolveDailySportSeasonStart('NBA', 2026)!
    for (const day of ['2026-10-03', '2026-10-11', '2026-10-17']) {
      const played = new Date(`${day}T23:00:00.000Z`)
      for (let week = 1; week <= 30; week += 1) {
        const w = weekWindowFromSeasonStart(start, week)!
        expect(played >= w.start && played < w.end, `${day} fell inside NBA week ${week}`).toBe(false)
      }
    }
  })

  it('places opening night in week 1 for both sports', () => {
    const nhl = weekWindowFromSeasonStart(resolveDailySportSeasonStart('NHL', 2026), 1)!
    expect(nhl.start.toISOString()).toBe('2026-09-29T00:00:00.000Z')
    expect(new Date('2026-09-29T22:00:00.000Z') >= nhl.start).toBe(true)

    const nba = weekWindowFromSeasonStart(resolveDailySportSeasonStart('NBA', 2026), 1)!
    expect(nba.start.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    expect(new Date('2026-10-20T23:00:00.000Z') < nba.end).toBe(true)
  })

  it('puts the first full NBA slate in week 1 with opening night', () => {
    // 20 Oct opening night and the 21 Oct slate belong to the same fantasy week.
    const w1 = weekWindowFromSeasonStart(resolveDailySportSeasonStart('NBA', 2026), 1)!
    const slate = new Date('2026-10-21T23:30:00.000Z')
    expect(slate >= w1.start && slate < w1.end).toBe(true)
  })
})
