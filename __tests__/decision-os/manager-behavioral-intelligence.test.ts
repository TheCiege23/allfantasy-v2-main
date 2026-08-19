/**
 * Phase 5.2 — Manager Behavioral Intelligence tests.
 *
 * Covers:
 *   - Engagement scoring per dimension (lineup / waiver / trade / draft)
 *   - Composite overall score (weighted average)
 *   - Participation tier assignment
 *   - Retention risk levels
 *   - Inactivity signals (daysSinceLastActivity, isInactive, inactivityWarning)
 *   - Commissioner nudges (correct nudge per scenario)
 *   - Missing events / zero-event graceful state
 *   - Data quality (completeness inherited, warnings propagated)
 *   - No mutation invariant (facts and events are never modified)
 *   - derivedAt reflects the injected clock
 */

import { describe, expect, it } from 'vitest'
import type { BehavioralEvent } from '../../lib/decision-os/behavioral/events/types'
import type { ManagerBehavioralFacts } from '../../lib/decision-os/behavioral/facts'
import {
  deriveManagerBehavioralIntelligence,
} from '../../lib/decision-os/behavioral/manager-intelligence'

// ── Fixture helpers ───────────────────────────────────────────────────────────

const MANAGER_ID = 'manager-abc'
const LEAGUE_ID  = 'league-xyz'
const NOW        = new Date('2026-06-30T12:00:00.000Z')

function makeFacts(overrides: Partial<ManagerBehavioralFacts> = {}): ManagerBehavioralFacts {
  return {
    managerId: MANAGER_ID,
    leagueId:  LEAGUE_ID,
    lastLineupSave:           null,
    lastActivity:             null,
    lineupSaveCount:          0,
    tradeProposalCount:       0,
    tradeAcceptedCount:       0,
    tradeRejectedCount:       0,
    waiverClaimCount:         0,
    waiverSuccessCount:       0,
    commissionerActionCount:  0,
    leagueOpenCount:          0,
    liveScoringSessionCount:  0,
    recapViewCount:           0,
    draftPickCount:           0,
    completeness:             0,
    eventCount:               0,
    lookbackDays:             null,
    warnings:                 [],
    ...overrides,
  }
}

function makeLineupSavedEvent(
  managerId: string = MANAGER_ID,
  occurredAt: string = '2026-06-01T12:00:00Z',
  eventId?: string,
): BehavioralEvent {
  return {
    eventId:    eventId ?? `lineup_saved_${occurredAt}`,
    eventType:  'lineup_saved',
    occurredAt,
    recordedAt: occurredAt,
    leagueId:   LEAGUE_ID,
    managerId,
    source:     'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: ['AfRosterMoveHistory'] },
    completeness: 80,
    uncertainty:  { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' },
    metadata: {
      week: 1, season: 2026, leagueType: 'redraft',
      slotChanges: 2, startedPlayerIds: [], benchedPlayerIds: [],
    },
  }
}

function makeWaiverEvent(
  managerId: string = MANAGER_ID,
  occurredAt: string = '2026-06-05T08:00:00Z',
): BehavioralEvent {
  return {
    eventId:    `waiver_claim_created_${occurredAt}`,
    eventType:  'waiver_claim_created',
    occurredAt,
    recordedAt: occurredAt,
    leagueId:   LEAGUE_ID,
    managerId,
    source:     'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: ['WaiverClaim'] },
    completeness: 70,
    uncertainty:  { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' },
    metadata: {
      claimId: 'claim-1', addPlayerId: 'player-1', addPlayerName: null,
      dropPlayerId: null, dropPlayerName: null, bidAmount: 25, priority: null,
      waiverType: 'faab',
    },
  }
}

function makeTradeEvent(
  managerId: string = MANAGER_ID,
  occurredAt: string = '2026-06-10T14:00:00Z',
): BehavioralEvent {
  return {
    eventId:    `trade_created_${occurredAt}`,
    eventType:  'trade_created',
    occurredAt,
    recordedAt: occurredAt,
    leagueId:   LEAGUE_ID,
    managerId,
    source:     'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: ['AfLeagueTrade'] },
    completeness: 90,
    uncertainty:  { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' },
    metadata: {
      proposalId: 'trade-1', proposerRosterId: 'roster-1', receiverRosterId: 'roster-2',
      assetCount: 3, vetoMode: 'commissioner', expiresAt: null,
    },
  }
}

function makeDraftPickEvent(
  managerId: string = MANAGER_ID,
  occurredAt: string = '2026-05-01T10:00:00Z',
): BehavioralEvent {
  return {
    eventId:    `draft_pick_${occurredAt}`,
    eventType:  'draft_pick_made',
    occurredAt,
    recordedAt: occurredAt,
    leagueId:   LEAGUE_ID,
    managerId,
    source:     'api',
    provenance: { provider: null, sourceId: null, importedAt: null, derivedFrom: ['DraftPick'] },
    completeness: 90,
    uncertainty:  { sources: [], timestampConfidence: 'exact', actorConfidence: 'confirmed' },
    metadata: {
      draftId: 'draft-1', pickNumber: 3, overallPick: 3, round: 1,
      playerId: 'player-5', playerName: 'Test Player', position: 'RB', team: 'KC',
    },
  }
}

// ── Zero-event state ──────────────────────────────────────────────────────────

describe('missing events — graceful zero state', () => {
  const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)

  it('returns managerId and leagueId from facts', () => {
    expect(intel.managerId).toBe(MANAGER_ID)
    expect(intel.leagueId).toBe(LEAGUE_ID)
  })

  it('all dimension scores are 0', () => {
    expect(intel.lineupEngagement.score).toBe(0)
    expect(intel.waiverEngagement.score).toBe(0)
    expect(intel.tradeEngagement.score).toBe(0)
    expect(intel.draftEngagement.score).toBe(0)
    expect(intel.overallEngagementScore).toBe(0)
  })

  it('all dimension levels are none', () => {
    expect(intel.lineupEngagement.level).toBe('none')
    expect(intel.waiverEngagement.level).toBe('none')
    expect(intel.tradeEngagement.level).toBe('none')
    expect(intel.draftEngagement.level).toBe('none')
  })

  it('all dimension lastEventAt are null', () => {
    expect(intel.lineupEngagement.lastEventAt).toBeNull()
    expect(intel.waiverEngagement.lastEventAt).toBeNull()
    expect(intel.tradeEngagement.lastEventAt).toBeNull()
    expect(intel.draftEngagement.lastEventAt).toBeNull()
  })

  it('participationTier is inactive', () => {
    expect(intel.participationTier).toBe('inactive')
  })

  // Phase 36: this fixture has an empty `events` array — i.e. the LEAGUE itself has zero
  // recorded activity for any manager, not just this one. That is a data-coverage gap,
  // not confirmed disengagement, so this must be insufficient_data, not critical.
  it('retentionRisk is insufficient_data (league-wide zero events, not confirmed inactivity)', () => {
    expect(intel.retentionRisk).toBe('insufficient_data')
    expect(intel.retentionRiskReasons.length).toBeGreaterThan(0)
    expect(intel.retentionRiskReasons[0]).not.toContain('has never taken any recorded action')
  })

  it('daysSinceLastActivity is null, isInactive is true', () => {
    expect(intel.daysSinceLastActivity).toBeNull()
    expect(intel.isInactive).toBe(true)
  })

  it('inactivityWarning mentions no recorded activity', () => {
    expect(intel.inactivityWarning).toContain('No recorded manager activity')
  })

  it('emits nudge_never_engaged as critical', () => {
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_never_engaged')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('critical')
    expect(nudge!.category).toBe('retention')
  })

  it('completeness and derivedFrom are 0', () => {
    expect(intel.completeness).toBe(0)
    expect(intel.derivedFrom).toBe(0)
  })

  it('no_draft_pick_events warning is present', () => {
    expect(intel.warnings).toContain('no_draft_pick_events')
  })
})

// ── Lineup engagement scoring ─────────────────────────────────────────────────

describe('engagement scoring — lineup', () => {
  it('0 saves → score 0, level none', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 0 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(0)
    expect(intel.lineupEngagement.level).toBe('none')
  })

  it('1 save → score 40, level low', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 1, eventCount: 1 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(40)
    expect(intel.lineupEngagement.level).toBe('low')
  })

  it('2 saves → score 40, level low', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 2, eventCount: 2 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(40)
    expect(intel.lineupEngagement.level).toBe('low')
  })

  it('3 saves → score 65, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 3, eventCount: 3 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(65)
    expect(intel.lineupEngagement.level).toBe('moderate')
  })

  it('5 saves → score 65, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 5, eventCount: 5 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(65)
    expect(intel.lineupEngagement.level).toBe('moderate')
  })

  it('6 saves → score 80, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 6, eventCount: 6 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(80)
    expect(intel.lineupEngagement.level).toBe('high')
  })

  it('10 saves → score 95, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 10, eventCount: 10 }), [], NOW)
    expect(intel.lineupEngagement.score).toBe(95)
    expect(intel.lineupEngagement.level).toBe('high')
  })

  it('eventCount reflects lineupSaveCount', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ lineupSaveCount: 4, eventCount: 4 }), [], NOW)
    expect(intel.lineupEngagement.eventCount).toBe(4)
  })

  it('lastEventAt populated from facts.lastLineupSave', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-20T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 3, eventCount: 3, lastLineupSave: ev, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.lineupEngagement.lastEventAt).toBe('2026-06-20T10:00:00Z')
  })

  it('lastEventAt falls back to raw events when facts.lastLineupSave is null', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-18T09:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastLineupSave: null, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.lineupEngagement.lastEventAt).toBe('2026-06-18T09:00:00Z')
  })
})

// ── Waiver engagement scoring ─────────────────────────────────────────────────

describe('engagement scoring — waiver', () => {
  it('0 claims → score 0, level none', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ waiverClaimCount: 0 }), [], NOW)
    expect(intel.waiverEngagement.score).toBe(0)
    expect(intel.waiverEngagement.level).toBe('none')
  })

  it('1 claim → score 30, level low', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 1, eventCount: 1 }), [], NOW,
    )
    expect(intel.waiverEngagement.score).toBe(30)
    expect(intel.waiverEngagement.level).toBe('low')
  })

  it('2 claims → score 55, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 2, eventCount: 2 }), [], NOW,
    )
    expect(intel.waiverEngagement.score).toBe(55)
    expect(intel.waiverEngagement.level).toBe('moderate')
  })

  it('5 claims → score 75, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 5, eventCount: 5 }), [], NOW,
    )
    expect(intel.waiverEngagement.score).toBe(75)
    expect(intel.waiverEngagement.level).toBe('high')
  })

  it('10 claims → score 90, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 10, eventCount: 10 }), [], NOW,
    )
    expect(intel.waiverEngagement.score).toBe(90)
    expect(intel.waiverEngagement.level).toBe('high')
  })

  it('waiverSuccessCount > 0 adds 5 bonus points', () => {
    const baseIntel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 1, waiverSuccessCount: 0, eventCount: 1 }), [], NOW,
    )
    const bonusIntel = deriveManagerBehavioralIntelligence(
      makeFacts({ waiverClaimCount: 1, waiverSuccessCount: 1, eventCount: 2 }), [], NOW,
    )
    expect(bonusIntel.waiverEngagement.score).toBe(baseIntel.waiverEngagement.score + 5)
  })

  it('lastEventAt populated from events filtered by managerId', () => {
    const ev1 = makeWaiverEvent(MANAGER_ID, '2026-06-15T10:00:00Z')
    const ev2 = makeWaiverEvent(MANAGER_ID, '2026-06-20T10:00:00Z')
    const other = makeWaiverEvent('other-manager', '2026-06-25T10:00:00Z')
    const facts = makeFacts({ waiverClaimCount: 2, eventCount: 2, lastActivity: ev2 })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev1, ev2, other], NOW)
    expect(intel.waiverEngagement.lastEventAt).toBe('2026-06-20T10:00:00Z')
  })
})

// ── Trade engagement scoring ──────────────────────────────────────────────────

describe('engagement scoring — trade', () => {
  it('0 proposals → score 0, level none', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ tradeProposalCount: 0 }), [], NOW)
    expect(intel.tradeEngagement.score).toBe(0)
    expect(intel.tradeEngagement.level).toBe('none')
  })

  it('1 proposal → score 40, level low', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ tradeProposalCount: 1, eventCount: 1 }), [], NOW,
    )
    expect(intel.tradeEngagement.score).toBe(40)
    expect(intel.tradeEngagement.level).toBe('low')
  })

  it('2 proposals → score 65, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ tradeProposalCount: 2, eventCount: 2 }), [], NOW,
    )
    expect(intel.tradeEngagement.score).toBe(65)
    expect(intel.tradeEngagement.level).toBe('moderate')
  })

  it('4+ proposals → score 85, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ tradeProposalCount: 4, eventCount: 4 }), [], NOW,
    )
    expect(intel.tradeEngagement.score).toBe(85)
    expect(intel.tradeEngagement.level).toBe('high')
  })

  it('tradeAcceptedCount > 0 adds 5 bonus points', () => {
    const base = deriveManagerBehavioralIntelligence(
      makeFacts({ tradeProposalCount: 1, tradeAcceptedCount: 0, eventCount: 1 }), [], NOW,
    )
    const bonus = deriveManagerBehavioralIntelligence(
      makeFacts({ tradeProposalCount: 1, tradeAcceptedCount: 1, eventCount: 2 }), [], NOW,
    )
    expect(bonus.tradeEngagement.score).toBe(base.tradeEngagement.score + 5)
  })

  it('only trade_created events are attributed (accepted/rejected have null managerId)', () => {
    const proposal = makeTradeEvent(MANAGER_ID, '2026-06-10T14:00:00Z')
    const facts = makeFacts({ tradeProposalCount: 1, eventCount: 1, lastActivity: proposal })
    const intel = deriveManagerBehavioralIntelligence(facts, [proposal], NOW)
    expect(intel.tradeEngagement.lastEventAt).toBe('2026-06-10T14:00:00Z')
  })
})

// ── Draft engagement scoring ──────────────────────────────────────────────────

describe('engagement scoring — draft', () => {
  it('0 picks → score 0, level none', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts({ draftPickCount: 0 }), [], NOW)
    expect(intel.draftEngagement.score).toBe(0)
    expect(intel.draftEngagement.level).toBe('none')
  })

  it('1 pick → score 50, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ draftPickCount: 1, eventCount: 1 }), [], NOW,
    )
    expect(intel.draftEngagement.score).toBe(50)
    expect(intel.draftEngagement.level).toBe('moderate')
  })

  it('5 picks → score 50, level moderate', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ draftPickCount: 5, eventCount: 5 }), [], NOW,
    )
    expect(intel.draftEngagement.score).toBe(50)
    expect(intel.draftEngagement.level).toBe('moderate')
  })

  it('6 picks → score 75, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ draftPickCount: 6, eventCount: 6 }), [], NOW,
    )
    expect(intel.draftEngagement.score).toBe(75)
    expect(intel.draftEngagement.level).toBe('high')
  })

  it('13+ picks → score 90, level high', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ draftPickCount: 14, eventCount: 14 }), [], NOW,
    )
    expect(intel.draftEngagement.score).toBe(90)
    expect(intel.draftEngagement.level).toBe('high')
  })
})

// ── Composite overall score ───────────────────────────────────────────────────

describe('overall composite score', () => {
  it('all-zero facts → overall score 0', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    expect(intel.overallEngagementScore).toBe(0)
  })

  it('lineup-only (6 saves, nothing else) → 80 × 0.40 = 32', () => {
    const intel = deriveManagerBehavioralIntelligence(
      makeFacts({ lineupSaveCount: 6, eventCount: 6 }), [], NOW,
    )
    // lineup: 80, waiver: 0, trade: 0, draft: 0
    // overall: 80*0.4 + 0 + 0 + 0 = 32
    expect(intel.overallEngagementScore).toBe(32)
  })

  it('mixed engagement computes weighted average correctly', () => {
    // lineup: 8 saves → 80, waiver: 6 claims → 75+5=80 (1 success), trade: 3 proposals → 65, draft: 8 picks → 75
    // overall: 80*0.4 + 80*0.25 + 65*0.25 + 75*0.1 = 32 + 20 + 16.25 + 7.5 = 75.75 → 76
    const facts = makeFacts({
      lineupSaveCount:    8,
      waiverClaimCount:   6,
      waiverSuccessCount: 1,
      tradeProposalCount: 3,
      draftPickCount:     8,
      eventCount:         18,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel.overallEngagementScore).toBe(76)
  })

  it('overall score is clamped to 100', () => {
    const facts = makeFacts({
      lineupSaveCount:    20,
      waiverClaimCount:   20,
      waiverSuccessCount: 5,
      tradeProposalCount: 10,
      tradeAcceptedCount: 3,
      draftPickCount:     20,
      eventCount:         55,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel.overallEngagementScore).toBeLessThanOrEqual(100)
    expect(intel.overallEngagementScore).toBeGreaterThan(90)
  })
})

// ── Participation tier ────────────────────────────────────────────────────────

describe('participation tier', () => {
  it('no events → inactive', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    expect(intel.participationTier).toBe('inactive')
  })

  it('low engagement → passive', () => {
    // lineup:1=40, waiver:0, trade:0, draft:0 → overall: 40*0.4=16 → passive
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1 })
    // Recent activity to avoid isInactive, but tier doesn't depend on inactivity now
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const intelFacts = { ...facts, lastActivity: ev }
    const intel = deriveManagerBehavioralIntelligence(intelFacts, [ev], NOW)
    expect(intel.participationTier).toBe('passive')
    expect(intel.overallEngagementScore).toBe(16)
  })

  it('moderate engagement → moderate', () => {
    // lineup:3=65 → overall: 65*0.4=26 → moderate
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 3, eventCount: 3, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.participationTier).toBe('moderate')
    expect(intel.overallEngagementScore).toBe(26)
  })

  it('active engagement (score≥45 with lineup save) → active', () => {
    // lineup:6=80, waiver:3=55, overall: 80*0.4+55*0.25=32+13.75=45.75→46 → active
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({
      lineupSaveCount:  6,
      waiverClaimCount: 3,
      eventCount:       9,
      lastActivity:     ev,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.participationTier).toBe('active')
    expect(intel.overallEngagementScore).toBeGreaterThanOrEqual(45)
  })

  it('elite engagement → elite (score≥70, lineupSaves≥3, trades+waivers≥2)', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({
      lineupSaveCount:    8,
      waiverClaimCount:   5,
      waiverSuccessCount: 2,
      tradeProposalCount: 3,
      draftPickCount:     10,
      eventCount:         26,
      lastActivity:       ev,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.participationTier).toBe('elite')
    expect(intel.overallEngagementScore).toBeGreaterThanOrEqual(70)
  })
})

// ── Inactivity signals ────────────────────────────────────────────────────────

describe('manager inactivity signals', () => {
  it('no events → daysSinceLastActivity null, isInactive true', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    expect(intel.daysSinceLastActivity).toBeNull()
    expect(intel.isInactive).toBe(true)
  })

  it('activity 5 days ago → not inactive, no inactivity warning', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-25T12:00:00Z')  // 5 days before NOW
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastLineupSave: ev, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.daysSinceLastActivity).toBe(5)
    expect(intel.isInactive).toBe(false)
    expect(intel.inactivityWarning).toBeNull()
    expect(intel.nudges.find((n) => n.nudgeId === 'nudge_inactive_7d')).toBeUndefined()
  })

  it('activity 8 days ago → not inactive, but 7d nudge fires', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-22T12:00:00Z')  // 8 days before NOW
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.daysSinceLastActivity).toBe(8)
    expect(intel.isInactive).toBe(false)
    expect(intel.nudges.find((n) => n.nudgeId === 'nudge_inactive_7d')).toBeDefined()
  })

  it('activity 15 days ago → isInactive true, 14d nudge fires', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-15T12:00:00Z')  // 15 days before NOW
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.daysSinceLastActivity).toBe(15)
    expect(intel.isInactive).toBe(true)
    expect(intel.inactivityWarning).toContain('2 weeks')
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_inactive_14d')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('high')
    expect(nudge!.supportingEventIds).toContain(ev.eventId)
  })

  it('activity 29 days ago → critical retention risk, 28d nudge fires', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-01T12:00:00Z')  // 29 days before NOW
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.daysSinceLastActivity).toBe(29)
    expect(intel.retentionRisk).toBe('critical')
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_inactive_28d')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('critical')
    expect(intel.nudges.find((n) => n.nudgeId === 'nudge_inactive_14d')).toBeUndefined()
  })

  it('inactivity nudges are mutually exclusive (most severe wins)', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-05-01T12:00:00Z')  // 60 days ago
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    const inactivityNudges = intel.nudges.filter((n) =>
      ['nudge_inactive_7d', 'nudge_inactive_14d', 'nudge_inactive_28d'].includes(n.nudgeId),
    )
    // Only the 28d nudge should fire, not 14d or 7d
    expect(inactivityNudges).toHaveLength(1)
    expect(inactivityNudges[0].nudgeId).toBe('nudge_inactive_28d')
  })
})

// ── Retention risk ────────────────────────────────────────────────────────────

describe('retention risk', () => {
  it('no events anywhere in the league → insufficient_data, not critical (Phase 36)', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    expect(intel.retentionRisk).toBe('insufficient_data')
    expect(intel.retentionRiskReasons[0]).toContain('cannot be assessed')
  })

  // Phase 36: real, relative evidence — OTHER managers in this league DO have recorded
  // activity, but this manager has none. This is genuine negative evidence, not a data gap.
  it('no events for this manager, but the league has real activity from others → critical', () => {
    const otherManagerEvent = makeLineupSavedEvent('other-manager', '2026-06-20T10:00:00Z')
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [otherManagerEvent], NOW)
    expect(intel.retentionRisk).toBe('critical')
    expect(intel.retentionRiskReasons).toContain(
      'Manager has never taken any recorded action in the league',
    )
  })

  it('is deterministic: identical inputs always produce the same retention risk', () => {
    const otherManagerEvent = makeLineupSavedEvent('other-manager', '2026-06-20T10:00:00Z')
    const run1 = deriveManagerBehavioralIntelligence(makeFacts(), [otherManagerEvent], NOW)
    const run2 = deriveManagerBehavioralIntelligence(makeFacts(), [otherManagerEvent], NOW)
    expect(run1.retentionRisk).toBe(run2.retentionRisk)
    expect(run1.retentionRiskReasons).toEqual(run2.retentionRiskReasons)
  })

  it('events but no lineup saves → high risk', () => {
    const ev = makeWaiverEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const facts = makeFacts({ waiverClaimCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.retentionRisk).toBe('high')
    expect(intel.retentionRiskReasons).toContain('Manager has not set their lineup this season')
  })

  it('inactive 15+ days with lineup saves → high risk from inactivity', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-15T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 3, eventCount: 3, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.retentionRisk).toBe('high')
    expect(intel.retentionRiskReasons.some((r) => r.includes('inactive'))).toBe(true)
  })

  it('passive tier with recent activity → medium risk', () => {
    // lineup:1 → score 16 → passive; activity 3 days ago → not inactive
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-27T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.participationTier).toBe('passive')
    expect(intel.retentionRisk).toBe('medium')
  })

  it('active/moderate/elite managers → low risk', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({
      lineupSaveCount:  6,
      waiverClaimCount: 3,
      eventCount:       9,
      lastActivity:     ev,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.retentionRisk).toBe('low')
    expect(intel.retentionRiskReasons).toHaveLength(0)
  })
})

// ── Nudges ────────────────────────────────────────────────────────────────────

describe('commissioner nudges', () => {
  it('no_lineup_saves nudge fires when events exist but no lineup saves', () => {
    const ev = makeWaiverEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const facts = makeFacts({ waiverClaimCount: 2, eventCount: 2, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_no_lineup_saves')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('high')
    expect(nudge!.category).toBe('roster')
  })

  it('no_waiver_activity nudge fires when events exist but no waiver claims', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 3, eventCount: 3, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_no_waiver_activity')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('medium')
    expect(nudge!.category).toBe('transaction')
  })

  it('no_trade_activity nudge fires when events exist but no trade proposals', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 3, waiverClaimCount: 2, eventCount: 5, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    const nudge = intel.nudges.find((n) => n.nudgeId === 'nudge_no_trade_activity')
    expect(nudge).toBeDefined()
    expect(nudge!.priority).toBe('low')
  })

  it('fully engaged manager produces zero nudges', () => {
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({
      lineupSaveCount:    8,
      waiverClaimCount:   5,
      waiverSuccessCount: 2,
      tradeProposalCount: 3,
      draftPickCount:     10,
      eventCount:         26,
      lastActivity:       ev,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.nudges).toHaveLength(0)
  })

  it('nudge messages are customer-facing (no internal terminology)', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    for (const nudge of intel.nudges) {
      expect(nudge.message).not.toContain('Canonical World')
      expect(nudge.message).not.toContain('Decision OS')
      expect(nudge.message).not.toContain('shadow')
      expect(nudge.message).not.toContain('parity')
      expect(nudge.message).not.toContain('BehavioralEvent')
      expect(nudge.message).not.toContain('managerId')
    }
  })

  it('nudge_never_engaged does not co-fire with engagement nudges', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    // never_engaged is the only nudge when eventCount=0
    expect(intel.nudges).toHaveLength(1)
    expect(intel.nudges[0].nudgeId).toBe('nudge_never_engaged')
  })
})

// ── Data quality — completeness and warnings ──────────────────────────────────

describe('data quality — completeness and warnings', () => {
  it('completeness is inherited from facts', () => {
    const facts = makeFacts({ completeness: 72, eventCount: 5 })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel.completeness).toBe(72)
  })

  it('derivedFrom reflects facts.eventCount', () => {
    const facts = makeFacts({ eventCount: 13 })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel.derivedFrom).toBe(13)
  })

  it('lookbackDays is inherited from facts', () => {
    const facts = makeFacts({ lookbackDays: 90, eventCount: 5 })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel.lookbackDays).toBe(90)
  })

  it('warnings from facts are propagated', () => {
    const facts = makeFacts({ warnings: ['some_upstream_warning'], eventCount: 3, lineupSaveCount: 3 })
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const intelFacts = { ...facts, lastActivity: ev, waiverClaimCount: 0, tradeProposalCount: 0 }
    const intel = deriveManagerBehavioralIntelligence(intelFacts, [ev], NOW)
    expect(intel.warnings).toContain('some_upstream_warning')
  })

  it('missing dimension events add warnings', () => {
    const ev = makeWaiverEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const facts = makeFacts({ waiverClaimCount: 2, eventCount: 2, lastActivity: ev })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.warnings).toContain('no_lineup_save_events')
    expect(intel.warnings).toContain('no_trade_proposal_events')
    expect(intel.warnings).toContain('no_draft_pick_events')
    expect(intel.warnings).not.toContain('no_waiver_claim_events')
  })

  it('no_draft_pick_events always present when draftPickCount = 0', () => {
    // Even for a fully active manager who hasn't drafted
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-29T10:00:00Z')
    const facts = makeFacts({
      lineupSaveCount:    8,
      waiverClaimCount:   5,
      tradeProposalCount: 3,
      draftPickCount:     0,
      eventCount:         16,
      lastActivity:       ev,
    })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev], NOW)
    expect(intel.warnings).toContain('no_draft_pick_events')
  })

  it('derivedAt matches the injected clock', () => {
    const intel = deriveManagerBehavioralIntelligence(makeFacts(), [], NOW)
    expect(intel.derivedAt).toBe(NOW.toISOString())
  })
})

// ── No mutation invariant ─────────────────────────────────────────────────────

describe('no mutation invariant', () => {
  it('facts object is not mutated', () => {
    const facts = makeFacts({
      lineupSaveCount: 5,
      waiverClaimCount: 3,
      eventCount: 8,
      warnings: ['upstream_warning'],
    })
    const factsBefore = JSON.stringify(facts)
    deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(JSON.stringify(facts)).toBe(factsBefore)
  })

  it('events array is not mutated', () => {
    const events: BehavioralEvent[] = [
      makeLineupSavedEvent(MANAGER_ID, '2026-06-10T10:00:00Z'),
      makeWaiverEvent(MANAGER_ID, '2026-06-15T10:00:00Z'),
    ]
    const eventsBefore = JSON.stringify(events)
    const facts = makeFacts({ lineupSaveCount: 1, waiverClaimCount: 1, eventCount: 2 })
    deriveManagerBehavioralIntelligence(facts, events, NOW)
    expect(JSON.stringify(events)).toBe(eventsBefore)
  })

  it('returned intelligence is a new object (not the facts reference)', () => {
    const facts = makeFacts({ lineupSaveCount: 3, eventCount: 3 })
    const intel = deriveManagerBehavioralIntelligence(facts, [], NOW)
    expect(intel).not.toBe(facts)
    expect(intel.warnings).not.toBe(facts.warnings)
  })

  it('nudges and warnings arrays are independent between calls', () => {
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1 })
    const ev = makeLineupSavedEvent(MANAGER_ID, '2026-06-28T10:00:00Z')
    const intelFacts = { ...facts, lastActivity: ev }
    const intel1 = deriveManagerBehavioralIntelligence(intelFacts, [ev], NOW)
    const intel2 = deriveManagerBehavioralIntelligence(intelFacts, [ev], NOW)
    expect(intel1.nudges).not.toBe(intel2.nudges)
    expect(intel1.warnings).not.toBe(intel2.warnings)
  })
})

// ── Events filtered to managerId ──────────────────────────────────────────────

describe('event filtering by managerId', () => {
  it('ignores events belonging to other managers', () => {
    const myEvent    = makeLineupSavedEvent(MANAGER_ID,   '2026-06-29T10:00:00Z')
    const otherEvent = makeLineupSavedEvent('other-manager', '2026-06-28T10:00:00Z')
    const facts = makeFacts({ lineupSaveCount: 1, eventCount: 1, lastActivity: myEvent })
    const intel = deriveManagerBehavioralIntelligence(facts, [myEvent, otherEvent], NOW)
    // lastEventAt should only reflect myEvent, not otherEvent
    expect(intel.lineupEngagement.lastEventAt).toBe('2026-06-29T10:00:00Z')
  })

  it('picks the most recent when multiple events for the same manager', () => {
    const ev1 = makeWaiverEvent(MANAGER_ID, '2026-06-01T10:00:00Z')
    const ev2 = makeWaiverEvent(MANAGER_ID, '2026-06-20T10:00:00Z')
    const ev3 = makeWaiverEvent(MANAGER_ID, '2026-06-15T10:00:00Z')
    const facts = makeFacts({ waiverClaimCount: 3, eventCount: 3, lastActivity: ev2 })
    const intel = deriveManagerBehavioralIntelligence(facts, [ev1, ev2, ev3], NOW)
    expect(intel.waiverEngagement.lastEventAt).toBe('2026-06-20T10:00:00Z')
  })
})
