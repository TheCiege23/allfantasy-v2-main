/**
 * Canonical league rules for a simulated league. The shape is the one the G43 full-season simulation
 * (`lib/redraft-season-simulation/`) already feeds the canonical runtimes, parameterized so the fuzz
 * runner can vary team count, roster, season length and playoff field.
 */
import type { CanonicalLeagueRules } from '@/lib/league-runtime'

export type SimLeagueFormat = 'redraft' | 'guillotine'

type SimRulesInput = {
  leagueId: string
  season: number
  format: SimLeagueFormat
  teamCount: number
  starters: string[]
  benchSize: number
  regularSeasonWeeks: number
  playoffTeams: number
  tradeDeadlineWeek: number
  faabBudget: number
  scoringPreset: 'nfl_ppr' | 'nfl_half_ppr' | 'nfl_standard'
  generatedAt: Date
}

export const DEFAULT_SIM_STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']

export function buildSimRules(input: SimRulesInput): CanonicalLeagueRules {
  const rosterSize = input.starters.length + input.benchSize
  const tiebreakers = ['win_pct', 'wins', 'points_for', 'points_against']
  return {
    version: 1,
    leagueId: input.leagueId,
    generatedAtIso: input.generatedAt.toISOString(),
    source: {
      commissionerSettings: 'League',
      draftSettings: 'LeagueSettings',
      effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
      settingsSnapshotVersion: 8,
      presetKey: `af:v2|concept=${input.format}|sport=NFL`,
    },
    general: {
      name: `Season sim ${input.leagueId}`,
      sport: 'NFL',
      season: input.season,
      format: input.format,
      variant: null,
      teamCount: input.teamCount,
      rosterSize,
      lifecycleState: 'active',
      status: 'active',
      locked: false,
      emergencyPaused: false,
      timezone: 'America/New_York',
      language: 'en',
    },
    draft: {
      type: 'snake',
      rounds: rosterSize,
      timerSeconds: 90,
      slowTimerSeconds: 3600,
      timerMode: 'per_pick',
      scheduledAtIso: input.generatedAt.toISOString(),
      orderMethod: 'manual',
      orderLocked: true,
      pickOrderRules: 'snake',
      thirdRoundReversal: false,
      autoPickEnabled: true,
      cpuAutoPick: true,
      commissionerForceAutoPickEnabled: true,
      pickTradingEnabled: false,
      importEnabled: false,
      executionMode: 'live',
      playerPool: 'all',
      rosterFillOrder: 'starter_first',
      positionFilterBehavior: 'by_eligibility',
    },
    scoring: {
      templateId: input.scoringPreset,
      presetId: input.scoringPreset,
      formatType: input.format,
      sport: 'NFL',
      activeRuleCount: 0,
      overriddenRuleCount: 0,
      activeRules: [],
    },
    roster: {
      size: rosterSize,
      starters: input.starters,
      irSlots: 0,
      eligibleReserveStatuses: [],
      allowPreDraftMoves: true,
      preventBenchDrops: false,
      lockAllMoves: false,
    },
    waivers: {
      type: 'faab',
      continuous: false,
      processingDays: [3],
      processingTimeUtc: '10:00',
      processingTimeLocal: '06:00',
      claimLimitPerPeriod: null,
      maxClaimsPerPeriod: null,
      priorityBehavior: 'rolling',
      gameLockBehavior: 'per_player',
      dropLockBehavior: 'locked_after_kickoff',
      freeAgentUnlockBehavior: 'after_clear',
      sameDayAddDropRules: null,
      faabEnabled: true,
      faabBudget: input.faabBudget,
      faabMinBid: 0,
      faabResetRules: null,
      tiebreakRule: 'waiver_priority',
      instantFreeAgencyAfterClear: false,
    },
    trades: { reviewHours: 24, deadlineWeek: input.tradeDeadlineWeek, draftPickTrading: false },
    playoffs: {
      teamCount: input.playoffTeams,
      startWeek: input.regularSeasonWeeks + 1,
      startPoint: input.regularSeasonWeeks + 1,
      weeksPerRound: 1,
      firstRoundByes: 0,
      bracketType: 'single_elimination',
      matchupLength: 1,
      totalRounds: Math.max(1, Math.ceil(Math.log2(Math.max(2, input.playoffTeams)))),
      consolationBracketEnabled: false,
      thirdPlaceGameEnabled: false,
      toiletBowlEnabled: false,
      championshipLength: 1,
      consolationPlaysFor: 'final_standings',
      seedingRules: 'standings',
      tiebreakerRules: tiebreakers,
      byeRules: 'top_seed_byes',
      reseedBehavior: 'none',
      standingsTiebreakers: tiebreakers,
      byePlan: null,
      customTiebreakers: null,
    },
    schedule: {
      unit: 'week',
      regularSeasonLength: input.regularSeasonWeeks,
      matchupFrequency: 'weekly',
      matchupCadence: 'weekly',
      generationStrategy: 'round_robin',
      playoffTransitionPoint: input.regularSeasonWeeks + 1,
      headToHeadBehavior: 'standard',
      lockTimeBehavior: 'per_player_kickoff',
      lockWindowBehavior: 'nfl_week',
      scoringPeriodBehavior: 'weekly',
      rescheduleHandling: null,
      doubleheaderHandling: null,
    },
    permissions: {
      settingsEditableByRoles: ['commissioner', 'co_commissioner'],
      memberMovesLocked: false,
      inviteLinksDisabled: false,
      inviteCapacityOverride: false,
    },
    intelligence: {
      chimmyHelperEnabled: false,
      managerIntelligence: { requiredPlan: 'pro', requiredFeatures: [], leagueToggles: [] },
      commissionerIntelligence: {
        requiredPlan: 'commissioner',
        requiredFeatures: [],
        enabledLeagueSettings: [],
        lockedWithoutEntitlement: [],
      },
      automation: { commissionerShortcutsEnabled: false, weeklyLeagueReportEnabled: false },
    },
  } as CanonicalLeagueRules
}
