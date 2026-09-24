/**
 * The live tick asks only for the defences somebody actually starts.
 *
 * 🛑 THE OFFENSIVE HALF ALWAYS NARROWED; THE DEFENCE HALF ASKED FOR THE WHOLE SLATE. The NFL
 * provider calls Sleeper once PER TEAM, so an unnarrowed request is 32 calls — per season being
 * scored, per tick. Measured on production 2026-09-24, from the minute the first native league
 * advanced a week and gave the tick something to score: 128 calls every two minutes (32 teams x
 * 4 seasons), 3,840/hour against a 1,000/hour cap, exhausted by :16.
 *
 * ⚠ AND THE CAP IS PER PROVIDER, so the visible damage was somewhere else entirely:
 * `stats/nfl/week` went dark, `fetchPlayerStatsForGames` returns an EMPTY map when refused, and
 * the week finalizer refused with `stat_coverage_below_floor` — naming the roster when the cause
 * was this fetch's quota.
 */
import { describe, expect, it } from 'vitest'

import { teamDefenseTargets, type LiveGameLite } from '@/lib/live-scoring/provider'

const games: LiveGameLite[] = [
  { gameId: '1', homeTeam: 'KC', awayTeam: 'BUF', status: 'in_progress', startTime: null },
  { gameId: '2', homeTeam: 'SF', awayTeam: 'DAL', status: 'in_progress', startTime: null },
]

describe('teamDefenseTargets', () => {
  it('returns every playing team when no narrowing is asked for', () => {
    expect(teamDefenseTargets({ sport: 'NFL', season: 2026, week: 2, games }).sort()).toEqual([
      'BUF',
      'DAL',
      'KC',
      'SF',
    ])
  })

  it('narrows to the rostered defences', () => {
    const got = teamDefenseTargets({ sport: 'NFL', season: 2026, week: 2, games, teamAbbrs: ['KC', 'DAL'] })
    expect(got.sort()).toEqual(['DAL', 'KC'])
  })

  /**
   * 🛑 THE CASE THAT MAKES THIS WORTH A TEST. "Empty means no filter" is the natural way to
   * write this and it is exactly backwards — it would restore the 32-team fetch for the leagues
   * that start no defence at all, which are the ones that should cost nothing.
   */
  it('treats an EMPTY list as none, not as everything', () => {
    expect(teamDefenseTargets({ sport: 'NFL', season: 2026, week: 2, games, teamAbbrs: [] })).toEqual([])
  })

  it('ignores a rostered defence whose team is not playing this week', () => {
    // A bye: owned, but it has no game on this slate, so there is nothing to ask for.
    const got = teamDefenseTargets({ sport: 'NFL', season: 2026, week: 2, games, teamAbbrs: ['KC', 'GB'] })
    expect(got).toEqual(['KC'])
  })

  it('matches case-insensitively and ignores blanks', () => {
    const got = teamDefenseTargets({
      sport: 'NFL',
      season: 2026,
      week: 2,
      games,
      teamAbbrs: ['kc', '  buf  ', '', '   '],
    })
    expect(got.sort()).toEqual(['BUF', 'KC'])
  })
})
