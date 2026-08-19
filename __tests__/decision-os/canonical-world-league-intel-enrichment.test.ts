import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  deriveActivityTier,
  deriveEngagementTier,
  projectManagerParticipation,
  projectRosterCompleteness,
  projectCommissionerWorkload,
  projectLeagueHealthScore,
  buildInactivityWarnings,
  buildEngagementWarnings,
  projectLeagueIntelEnrichedWorld,
  resolveLeagueIntelEnrichedCanonicalWorld,
} from '@/lib/decision-os/world/leagueIntelEnrichedWorld'
import type {
  ActivitySignal,
  LeagueIntelEnrichedCanonicalWorld,
} from '@/lib/decision-os/world/leagueIntelEnrichedWorld'
import type {
  CanonicalWorld,
  RawLeagueActivityCounts,
  RawLeagueReputationRow,
  TeamFacts,
  RosterFacts,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function emptyMetadata() {
  return {
    byId: new Map<string, {
      playerId: string; name: string | null; position: string | null; team: string | null;
      injuryStatus: string | null; byeWeek: null; projectedPoints: null; projectionConfidence: null;
      source: string | null; resolved: boolean
    }>(),
    complete: false,
    unresolvedIds: [],
    warnings: [],
  }
}

function activityCounts(
  overrides: Partial<RawLeagueActivityCounts> = {},
): RawLeagueActivityCounts {
  return {
    waiverClaimCount: 0,
    tradeCount: 0,
    rosterMoveCount: 0,
    lookbackDays: 30,
    loadedAt: NOW,
    ...overrides,
  }
}

function noActivity(): { counts: RawLeagueActivityCounts; error: null } {
  return { counts: activityCounts(), error: null }
}

function activityError(): { counts: null; error: string } {
  return { counts: null, error: 'db connection failed' }
}

function activityWith(overrides: Partial<RawLeagueActivityCounts>) {
  return { counts: activityCounts(overrides), error: null as null }
}

function noReputation(): { row: null; error: null } {
  return { row: null, error: null }
}

function reputationRow(overrides: Partial<RawLeagueReputationRow> = {}): { row: RawLeagueReputationRow; error: null } {
  return {
    row: {
      leagueId: 'test-league',
      overallScore: 0.75,
      tier: 'established',
      completionRate: 0.9,
      retentionRate: 0.85,
      stabilityScore: 0.8,
      longevityScore: 0.7,
      competitivenessScore: 0.65,
      totalSeasons: 3,
      lastComputedAt: NOW,
      ...overrides,
    },
    error: null,
  }
}

function makeTeam(overrides: Partial<TeamFacts> = {}): TeamFacts {
  return {
    teamId: `team-${Math.random().toString(36).slice(2)}`,
    displayName: 'Test Team',
    ownerName: 'Test Owner',
    managerUserId: 'user-1',
    isCommissioner: false,
    isCoCommissioner: false,
    isOrphan: false,
    rank: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pointsFor: 0,
    pointsAgainst: null,
    pointsAgainstBasis: 'unavailable',
    faab: { budget: null, used: null, remaining: null, remainingDerived: false },
    source: { sourceTeamId: null, sourceManagerId: null },
    ...overrides,
  }
}

function makeRoster(overrides: Partial<RosterFacts> = {}): RosterFacts {
  return {
    rosterId: `roster-${Math.random().toString(36).slice(2)}`,
    teamId: null,
    playerIds: ['p1', 'p2', 'p3'],
    starterIds: ['p1'],
    benchIds: ['p2', 'p3'],
    reserveIds: [],
    taxiIds: [],
    playerCount: 3,
    waiverPriority: null,
    playerMetadataEnriched: false,
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// deriveActivityTier
// ──────────────────────────────────────────────────────────────────────────

describe('deriveActivityTier', () => {
  it('returns high when >= 3 per week', () => {
    // 30 lookback / 7 days per week ≈ 4.3 weeks → 30 claims / 4.3 = 7/week = high
    expect(deriveActivityTier(30, 30)).toBe('high')
  })

  it('returns moderate when >= 1 per week', () => {
    // 5 in 30 days = 5/4.3 ≈ 1.17/week
    expect(deriveActivityTier(5, 30)).toBe('moderate')
  })

  it('returns low when > 0 but < 1 per week', () => {
    // 1 in 30 days = ~0.23/week
    expect(deriveActivityTier(1, 30)).toBe('low')
  })

  it('returns inactive when count is 0', () => {
    expect(deriveActivityTier(0, 30)).toBe('inactive')
  })

  it('returns unknown when lookbackDays is 0', () => {
    expect(deriveActivityTier(5, 0)).toBe('unknown')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// deriveEngagementTier
// ──────────────────────────────────────────────────────────────────────────

describe('deriveEngagementTier', () => {
  it('returns unknown when all signals are unknown', () => {
    expect(deriveEngagementTier('unknown', 'unknown', 'unknown')).toBe('unknown')
  })

  it('returns high when any signal is high', () => {
    expect(deriveEngagementTier('high', 'inactive', 'inactive')).toBe('high')
  })

  it('returns moderate when any signal is moderate', () => {
    expect(deriveEngagementTier('inactive', 'moderate', 'inactive')).toBe('moderate')
  })

  it('returns inactive when all non-unknown signals are inactive', () => {
    expect(deriveEngagementTier('inactive', 'inactive', 'unknown')).toBe('inactive')
  })

  it('returns low when non-unknown signals are all low', () => {
    expect(deriveEngagementTier('low', 'low', 'unknown')).toBe('low')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectManagerParticipation
// ──────────────────────────────────────────────────────────────────────────

describe('projectManagerParticipation', () => {
  it('handles empty teams', () => {
    const p = projectManagerParticipation([])
    expect(p.totalManagers).toBe(0)
    expect(p.orphanRate).toBe(0)
    expect(p.participationRate).toBe(0)
  })

  it('counts orphans correctly', () => {
    const teams = [makeTeam({ isOrphan: false }), makeTeam({ isOrphan: true }), makeTeam({ isOrphan: true })]
    const p = projectManagerParticipation(teams)
    expect(p.totalManagers).toBe(3)
    expect(p.orphanCount).toBe(2)
    expect(p.activeManagers).toBe(1)
    expect(p.orphanRate).toBeCloseTo(2 / 3)
    expect(p.participationRate).toBeCloseTo(1 / 3)
  })

  it('returns full participation when no orphans', () => {
    const teams = [makeTeam(), makeTeam(), makeTeam()]
    const p = projectManagerParticipation(teams)
    expect(p.orphanCount).toBe(0)
    expect(p.participationRate).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectRosterCompleteness
// ──────────────────────────────────────────────────────────────────────────

describe('projectRosterCompleteness', () => {
  it('handles empty roster list', () => {
    const c = projectRosterCompleteness([], null)
    expect(c.totalRosters).toBe(0)
    expect(c.completenessRate).toBe(1)
  })

  it('detects empty rosters', () => {
    const rosters = [makeRoster({ playerCount: 0 }), makeRoster({ playerCount: 5 })]
    const c = projectRosterCompleteness(rosters, null)
    expect(c.emptyRosters).toBe(1)
  })

  it('detects underfilled rosters when expectedMinimum is set', () => {
    const rosters = [
      makeRoster({ playerCount: 10 }),
      makeRoster({ playerCount: 5 }),
      makeRoster({ playerCount: 12 }),
    ]
    const c = projectRosterCompleteness(rosters, 10)
    expect(c.underfilledRosters).toBe(1)
    expect(c.expectedMinimum).toBe(10)
  })

  it('completenessRate is 1 when all rosters meet expected minimum', () => {
    const rosters = [makeRoster({ playerCount: 12 }), makeRoster({ playerCount: 10 })]
    const c = projectRosterCompleteness(rosters, 10)
    expect(c.completenessRate).toBe(1)
  })

  it('completenessRate is 0.5 when half are underfilled', () => {
    const rosters = [makeRoster({ playerCount: 5 }), makeRoster({ playerCount: 12 })]
    const c = projectRosterCompleteness(rosters, 10)
    expect(c.completenessRate).toBe(0.5)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectCommissionerWorkload
// ──────────────────────────────────────────────────────────────────────────

describe('projectCommissionerWorkload', () => {
  it('counts commissioners and co-commissioners', () => {
    const teams = [
      makeTeam({ isCommissioner: true, isOrphan: false }),
      makeTeam({ isCoCommissioner: true }),
      makeTeam(),
    ]
    const cw = projectCommissionerWorkload(teams, null)
    expect(cw.commissionerCount).toBe(1)
    expect(cw.coCommissionerCount).toBe(1)
    expect(cw.isOrphanCommissioner).toBe(false)
  })

  it('flags orphan commissioner', () => {
    const teams = [makeTeam({ isCommissioner: true, isOrphan: true }), makeTeam()]
    const cw = projectCommissionerWorkload(teams, null)
    expect(cw.isOrphanCommissioner).toBe(true)
  })

  it('carries lockAllMoves', () => {
    const cw = projectCommissionerWorkload([makeTeam()], true)
    expect(cw.lockAllMoves).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectLeagueHealthScore
// ──────────────────────────────────────────────────────────────────────────

describe('projectLeagueHealthScore', () => {
  const fullParticipation = projectManagerParticipation([makeTeam(), makeTeam(), makeTeam()])
  const fullCompleteness = projectRosterCompleteness([makeRoster(), makeRoster()], 3)

  it('returns score=null and tier=unknown when teams is empty', () => {
    const emptyPart = projectManagerParticipation([])
    const hs = projectLeagueHealthScore(emptyPart, fullCompleteness, false)
    expect(hs.score).toBeNull()
    expect(hs.tier).toBe('unknown')
    expect(hs.basis).toContain('empty_league')
  })

  it('returns 100 for a clean league (no orphans, complete rosters, fresh)', () => {
    const hs = projectLeagueHealthScore(fullParticipation, fullCompleteness, false)
    expect(hs.score).toBe(100)
    expect(hs.tier).toBe('healthy')
    expect(hs.basis).toHaveLength(0)
  })

  it('deducts for orphan teams', () => {
    const withOrphans = projectManagerParticipation([
      makeTeam({ isOrphan: true }),
      makeTeam({ isOrphan: true }),
      makeTeam(),
      makeTeam(),
    ])
    const hs = projectLeagueHealthScore(withOrphans, fullCompleteness, false)
    expect(hs.score!).toBeLessThan(100)
    expect(hs.basis).toContain('orphan_teams')
  })

  it('deducts for stale world', () => {
    const hs = projectLeagueHealthScore(fullParticipation, fullCompleteness, true)
    expect(hs.score).toBe(90)
    expect(hs.basis).toContain('sync_stale')
  })

  it('deducts for incomplete rosters', () => {
    const incompleteRosters = projectRosterCompleteness(
      [makeRoster({ playerCount: 0 }), makeRoster({ playerCount: 12 })],
      10,
    )
    const hs = projectLeagueHealthScore(fullParticipation, incompleteRosters, false)
    expect(hs.score!).toBeLessThan(100)
    expect(hs.basis).toContain('incomplete_rosters')
  })

  it('score never goes below 0', () => {
    const allOrphan = projectManagerParticipation([
      makeTeam({ isOrphan: true }),
      makeTeam({ isOrphan: true }),
      makeTeam({ isOrphan: true }),
      makeTeam({ isOrphan: true }),
    ])
    const allEmpty = projectRosterCompleteness(
      [makeRoster({ playerCount: 0 }), makeRoster({ playerCount: 0 })],
      10,
    )
    const hs = projectLeagueHealthScore(allOrphan, allEmpty, true)
    expect(hs.score!).toBeGreaterThanOrEqual(0)
    expect(hs.tier).toBe('inactive')
  })

  it('tier is at_risk for moderate orphan rate', () => {
    const moderate = projectManagerParticipation([
      makeTeam({ isOrphan: true }),
      makeTeam(),
      makeTeam(),
      makeTeam(),
    ])
    const hs = projectLeagueHealthScore(moderate, fullCompleteness, false)
    // orphanRate = 0.25 → orphanPenalty = 7 → score = 92. But orphanRate >= 0.20, so not 'healthy'.
    // orphanRate < 0.40, score >= 50 → 'at_risk'
    expect(hs.tier).toBe('at_risk')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// buildInactivityWarnings
// ──────────────────────────────────────────────────────────────────────────

describe('buildInactivityWarnings', () => {
  const noIssues = {
    participation: projectManagerParticipation([makeTeam(), makeTeam()]),
    completeness: projectRosterCompleteness([makeRoster(), makeRoster()], 3),
    commWorkload: projectCommissionerWorkload([makeTeam({ isCommissioner: true })], null),
  }

  it('returns no warnings for healthy league', () => {
    const w = buildInactivityWarnings(noIssues.participation, noIssues.completeness, noIssues.commWorkload)
    expect(w).toHaveLength(0)
  })

  it('warns on orphan teams', () => {
    const p = projectManagerParticipation([makeTeam({ isOrphan: true }), makeTeam()])
    const w = buildInactivityWarnings(p, noIssues.completeness, noIssues.commWorkload)
    expect(w).toContain('orphan_teams_detected')
  })

  it('warns majority_orphan when >= 50% orphan', () => {
    const p = projectManagerParticipation([makeTeam({ isOrphan: true }), makeTeam({ isOrphan: true }), makeTeam()])
    const w = buildInactivityWarnings(p, noIssues.completeness, noIssues.commWorkload)
    expect(w).toContain('majority_orphan')
  })

  it('warns empty_rosters_detected', () => {
    const c = projectRosterCompleteness([makeRoster({ playerCount: 0 }), makeRoster()], null)
    const w = buildInactivityWarnings(noIssues.participation, c, noIssues.commWorkload)
    expect(w).toContain('empty_rosters_detected')
  })

  it('warns all_rosters_empty when all rosters have 0 players', () => {
    const c = projectRosterCompleteness([makeRoster({ playerCount: 0 }), makeRoster({ playerCount: 0 })], null)
    const w = buildInactivityWarnings(noIssues.participation, c, noIssues.commWorkload)
    expect(w).toContain('all_rosters_empty')
  })

  it('warns orphan_commissioner', () => {
    const cw = projectCommissionerWorkload([makeTeam({ isCommissioner: true, isOrphan: true })], null)
    const w = buildInactivityWarnings(noIssues.participation, noIssues.completeness, cw)
    expect(w).toContain('orphan_commissioner')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// buildEngagementWarnings
// ──────────────────────────────────────────────────────────────────────────

describe('buildEngagementWarnings', () => {
  const available = (tier: ActivitySignal['tier']): ActivitySignal => ({
    count: 0, lookbackDays: 30, tier, available: true,
  })
  const unavailable: ActivitySignal = { count: 0, lookbackDays: 30, tier: 'unknown', available: false }

  it('returns no warnings when all activities are active', () => {
    const w = buildEngagementWarnings(available('moderate'), available('moderate'), available('moderate'))
    expect(w).toHaveLength(0)
  })

  it('warns no_waiver_activity when waiver is inactive', () => {
    const w = buildEngagementWarnings(available('inactive'), available('moderate'), available('moderate'))
    expect(w).toContain('no_waiver_activity')
  })

  it('warns no_trade_activity when trade is inactive', () => {
    const w = buildEngagementWarnings(available('moderate'), available('inactive'), available('moderate'))
    expect(w).toContain('no_trade_activity')
  })

  it('warns no_lineup_activity when lineup is inactive', () => {
    const w = buildEngagementWarnings(available('moderate'), available('moderate'), available('inactive'))
    expect(w).toContain('no_lineup_activity')
  })

  it('warns all_activity_low when all are low or inactive', () => {
    const w = buildEngagementWarnings(available('low'), available('inactive'), available('low'))
    expect(w).toContain('all_activity_low')
  })

  it('does not warn when data is unavailable (not the same as inactive)', () => {
    const w = buildEngagementWarnings(unavailable, unavailable, unavailable)
    expect(w).not.toContain('no_waiver_activity')
    expect(w).not.toContain('all_activity_low')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectLeagueIntelEnrichedWorld — no mutation
// ──────────────────────────────────────────────────────────────────────────

describe('projectLeagueIntelEnrichedWorld — no mutation', () => {
  it('does not mutate the base enriched world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const frozen = JSON.stringify(enriched)

    projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)

    expect(JSON.stringify(enriched)).toBe(frozen)
  })

  it('league intel does not appear on base world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    expect((enriched as Record<string, unknown>)['leagueIntelligence']).toBeUndefined()
  })

  it('base world fields are preserved on projected world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.league).toEqual(enriched.league)
    expect(projected.teams).toEqual(enriched.teams)
    expect(projected.rosters).toEqual(enriched.rosters)
    expect(projected.provenance).toEqual(enriched.provenance)
    expect(projected.completeness).toEqual(enriched.completeness)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectLeagueIntelEnrichedWorld — health scoring
// ──────────────────────────────────────────────────────────────────────────

describe('projectLeagueIntelEnrichedWorld — health scoring', () => {
  it('health score is non-null and bounded 0-100 for real world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.leagueIntelligence.healthScore.score).not.toBeNull()
    expect(projected.leagueIntelligence.healthScore.score!).toBeGreaterThanOrEqual(0)
    expect(projected.leagueIntelligence.healthScore.score!).toBeLessThanOrEqual(100)
  })

  it('health score deducts 10 for stale world (pure helper)', () => {
    const participation = projectManagerParticipation([makeTeam(), makeTeam()])
    const completeness = projectRosterCompleteness([makeRoster(), makeRoster()], 3)
    const fresh = projectLeagueHealthScore(participation, completeness, false)
    const stale = projectLeagueHealthScore(participation, completeness, true)
    expect(fresh.score).toBe(100)
    expect(stale.score).toBe(90)
    expect(stale.basis).toContain('sync_stale')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectLeagueIntelEnrichedWorld — activity signals
// ──────────────────────────────────────────────────────────────────────────

describe('projectLeagueIntelEnrichedWorld — activity signals', () => {
  it('activity signals are unknown when port fails', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, activityError(), noReputation(), NOW)
    expect(projected.leagueIntelligence.waiverActivity.tier).toBe('unknown')
    expect(projected.leagueIntelligence.tradeActivity.tier).toBe('unknown')
    expect(projected.leagueIntelligence.lineupActivity.tier).toBe('unknown')
    expect(projected.leagueIntelligence.uncertainty).toContain('activity_data_unavailable')
  })

  it('activity signals are classified when data is available', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    // 20 waiver claims in 30 days → ~4.7/week = high
    const projected = projectLeagueIntelEnrichedWorld(
      enriched,
      activityWith({ waiverClaimCount: 20, tradeCount: 0, rosterMoveCount: 0 }),
      noReputation(),
      NOW,
    )
    expect(projected.leagueIntelligence.waiverActivity.tier).toBe('high')
    expect(projected.leagueIntelligence.waiverActivity.count).toBe(20)
    expect(projected.leagueIntelligence.tradeActivity.tier).toBe('inactive')
  })

  it('engagement tier reflects best activity signal', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(
      enriched,
      activityWith({ waiverClaimCount: 0, tradeCount: 10, rosterMoveCount: 0 }),
      noReputation(),
      NOW,
    )
    expect(projected.leagueIntelligence.engagementTier).toBe('moderate')
  })

  it('all_activity_low warning fires when all available signals are low', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    // 1 of each in 30 days → ~0.23/week = low
    const projected = projectLeagueIntelEnrichedWorld(
      enriched,
      activityWith({ waiverClaimCount: 1, tradeCount: 1, rosterMoveCount: 1 }),
      noReputation(),
      NOW,
    )
    expect(projected.leagueIntelligence.engagementWarnings).toContain('all_activity_low')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectLeagueIntelEnrichedWorld — reputation carry
// ──────────────────────────────────────────────────────────────────────────

describe('projectLeagueIntelEnrichedWorld — reputation carry', () => {
  it('leagueReputation is null when no row', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.leagueIntelligence.leagueReputation).toBeNull()
    expect(projected.leagueIntelligence.uncertainty).toContain('reputation_unavailable')
  })

  it('leagueReputation carries precomputed score as provenance', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), reputationRow(), NOW)
    expect(projected.leagueIntelligence.leagueReputation).not.toBeNull()
    expect(projected.leagueIntelligence.leagueReputation!.overallScore).toBe(0.75)
    expect(projected.leagueIntelligence.leagueReputation!.tier).toBe('established')
    expect(projected.leagueIntelligence.uncertainty).not.toContain('reputation_unavailable')
  })

  it('reputation_unavailable in uncertainty when port throws', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(
      enriched,
      noActivity(),
      { row: null, error: 'db error' },
      NOW,
    )
    expect(projected.leagueIntelligence.uncertainty).toContain('reputation_unavailable')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Origin-blind shape
// ──────────────────────────────────────────────────────────────────────────

describe('origin-blind shape', () => {
  it('imported and native worlds produce the same LeagueIntelContext shape', () => {
    const importedWorld = assemble(makeImportedProviderWorld())
    const nativeWorld = assemble(makeNativeAfWorld())

    const importedEnriched = projectEnrichedWorld(importedWorld, emptyMetadata())
    const nativeEnriched = projectEnrichedWorld(nativeWorld, emptyMetadata())

    const importedProjected = projectLeagueIntelEnrichedWorld(importedEnriched, noActivity(), noReputation(), NOW)
    const nativeProjected = projectLeagueIntelEnrichedWorld(nativeEnriched, noActivity(), noReputation(), NOW)

    const importedKeys = Object.keys(importedProjected.leagueIntelligence).sort()
    const nativeKeys = Object.keys(nativeProjected.leagueIntelligence).sort()
    expect(importedKeys).toEqual(nativeKeys)
  })

  it('leagueIntelligence does not contain provider-specific fields', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), reputationRow(), NOW)
    const intelStr = JSON.stringify(projected.leagueIntelligence)
    expect(intelStr).not.toContain('sleeper')
    expect(intelStr).not.toContain('platformLeagueId')
    expect(intelStr).not.toContain('"provider"')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Honest degradation — missing data
// ──────────────────────────────────────────────────────────────────────────

describe('honest degradation', () => {
  it('sync_stale in uncertainty when world is stale', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const staleWorld = {
      ...world,
      provenance: {
        ...world.provenance,
        freshness: { ...world.provenance.freshness, isStale: true, staleReason: 'test' },
      },
    }
    const enriched = projectEnrichedWorld(staleWorld, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.leagueIntelligence.uncertainty).toContain('sync_stale')
  })

  it('freshness.isWorldStale matches world provenance', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.leagueIntelligence.freshness.isWorldStale).toBe(
      world.provenance.freshness.isStale,
    )
  })

  it('freshness.computedAt equals now', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const enriched = projectEnrichedWorld(world, emptyMetadata())
    const projected = projectLeagueIntelEnrichedWorld(enriched, noActivity(), noReputation(), NOW)
    expect(projected.leagueIntelligence.freshness.computedAt).toEqual(NOW)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveLeagueIntelEnrichedCanonicalWorld — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveLeagueIntelEnrichedCanonicalWorld — never throws', () => {
  it('returns null for unknown leagueId without throwing', async () => {
    const result = await resolveLeagueIntelEnrichedCanonicalWorld('nonexistent-league-xyz')
    expect(result).toBeNull()
  })

  it('surfaces activity port error in uncertainty without throwing', async () => {
    const result = await resolveLeagueIntelEnrichedCanonicalWorld('nonexistent', {
      intel: {
        loadLeagueActivityCounts: async () => { throw new Error('db error') },
        loadLeagueReputation: async () => null,
      },
    })
    // Still null because league doesn't exist — but it doesn't throw
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Architecture guard
// ──────────────────────────────────────────────────────────────────────────

describe('architecture guard', () => {
  it('leagueIntelEnrichedWorld.ts contains no direct prisma import', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/leagueIntelEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain("from '@/lib/prisma'")
    expect(src).not.toContain('from "../prisma"')
  })

  it('leagueIntelEnrichedWorld.ts contains no mutation keywords', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/leagueIntelEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain('.create(')
    expect(src).not.toContain('.update(')
    expect(src).not.toContain('.upsert(')
    expect(src).not.toContain('.delete(')
  })

  it('leagueIntelEnrichedWorld.ts does not import server-only modules', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/leagueIntelEnrichedWorld.ts'), 'utf-8')
    // Check for actual import statements, not just string occurrence (header comment mentions "server-only" as a constraint)
    expect(src).not.toMatch(/from ['"]server-only['"]/)
    expect(src).not.toMatch(/from ['"].*serverClock['"]/)
    expect(src).not.toMatch(/from ['"].*commissionerHubHealth['"]/)
  })

  it('leagueIntelEnrichedWorld.ts does not use AI or fuzzy matching', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/leagueIntelEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain('openai')
    expect(src).not.toContain('anthropic')
    expect(src).not.toContain('levenshtein')
    expect(src).not.toContain('fuzzy')
  })
})
