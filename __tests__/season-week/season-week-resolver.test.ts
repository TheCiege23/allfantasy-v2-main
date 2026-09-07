/**
 * Per-league week resolution.
 *
 * 🛑 THE THING THIS EXISTS TO STOP IS A CONFIDENT WRONG WEEK. Every prior answer
 * in this codebase is a guess — `Math.max(1, currentWeek || 1)`, a month check,
 * a bare `|| 1` — and a wrong week fetches a real but irrelevant slate, which is
 * far harder to notice than no answer at all. So the assertions below are split
 * deliberately: the "it refuses" cases matter as much as the "it answers" ones,
 * and each refusal is exercised with a fixture that WOULD have produced a
 * plausible number under a naive implementation.
 *
 * Fixtures are shaped from real production rows measured 2026-09-07 against
 * `icy-field-51189449` — NFL 2026 regular weeks 1-3, including week 1's genuine
 * 2-source duplication (32 rows for 16 fixtures).
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_PLAUSIBLE_SPORT_WEEK,
  mapSportWeekToLeagueWeek,
  resolveRegularSeasonEndWeek,
  resolveSportWeekFromSchedule,
  sportHasWeekSignal,
  toScheduleSportKey,
  type ScheduleRow,
} from '@/lib/season-week'

const FETCHED = new Date('2026-09-07T12:00:00Z')

function game(
  week: number,
  startIso: string,
  status: string,
  source = 'espn',
): ScheduleRow {
  return {
    week,
    seasonType: 'regular',
    startTime: new Date(startIso),
    status,
    source,
    fetchedAt: FETCHED,
  }
}

/**
 * NFL 2026 weeks 1-3 at their real kickoff times. Week 1 is duplicated across
 * two sources exactly as production holds it; weeks 2 and 3 carry one source.
 */
function nfl2026(statusByWeek: Record<number, string> = {}): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  const weeks: Array<[number, string, string]> = [
    [1, '2026-09-10T00:20:00Z', '2026-09-15T00:15:00Z'],
    [2, '2026-09-18T00:15:00Z', '2026-09-22T00:15:00Z'],
    [3, '2026-09-25T00:15:00Z', '2026-09-29T00:15:00Z'],
  ]
  for (const [week, first, last] of weeks) {
    const status = statusByWeek[week] ?? 'scheduled'
    // Two games per week is enough to carry a first/last kickoff spread.
    rows.push(game(week, first, status, 'espn'))
    rows.push(game(week, last, status, 'espn'))
    if (week === 1) {
      // The real duplication: a second source holding the same fixtures.
      rows.push(game(week, first, status, 'rolling_insights'))
      rows.push(game(week, last, status, 'rolling_insights'))
    }
  }
  return rows
}

const NFL_LEAGUE = {
  sport: 'NFL',
  seasonYear: 2026,
  totalWeeks: 14,
  playoffStartWeek: 15,
}

describe('sport key normalization', () => {
  it('maps the config-key spelling back to the schedule vocabulary', () => {
    // `finalizeDraftToRedraftSeason` writes NCAAFB via `leagueSportToConfigSport`;
    // `SportsGame` only ever holds NCAAF. Without this the join finds nothing.
    expect(toScheduleSportKey('NCAAFB')).toBe('NCAAF')
    expect(toScheduleSportKey('ncaaf')).toBe('NCAAF')
    expect(toScheduleSportKey('NFL')).toBe('NFL')
  })

  it('declines the sports whose feed has no usable week', () => {
    // Measured: NBA/NHL/MLB write week 0 or 500; NCAAB writes 0 for every row.
    for (const sport of ['NBA', 'NHL', 'MLB', 'NCAAB']) {
      expect(sportHasWeekSignal(sport)).toBe(false)
    }
    for (const sport of ['NFL', 'NCAAF', 'NCAAFB', 'SOCCER']) {
      expect(sportHasWeekSignal(sport)).toBe(true)
    }
  })
})

describe('resolveSportWeekFromSchedule — refusals', () => {
  it('refuses an empty schedule instead of returning week 1', () => {
    const res = resolveSportWeekFromSchedule([], new Date('2026-10-01T18:00:00Z'))
    expect(res).toEqual({ ok: false, reason: 'NO_SCHEDULE_ROWS' })
  })

  it('refuses rows that carry no kickoff time', () => {
    const rows: ScheduleRow[] = [
      { week: 1, seasonType: 'regular', startTime: null, status: 'scheduled', source: 'espn', fetchedAt: FETCHED },
    ]
    const res = resolveSportWeekFromSchedule(rows, new Date('2026-10-01T18:00:00Z'))
    expect(res).toEqual({ ok: false, reason: 'NO_DATED_ROWS' })
  })

  it('refuses the 500-week feed even though the rows look complete', () => {
    // 🛑 POSITIVE CONTROL FOR THE BACKSTOP. These are real NHL/MLB values. A
    // naive "max week whose kickoff has passed" reads 500 here and hands back a
    // confident, catastrophic number.
    const rows = [
      game(1, '2026-04-24T23:00:00Z', 'final'),
      game(500, '2026-05-01T23:00:00Z', 'final'),
    ]
    const res = resolveSportWeekFromSchedule(rows, new Date('2026-06-01T00:00:00Z'))
    expect(res).toEqual({ ok: false, reason: 'IMPLAUSIBLE_WEEKS' })
    expect(500).toBeGreaterThan(MAX_PLAUSIBLE_SPORT_WEEK)
  })

  it('refuses a season the feed files under a single week', () => {
    // NCAAB writes week 0 for all 4,256 rows. One distinct week is a default,
    // not a numbering — and week 0 is out of range besides.
    const rows = [
      game(0, '2026-11-03T16:00:00Z', 'final'),
      game(0, '2026-11-10T16:00:00Z', 'final'),
    ]
    expect(resolveSportWeekFromSchedule(rows, new Date('2026-12-01T00:00:00Z'))).toEqual({
      ok: false,
      reason: 'IMPLAUSIBLE_WEEKS',
    })
  })
})

describe('resolveSportWeekFromSchedule — answers', () => {
  it('reports the season as upcoming before the first kickoff', () => {
    // Today, against the real 2026 schedule: week 1 kicks off 2026-09-10.
    const res = resolveSportWeekFromSchedule(nfl2026(), new Date('2026-09-07T19:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sportWeek).toBe(1)
    expect(res.state).toBe('upcoming')
    expect(res.nextSportWeek).toBe(2)
  })

  it('deduplicates the two sources holding week 1', () => {
    // 4 rows in, 2 fixtures out — the source split is real and un-deduped it
    // would double every count a scheduling decision reads.
    const res = resolveSportWeekFromSchedule(nfl2026(), new Date('2026-09-11T19:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sportWeek).toBe(1)
    expect(res.slate.gameCount).toBe(2)
  })

  it('a live game wins over a later week that has also kicked off', () => {
    const rows = [
      ...nfl2026({ 1: 'final' }),
      game(2, '2026-09-18T00:15:00Z', 'in_progress'),
    ]
    const res = resolveSportWeekFromSchedule(rows, new Date('2026-09-18T01:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sportWeek).toBe(2)
    expect(res.state).toBe('live')
  })

  it('stays on the played week through the gap before the next one', () => {
    const res = resolveSportWeekFromSchedule(
      nfl2026({ 1: 'final' }),
      // Tuesday: week 1 is done, week 2 has not kicked off.
      new Date('2026-09-16T15:00:00Z'),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sportWeek).toBe(1)
    expect(res.state).toBe('played')
    expect(res.slate.allFinal).toBe(true)
    expect(res.nextSportWeek).toBe(2)
  })

  it('will not call a week played while its last kickoff is still ahead', () => {
    // 🛑 A PARTIALLY INGESTED WEEK LOOKS COMPLETE. The feed holds Thursday and
    // marks it final; Sunday has not been written yet. Every row present is
    // final, so `allFinal` is true — and a roller trusting that alone advances
    // the league past a slate that has not been played.
    const rows = [
      game(1, '2026-09-10T00:20:00Z', 'final'),
      game(1, '2026-09-15T00:15:00Z', 'final'),
    ]
    const res = resolveSportWeekFromSchedule(rows, new Date('2026-09-11T12:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.slate.allFinal).toBe(true)
    expect(res.state).toBe('between')
  })

  it('separates a postponed week from a finished one', () => {
    // 🛑 THIS IS THE DISTINCTION A ROLLER DEPENDS ON. Kickoff has passed and one
    // game is still unfinal. `played` here would advance a league over a game
    // that has not been scored.
    const rows = [
      game(1, '2026-09-10T00:20:00Z', 'final'),
      game(1, '2026-09-15T00:15:00Z', 'postponed'),
      game(2, '2026-09-18T00:15:00Z', 'scheduled'),
    ]
    const res = resolveSportWeekFromSchedule(rows, new Date('2026-09-16T15:00:00Z'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.state).toBe('between')
    expect(res.slate.allFinal).toBe(false)
  })
})

describe('mapSportWeekToLeagueWeek', () => {
  function sportWeekAt(now: string, statusByWeek: Record<number, string> = {}) {
    return resolveSportWeekFromSchedule(nfl2026(statusByWeek), new Date(now))
  }

  it('carries a refusal through untouched rather than substituting week 1', () => {
    const mapped = mapSportWeekToLeagueWeek(
      { ok: false, reason: 'NO_WEEK_SIGNAL' },
      NFL_LEAGUE,
    )
    expect(mapped).toEqual({ ok: false, reason: 'NO_WEEK_SIGNAL' })
  })

  it('reports preseason before the league has played a week', () => {
    const mapped = mapSportWeekToLeagueWeek(sportWeekAt('2026-09-07T19:00:00Z'), NFL_LEAGUE)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.phase).toBe('preseason')
    expect(mapped.fantasyWeek).toBe(1)
    expect(mapped.sportWeekComplete).toBe(false)
    expect(mapped.slate).toBeNull()
  })

  it('maps sport week to fantasy week one-to-one for a league that starts at kickoff', () => {
    const mapped = mapSportWeekToLeagueWeek(
      sportWeekAt('2026-09-16T15:00:00Z', { 1: 'final' }),
      NFL_LEAGUE,
    )
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.fantasyWeek).toBe(1)
    expect(mapped.sportWeek).toBe(1)
    expect(mapped.phase).toBe('regular')
    expect(mapped.sportWeekComplete).toBe(true)
  })

  it('offsets a league that starts after the sport does', () => {
    const mapped = mapSportWeekToLeagueWeek(
      sportWeekAt('2026-09-23T15:00:00Z', { 1: 'final', 2: 'final' }),
      { ...NFL_LEAGUE, anchorSportWeek: 2 },
    )
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.sportWeek).toBe(2)
    expect(mapped.fantasyWeek).toBe(1)
  })

  it('holds a not-yet-started league in preseason past the sport kickoff', () => {
    const mapped = mapSportWeekToLeagueWeek(
      sportWeekAt('2026-09-16T15:00:00Z', { 1: 'final' }),
      { ...NFL_LEAGUE, anchorSportWeek: 3 },
    )
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.phase).toBe('preseason')
    expect(mapped.fantasyWeek).toBe(1)
  })

  it('never reports a week complete while a game is in play', () => {
    const rows = [...nfl2026({ 1: 'final' }), game(2, '2026-09-18T00:15:00Z', 'in_progress')]
    const mapped = mapSportWeekToLeagueWeek(
      resolveSportWeekFromSchedule(rows, new Date('2026-09-18T01:00:00Z')),
      NFL_LEAGUE,
    )
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.state).toBe('live')
    expect(mapped.sportWeekComplete).toBe(false)
  })
})

describe('phase boundaries', () => {
  function phaseAtWeek(week: number, extra: Record<string, number> = {}) {
    const mapped = mapSportWeekToLeagueWeek(
      {
        ok: true,
        sportWeek: week,
        seasonType: 'regular',
        state: 'played',
        nextSportWeek: week + 1,
        source: 'schedule',
        slate: {
          week,
          seasonType: 'regular',
          gameCount: 16,
          firstKickoffAt: new Date('2026-09-10T00:20:00Z'),
          lastKickoffAt: new Date('2026-09-15T00:15:00Z'),
          liveCount: 0,
          finalCount: 16,
          allFinal: true,
        },
      },
      { ...NFL_LEAGUE, ...extra },
    )
    return mapped.ok ? mapped.phase : null
  }

  it('crosses into playoffs at playoffStartWeek', () => {
    expect(phaseAtWeek(14)).toBe('regular')
    expect(phaseAtWeek(15)).toBe('playoffs')
    expect(phaseAtWeek(17)).toBe('playoffs')
  })

  it('will not call a season complete without a bracket to say so', () => {
    // 🛑 The absent case is the point: nothing on `RedraftSeason` records how
    // many playoff rounds a league runs, so week arithmetic alone must never end
    // a season. Only a real `lastPlayoffWeek` does.
    expect(phaseAtWeek(30)).toBe('playoffs')
    expect(phaseAtWeek(18, { lastPlayoffWeek: 17 })).toBe('season_complete')
    expect(phaseAtWeek(17, { lastPlayoffWeek: 17 })).toBe('playoffs')
  })
})

describe('resolveRegularSeasonEndWeek', () => {
  it('reconciles the two meanings totalWeeks carries', () => {
    // Import writes playoffStartWeek - 1 ...
    expect(resolveRegularSeasonEndWeek({ totalWeeks: 14, playoffStartWeek: 15 })).toBe(14)
    // ... while a native draft writes sportConfig.defaultSeasonWeeks, which for
    // NFL is 17 against the same playoff start. Both must end the regular season
    // at 14, exactly as generateSchedule already does.
    expect(resolveRegularSeasonEndWeek({ totalWeeks: 17, playoffStartWeek: 15 })).toBe(14)
  })
})
