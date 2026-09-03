import { describe, it, expect } from 'vitest'

import { isConclusiveFor, isConclusive, FACT_PROFILES } from '@/lib/decision-os/conclusive'
import type { ImportAssertions } from '@/lib/decision-os/import/assertions'

const HOUR = 3_600_000
const NOW = Date.parse('2026-08-31T20:00:00.000Z')

function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
  return {
    leagueId: 'lg1',
    provider: 'fantrax',
    externalLeagueId: 'x1',
    season: 2026,
    lastAttemptedSyncAt: new Date(NOW - HOUR).toISOString(),
    lastSuccessfulSyncAt: new Date(NOW - HOUR).toISOString(),
    staleMs: HOUR,
    syncStatus: 'completed',
    consecutiveFailures: 0,
    scopes: [
      { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'traded_picks', completedLastRun: true, incomplete: false, hasCheckpoint: true },
    ],
    parity: 'matched',
    parityNote: null,
    rosterCoverage: 1,
    rostersHeld: 12,
    rostersExpected: 12,
    managerIdentityCoverage: 1,
    managersMapped: 12,
    managersTotal: 12,
    playerIdentityCoverage: 1,
    playersResolved: 200,
    playersTotal: 200,
    ...over,
  }
}

describe('isConclusive — per fact, not per league', () => {
  it('🛑 a stale sync blocks a lineup call and NOT the scoring rules', () => {
    // This single case is the entire justification for the module. A league-level boolean
    // would refuse both, and the scoring rules are exactly as true as they were yesterday.
    const stale = assertions({
      staleMs: 30 * HOUR,
      lastSuccessfulSyncAt: new Date(NOW - 30 * HOUR).toISOString(),
    })

    const lineup = isConclusiveFor('lineupDecision', stale, NOW)
    const rules = isConclusiveFor('leagueRules', stale, NOW)

    expect(lineup.ok).toBe(false)
    expect(rules.ok).toBe(true)
  })

  it('names the blocking assertion AND a remedy, never a bare refusal', () => {
    const stale = assertions({ staleMs: 30 * HOUR })
    const v = isConclusiveFor('lineupDecision', stale, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy.length).toBeGreaterThan(0)
    for (const b of v.blockedBy) {
      // D8: "I can't tell you" is a dead end; the remedy is the half that makes it useful.
      expect(b.remedy.length).toBeGreaterThan(0)
      expect(b.detail.length).toBeGreaterThan(0)
    }
  })

  it('mentions the repeated failure in the remedy when syncing keeps failing', () => {
    const failing = assertions({ staleMs: 30 * HOUR, consecutiveFailures: 4 })
    const v = isConclusiveFor('lineupDecision', failing, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy.some((b) => /failed 4 time/i.test(b.remedy))).toBe(true)
  })

  it('🛑 treats a NEVER-IMPORTED league as conclusive, not as unverified', () => {
    // Native AF leagues have no sync to be stale and no provider to diverge from. Blocking them
    // would refuse to answer anything about half the product.
    const native = assertions({
      lastAttemptedSyncAt: null,
      lastSuccessfulSyncAt: null,
      staleMs: null,
      syncStatus: null,
      parity: 'unchecked',
    })
    expect(isConclusiveFor('lineupDecision', native, NOW).ok).toBe(true)
    expect(isConclusive(FACT_PROFILES.lineupDecision, null, NOW).ok).toBe(true)
  })

  it('blocks a manager claim on an unmapped owner, but leaves standings alone', () => {
    const partial = assertions({ managerIdentityCoverage: 10 / 12, managersMapped: 10 })
    expect(isConclusiveFor('managerBehaviour', partial, NOW).ok).toBe(false)
    // Standings do not name a person, so an unmapped owner does not make them unsafe.
    expect(isConclusiveFor('standings', partial, NOW).ok).toBe(true)
  })

  it('blocks on divergence only where parity actually matters', () => {
    const diverged = assertions({ parity: 'diverged', syncStatus: 'partial' })
    expect(isConclusiveFor('lineupDecision', diverged, NOW).ok).toBe(false)
    // Manager behaviour is derived from history, not from the current provider copy.
    expect(isConclusiveFor('managerBehaviour', diverged, NOW).ok).toBe(true)
  })

  it('never blocks a global player value on a league import', () => {
    const wrecked = assertions({
      staleMs: 500 * HOUR, parity: 'failed', consecutiveFailures: 9,
      rosterCoverage: 0.1, managerIdentityCoverage: 0,
      scopes: [{ scope: 'teams_rosters', completedLastRun: false, incomplete: true, hasCheckpoint: false }],
    })
    // Market values are global. No import assertion can bear on them, however broken the league is.
    expect(isConclusiveFor('globalPlayerValue', wrecked, NOW).ok).toBe(true)
  })

  it('🛑 R4 — blocks a lineup decision when player identity resolution is near zero, the measured trap', () => {
    // The trap this exists for: a roster where every player came back as
    // { playerId: '6804', name: '6804' } and still graded itself conclusive: ok.
    const unresolved = assertions({ playerIdentityCoverage: 0, playersResolved: 0, playersTotal: 27 })
    const v = isConclusiveFor('lineupDecision', unresolved, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    const identityBlockers = v.blockedBy.filter((b) => b.assertion === 'identity')
    expect(identityBlockers.some((b) => /27.*do not resolve/i.test(b.detail))).toBe(true)
  })

  it('does NOT block a lineup decision at a normal, measured resolution rate (~61% NFL is healthy, not a defect)', () => {
    // minIdentityResolution is 0.15 precisely so the ordinary case sails through — see the
    // field's own comment for the 2026-09-03 measurement this threshold is anchored to.
    const normal = assertions({ playerIdentityCoverage: 0.61, playersResolved: 178, playersTotal: 292 })
    expect(isConclusiveFor('lineupDecision', normal, NOW).ok).toBe(true)
  })

  it('a null playerIdentityCoverage (no id-space for this provider) never blocks — cannot measure ≠ measured bad', () => {
    const unmappedProvider = assertions({ playerIdentityCoverage: null, playersResolved: 0, playersTotal: 0 })
    expect(isConclusiveFor('lineupDecision', unmappedProvider, NOW).ok).toBe(true)
  })

  it('a fact with no minIdentityResolution (e.g. standings) is never blocked by player identity, however bad', () => {
    const catastrophic = assertions({ playerIdentityCoverage: 0, playersResolved: 0, playersTotal: 27 })
    expect(isConclusiveFor('standings', catastrophic, NOW).ok).toBe(true)
  })

  it('player-identity and manager-identity blockers are DISTINGUISHABLE, not conflated under one detail', () => {
    // Both failures share assertion: 'identity' by design (see the field's own comment on why),
    // so the only thing separating "wrong reason" from "right reason" is the detail text.
    const bothBroken = assertions({
      managerIdentityCoverage: 0, managersMapped: 0, managersTotal: 12,
      playerIdentityCoverage: 0, playersResolved: 0, playersTotal: 150,
    })
    const v = isConclusiveFor('lineupDecision', bothBroken, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    const identityBlockers = v.blockedBy.filter((b) => b.assertion === 'identity')
    expect(identityBlockers).toHaveLength(2)
    expect(identityBlockers.some((b) => /owner we cannot match/i.test(b.detail))).toBe(true)
    expect(identityBlockers.some((b) => /do not resolve to a known player/i.test(b.detail))).toBe(true)
  })

  it('reports an incomplete scope even when the league is otherwise fresh', () => {
    const partialScope = assertions({
      scopes: [
        { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
        { scope: 'teams_rosters', completedLastRun: false, incomplete: true, hasCheckpoint: true },
        { scope: 'traded_picks', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      ],
    })
    const v = isConclusiveFor('lineupDecision', partialScope, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy.some((b) => b.assertion === 'freshness' && b.scope === 'teams_rosters')).toBe(true)
    // ...and the same incomplete scope must NOT block a fact that does not read it.
    expect(isConclusiveFor('leagueRules', partialScope, NOW).ok).toBe(true)
  })
})
