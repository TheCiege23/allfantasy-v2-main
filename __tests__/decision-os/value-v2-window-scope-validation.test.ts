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
      injuries: async () => null,
    }
    const decision = await resolveWindowDecision(scope(6), port)
    expect(touched).toBe(true)
    expect(decision.gaps).not.toContain(INVALID_SCOPE_GAP)
  })
})
