// @vitest-environment node
/**
 * lib/api-sports.ts — syncAPISportsStandingsToDb null-safety.
 *
 * Production (import-standings cron) threw two ways on malformed API-Sports rows:
 *  - `s.team.name` was read OUTSIDE the per-row try, so an undefined `team` threw uncaught and
 *    aborted the ENTIRE loop — every remaining standing lost.
 *  - `s.points.for` inside threw `Cannot read properties of undefined (reading 'for')` per row
 *    (~100 in one run).
 * `isSyncableStandingRow` is the guard that now skips such rows. These tests pin it.
 */
import { describe, it, expect } from 'vitest'
import { isSyncableStandingRow } from '@/lib/api-sports'

const valid = {
  team: { id: 1, name: 'Kansas City Chiefs', logo: null },
  position: 1,
  won: 10,
  lost: 2,
  tied: 0,
  points: { for: 300, against: 200 },
  group: { name: 'AFC West', conference: 'AFC' },
} as unknown as Parameters<typeof isSyncableStandingRow>[0]

describe('isSyncableStandingRow', () => {
  it('accepts a well-formed standings row', () => {
    expect(isSyncableStandingRow(valid)).toBe(true)
  })

  it('rejects every malformed shape seen in production, without throwing', () => {
    // Collect-all-then-assert: each of these must be rejected (false), and evaluating the guard
    // must never throw — throwing is the exact bug being fixed.
    const cases: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['missing team', { ...(valid as object), team: undefined }],
      ['team without name', { ...(valid as object), team: { id: 1, logo: null } }],
      ['team.name empty', { ...(valid as object), team: { id: 1, name: '', logo: null } }],
      ['missing points', { ...(valid as object), points: undefined }],
      ['empty object', {}],
    ]
    const offenders: string[] = []
    for (const [label, row] of cases) {
      let result: boolean
      try {
        result = isSyncableStandingRow(row as never)
      } catch (e) {
        offenders.push(`${label}: THREW ${(e as Error).message}`)
        continue
      }
      if (result !== false) offenders.push(`${label}: expected false, got ${result}`)
    }
    expect(offenders).toEqual([])
    expect(cases.length).toBeGreaterThan(0) // floor: an empty case list must not read as a pass
  })
})
