import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'
import {
  applyNflRedraftStatCorrection,
  buildNflRedraftLiveScoringRuntimeState,
  buildScoringRuntimeEvents,
  calculateNflRedraftFantasyPoints,
  normalizeNflRedraftPlayerStats,
  resolveNflRedraftScoringSettings,
  type NflRedraftRuntimeMatchupInput,
  type NflRedraftRuntimeScoreInput,
  type NflRedraftRuntimeTeamInput,
} from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g37',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 6,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G37 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 6,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {
    templateId: 'nfl_half_ppr',
    presetId: 'nfl_half_ppr',
    formatType: 'redraft',
    sport: 'NFL',
    activeRuleCount: 0,
    overriddenRuleCount: 0,
    activeRules: [],
  },
  roster: {
    size: 6,
    starters: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    irSlots: 1,
    eligibleReserveStatuses: ['IR'],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
  playoffs: { teamCount: 2, startWeek: 15, standingsTiebreakers: ['win_pct', 'points_for'] },
  schedule: {
    unit: 'week',
    regularSeasonLength: 14,
    matchupFrequency: 'weekly',
    matchupCadence: 'weekly',
    generationStrategy: 'round_robin',
    playoffTransitionPoint: 15,
    headToHeadBehavior: 'standard',
    lockTimeBehavior: 'per_player_kickoff',
    lockWindowBehavior: 'nfl_week',
    scoringPeriodBehavior: 'weekly',
    rescheduleHandling: null,
    doubleheaderHandling: null,
  },
  permissions: {
    settingsEditableByRoles: ['commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

const teams: NflRedraftRuntimeTeamInput[] = [
  {
    rosterId: 'alpha',
    displayName: 'Alpha',
    ownerName: 'Ava',
    divisionId: 'east',
    divisionName: 'East',
    players: [
      { rosterId: 'alpha', playerId: 'qb-1', playerName: 'Quarterback One', position: 'QB', slotType: 'QB' },
      { rosterId: 'alpha', playerId: 'te-1', playerName: 'Premium Tight End', position: 'TE', slotType: 'TE' },
      { rosterId: 'alpha', playerId: 'rb-bench', playerName: 'Bench Runner', position: 'RB', slotType: 'BENCH' },
      { rosterId: 'alpha', playerId: 'wr-ir', playerName: 'IR Wideout', position: 'WR', slotType: 'IR' },
    ],
  },
  {
    rosterId: 'bravo',
    displayName: 'Bravo',
    ownerName: 'Ben',
    divisionId: 'east',
    divisionName: 'East',
    players: [
      { rosterId: 'bravo', playerId: 'rb-1', playerName: 'Runner One', position: 'RB', slotType: 'RB' },
      { rosterId: 'bravo', playerId: 'k-1', playerName: 'Kicker One', position: 'K', slotType: 'K' },
      { rosterId: 'bravo', playerId: 'nfl:def:KC', playerName: 'Kansas City D/ST', position: 'DEF', slotType: 'DEF' },
    ],
  },
]

const matchups: NflRedraftRuntimeMatchupInput[] = [
  { matchupId: 'm1', week: 1, homeRosterId: 'alpha', awayRosterId: 'bravo' },
]

describe('G37 canonical NFL redraft live scoring runtime', () => {
  it('normalizes NFL stat aliases and calculates half-PPR fantasy points deterministically', () => {
    const settings = resolveNflRedraftScoringSettings({ rules })
    const stats = normalizeNflRedraftPlayerStats({
      playerId: 'qb-1',
      position: 'QB',
      rawStats: {
        passingYards: 250,
        passingTouchdowns: 2,
        interceptions: 1,
        rushingYards: 20,
      },
    })
    const scored = calculateNflRedraftFantasyPoints({ settings, stats, position: 'QB' })

    expect(stats).toMatchObject({ pass_yds: 250, pass_td: 2, pass_int: 1, rush_yds: 20 })
    expect(scored.points).toBe(18)
  })

  it('supports full PPR, standard scoring, and TE premium from canonical rules', () => {
    const fullPpr = resolveNflRedraftScoringSettings({
      rules: { ...rules, scoring: { ...rules.scoring, presetId: 'nfl_ppr', templateId: 'nfl_ppr' } },
    })
    const standard = resolveNflRedraftScoringSettings({
      rules: { ...rules, scoring: { ...rules.scoring, presetId: 'nfl_standard', templateId: 'nfl_standard' } },
    })
    const tePremiumRules = {
      ...rules,
      scoring: {
        ...rules.scoring,
        activeRules: [{ statKey: 'te_premium', pointsValue: 0.5, multiplier: 1, enabled: true }],
      },
    } as CanonicalLeagueRules
    const tePremium = resolveNflRedraftScoringSettings({ rules: tePremiumRules })
    const wrStats = { rec: 6, rec_yds: 60 }

    expect(calculateNflRedraftFantasyPoints({ settings: fullPpr, stats: wrStats, position: 'WR' }).points).toBe(12)
    expect(calculateNflRedraftFantasyPoints({ settings: standard, stats: wrStats, position: 'WR' }).points).toBe(6)
    expect(calculateNflRedraftFantasyPoints({ settings: tePremium, stats: wrStats, position: 'TE' }).points).toBe(12)
    expect(calculateNflRedraftFantasyPoints({ settings: tePremium, stats: wrStats, position: 'WR' }).points).toBe(9)
  })

  it('scores kickers, DST counting stats, negative points, and points-allowed tiers', () => {
    const settings = resolveNflRedraftScoringSettings({ rules })
    const kicker = calculateNflRedraftFantasyPoints({
      settings,
      position: 'K',
      stats: { fg_0_39: 2, fg_50_plus: 1, xp_made: 3, fg_miss: 1 },
    })
    const dstStats = normalizeNflRedraftPlayerStats({
      playerId: 'nfl:def:KC',
      position: 'DEF',
      rawStats: { sacks: 3, interceptions: 1, fumbles_recovered: 1, defensive_td: 1, points_allowed: 10 },
    })
    const dst = calculateNflRedraftFantasyPoints({ settings, position: 'DEF', stats: dstStats })

    expect(kicker.points).toBe(13)
    expect(dstStats).toMatchObject({ def_sack: 3, def_int: 1, def_fr: 1, def_td: 1, def_points_allowed: 10 })
    expect(dst.points).toBe(17)
  })

  it('applies starters to matchup totals while keeping bench and IR visible only', () => {
    const tePremiumRules = {
      ...rules,
      scoring: {
        ...rules.scoring,
        activeRules: [{ statKey: 'te_premium', pointsValue: 0.5, multiplier: 1, enabled: true }],
      },
    } as CanonicalLeagueRules
    const scoreRows: NflRedraftRuntimeScoreInput[] = [
      { playerId: 'qb-1', stats: { pass_yds: 250, pass_td: 2, pass_int: 1, rush_yds: 20 }, isFinalized: true },
      { playerId: 'te-1', stats: { rec: 6, rec_yds: 60 }, isFinalized: true },
      { playerId: 'rb-bench', stats: { rush_yds: 120, rush_td: 1 }, isFinalized: true },
      { playerId: 'wr-ir', stats: { rec: 10, rec_yds: 100, rec_td: 2 }, isFinalized: true },
      { playerId: 'rb-1', stats: { rush_yds: 80, rush_td: 2, rec: 2, rec_yds: 10 }, isFinalized: true },
      { playerId: 'k-1', stats: { fg_0_39: 2, fg_50_plus: 1, xp_made: 3, fg_miss: 1 }, isFinalized: true },
      { playerId: 'nfl:def:KC', stats: { def_sack: 3, def_int: 1, def_fr: 1, def_td: 1, def_points_allowed: 10 }, isFinalized: true },
    ]

    const state = buildNflRedraftLiveScoringRuntimeState({
      leagueId: rules.leagueId,
      seasonId: 'season-1',
      season: 2026,
      week: 1,
      rules: tePremiumRules,
      teams,
      matchups,
      scoreRows,
      now: new Date('2026-07-02T12:00:00.000Z'),
    })

    expect(state.matchups[0]).toMatchObject({
      status: 'final',
      homeScore: 30,
      awayScore: 52,
      winnerRosterId: 'bravo',
      loserRosterId: 'alpha',
      complete: true,
    })
    expect(state.teams.find((team) => team.rosterId === 'alpha')).toMatchObject({
      starterTotal: 30,
      benchTotal: 21,
      irTotal: 30,
      scoredStarterCount: 2,
    })
    expect(state.standings.map((row) => [row.rosterId, row.wins, row.losses, row.pointsFor])).toEqual([
      ['bravo', 1, 0, 52],
      ['alpha', 0, 1, 30],
    ])
  })

  it('versions stat corrections and emits canonical scoring events including illegal lineup flags', () => {
    const correction = applyNflRedraftStatCorrection({
      playerId: 'qb-1',
      position: 'QB',
      previousStats: { pass_yds: 200, __af_correction_version: 1 },
      correctedStats: { passingYards: 260, passingTouchdowns: 3 },
    })
    const state = buildNflRedraftLiveScoringRuntimeState({
      leagueId: rules.leagueId,
      seasonId: 'season-1',
      season: 2026,
      week: 1,
      rules,
      teams: [
        {
          ...teams[0],
          validationIssues: [{ code: 'missing_starter_slot', severity: 'error', message: 'WR requires 1 starter.' }],
        },
        teams[1],
      ],
      matchups,
      scoreRows: [{ playerId: 'qb-1', stats: correction.normalizedStats, isFinalized: false }],
    })
    const events = buildScoringRuntimeEvents({ state, actorUserId: 'commissioner-1', includePlayerEvents: true })

    expect(correction.correctionVersion).toBe(2)
    expect(correction.normalizedStats).toMatchObject({ pass_yds: 260, pass_td: 3, __af_correction_version: 2 })
    expect(state.matchups[0].status).toBe('illegal_lineup')
    expect(normalizeLeagueRuntimeEventType('scoring_period_opened')).toBe('scoring.period.opened')
    expect(normalizeLeagueRuntimeEventType('stat_correction_applied')).toBe('scoring.stat_correction.applied')
    expect(normalizeLeagueRuntimeEventType('commissioner_scoring_correction')).toBe('commissioner.scoring_correction')
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'scoring.period.opened',
        'scoring.player_stat.ingested',
        'scoring.fantasy_points.calculated',
        'lineup.illegal.flagged',
        'scoring.matchup_score.updated',
        'standings.recalculated',
      ]),
    )
  })
})
