import { describe, expect, it } from 'vitest'
import { INVALID_SCOPE_GAP, resolveWindowDecision } from '@/lib/decision-os/value-v2/windowDecision'
import type { WindowFactsPort } from '@/lib/decision-os/value-v2/windowFacts'

/**
 * Scope validation for the resolver's entry point.
 *
 * ⚠ THE ARITHMETIC LOOKBACK HAD NO UPPER GUARD AND NO FINITENESS GUARD.
 *   week 0 / -1 / NaN -> the loop pushes nothing, `assembled[assembled.length - 1]`
 *                        is `undefined`, and reading `.facts` throws a TypeError.
 *   week Infinity     -> `Infinity - 2 <= Infinity` is true and `w += 1` never advances,
 *                        so the loop never terminates. A hang, not an error.
 * A caller passing a bad week must get a named refusal, and the port must not be touched.
 */

/** Fails loudly if the resolver reads any evidence for a scope it should have rejected. */
function forbiddenPort(): WindowFactsPort {
  const boom = (name: string) => async () => {
    throw new Error(`port.${name} must not be called for an invalid scope`)
  }
  return {
    identity: boom('identity') as WindowFactsPort['identity'],
    allPlay: boom('allPlay') as WindowFactsPort['allPlay'],
    forecast: boom('forecast') as WindowFactsPort['forecast'],
    dynasty: boom('dynasty') as WindowFactsPort['dynasty'],
    /*
     * ⚠ THE REDRAFT READS BELONG IN THE TRAP TOO, OR THE TRAP ONLY COVERS HALF THE PORT.
     * `restOfSeason` and `remainingScheduleStrength` are the reads the resolver makes for a
     * REDRAFT league; `dynasty` is the one it makes otherwise. A forbidden port that omits them
     * proves the resolver touches no evidence only on the dynasty branch, and an invalid scope
     * must be refused before the format is even consulted.
     */
    restOfSeason: boom('restOfSeason') as WindowFactsPort['restOfSeason'],
    remainingScheduleStrength: boom('remainingScheduleStrength') as NonNullable<WindowFactsPort['remainingScheduleStrength']>,
    injuries: boom('injuries') as WindowFactsPort['injuries'],
  }
}

const scope = (week: number) => ({ leagueId: 'l1', teamId: 't1', season: 2026, week })

const INVALID_WEEKS: Array<[string, number]> = [
  ['zero', 0],
  ['negative', -1],
  ['large negative', -999],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['fractional', 6.5],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
  ['above the period bound', 26],
]

describe('an invalid scope refuses without touching the port', () => {
  it.each(INVALID_WEEKS)('week %s refuses (no schedule supplied)', async (_label, week) => {
    const decision = await resolveWindowDecision(scope(week), forbiddenPort())
    expect(decision.state).toBe('refused')
    expect(decision.status).toBeNull()
    expect(decision.gaps).toContain(INVALID_SCOPE_GAP)
    expect(decision.teamFit).toMatchObject({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
  })

  it.each(INVALID_WEEKS)('week %s refuses (schedule supplied)', async (_label, week) => {
    const decision = await resolveWindowDecision(scope(week), forbiddenPort(), {
      scheduledPeriods: [1, 2, 3, 4, 5, 6],
    })
    expect(decision.state).toBe('refused')
    expect(decision.gaps).toContain(INVALID_SCOPE_GAP)
  })

  it('terminates rather than hanging on Infinity', async () => {
    // Guards the loop directly: before validation this never returned.
    const decision = await Promise.race([
      resolveWindowDecision(scope(Number.POSITIVE_INFINITY), forbiddenPort()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('resolver hung')), 3_000)),
    ])
    expect((decision as { state: string }).state).toBe('refused')
  }, 10_000)

  it('rejects a malformed identity before reading evidence', async () => {
    for (const bad of [{ leagueId: '' }, { teamId: '' }, { season: Number.NaN }, { season: 1.5 }]) {
      const decision = await resolveWindowDecision({ ...scope(6), ...bad }, forbiddenPort())
      expect(decision.state).toBe('refused')
      expect(decision.gaps).toContain(INVALID_SCOPE_GAP)
    }
  })

  it('carries the offending identity through so an operator can find the caller', async () => {
    const decision = await resolveWindowDecision(scope(0), forbiddenPort())
    expect(decision.identity).toMatchObject({ leagueId: 'l1', teamId: 't1', season: 2026, week: 0 })
  })

  it('still accepts a legitimate week', async () => {
    let touched = false
    const port: WindowFactsPort = {
      identity: async () => { touched = true; return null },
      allPlay: async () => null,
      forecast: async () => null,
      dynasty: async () => null,
      /** Null is the honest answer here: this stub models no rest-of-season projection. */
      restOfSeason: async () => null,
      injuries: async () => null,
    }
    const decision = await resolveWindowDecision(scope(6), port)
    expect(touched).toBe(true)
    expect(decision.gaps).not.toContain(INVALID_SCOPE_GAP)
  })
})

/**
 * The `scope_missing` branch, which could not previously be reached alive.
 *
 * 🛑 `invalidScopeReason` returned 'scope_missing' for null, undefined and non-objects, and
 * `refusedDecision` then read `scope.leagueId` — so the ONE input the contract named as
 * supported threw a TypeError instead of refusing. The refusal was unreachable by
 * construction: producing it required a value that made producing it throw.
 *
 * These assert the contract end to end rather than the guard in isolation. A test that only
 * called `invalidScopeReason` would have passed against the broken version, because the
 * guard was never the broken half.
 */
describe('a missing or non-object scope refuses instead of throwing', () => {
  const MISSING: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'l1'],
    ['a number', 7],
    ['a boolean', true],
  ]

  it.each(MISSING)('scope %s refuses and reads no evidence', async (_label, bad) => {
    const decision = await resolveWindowDecision(
      bad as never,
      forbiddenPort(),
    )
    expect(decision.state).toBe('refused')
    expect(decision.status).toBeNull()
    expect(decision.gaps).toContain(INVALID_SCOPE_GAP)
    expect(decision.gaps).toContain('scope_missing')
    expect(decision.teamFit).toMatchObject({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
  })

  it.each(MISSING)('scope %s reports a null identity rather than inventing one', async (_label, bad) => {
    const decision = await resolveWindowDecision(bad as never, forbiddenPort())
    // Null, not undefined: the field is declared nullable and must actually hold null.
    expect(decision.identity).toEqual({
      leagueId: null, season: null, week: null, teamId: null, teamName: null, managerName: null,
    })
  })

  it('an array is not a usable scope even though typeof is "object"', async () => {
    const decision = await resolveWindowDecision([] as never, forbiddenPort())
    expect(decision.state).toBe('refused')
    // An array has no leagueId, so it is caught one step later than scope_missing.
    expect(decision.gaps).toContain('league_id_missing')
    expect(decision.identity.leagueId).toBeNull()
  })

  /*
   * A partial scope must still echo the fields that ARE usable. This is what the refusal is
   * for: an operator reading it has to be able to find the caller that sent it.
   */
  it('echoes usable fields and nulls only the unusable ones', async () => {
    const decision = await resolveWindowDecision(
      { leagueId: 'l1', teamId: 't1', season: 2026 } as never,
      forbiddenPort(),
    )
    expect(decision.state).toBe('refused')
    expect(decision.gaps).toContain('week_not_an_integer')
    expect(decision.identity).toEqual({
      leagueId: 'l1', season: 2026, week: null, teamId: 't1', teamName: null, managerName: null,
    })
  })

  /*
   * ⚠ A WRONG VALUE IS NOT AN ABSENT ONE. `week: 0` and `season: NaN` are real values that a
   * real caller sent, and they are the evidence needed to find that caller. Nulling them
   * would hide exactly what the echo exists to carry.
   */
  it('echoes a wrong-but-real week and season rather than nulling them', async () => {
    const zero = await resolveWindowDecision(
      { leagueId: 'l1', teamId: 't1', season: 2026, week: 0 } as never,
      forbiddenPort(),
    )
    expect(zero.identity.week).toBe(0)

    const nan = await resolveWindowDecision(
      { leagueId: 'l1', teamId: 't1', season: Number.NaN, week: 6 } as never,
      forbiddenPort(),
    )
    expect(nan.identity.season).toBeNaN()
    expect(nan.identity.week).toBe(6)
  })

  it('a wrong-typed field is nulled rather than passed through as-is', async () => {
    const decision = await resolveWindowDecision(
      { leagueId: 42, teamId: 't1', season: '2026', week: 6 } as never,
      forbiddenPort(),
    )
    expect(decision.state).toBe('refused')
    expect(decision.identity.leagueId).toBeNull()
    expect(decision.identity.season).toBeNull()
    expect(decision.identity.teamId).toBe('t1')
  })
})
