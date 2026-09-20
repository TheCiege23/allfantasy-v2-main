// @vitest-environment node
/**
 * The week board's win-probability model, now shared with the pre-game odds snapshot
 * (2026-09-14): one formula, so the board and the snapshot cannot disagree.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  buildFormProfiles,
  buildProfiles,
  pairRows,
  priorSeasonRowsFromFacts,
  winProbabilityOf,
} from '@/lib/core-app/weekBoard'

describe('winProbabilityOf', () => {
  it('equal teams are a coin flip; the two sides always sum to 1; the better team is favoured', () => {
    expect(winProbabilityOf({ mu: 110, sigma: 12 }, { mu: 110, sigma: 20 })).toBeCloseTo(0.5, 6)
    const p = winProbabilityOf({ mu: 130, sigma: 15 }, { mu: 110, sigma: 12 })
    expect(p).toBeGreaterThan(0.5)
    expect(p + winProbabilityOf({ mu: 110, sigma: 12 }, { mu: 130, sigma: 15 })).toBeCloseTo(1, 6)
    // Φ(20 / √(15² + 12²)) = Φ(1.0412…) ≈ 0.8511
    expect(p).toBeCloseTo(0.8511, 3)
  })
})

describe('buildProfiles / pairRows (exported unchanged)', () => {
  const r = (rosterId: string, week: number, pointsFor: number, matchupId: number | null) => ({
    leagueId: 'L', seasonYear: 2026, week, rosterId, matchupId, pointsFor, pointsAgainst: pointsFor ? 1 : 0, win: 0,
  })

  it('profiles need three scored weeks and floor σ at 12; unscored rows do not count', () => {
    const profiles = buildProfiles([r('a', 1, 100, 1), r('a', 2, 101, 1), r('a', 3, 100, 1), r('a', 4, 0, 1), r('b', 1, 90, 1), r('b', 2, 91, 1)])
    expect(profiles.get('L:a')).toMatchObject({ n: 3, sigma: 12 })
    expect(profiles.get('L:a')!.mu).toBeCloseTo(100.33, 2)
    expect(profiles.has('L:b')).toBe(false)
  })

  /*
   * `buildFormProfiles` is the fallback for the rosters `buildProfiles` drops.
   * The property that matters is DISJOINTNESS: the loader checks the projection
   * map first and falls back to this one, so an overlap would mean a roster
   * could carry both a projection and a form line describing it differently.
   */
  it('form profiles are exactly the rosters buildProfiles drops, and never overlap it', () => {
    const rows = [
      // three scored weeks -> projectable, so NOT a form profile
      r('a', 1, 100, 1), r('a', 2, 101, 1), r('a', 3, 100, 1),
      // two scored weeks -> form only
      r('b', 1, 90, 1), r('b', 2, 110, 1),
      // one scored week -> form only; a mean at n=1 is still a true statement
      r('c', 1, 77, 1),
      // no scored week -> neither map. An unscored row is not a zero.
      r('d', 1, 0, 1),
    ]
    const projected = buildProfiles(rows)
    const form = buildFormProfiles(rows)

    expect(form.get('L:b')).toEqual({ mu: 100, n: 2 })
    expect(form.get('L:c')).toEqual({ mu: 77, n: 1 })

    /* The projectable roster is absent here, and the empty one is absent from both. */
    expect(form.has('L:a')).toBe(false)
    expect(form.has('L:d')).toBe(false)
    expect(projected.has('L:d')).toBe(false)

    /* Disjoint, stated as the property rather than as three spot checks. */
    for (const key of form.keys()) expect(projected.has(key)).toBe(false)

    /* No sigma — withholding it is what stops form being fed to winProbabilityOf. */
    expect(form.get('L:b')).not.toHaveProperty('sigma')
  })

  it('pairs exactly two rows per matchup id; a null id or a group of one does not pair', () => {
    const pairs = pairRows([r('a', 1, 0, 7), r('b', 1, 0, 7), r('c', 1, 0, null), r('d', 1, 0, null), r('e', 1, 0, 9)])
    expect(pairs).toHaveLength(1)
    expect([pairs[0]!.a.rosterId, pairs[0]!.b.rosterId].sort()).toEqual(['a', 'b'])
  })
})


describe('priorSeasonRowsFromFacts', () => {
  const fact = (season: number | null, week: number, a: string, b: string, sa: number, sb: number, leagueId = 'INTERNAL') =>
    ({ leagueId, season, weekOrPeriod: week, teamA: a, teamB: b, scoreA: sa, scoreB: sb })

  const platformIds = new Map([['INTERNAL', 'PLATFORM']])

  it('files facts under the league CURRENT platform id, not the internal one', () => {
    const rows = priorSeasonRowsFromFacts([fact(2025, 1, '1', '2', 110, 95)], platformIds, new Set())
    expect(rows).toHaveLength(2)
    /*
     * The whole point: buildProfiles keys "<platformLeagueId>:<rosterId>". Filed under the
     * internal id these rows form their own bucket and count toward nothing.
     */
    expect(rows.every((r) => r.leagueId === 'PLATFORM')).toBe(true)
    expect(rows.map((r) => r.rosterId).sort()).toEqual(['1', '2'])
  })

  it('splits each fact into both sides, mirroring pointsFor/pointsAgainst', () => {
    const rows = priorSeasonRowsFromFacts([fact(2025, 3, 'a', 'b', 120, 88)], platformIds, new Set())
    const a = rows.find((r) => r.rosterId === 'a')!
    const b = rows.find((r) => r.rosterId === 'b')!
    expect(a).toMatchObject({ pointsFor: 120, pointsAgainst: 88, win: 1, seasonYear: 2025, week: 3 })
    expect(b).toMatchObject({ pointsFor: 88, pointsAgainst: 120, win: 0 })
    /* Both sides of one game share a matchupId, or pairRows cannot pair them. */
    expect(a.matchupId).toBe(b.matchupId)
  })

  it('drops a season WeeklyMatchup already holds, and keeps the ones it does not', () => {
    const rows = priorSeasonRowsFromFacts(
      [fact(2025, 1, '1', '2', 100, 90), fact(2026, 1, '1', '2', 105, 99)],
      platformIds,
      new Set(['PLATFORM:2026']),
    )
    /*
     * 🛑 THE DOUBLE-COUNT GUARD. Counting one week twice inflates n while narrowing the
     * spread — a more confident projection off the same single game.
     */
    expect(rows.every((r) => r.seasonYear === 2025)).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('drops a fact with no season and a league with no platform id', () => {
    expect(priorSeasonRowsFromFacts([fact(null, 1, '1', '2', 100, 90)], platformIds, new Set())).toHaveLength(0)
    expect(
      priorSeasonRowsFromFacts([fact(2025, 1, '1', '2', 100, 90, 'UNKNOWN')], platformIds, new Set()),
    ).toHaveLength(0)
  })

  /*
   * 🛑 THE DUPLICATE-LEAGUE-COPY GUARD, found against production rather than by reading.
   * `leagues.userId` is the IMPORTER, so one real league exists once per member who connected it
   * (see `realLeague.ts`). Every copy maps to the SAME platform id, so the same game arrives once
   * per copy — measured at 1.55x on a real account.
   */
  it('counts one real game once, however many league copies deliver it', () => {
    const threeCopies = new Map([
      ['COPY_A', 'PLATFORM'],
      ['COPY_B', 'PLATFORM'],
      ['COPY_C', 'PLATFORM'],
    ])
    const oneGame = [
      fact(2025, 1, 'x', 'y', 100, 90, 'COPY_A'),
      fact(2025, 1, 'x', 'y', 100, 90, 'COPY_B'),
      fact(2025, 1, 'x', 'y', 100, 90, 'COPY_C'),
    ]
    const rows = priorSeasonRowsFromFacts(oneGame, threeCopies, new Set())

    /* One game is two rows — not six. */
    expect(rows).toHaveLength(2)

    /*
     * And the threshold holds. Three copies of ONE week must not reach
     * MIN_WEEKS_FOR_PROJECTION: that is a confident projection off a single game, which is
     * exactly what the threshold exists to refuse.
     */
    expect(buildProfiles(rows).has('PLATFORM:x')).toBe(false)
  })

  it('normalises the pair order, so a mirrored copy is still one game', () => {
    const twoCopies = new Map([['COPY_A', 'PLATFORM'], ['COPY_B', 'PLATFORM']])
    const mirrored = [
      fact(2025, 1, 'x', 'y', 100, 90, 'COPY_A'),
      /* The other copy wrote the same game with the sides swapped. */
      fact(2025, 1, 'y', 'x', 90, 100, 'COPY_B'),
    ]
    expect(priorSeasonRowsFromFacts(mirrored, twoCopies, new Set())).toHaveLength(2)
  })

  it('feeds buildProfiles so a roster with no current weeks becomes projectable', () => {
    /* Three prior-season weeks is exactly MIN_WEEKS_FOR_PROJECTION — the whole point of the change. */
    const rows = priorSeasonRowsFromFacts(
      [fact(2025, 1, 'x', 'y', 100, 90), fact(2025, 2, 'x', 'y', 110, 95), fact(2025, 3, 'x', 'y', 120, 85)],
      platformIds,
      new Set(),
    )
    const profiles = buildProfiles(rows)
    expect(profiles.get('PLATFORM:x')).toMatchObject({ n: 3 })
    expect(profiles.get('PLATFORM:x')!.mu).toBeCloseTo(110, 6)
    /* And with the prior seasons withheld, the same roster is NOT projectable — the control. */
    expect(buildProfiles(priorSeasonRowsFromFacts([], platformIds, new Set())).has('PLATFORM:x')).toBe(false)
  })
})
