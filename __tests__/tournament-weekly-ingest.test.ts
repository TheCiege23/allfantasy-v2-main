// @vitest-environment node
/**
 * Guards the per-player weekly ingest.
 *
 * 🛑 THE POINT IS THAT WE COPY A NUMBER RATHER THAN RECOMPUTE ONE. Sleeper's
 * `players_points` is scored under the league's own settings — PPR, TE premium,
 * 6-point passing touchdowns, first-down points — so it is what the managers
 * actually saw. The existing `weeklyProcessor` re-scores with AllFantasy's rules
 * and invents opponents with a synthetic round-robin, which is why it must not
 * be pointed at these leagues.
 */
import { describe, it, expect } from 'vitest'
import {
  buildRosterIndex,
  mapMatchupsToWeeklyScores,
  type SleeperMatchupRow,
} from '@/lib/tournament/ingestWeeklyPlayerScores'

const rosterMap = new Map([
  ['1', 'roster-a'],
  ['2', 'roster-b'],
])

describe('mapping a published week onto rosters', () => {
  it('writes one row per scored player, keyed to our roster', () => {
    const rows: SleeperMatchupRow[] = [
      { roster_id: 1, starters: ['p1'], players_points: { p1: 21.5, p2: 4 } },
    ]
    const out = mapMatchupsToWeeklyScores(rows, rosterMap)
    expect(out.rows).toEqual([
      { rosterId: 'roster-a', playerId: 'p1', points: 21.5, isStarter: true },
      { rosterId: 'roster-a', playerId: 'p2', points: 4, isStarter: false },
    ])
  })

  /**
   * 🛑 SLEEPER PADS EMPTY LINEUP SLOTS WITH "0". Treating those as a started
   * player invents a starter — and the starter flag is exactly what a
   * player-of-the-week read filters on.
   */
  it('does not turn a "0" lineup slot into a starter', () => {
    const rows: SleeperMatchupRow[] = [
      { roster_id: 1, starters: ['0', '', 'p1'], players_points: { p1: 10, '0': 99 } },
    ]
    const out = mapMatchupsToWeeklyScores(rows, rosterMap)
    expect(out.rows).toEqual([
      { rosterId: 'roster-a', playerId: 'p1', points: 10, isStarter: true },
    ])
  })

  /**
   * ⚠ A MISSING SCORE IS NOT ZERO. Sleeper omits players it has no line for, and
   * writing them as 0.00 makes an unplayed player indistinguishable from one who
   * genuinely scored nothing — a "worst performance" read would then rank people
   * who never took the field.
   */
  it('drops unscoreable values rather than storing them as zero', () => {
    const rows: SleeperMatchupRow[] = [
      {
        roster_id: 1,
        starters: ['p1'],
        players_points: { p1: 10, p2: null as unknown as number, p3: 'x' as unknown as number },
      },
    ]
    const out = mapMatchupsToWeeklyScores(rows, rosterMap)
    expect(out.rows.map((r) => r.playerId)).toEqual(['p1'])
  })

  /** ⚠ A genuine zero IS kept — it is a score, not a gap. */
  it('keeps a real zero', () => {
    const out = mapMatchupsToWeeklyScores(
      [{ roster_id: 1, starters: ['p1'], players_points: { p1: 0 } }],
      rosterMap,
    )
    expect(out.rows[0]).toMatchObject({ playerId: 'p1', points: 0 })
  })

  /**
   * ⚠ AN UNMAPPED ROSTER IS REPORTED, NOT DROPPED. A team whose week silently
   * does not exist looks exactly like a manager who scored nothing.
   */
  it('reports a roster it cannot map instead of skipping quietly', () => {
    const out = mapMatchupsToWeeklyScores(
      [{ roster_id: 99, starters: ['p1'], players_points: { p1: 12 } }],
      rosterMap,
    )
    expect(out.rows).toEqual([])
    expect(out.unmappedRosterIds).toEqual(['99'])
  })

  it('handles both string and numeric roster ids', () => {
    const out = mapMatchupsToWeeklyScores(
      [
        { roster_id: '2', starters: [], players_points: { p9: 3 } },
        { roster_id: 1, starters: [], players_points: { p8: 2 } },
      ],
      rosterMap,
    )
    expect(out.rows.map((r) => r.rosterId).sort()).toEqual(['roster-a', 'roster-b'])
  })

  it('survives an empty or malformed payload', () => {
    expect(mapMatchupsToWeeklyScores([], rosterMap).rows).toEqual([])
    expect(
      mapMatchupsToWeeklyScores([{ roster_id: 1, players_points: null }], rosterMap).rows,
    ).toEqual([])
    expect(mapMatchupsToWeeklyScores([{}], rosterMap).rows).toEqual([])
  })
})

/**
 * 🛑 `Roster.platformUserId` CARRIES TWO ID SPACES, AND THE JOIN FAILS ON
 * EXACTLY ONE TEAM — the commissioner's own. For a manager we imported it holds
 * the platform id; for the team the VIEWER has claimed it holds the AllFantasy
 * `AppUser.id`. Measured by another session on production: 12 teams, 11 keys
 * matched, and the one that did not was the viewer's, whose roster held 50
 * players. It presents as "no scores for this manager", which reads as broken
 * ingestion rather than a missed key.
 */
describe('resolving a team to its roster', () => {
  const rosters = [
    { id: 'roster-imported', platformUserId: 'sleeper-11' },
    /* The viewer's roster sits under their AllFantasy account id. */
    { id: 'roster-viewer', platformUserId: 'appuser-77' },
  ]

  it('matches an imported manager on the platform id', () => {
    const idx = buildRosterIndex(
      [{ externalId: '1', platformUserId: 'sleeper-11', claimedByUserId: null }],
      rosters,
    )
    expect(idx.get('1')).toBe('roster-imported')
  })

  it('matches the viewer’s claimed team on the AppUser id', () => {
    const idx = buildRosterIndex(
      [{ externalId: '2', platformUserId: 'sleeper-99', claimedByUserId: 'appuser-77' }],
      rosters,
    )
    expect(idx.get('2')).toBe('roster-viewer')
  })

  /** ⚠ Platform id first — it is the common case and the unambiguous one. */
  it('prefers the platform id when both would resolve', () => {
    const idx = buildRosterIndex(
      [{ externalId: '3', platformUserId: 'sleeper-11', claimedByUserId: 'appuser-77' }],
      rosters,
    )
    expect(idx.get('3')).toBe('roster-imported')
  })

  it('leaves a team with neither key unresolved rather than guessing', () => {
    const idx = buildRosterIndex(
      [{ externalId: '4', platformUserId: 'nobody', claimedByUserId: null }],
      rosters,
    )
    expect(idx.has('4')).toBe(false)
  })
})
