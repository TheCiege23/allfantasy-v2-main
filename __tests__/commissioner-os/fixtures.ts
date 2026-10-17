/**
 * Commissioner OS League-Specific Intelligence Wiring phase — shared test
 * fixtures. Generators are pure functions over `CommissionerOsContext` — no
 * Prisma mocking needed to test them, just a real, representative context
 * object. `shared` (the pre-existing `CommissionerContext` from
 * `lib/shared-services/commissioner`) is deep and largely untouched by these
 * generators — only the handful of fields they actually read are given real
 * values; the rest is cast, matching this repo's established fixture
 * convention of not re-modeling an entire external package's type surface
 * just to satisfy the compiler.
 */
import type {
  CommissionerOsContext,
  RivalryRecordSummary,
  DramaEventSummary,
  DraftGradeSummary,
} from '@/lib/shared-services/league-hub/commissionerOsContext'
import type {
  CommissionerContext,
  LeagueHealthAssessment,
  CommissionerAttentionItem,
  CommissionerPowerRanking,
  CommissionerBrief,
} from '@/lib/shared-services/commissioner'
import type { SyncFreshness } from '@/lib/shared-services/league-hub/types'

export function freshFreshness(): SyncFreshness {
  return { state: 'fresh', lastSyncedAt: '2026-07-12T00:00:00.000Z' }
}

export function staleFreshness(): SyncFreshness {
  return { state: 'stale', lastSyncedAt: '2026-06-01T00:00:00.000Z' }
}

export function baseHealth(overrides: Partial<LeagueHealthAssessment> = {}): LeagueHealthAssessment {
  return {
    leagueId: 'league-1',
    category: 'healthy',
    score: 88,
    issues: [],
    evidence: ['12 lineups set this week.'],
    confidence: 90,
    freshness: 'fresh',
    sourceAttribution: {
      source: 'monitorLeagueHealth',
      fetchedAt: '2026-07-12T00:00:00.000Z',
      providerTimestamp: '2026-07-12T00:00:00.000Z',
      freshness: 'fresh',
      confidence: 90,
      missingDataReason: null,
    },
    ...overrides,
  }
}

export function baseAttentionItem(overrides: Partial<CommissionerAttentionItem> = {}): CommissionerAttentionItem {
  return {
    reasonCode: 'legacy_signal',
    category: 'league_requires_review',
    severity: 'medium',
    leagueId: 'league-1',
    affectedManagerIds: [],
    message: 'League settings need a review.',
    evidence: ['Real evidence line.'],
    confidence: 70,
    freshness: 'fresh',
    risk: 'medium',
    recommendedAction: 'Review league settings.',
    actionAvailableInApp: false,
    providerDeepLink: null,
    permissionRequired: 'commissioner',
    ...overrides,
  }
}

export function baseRanking(overrides: Partial<CommissionerPowerRanking> = {}): CommissionerPowerRanking {
  return {
    leagueId: 'league-1',
    week: 5,
    mode: 'general_v2',
    formulaVersion: '1.0',
    support: 'supported',
    teams: [
      { rosterId: 'roster-1', rank: 1, rankDelta: 2, displayName: 'Team One', username: null } as never,
      { rosterId: 'roster-2', rank: 2, rankDelta: -1, displayName: 'Team Two', username: null } as never,
    ],
    sourceAttribution: {
      source: 'computePowerRankings',
      fetchedAt: '2026-07-12T00:00:00.000Z',
      providerTimestamp: '2026-07-12T00:00:00.000Z',
      freshness: 'fresh',
      confidence: 85,
      missingDataReason: null,
    },
    explanation: 'Deterministic power rankings based on points scored and margin of victory.',
    ...overrides,
  }
}

export function baseBrief(overrides: Partial<CommissionerBrief> = {}): CommissionerBrief {
  return {
    leagueId: 'league-1',
    week: 5,
    generatedAt: '2026-07-12T00:00:00.000Z',
    sections: [],
    isHealthy: true,
    confidence: 85,
    ...overrides,
  }
}

export function baseShared(overrides: Record<string, unknown> = {}): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-07-12T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {
      leagueId: 'league-1',
      activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
      managersAtRetentionRisk: [],
      recommendedActions: [],
      fieldProvenance: null,
    },
    leagueAnalytics: {},
    formatAwareness: {
      leagueVariant: null,
      isDynasty: false,
      powerRankingSupport: 'supported',
      reason: null,
    },
    gameDayAttentionItems: null,
    managerTendencies: {},
    ...overrides,
  } as unknown as CommissionerContext
}

export function rivalry(overrides: Partial<RivalryRecordSummary> = {}): RivalryRecordSummary {
  return {
    id: 'rivalry-1',
    managerAId: 'manager-a',
    managerBId: 'manager-b',
    rivalryScore: 82,
    rivalryTier: 'heated',
    eventCount: 5,
    latestEvent: { eventType: 'playoff_meeting', season: 2025 },
    ...overrides,
  }
}

export function dramaEvent(overrides: Partial<DramaEventSummary> = {}): DramaEventSummary {
  return {
    id: 'drama-1',
    dramaType: 'UPSET',
    headline: 'Team Two stuns Team One in a shootout',
    summary: 'Team Two overcame a 20-point deficit to win 145-142.',
    relatedManagerIds: ['manager-a', 'manager-b'],
    relatedTeamIds: ['roster-1', 'roster-2'],
    dramaScore: 78,
    season: 2026,
    createdAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  }
}

export function draftGrade(overrides: Partial<DraftGradeSummary> = {}): DraftGradeSummary {
  return {
    rosterId: 'roster-1',
    season: '2026',
    grade: 'A-',
    score: 91.5,
    ...overrides,
  }
}

export function baseCommissionerOsContext(overrides: Partial<CommissionerOsContext> = {}): CommissionerOsContext {
  return {
    appUserId: 'commissioner-1',
    canonicalLeagueId: 'league-1',
    provider: 'sleeper',
    sport: 'NFL',
    season: 2026,
    isDynasty: false,
    isCommissioner: true,
    syncFreshness: freshFreshness(),
    isSnapshotOnly: false,
    shared: baseShared(),
    health: baseHealth(),
    attentionItems: [],
    ranking: baseRanking(),
    brief: baseBrief(),
    championHistory: [],
    rivalries: [],
    dramaEvents: [],
    draftGrades: [],
    unavailableDomains: [],
    ...overrides,
  }
}
