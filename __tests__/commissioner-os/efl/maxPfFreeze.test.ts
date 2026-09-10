import { describe, expect, it } from 'vitest'

import {
  applyMaxPfCorrections,
  computeRegularSeasonMaxPf,
  resolveMaxPfFreezeStatus,
  type WeeklyTeamValue,
} from '@/lib/commissioner-os/efl/maxPfFreeze'

/**
 * The regular-season freeze.
 *
 * 🛑 THE RULE UNDER TEST: PLAYOFF POINTS MUST NOT ALTER A NON-PLAYOFF TEAM'S ROOKIE SLOT.
 */

const TEAMS = ['a', 'b', 'c']

/** Weeks 1..n at a flat value, so a change is obvious rather than arithmetic. */
function weeks(teamId: string, from: number, to: number, value: number): WeeklyTeamValue[] {
  const out: WeeklyTeamValue[] = []
  for (let w = from; w <= to; w += 1) out.push({ teamId, week: w, value })
  return out
}

const REGULAR_ONLY: WeeklyTeamValue[] = [
  ...weeks('a', 1, 14, 100),
  ...weeks('b', 1, 14, 110),
  ...weeks('c', 1, 14, 90),
]

const compute = (rows: WeeklyTeamValue[], finalWeek = 14) =>
  computeRegularSeasonMaxPf({
    leagueId: 'efl-1',
    season: 2026,
    regularSeasonFinalWeek: finalWeek,
    metric: 'optimal_lineup_max_pf',
    computationVersion: 'test-engine-v1',
    weeklyRows: rows,
    teamIds: TEAMS,
  })

describe('the freeze sums the regular season and nothing else', () => {
  it('totals weeks 1 through the final week', () => {
    const r = compute(REGULAR_ONLY)
    expect(r.snapshot.rows.find((x) => x.teamId === 'a')!.value).toBe(1400)
    expect(r.snapshot.rows.find((x) => x.teamId === 'c')!.value).toBe(1260)
    expect(r.complete).toBe(true)
  })

  it('PLAYOFF WEEKS CANNOT CHANGE IT, even when handed to the resolver unfiltered', () => {
    /*
     * 🛑 THE CENTRAL ASSERTION OF THIS PHASE. The same league, run again in week 17 with three
     * playoff weeks of scores included, must produce the IDENTICAL number and the IDENTICAL
     * fingerprint. This is the property that `LeagueTeam.pointsFor` — a running total — cannot
     * have, which is why the existing `reverse_max_pf` code could not be reused.
     */
    const withPlayoffs = [
      ...REGULAR_ONLY,
      ...weeks('a', 15, 17, 500),
      ...weeks('b', 15, 17, 500),
      ...weeks('c', 15, 17, 500),
    ]
    expect(compute(withPlayoffs).snapshot).toEqual(compute(REGULAR_ONLY).snapshot)
  })

  it('does not hardcode NFL week 14', () => {
    const r = compute(REGULAR_ONLY, 13)
    expect(r.snapshot.regularSeasonFinalWeek).toBe(13)
    expect(r.snapshot.rows.find((x) => x.teamId === 'a')!.value).toBe(1300)
  })

  it('ignores a duplicate row for a week already counted', () => {
    const dup = [...REGULAR_ONLY, { teamId: 'a', week: 3, value: 999 }]
    expect(compute(dup).snapshot.rows.find((x) => x.teamId === 'a')!.value).toBe(1400)
  })

  it('ignores a row for a team that is not on the roster of record', () => {
    /* A stray provider id must not invent a fourth team in a three-team league. */
    const stray = [...REGULAR_ONLY, ...weeks('ghost', 1, 14, 1000)]
    expect(compute(stray).snapshot.rows.map((r) => r.teamId)).toEqual(['a', 'b', 'c'])
  })
})

describe('freezing is idempotent', () => {
  it('the same inputs produce the same fingerprint', () => {
    expect(compute(REGULAR_ONLY).snapshot.fingerprint).toBe(compute(REGULAR_ONLY).snapshot.fingerprint)
  })

  it('row order in the input does not change the fingerprint', () => {
    const reversed = [...REGULAR_ONLY].reverse()
    expect(compute(reversed).snapshot.fingerprint).toBe(compute(REGULAR_ONLY).snapshot.fingerprint)
  })

  it('a genuine change to a regular-season score DOES change it', () => {
    /*
     * ⚠ THE POSITIVE CONTROL FOR THE FINGERPRINT ITSELF. A digest that never moves is not a
     * fingerprint, and every idempotency claim above would be vacuous.
     */
    const corrected = REGULAR_ONLY.map((r) =>
      r.teamId === 'a' && r.week === 5 ? { ...r, value: 101 } : r,
    )
    expect(compute(corrected).snapshot.fingerprint).not.toBe(compute(REGULAR_ONLY).snapshot.fingerprint)
  })

  it('a metric change changes it, even at identical values', () => {
    const asOptimal = computeRegularSeasonMaxPf({
      leagueId: 'efl-1',
      season: 2026,
      regularSeasonFinalWeek: 14,
      metric: 'actual_points_for',
      computationVersion: 'test-engine-v1',
      weeklyRows: REGULAR_ONLY,
      teamIds: TEAMS,
    })
    expect(asOptimal.snapshot.fingerprint).not.toBe(compute(REGULAR_ONLY).snapshot.fingerprint)
  })
})

describe('the state machine tells the truth about what is settled', () => {
  it('reports missing when the weeks are incomplete', () => {
    const partial = compute([...weeks('a', 1, 14, 100), ...weeks('b', 1, 14, 100)])
    const status = resolveMaxPfFreezeStatus({ stored: null, computed: partial })
    expect(status.state).toBe('missing')
    expect(status.teamsWithNoData).toEqual(['c'])
    expect(status.explanation).toMatch(/cannot freeze yet/i)
  })

  it('names the weeks that are short', () => {
    const holed = compute(REGULAR_ONLY.filter((r) => !(r.teamId === 'b' && r.week === 7)))
    const status = resolveMaxPfFreezeStatus({ stored: null, computed: holed })
    expect(status.state).toBe('missing')
    expect(status.missingWeeks).toEqual([7])
  })

  it('reports READY — computable, and explicitly not yet frozen', () => {
    /*
     * 🛑 `ready` AND `frozen` MUST NOT BE COLLAPSED. A commissioner shown a `ready` order as
     * settled will watch it move next week and stop trusting the ladder.
     */
    const status = resolveMaxPfFreezeStatus({ stored: null, computed: compute(REGULAR_ONLY) })
    expect(status.state).toBe('ready')
    expect(status.explanation).toMatch(/NOT yet frozen/i)
  })

  it('reports frozen once something is stored', () => {
    const stored = compute(REGULAR_ONLY).snapshot
    const status = resolveMaxPfFreezeStatus({ stored, computed: compute(REGULAR_ONLY) })
    expect(status.state).toBe('frozen')
    expect(status.driftDetected).toBe(false)
  })

  it('reports corrected when an override is recorded', () => {
    const stored = compute(REGULAR_ONLY).snapshot
    const status = resolveMaxPfFreezeStatus({ stored, storedHasCorrection: true, computed: null })
    expect(status.state).toBe('corrected')
  })

  it('a stat correction after the freeze is reported as DRIFT and does not move the value', () => {
    /*
     * 🛑 DRIFT DOES NOT OVERWRITE. Stat corrections legitimately move a week-9 score in week 12.
     * The draft order does not move with them — that is what "frozen" means.
     */
    const stored = compute(REGULAR_ONLY).snapshot
    const laterCorrection = REGULAR_ONLY.map((r) =>
      r.teamId === 'a' && r.week === 9 ? { ...r, value: 130 } : r,
    )
    const status = resolveMaxPfFreezeStatus({ stored, computed: compute(laterCorrection) })
    expect(status.state).toBe('frozen')
    expect(status.driftDetected).toBe(true)
    expect(status.snapshot!.rows.find((x) => x.teamId === 'a')!.value).toBe(1400)
    expect(status.explanation).toMatch(/has not moved/i)
  })
})

describe('the correction path is explicit and audited', () => {
  const base = compute(REGULAR_ONLY).snapshot

  it('produces a NEW snapshot and leaves the original untouched', () => {
    const before = JSON.stringify(base)
    const { snapshot } = applyMaxPfCorrections(base, [
      { teamId: 'a', value: 1234, reason: 'scoring appeal', correctedByUserId: 'u1', correctedAt: '2026-12-30T00:00:00Z' },
    ])
    expect(JSON.stringify(base)).toBe(before)
    expect(snapshot.rows.find((r) => r.teamId === 'a')!.value).toBe(1234)
    expect(snapshot.fingerprint).not.toBe(base.fingerprint)
  })

  it('marks the corrected row so provenance survives', () => {
    const { snapshot } = applyMaxPfCorrections(base, [
      { teamId: 'b', value: 1, reason: 'r', correctedByUserId: 'u1', correctedAt: 'now' },
    ])
    expect(snapshot.rows.find((r) => r.teamId === 'b')!.source).toBe('commissioner_correction')
    expect(snapshot.rows.find((r) => r.teamId === 'a')!.source).toBe('weekly_rows')
  })

  it('rejects a correction for a team not in the snapshot', () => {
    const { applied, rejected } = applyMaxPfCorrections(base, [
      { teamId: 'ghost', value: 1, reason: 'r', correctedByUserId: 'u1', correctedAt: 'now' },
    ])
    expect(applied).toEqual([])
    expect(rejected).toHaveLength(1)
  })
})
