// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { headToHeadFrom } from '@/lib/core-app/matchup'

/*
 * The series line on a league's Matchup page (2026-10-02). A meeting needs a shared matchup id AND
 * a score: a Sleeper import bootstraps every week of the season as a 0-0 row with matchup ids
 * already assigned, and counting those would print "0–0–9" before week 1 had been played.
 */

const row = (rosterId: string, week: number, matchupId: number | null, pointsFor: number, seasonYear = 2026) => ({
  seasonYear, week, rosterId, matchupId, pointsFor,
})

describe('headToHeadFrom', () => {
  it('counts only scored weeks the two shared, newest first', () => {
    const h = headToHeadFrom(
      [
        row('1', 1, 3, 120), row('2', 1, 3, 100), // met, won
        row('1', 2, 4, 90), row('2', 2, 5, 140), // different matchups — not a meeting
        row('1', 3, 6, 101), row('2', 3, 6, 111), // met, lost
        row('1', 9, 2, 0), row('2', 9, 2, 0), // bootstrapped future week — not a meeting
      ],
      '1',
      { season: 2026, week: 4 },
    )
    expect(h).toMatchObject({ wins: 1, losses: 1, ties: 0 })
    expect(h.meetings.map((m) => m.week)).toEqual([3, 1])
  })

  it('leaves out the week on screen — it is the game, not history', () => {
    const h = headToHeadFrom([row('1', 4, 1, 50), row('2', 4, 1, 40)], '1', { season: 2026, week: 4 })
    expect(h.meetings).toHaveLength(0)
  })

  it('a null matchup id is never a meeting', () => {
    const h = headToHeadFrom([row('1', 1, null, 50), row('2', 1, null, 40)], '1', { season: 2026, week: 4 })
    expect(h.meetings).toHaveLength(0)
  })

  it('a tie is counted as a tie', () => {
    const h = headToHeadFrom([row('1', 1, 7, 88.5), row('2', 1, 7, 88.5)], '1', { season: 2026, week: 4 })
    expect(h).toMatchObject({ wins: 0, losses: 0, ties: 1 })
  })
})
