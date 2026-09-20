// @vitest-environment node
/**
 * Guillotine / survivor weeks on the cross-league board.
 *
 * These leagues rendered NOTHING before this — not an unprojected card, no card at all —
 * because `pairRows` drops any matchup group that is not exactly two and Sleeper puts every
 * roster in its own group of one. The tests that matter here are the three refusals: a bye
 * must not be read as an elimination week, a field of one must not produce a cut line, and
 * an eliminated roster's leftover 0-0 row must not become the cut line for everyone else.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildEliminationWeeks, pairRows } from '@/lib/core-app/weekBoard'

const row = (
  leagueId: string,
  rosterId: string,
  pointsFor: number,
  matchupId: number | null,
  week = 3,
) => ({
  leagueId,
  seasonYear: 2026,
  week,
  rosterId,
  matchupId,
  pointsFor,
  pointsAgainst: 0,
  win: 0,
})

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'internal-1',
  name: 'Guillotine League 26',
  platform: 'sleeper',
  elimination: true,
  imageUrl: null,
  ...over,
})

const leagueMap = (over: Partial<Record<string, unknown>> = {}) =>
  new Map([['PID', meta(over)]]) as never

/** The production shape: 18 rosters, each its own matchup group, no points against. */
const guillotineWeek = () => [
  row('PID', 'r1', 140.5, 1),
  row('PID', 'r2', 120.0, 2),
  row('PID', 'r3', 99.25, 3),
]

describe('buildEliminationWeeks', () => {
  it('builds a card for a league whose rosters never pair, and ranks you in the field', () => {
    const out = buildEliminationWeeks({
      rows: guillotineWeek(),
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap(),
      myRosters: new Set(['PID:r2']),
    })

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      leagueId: 'internal-1',
      season: 2026,
      week: 3,
      yourScore: 120,
      cutLine: 99.25,
      rank: 2,
      fieldSize: 3,
      onTheBlock: false,
      labelled: true,
    })
    expect(out[0].margin).toBeCloseTo(20.75, 6)
  })

  it('names you as on the block when you hold the lowest score, and ties count', () => {
    const tied = [row('PID', 'r1', 140, 1), row('PID', 'r2', 99, 2), row('PID', 'r3', 99, 3)]
    const mine = buildEliminationWeeks({
      rows: tied,
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap(),
      myRosters: new Set(['PID:r3']),
    })
    expect(mine[0]).toMatchObject({ onTheBlock: true, margin: 0, rank: 2 })
  })

  /*
   * 🛑 THE REFUSAL THAT PROTECTS EVERY ORDINARY LEAGUE. A bye leaves one roster unpaired in
   * a normal head-to-head league too. Triggering on "your row did not pair" would put a cut
   * line on a league that has none — so the trigger is that the WHOLE league produced no
   * pairs, which is also what makes a double-emitted card impossible.
   */
  it('refuses a league that produced any pair at all, which is what a bye looks like', () => {
    const withBye = [
      row('PID', 'r1', 140, 1),
      row('PID', 'r2', 120, 1), // a real head-to-head
      row('PID', 'r3', 99, 7), // the bye — unpaired, but the league is not elimination
    ]
    const paired = new Set(pairRows(withBye).map((p) => p.leagueId))
    expect(paired.has('PID')).toBe(true)

    expect(
      buildEliminationWeeks({
        rows: withBye,
        pairedLeagueIds: paired,
        leagueByPlatformId: leagueMap(),
        myRosters: new Set(['PID:r3']),
      }),
    ).toEqual([])
  })

  /*
   * 🛑 AN ELIMINATED ROSTER KEEPS A 0-0 ROW FOR EVERY LATER WEEK. Counting unscored rows
   * would hold the cut line at 0 forever and report a field of 18 in a league with three
   * teams left — the card would say you are 120 points clear of a line nobody is near.
   */
  it('counts only scored rosters, so a knocked-out team is not the cut line', () => {
    const out = buildEliminationWeeks({
      rows: [...guillotineWeek(), row('PID', 'dead1', 0, 4), row('PID', 'dead2', 0, 5)],
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap(),
      myRosters: new Set(['PID:r2']),
    })
    expect(out[0].fieldSize).toBe(3)
    expect(out[0].cutLine).toBe(99.25)
    expect(out[0].onTheBlock).toBe(false)
  })

  /*
   * ⚠ A FIELD OF ONE IS NOT A CUT LINE — the only scorer is both highest and lowest, so
   * "on the block" would fire on whoever posts the first point of every week.
   */
  it('does not call a lone scorer on the block', () => {
    const out = buildEliminationWeeks({
      rows: [row('PID', 'r1', 12, 1), row('PID', 'r2', 0, 2), row('PID', 'r3', 0, 3)],
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap(),
      myRosters: new Set(['PID:r1']),
    })
    expect(out[0]).toMatchObject({ fieldSize: 1, onTheBlock: false, rank: 1 })
  })

  it('keeps a league with no scores yet on the board, reporting nulls rather than zeroes', () => {
    const out = buildEliminationWeeks({
      rows: [row('PID', 'r1', 0, 1), row('PID', 'r2', 0, 2)],
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap(),
      myRosters: new Set(['PID:r1']),
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      yourScore: null,
      cutLine: null,
      rank: null,
      margin: null,
      fieldSize: 0,
      onTheBlock: false,
    })
  })

  /*
   * ⚠ THE LABEL IS NOT THE TRIGGER. This account's "🪓 Elimination Station 2" is stored as
   * `leagueType: 'redraft'` while behaving exactly like the guillotine leagues beside it.
   * Gating on the label would drop the one league the label is wrong about.
   */
  it('builds the card on the shape of the week, not on leagueType', () => {
    const out = buildEliminationWeeks({
      rows: guillotineWeek(),
      pairedLeagueIds: new Set(),
      leagueByPlatformId: leagueMap({ elimination: false, name: 'Elimination Station 2' }),
      myRosters: new Set(['PID:r2']),
    })
    expect(out).toHaveLength(1)
    expect(out[0].labelled).toBe(false)
  })

  it('skips a league the user has no roster in, and one with no meta', () => {
    expect(
      buildEliminationWeeks({
        rows: guillotineWeek(),
        pairedLeagueIds: new Set(),
        leagueByPlatformId: leagueMap(),
        myRosters: new Set(['PID:someone-else']),
      }),
    ).toEqual([])

    expect(
      buildEliminationWeeks({
        rows: guillotineWeek(),
        pairedLeagueIds: new Set(),
        leagueByPlatformId: new Map() as never,
        myRosters: new Set(['PID:r2']),
      }),
    ).toEqual([])
  })

  it('orders the most urgent first: on the block, then closest to the line', () => {
    const rows = [
      ...guillotineWeek(),
      row('PID2', 'x1', 80, 1),
      row('PID2', 'x2', 200, 2),
      row('PID3', 'y1', 100, 1),
      row('PID3', 'y2', 104, 2),
    ]
    const map = new Map([
      ['PID', meta({ id: 'comfortable', name: 'A' })],
      ['PID2', meta({ id: 'on-the-block', name: 'B' })],
      ['PID3', meta({ id: 'close', name: 'C' })],
    ]) as never

    const out = buildEliminationWeeks({
      rows,
      pairedLeagueIds: new Set(),
      leagueByPlatformId: map,
      myRosters: new Set(['PID:r2', 'PID2:x1', 'PID3:y2']),
    })

    expect(out.map((e) => e.leagueId)).toEqual(['on-the-block', 'close', 'comfortable'])
  })
})
