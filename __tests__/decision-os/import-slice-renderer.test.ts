/**
 * The import slice reaches the prompt in full (Import OS, 2026-11-20 re-score push).
 *
 * Through the generic object renderer the 8-row cap kept the two timestamps and cut parity, coverage and the
 * incomplete scopes — the facts that bound an answer. `importAssertionsText.ts` renders them field by field.
 */
import { describe, it, expect } from 'vitest'

import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import type { DecisionOsGroundingPacket, GroundedSlice } from '@/lib/decision-os/grounding/packet'

/**
 * ── 🛑 THE PACKET ASSEMBLED FACTS AND THE SERIALIZER THREW THEM AWAY (G11) ──────────────────
 *
 * `sliceLine()` rendered `- Market player values: available (4 hours old)` and never read
 * `slice.value` — zero occurrences of it in the whole file. So a packet that spent ~1.7s
 * gathering `ValueLookup[]`, `ProjectionFact[]` and three-brain's saved conclusion handed the
 * model ten lines of adjectives.
 *
 * ⚠ AND NOTHING CAUGHT IT, WHICH IS WHY THIS FILE EXISTS. Every existing serializer test asserts
 * on the GAPS half — the hard half, and the half that was written correctly. A serializer that
 * renders no values at all passes all of them. These tests assert the assertion half.
 *
 * ⚠ THE GAPS HALF IS DELIBERATELY RE-ASSERTED HERE TOO. It was correct before this change and
 * must stay correct through it: the whole point of the packet is that "I cannot tell you" and
 * "here is the number" are both first-class, and a fix to one must not quietly cost the other.
 */

const NOW = Date.parse('2026-09-02T12:00:00.000Z')

function present<T>(value: T, over: Partial<GroundedSlice<T>> = {}): GroundedSlice<T> {
  return {
    present: true,
    value,
    asOf: '2026-09-02T08:00:00.000Z',
    servedFrom: 'store',
    confidence: null,
    conclusive: { ok: true },
    gap: null,
    ...over,
  } as GroundedSlice<T>
}

function absent<T>(reason: string, detail = 'gone', remedy = 'do the thing'): GroundedSlice<T> {
  return {
    present: false,
    value: null,
    asOf: null,
    servedFrom: null,
    confidence: null,
    conclusive: { ok: true },
    gap: { reason, detail, remedy },
  } as unknown as GroundedSlice<T>
}


import type { ImportAssertions } from '@/lib/decision-os/import/assertions'
import { isImportAssertions, renderImportAssertions } from '@/lib/decision-os/grounding/importAssertionsText'

function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
  return {
    leagueId: 'L1',
    provider: 'espn',
    externalLeagueId: 'ext-1',
    season: 2026,
    lastAttemptedSyncAt: '2026-09-02T11:50:00.000Z',
    lastSuccessfulSyncAt: '2026-09-02T09:00:00.000Z',
    staleMs: 3 * 3_600_000,
    syncStatus: 'partial',
    consecutiveFailures: 2,
    scopes: [
      { scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: false },
      { scope: 'transactions', completedLastRun: false, incomplete: true, hasCheckpoint: true },
      { scope: 'draft', completedLastRun: false, incomplete: true, hasCheckpoint: false },
    ],
    activeLane: { lastSuccessfulSyncAt: '2026-09-02T11:55:00.000Z', staleMs: 5 * 60_000, scopes: ['league_state', 'transactions', 'teams_rosters'] },
    parity: 'diverged',
    parityNote: null,
    rosterCoverage: 0.75,
    rostersHeld: 9,
    rostersExpected: 12,
    managerIdentityCoverage: 0.5,
    managersMapped: 6,
    managersTotal: 12,
    playerIdentityCoverage: 0.9,
    playersResolved: 180,
    playersTotal: 200,
    ...over,
  }
}

function packet(importAssertions: GroundedSlice<ImportAssertions>): DecisionOsGroundingPacket {
  const none = absent('not_requested')
  return {
    leagueId: 'L1',
    userId: 'U1',
    builtAt: '2026-09-02T12:00:00.000Z',
    importAssertions,
    leagueRules: none,
    marketValues: none,
    devyValues: none,
    projections: none,
    contextFacts: null,
    contextLookups: null,
    commissionerIntelligence: none,
    leagueIntelligence: none,
    portfolio: none,
    gaps: [],
    meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
  } as unknown as DecisionOsGroundingPacket
}

describe('the import slice in the prompt', () => {
  it('carries parity, coverage and the incomplete scopes — the half the 8-row cap used to cut', () => {
    const text = serializeDecisionOsGroundingForPrompt(packet(present(assertions())), NOW)
    expect(text).toContain('matches the host platform: diverged')
    expect(text).toContain('rosters held: 9 of 12 (75%)')
    expect(text).toContain('managers linked to an account: 6 of 12 (50%)')
    expect(text).toContain('rostered players identified: 180 of 200 (90%)')
    expect(text).toContain('scopes NOT complete on the last run: transactions, draft')
    expect(text).toContain('2 failed run(s) in a row')
    expect(text).toContain('last complete sync: 3 hr ago')
    expect(text).toContain('rosters/transactions lane: last complete 5 min ago')
  })

  it('says "not measured" for a coverage the loader could not measure, never zero', () => {
    const rows = renderImportAssertions(
      assertions({ provider: 'allfantasy', playerIdentityCoverage: null, playersResolved: 0, playersTotal: 0, rosterCoverage: null, rostersExpected: null }),
    ).join('\n')
    expect(rows).toContain('rostered players identified: not measured')
    expect(rows).toContain('rosters held: not measured')
    expect(rows).not.toMatch(/0 of 0/)
  })

  it('a complete, never-failing sync says so in one line', () => {
    const rows = renderImportAssertions(
      assertions({
        consecutiveFailures: 0,
        scopes: [{ scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: false }],
      }),
    ).join('\n')
    expect(rows).toContain('scopes: all 1 completed on the last run')
    expect(rows).not.toContain('failed run')
  })

  it('recognises only the import shape', () => {
    expect(isImportAssertions(assertions())).toBe(true)
    expect(isImportAssertions({ provider: 'espn' })).toBe(false)
    expect(isImportAssertions([assertions()])).toBe(false)
  })
})
