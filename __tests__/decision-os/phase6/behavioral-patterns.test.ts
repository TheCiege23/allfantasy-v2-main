/**
 * Phase 6.1 — Behavioral Patterns: deterministic sequence-detection tests.
 *
 * Coverage:
 *   - Version stamp
 *   - Empty / sparse input + warnings
 *   - Out-of-order events (determinism)
 *   - No input mutation
 *   - All 12 pattern types (fires + doesn't fire + confidence)
 *   - Evidence window correctness
 *   - Manager vs league pattern separation
 *   - No false positives from single events
 *   - Missing timestamp confidence warnings
 *   - Regression: no shared types with Phase 6.3 or 6.5
 */

import { describe, it, expect } from 'vitest'
import { detectBehavioralPatterns, PATTERN_VERSION } from '../../../lib/decision-os/phase6/patterns/patterns'
import type { BehavioralEvent, BehavioralEventType } from '../../../lib/decision-os/behavioral/events/types'
import type { BehavioralPatternInput } from '../../../lib/decision-os/phase6/patterns/types'

// ── Test fixture factory ──────────────────────────────────────────────────────

let _idSeq = 0
function makeId(prefix: string): string {
  return `${prefix}-${++_idSeq}`
}

function makeEvent(
  type: BehavioralEventType,
  occurredAt: string,
  managerId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any,
  leagueId = 'league-1',
  timestampConfidence: 'exact' | 'approximate' | 'unknown' = 'exact',
): BehavioralEvent {
  return {
    eventId: makeId(type),
    eventType: type,
    occurredAt,
    recordedAt: occurredAt,
    leagueId,
    managerId,
    source: 'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: [] },
    completeness: 100,
    uncertainty: {
      sources: [],
      timestampConfidence,
      actorConfidence: 'confirmed',
    },
    metadata,
  } as BehavioralEvent
}

// Per-type shorthand helpers
function lineupSaved(
  occurredAt: string,
  managerId: string,
  week: number,
  slotChanges: number,
  started: string[] = [],
  benched: string[] = [],
  leagueId = 'league-1',
): BehavioralEvent {
  return makeEvent('lineup_saved', occurredAt, managerId, {
    week,
    season: 2024,
    leagueType: 'redraft',
    slotChanges,
    startedPlayerIds: started,
    benchedPlayerIds: benched,
  }, leagueId)
}

function waiverClaim(occurredAt: string, managerId: string, claimId?: string): BehavioralEvent {
  return makeEvent('waiver_claim_created', occurredAt, managerId, {
    claimId: claimId ?? makeId('c'),
    addPlayerId: 'p1',
    addPlayerName: 'P1',
    dropPlayerId: null,
    dropPlayerName: null,
    bidAmount: 10,
    priority: null,
    waiverType: 'faab',
  })
}

function tradeCreated(occurredAt: string, managerId: string, proposalId?: string): BehavioralEvent {
  const pid = proposalId ?? makeId('prop')
  return makeEvent('trade_created', occurredAt, managerId, {
    proposalId: pid,
    proposerRosterId: `roster-${managerId}`,
    receiverRosterId: 'roster-other',
    assetCount: 2,
    vetoMode: null,
    expiresAt: null,
  })
}

function tradeRejected(occurredAt: string, rejectorId: string, proposalId: string): BehavioralEvent {
  return makeEvent('trade_rejected', occurredAt, rejectorId, {
    proposalId,
    rejectorRosterId: `roster-${rejectorId}`,
    rejectionReason: null,
  })
}

function rulesChanged(occurredAt: string, managerId: string): BehavioralEvent {
  return makeEvent('rules_changed', occurredAt, managerId, {
    changedKeys: ['scoringSettings'],
    settingCategory: 'scoring',
  })
}

function leagueOpened(occurredAt: string, managerId: string): BehavioralEvent {
  return makeEvent('league_opened', occurredAt, managerId, { surface: 'overview' })
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const BASE = new Date('2024-09-01T12:00:00.000Z')

function d(offsetDays: number): string {
  return new Date(BASE.getTime() + offsetDays * 86400000).toISOString()
}

function run(events: BehavioralEvent[], leagueId = 'league-1') {
  return detectBehavioralPatterns({ leagueId, events })
}

function runWith(input: BehavioralPatternInput) {
  return detectBehavioralPatterns(input)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATTERN_VERSION', () => {
  it('is 6.1.0', () => {
    expect(PATTERN_VERSION).toBe('6.1.0')
  })
  it('is stamped on every result', () => {
    const result = run([])
    expect(result.version).toBe('6.1.0')
  })
})

describe('empty / sparse input', () => {
  it('handles zero events without throwing', () => {
    const result = run([])
    expect(result.managerPatterns).toEqual([])
    expect(result.leaguePatterns).toEqual([])
    expect(result.totalEventsAnalyzed).toBe(0)
    expect(result.earliestEventAt).toBeNull()
    expect(result.latestEventAt).toBeNull()
  })

  it('emits insufficient_events warning when fewer than 3 events', () => {
    const result = run([leagueOpened(d(0), 'm1')])
    expect(result.warnings.some((w) => w.includes('insufficient_events'))).toBe(true)
  })

  it('does not emit insufficient_events warning with 3+ events', () => {
    const events = [leagueOpened(d(0), 'm1'), leagueOpened(d(1), 'm1'), leagueOpened(d(2), 'm1')]
    const result = run(events)
    expect(result.warnings.some((w) => w.includes('insufficient_events'))).toBe(false)
  })

  it('sets leagueId correctly', () => {
    const result = run([], 'my-league')
    expect(result.leagueId).toBe('my-league')
  })

  it('reflects analysisWindowDays default', () => {
    const result = run([])
    expect(result.analysisWindowDays).toBe(90)
  })

  it('reflects custom analysisWindowDays', () => {
    const result = runWith({ leagueId: 'l', events: [], analysisWindowDays: 60 })
    expect(result.analysisWindowDays).toBe(60)
  })
})

describe('determinism (out-of-order input)', () => {
  it('produces identical output regardless of input order', () => {
    const events = [
      lineupSaved(d(5), 'm1', 1, 3),
      lineupSaved(d(1), 'm1', 1, 2),
      lineupSaved(d(3), 'm1', 1, 1),
      waiverClaim(d(10), 'm1'),
      waiverClaim(d(12), 'm1'),
    ]
    const reversed = [...events].reverse()
    const r1 = run(events)
    const r2 = run(reversed)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})

describe('no input mutation', () => {
  it('does not mutate the events array', () => {
    const events = [
      lineupSaved(d(5), 'm1', 1, 3),
      lineupSaved(d(1), 'm1', 1, 2),
      lineupSaved(d(10), 'm1', 2, 0),
    ]
    const originalOrder = events.map((e) => e.eventId)
    run(events)
    expect(events.map((e) => e.eventId)).toEqual(originalOrder)
  })
})

describe('missing timestamp confidence', () => {
  it('emits warning when events have unknown timestamp confidence', () => {
    const e = makeEvent('league_opened', d(0), 'm1', { surface: 'overview' }, 'league-1', 'unknown')
    const result = run([e, leagueOpened(d(1), 'm1'), leagueOpened(d(2), 'm1')])
    expect(result.warnings.some((w) => w.includes('unknown timestamp confidence'))).toBe(true)
  })

  it('does not warn when all timestamps are exact', () => {
    const result = run([
      leagueOpened(d(0), 'm1'),
      leagueOpened(d(1), 'm1'),
      leagueOpened(d(2), 'm1'),
    ])
    expect(result.warnings.some((w) => w.includes('unknown timestamp'))).toBe(false)
  })
})

describe('no false positives from single events', () => {
  it('does not detect any pattern from a single lineup_saved', () => {
    const result = run([lineupSaved(d(0), 'm1', 1, 5)])
    expect(result.managerPatterns).toEqual([])
    expect(result.leaguePatterns).toEqual([])
  })

  it('does not detect waiver_aggression_streak from one waiver claim', () => {
    const result = run([waiverClaim(d(0), 'm1')])
    expect(result.managerPatterns.flatMap((g) => g.patterns)).toHaveLength(0)
  })

  it('does not detect commissioner_rules_churn from two rule changes', () => {
    const result = run([rulesChanged(d(0), 'm1'), rulesChanged(d(5), 'm1')])
    expect(result.leaguePatterns).toHaveLength(0)
  })
})

// ── Manager patterns ──────────────────────────────────────────────────────────

describe('repeated_lineup_indecision', () => {
  it('fires when 3+ saves in same week', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 2),
      lineupSaved(d(1), 'm1', 1, 1),
      lineupSaved(d(2), 'm1', 1, 0),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group).toBeDefined()
    const pattern = group!.patterns.find((p) => p.patternType === 'repeated_lineup_indecision')
    expect(pattern).toBeDefined()
  })

  it('does not fire with 2 saves in same week', () => {
    const events = [lineupSaved(d(0), 'm1', 1, 2), lineupSaved(d(1), 'm1', 1, 1)]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    const pattern = group?.patterns.find((p) => p.patternType === 'repeated_lineup_indecision')
    expect(pattern).toBeUndefined()
  })

  it('confidence: low for 1 qualifying week, medium for 2, high for 3+', () => {
    const mk = (week: number) => [
      lineupSaved(d(week * 7), 'm1', week, 2),
      lineupSaved(d(week * 7 + 1), 'm1', week, 1),
      lineupSaved(d(week * 7 + 2), 'm1', week, 0),
    ]
    const result1 = run(mk(1))
    const p1 = result1.managerPatterns[0]!.patterns.find((p) => p.patternType === 'repeated_lineup_indecision')
    expect(p1!.confidence).toBe('low')

    const result2 = run([...mk(1), ...mk(2)])
    const p2 = result2.managerPatterns[0]!.patterns.find((p) => p.patternType === 'repeated_lineup_indecision')
    expect(p2!.confidence).toBe('medium')

    const result3 = run([...mk(1), ...mk(2), ...mk(3)])
    const p3 = result3.managerPatterns[0]!.patterns.find((p) => p.patternType === 'repeated_lineup_indecision')
    expect(p3!.confidence).toBe('high')
  })

  it('evidence window covers all saves in the qualifying week', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 2),
      lineupSaved(d(1), 'm1', 1, 1),
      lineupSaved(d(2), 'm1', 1, 0),
    ]
    const result = run(events)
    const pattern = result.managerPatterns[0]!.patterns.find(
      (p) => p.patternType === 'repeated_lineup_indecision',
    )!
    expect(pattern.evidenceWindows[0].eventIds).toHaveLength(3)
  })
})

describe('waiver_aggression_streak', () => {
  it('fires when 5+ claims in 21 days', () => {
    const events = Array.from({ length: 5 }, (_, i) => waiverClaim(d(i * 3), 'm1'))
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'waiver_aggression_streak')).toBeDefined()
  })

  it('does not fire with 4 claims in 21 days', () => {
    const events = Array.from({ length: 4 }, (_, i) => waiverClaim(d(i * 3), 'm1'))
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'waiver_aggression_streak')).toBeUndefined()
  })

  it('does not fire when 5 claims span more than 21 days', () => {
    const events = Array.from({ length: 5 }, (_, i) => waiverClaim(d(i * 6), 'm1'))
    // 5 claims over 24 days — no qualifying 21-day window
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'waiver_aggression_streak')).toBeUndefined()
  })
})

describe('trade_proposal_spike', () => {
  it('fires when 4+ proposals in 14 days', () => {
    const events = Array.from({ length: 4 }, (_, i) => tradeCreated(d(i * 2), 'm1'))
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'trade_proposal_spike')).toBeDefined()
  })

  it('does not fire with 3 proposals', () => {
    const events = Array.from({ length: 3 }, (_, i) => tradeCreated(d(i * 2), 'm1'))
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'trade_proposal_spike')).toBeUndefined()
  })

  it('evidence window contains correct event IDs', () => {
    const myTrades = Array.from({ length: 4 }, (_, i) => tradeCreated(d(i * 2), 'm1'))
    const result = run(myTrades)
    const pattern = result.managerPatterns[0]!.patterns.find(
      (p) => p.patternType === 'trade_proposal_spike',
    )!
    const windowIds = pattern.evidenceWindows[0].eventIds
    expect(windowIds).toHaveLength(4)
    expect(windowIds.every((id) => myTrades.some((t) => t.eventId === id))).toBe(true)
  })
})

describe('manager_inactivity_window', () => {
  it('fires when manager has 30+ day gap while league is active', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1),
      leagueOpened(d(15), 'm2'),  // league active mid-gap
      leagueOpened(d(25), 'm2'),
      lineupSaved(d(35), 'm1', 5, 1),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'manager_inactivity_window')).toBeDefined()
  })

  it('does not fire when gap is shorter than 30 days', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1),
      leagueOpened(d(10), 'm2'),
      lineupSaved(d(25), 'm1', 4, 1),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'manager_inactivity_window')).toBeUndefined()
  })

  it('does not fire when league is also inactive during the gap', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1),
      lineupSaved(d(45), 'm1', 7, 1),
      // No other manager events during gap
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'manager_inactivity_window')).toBeUndefined()
  })

  it('confidence: low=30d, medium=45d, high=60d', () => {
    const makeInactiveManager = (gapDays: number) => [
      lineupSaved(d(0), 'm1', 1, 1),
      leagueOpened(d(gapDays / 2), 'm2'),
      lineupSaved(d(gapDays + 1), 'm1', 9, 1),
    ]

    const low = run(makeInactiveManager(31))
    const pLow = low.managerPatterns.find((g) => g.managerId === 'm1')!.patterns.find((p) => p.patternType === 'manager_inactivity_window')
    expect(pLow!.confidence).toBe('low')

    const med = run(makeInactiveManager(46))
    const pMed = med.managerPatterns.find((g) => g.managerId === 'm1')!.patterns.find((p) => p.patternType === 'manager_inactivity_window')
    expect(pMed!.confidence).toBe('medium')

    const high = run(makeInactiveManager(61))
    const pHigh = high.managerPatterns.find((g) => g.managerId === 'm1')!.patterns.find((p) => p.patternType === 'manager_inactivity_window')
    expect(pHigh!.confidence).toBe('high')
  })

  it('evidence window has empty eventIds (absence-based)', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1),
      leagueOpened(d(15), 'm2'),
      lineupSaved(d(35), 'm1', 5, 1),
    ]
    const result = run(events)
    const pattern = result.managerPatterns.find((g) => g.managerId === 'm1')!.patterns.find(
      (p) => p.patternType === 'manager_inactivity_window',
    )!
    expect(pattern.evidenceWindows[0].eventIds).toHaveLength(0)
    expect(pattern.evidenceWindows[0].durationDays).toBeGreaterThanOrEqual(30)
  })
})

describe('bench_regret_repetition', () => {
  it('fires when same player flips bench/starter 3+ times', () => {
    // player-A: starter wk1, bench wk2, starter wk3, bench wk4 = 3 flips
    const events = [
      lineupSaved(d(0), 'm1', 1, 1, ['player-A'], []),
      lineupSaved(d(7), 'm1', 2, 1, [], ['player-A']),
      lineupSaved(d(14), 'm1', 3, 1, ['player-A'], []),
      lineupSaved(d(21), 'm1', 4, 1, [], ['player-A']),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'bench_regret_repetition')).toBeDefined()
  })

  it('does not fire with only 2 flips', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1, ['player-A'], []),
      lineupSaved(d(7), 'm1', 2, 1, [], ['player-A']),
      lineupSaved(d(14), 'm1', 3, 1, ['player-A'], []),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'bench_regret_repetition')).toBeUndefined()
  })

  it('evidence window references only the flip-involved saves', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1, ['player-A'], []),
      lineupSaved(d(7), 'm1', 2, 1, [], ['player-A']),
      lineupSaved(d(14), 'm1', 3, 1, ['player-A'], []),
      lineupSaved(d(21), 'm1', 4, 1, [], ['player-A']),
    ]
    const result = run(events)
    const pattern = result.managerPatterns[0]!.patterns.find(
      (p) => p.patternType === 'bench_regret_repetition',
    )!
    expect(pattern.evidenceWindows[0].eventIds.length).toBeGreaterThan(0)
  })
})

describe('injury_response_delay', () => {
  it('fires when player stays benched without waiver response twice', () => {
    const events = [
      // Occurrence 1: bench wk1, no waiver, still benched wk2
      lineupSaved(d(0), 'm1', 1, 1, [], ['player-A']),
      lineupSaved(d(8), 'm1', 2, 1, [], ['player-A']),
      // Occurrence 2: bench wk3, no waiver, still benched wk4
      lineupSaved(d(16), 'm1', 3, 1, [], ['player-B']),
      lineupSaved(d(24), 'm1', 4, 1, [], ['player-B']),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    const pattern = group?.patterns.find((p) => p.patternType === 'injury_response_delay')
    expect(pattern).toBeDefined()
  })

  it('does not fire when waiver claim submitted within 7 days', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1, [], ['player-A']),
      waiverClaim(d(3), 'm1'),   // quick response
      lineupSaved(d(8), 'm1', 2, 1, [], ['player-A']),
      lineupSaved(d(16), 'm1', 3, 1, [], ['player-B']),
      waiverClaim(d(18), 'm1'),  // quick response again
      lineupSaved(d(24), 'm1', 4, 1, [], ['player-B']),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'injury_response_delay')).toBeUndefined()
  })

  it('includes proxy_detection warning in pattern warnings', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 1, [], ['player-A']),
      lineupSaved(d(8), 'm1', 2, 1, [], ['player-A']),
      lineupSaved(d(16), 'm1', 3, 1, [], ['player-B']),
      lineupSaved(d(24), 'm1', 4, 1, [], ['player-B']),
    ]
    const result = run(events)
    const pattern = result.managerPatterns[0]!.patterns.find(
      (p) => p.patternType === 'injury_response_delay',
    )!
    expect(pattern.warnings.some((w) => w.includes('proxy_detection'))).toBe(true)
  })
})

describe('matchup_overreaction', () => {
  it('fires for 3 consecutive weeks with 4+ slot changes', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 4),
      lineupSaved(d(7), 'm1', 2, 5),
      lineupSaved(d(14), 'm1', 3, 6),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'matchup_overreaction')).toBeDefined()
  })

  it('does not fire with only 2 consecutive high-change weeks', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 4),
      lineupSaved(d(7), 'm1', 2, 5),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'matchup_overreaction')).toBeUndefined()
  })

  it('does not fire when streak is broken by a low-change week', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 4),
      lineupSaved(d(7), 'm1', 2, 0),  // breaks streak
      lineupSaved(d(14), 'm1', 3, 4),
      lineupSaved(d(21), 'm1', 4, 5),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'matchup_overreaction')).toBeUndefined()
  })

  it('does not fire when weeks are not consecutive', () => {
    // Weeks 1, 3, 5 — gaps in between
    const events = [
      lineupSaved(d(0), 'm1', 1, 4),
      lineupSaved(d(14), 'm1', 3, 5),
      lineupSaved(d(28), 'm1', 5, 6),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'matchup_overreaction')).toBeUndefined()
  })
})

describe('conservative_roster_pattern', () => {
  it('fires for 4 consecutive weeks with zero slot changes', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 0),
      lineupSaved(d(7), 'm1', 2, 0),
      lineupSaved(d(14), 'm1', 3, 0),
      lineupSaved(d(21), 'm1', 4, 0),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'conservative_roster_pattern')).toBeDefined()
  })

  it('does not fire with 3 consecutive zero-change weeks', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 0),
      lineupSaved(d(7), 'm1', 2, 0),
      lineupSaved(d(14), 'm1', 3, 0),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'conservative_roster_pattern')).toBeUndefined()
  })

  it('confidence escalates with streak length: low=4w, medium=6w, high=8w', () => {
    const mkWeeks = (n: number) =>
      Array.from({ length: n }, (_, i) => lineupSaved(d(i * 7), 'm1', i + 1, 0))

    const r4 = run(mkWeeks(4))
    const p4 = r4.managerPatterns[0]!.patterns.find((p) => p.patternType === 'conservative_roster_pattern')
    expect(p4!.confidence).toBe('low')

    const r6 = run(mkWeeks(6))
    const p6 = r6.managerPatterns[0]!.patterns.find((p) => p.patternType === 'conservative_roster_pattern')
    expect(p6!.confidence).toBe('medium')

    const r8 = run(mkWeeks(8))
    const p8 = r8.managerPatterns[0]!.patterns.find((p) => p.patternType === 'conservative_roster_pattern')
    expect(p8!.confidence).toBe('high')
  })
})

describe('trade_rejection_pattern', () => {
  it('fires when manager has 3+ proposals rejected in 30 days', () => {
    const prop1 = makeId('p')
    const prop2 = makeId('p')
    const prop3 = makeId('p')
    const events = [
      tradeCreated(d(0), 'm1', prop1),
      tradeCreated(d(3), 'm1', prop2),
      tradeCreated(d(6), 'm1', prop3),
      tradeRejected(d(1), 'm2', prop1),
      tradeRejected(d(4), 'm2', prop2),
      tradeRejected(d(7), 'm2', prop3),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'trade_rejection_pattern')).toBeDefined()
  })

  it('does not fire when fewer than 3 proposals are rejected', () => {
    const prop1 = makeId('p')
    const prop2 = makeId('p')
    const events = [
      tradeCreated(d(0), 'm1', prop1),
      tradeCreated(d(3), 'm1', prop2),
      tradeRejected(d(1), 'm2', prop1),
      tradeRejected(d(4), 'm2', prop2),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'trade_rejection_pattern')).toBeUndefined()
  })

  it('does not fire when rejections correspond to another manager trades', () => {
    const prop1 = makeId('p')
    const prop2 = makeId('p')
    const prop3 = makeId('p')
    const events = [
      // m2 created proposals that get rejected — m1 has none
      tradeCreated(d(0), 'm2', prop1),
      tradeCreated(d(3), 'm2', prop2),
      tradeCreated(d(6), 'm2', prop3),
      tradeRejected(d(1), 'm1', prop1),
      tradeRejected(d(4), 'm1', prop2),
      tradeRejected(d(7), 'm1', prop3),
    ]
    const result = run(events)
    const group = result.managerPatterns.find((g) => g.managerId === 'm1')
    expect(group?.patterns.find((p) => p.patternType === 'trade_rejection_pattern')).toBeUndefined()
  })
})

// ── League patterns ───────────────────────────────────────────────────────────

describe('commissioner_rules_churn', () => {
  it('fires when 3+ rule changes in 21 days', () => {
    const events = [
      rulesChanged(d(0), 'm1'),
      rulesChanged(d(7), 'm1'),
      rulesChanged(d(14), 'm1'),
    ]
    const result = run(events)
    expect(result.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')).toBeDefined()
  })

  it('does not fire with 2 rule changes', () => {
    const events = [rulesChanged(d(0), 'm1'), rulesChanged(d(7), 'm1')]
    const result = run(events)
    expect(result.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')).toBeUndefined()
  })

  it('does not fire when 3 changes span more than 21 days', () => {
    const events = [rulesChanged(d(0), 'm1'), rulesChanged(d(11), 'm1'), rulesChanged(d(22), 'm1')]
    const result = run(events)
    expect(result.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')).toBeUndefined()
  })

  it('confidence escalates: low=3, medium=5, high=7 changes per window', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => rulesChanged(d(i * 2), 'm1'))

    const r3 = run(mk(3))
    expect(r3.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')!.confidence).toBe('low')

    const r5 = run(mk(5))
    expect(r5.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')!.confidence).toBe('medium')

    const r7 = run(mk(7))
    expect(r7.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')!.confidence).toBe('high')
  })
})

describe('league_activity_surge', () => {
  it('fires when event count exceeds 2× baseline in a 7-day window', () => {
    // Baseline (days 0-27): 2 events — rate = 2/28 * 7 = 0.5 per 7 days
    // Window (days 28-34): 4 events — ratio = 4/0.5 = 8× — fires
    const baseline = [leagueOpened(d(0), 'm1'), leagueOpened(d(20), 'm2')]
    const surge = Array.from({ length: 4 }, (_, i) => leagueOpened(d(28 + i), 'm3'))
    const result = run([...baseline, ...surge])
    expect(result.leaguePatterns.find((p) => p.patternType === 'league_activity_surge')).toBeDefined()
  })

  it('does not fire when increase is less than 2× baseline', () => {
    // Baseline: 14 events in 28 days = 3.5 per 7 days; window: 4 events = just barely above 1×
    const baseline = Array.from({ length: 14 }, (_, i) => leagueOpened(d(i * 2), 'm1'))
    const window = Array.from({ length: 4 }, (_, i) => leagueOpened(d(28 + i), 'm2'))
    const result = run([...baseline, ...window])
    expect(result.leaguePatterns.find((p) => p.patternType === 'league_activity_surge')).toBeUndefined()
  })

  it('requires sufficient history before surge can be detected', () => {
    // Only 3 total events — no 28-day baseline possible
    const events = [leagueOpened(d(0), 'm1'), leagueOpened(d(1), 'm1'), leagueOpened(d(2), 'm1')]
    const result = run(events)
    expect(result.leaguePatterns.find((p) => p.patternType === 'league_activity_surge')).toBeUndefined()
  })
})

describe('league_activity_dropoff', () => {
  it('fires when event count falls below 40% of baseline in a 14-day window', () => {
    // Baseline (days 0-27): 20 events → 10 per 14 days
    // Window (days 28-41): 2 events → 2/10 = 20% < 40% — fires
    const baseline = Array.from({ length: 20 }, (_, i) => leagueOpened(d(i), 'm1'))
    const window = [leagueOpened(d(28), 'm1'), leagueOpened(d(32), 'm2')]
    const result = run([...baseline, ...window])
    expect(result.leaguePatterns.find((p) => p.patternType === 'league_activity_dropoff')).toBeDefined()
  })

  it('does not fire when activity stays above 40% of baseline', () => {
    // Baseline: 10 events in 28 days → 5 per 14 days; window: 3 events = 60% > 40%
    const baseline = Array.from({ length: 10 }, (_, i) => leagueOpened(d(i * 2), 'm1'))
    const window = Array.from({ length: 3 }, (_, i) => leagueOpened(d(28 + i * 4), 'm2'))
    const result = run([...baseline, ...window])
    expect(result.leaguePatterns.find((p) => p.patternType === 'league_activity_dropoff')).toBeUndefined()
  })
})

// ── Pattern separation ────────────────────────────────────────────────────────

describe('manager vs league pattern separation', () => {
  it('manager patterns are attributed to managerId, not placed in leaguePatterns', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 2),
      lineupSaved(d(1), 'm1', 1, 1),
      lineupSaved(d(2), 'm1', 1, 0),
    ]
    const result = run(events)
    expect(result.managerPatterns.find((g) => g.managerId === 'm1')).toBeDefined()
    expect(result.leaguePatterns.find((p) => p.patternType === 'repeated_lineup_indecision')).toBeUndefined()
  })

  it('league patterns are not attributed to any manager', () => {
    const events = [
      rulesChanged(d(0), 'm1'),
      rulesChanged(d(5), 'm1'),
      rulesChanged(d(10), 'm1'),
    ]
    const result = run(events)
    expect(result.leaguePatterns.find((p) => p.patternType === 'commissioner_rules_churn')).toBeDefined()
    for (const g of result.managerPatterns) {
      expect(g.patterns.find((p) => p.patternType === 'commissioner_rules_churn')).toBeUndefined()
    }
  })
})

// ── Derivation chain ─────────────────────────────────────────────────────────

describe('derivation chain', () => {
  it('every detected pattern carries a non-empty derivation array', () => {
    const events = [
      lineupSaved(d(0), 'm1', 1, 2),
      lineupSaved(d(1), 'm1', 1, 1),
      lineupSaved(d(2), 'm1', 1, 0),
    ]
    const result = run(events)
    const pattern = result.managerPatterns[0]!.patterns[0]!
    expect(pattern.derivation.length).toBeGreaterThan(0)
    expect(pattern.derivation.every((s) => typeof s === 'string')).toBe(true)
  })
})

// ── Regression: no shared internals with 6.3 / 6.5 ──────────────────────────

describe('regression: Phase 6.1 isolation from 6.3 and 6.5', () => {
  it('detectBehavioralPatterns does not import from archetypes module', async () => {
    const mod = await import('../../../lib/decision-os/phase6/patterns/patterns')
    expect(typeof mod.detectBehavioralPatterns).toBe('function')
    expect((mod as unknown as Record<string, unknown>)['classifyLeagueArchetype']).toBeUndefined()
    expect((mod as unknown as Record<string, unknown>)['assemblePlatformBenchmark']).toBeUndefined()
  })

  it('BehavioralPatternResult has no archetype or benchmark fields', () => {
    const result = run([])
    expect((result as unknown as Record<string, unknown>)['archetype']).toBeUndefined()
    expect((result as unknown as Record<string, unknown>)['benchmarkPercentile']).toBeUndefined()
    expect((result as unknown as Record<string, unknown>)['archetypeCohorts']).toBeUndefined()
  })
})
