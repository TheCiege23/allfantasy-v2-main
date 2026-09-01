import { describe, it, expect } from 'vitest'

import { collectGaps, gapFromVerdict, type GroundedSlice } from '@/lib/decision-os/grounding/packet'
import { isConclusiveFor } from '@/lib/decision-os/conclusive'
import type { ImportAssertions } from '@/lib/decision-os/import/assertions'

const HOUR = 3_600_000
const NOW = Date.parse('2026-08-31T20:00:00.000Z')

function slice(gap: GroundedSlice<unknown>['gap'], present = false): GroundedSlice<unknown> {
  return { present, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap }
}

describe('collectGaps — what a prompt is allowed to see', () => {
  it('🛑 excludes `not_requested`, which is a gap in the QUESTION not in what we know', () => {
    // Surfacing it would put "no devy board" on every NFL answer and train a reader to ignore
    // the gap list — which is exactly how a real gap gets missed.
    const gaps = collectGaps([
      ['devyValues', slice({ reason: 'not_requested', detail: 'not asked', remedy: 'ask' })],
      ['projections', slice({ reason: 'not_computed', detail: 'cold cache', remedy: 'runs daily' })],
    ])
    expect(gaps.map((g) => g.slice)).toEqual(['projections'])
  })

  it('names the slice each gap came from, so a refusal can be specific', () => {
    const gaps = collectGaps([
      ['marketValues', slice({ reason: 'no_producer', detail: 'no NHL market', remedy: 'nothing to fix' })],
    ])
    expect(gaps[0]).toMatchObject({ slice: 'marketValues', reason: 'no_producer' })
  })

  it('reports nothing when every slice is present', () => {
    expect(collectGaps([['projections', slice(null, true)]])).toEqual([])
  })

  it('every surfaced gap carries a non-empty remedy', () => {
    // D8: "I can't tell you that" is a dead end. The remedy is the half that makes it an answer.
    const gaps = collectGaps([
      ['a', slice({ reason: 'not_computed', detail: 'd', remedy: 'r' })],
      ['b', slice({ reason: 'no_producer', detail: 'd', remedy: 'r2' })],
    ])
    expect(gaps.length).toBe(2)
    for (const g of gaps) expect(g.remedy.length).toBeGreaterThan(0)
  })
})

describe('gapFromVerdict — carries the blocker\'s own remedy, not a generic one', () => {
  function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
    return {
      leagueId: 'lg1', provider: 'fantrax', externalLeagueId: 'x', season: 2026,
      lastAttemptedSyncAt: new Date(NOW - HOUR).toISOString(),
      lastSuccessfulSyncAt: new Date(NOW - 40 * HOUR).toISOString(),
      staleMs: 40 * HOUR, syncStatus: 'completed', consecutiveFailures: 0,
      scopes: [
        { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
        { scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: true },
        { scope: 'traded_picks', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      ],
      parity: 'matched', parityNote: null,
      rosterCoverage: 1, rostersHeld: 12, rostersExpected: 12,
      managerIdentityCoverage: 1, managersMapped: 12, managersTotal: 12,
      ...over,
    }
  }

  it('returns null for a conclusive verdict', () => {
    expect(gapFromVerdict({ ok: true })).toBeNull()
  })

  it('🛑 propagates the SPECIFIC remedy when syncing keeps failing', () => {
    // isConclusive says "failed 4 time(s) — reconnecting usually clears it" rather than
    // "try refreshing". Substituting a generic string at this step throws that away.
    const v = isConclusiveFor('lineupDecision', assertions({ consecutiveFailures: 4 }), NOW)
    const gap = gapFromVerdict(v)
    expect(gap).not.toBeNull()
    expect(gap!.remedy).toMatch(/failed 4 time/i)
    expect(gap!.remedy).not.toMatch(/^A manual refresh will bring it current\.$/)
  })

  it('quotes the real staleness in the detail rather than a placeholder', () => {
    const v = isConclusiveFor('lineupDecision', assertions(), NOW)
    const gap = gapFromVerdict(v)
    expect(gap).not.toBeNull()
    expect(gap!.detail).toMatch(/1 day|hours? ago/i)
  })
})
