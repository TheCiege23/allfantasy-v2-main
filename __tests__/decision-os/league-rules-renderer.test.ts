/**
 * Chimmy reads the league's rules (2026-11-16 re-score item 5). The league-rules slice was in the packet but the
 * generic renderer printed each nested object as "present", so the prompt said `scoring: present` and Chimmy
 * guessed PPR, the trade deadline and the FAAB budget. The ruleset comes from the real builder here (fixtures
 * shared with g33-canonical-league-runtime.test.ts), so the renderer is tested against the shape it really gets.
 */
import { describe, expect, it, vi } from 'vitest'

const leagueFindUniqueMock = vi.hoisted(() => vi.fn())
const getDraftConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getDraftUISettingsForLeagueMock = vi.hoisted(() => vi.fn())
const getLeagueScoringConfigMock = vi.hoisted(() => vi.fn())
const getWaiverConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getPlayoffConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getScheduleConfigForLeagueMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
    },
  },
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: getDraftConfigForLeagueMock,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: getDraftUISettingsForLeagueMock,
}))

vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({
  getLeagueScoringConfig: getLeagueScoringConfigMock,
}))

vi.mock('@/lib/waiver-defaults/WaiverConfigResolver', () => ({
  getWaiverConfigForLeague: getWaiverConfigForLeagueMock,
}))

vi.mock('@/lib/playoff-defaults/PlayoffConfigResolver', () => ({
  getPlayoffConfigForLeague: getPlayoffConfigForLeagueMock,
}))

vi.mock('@/lib/schedule-defaults/ScheduleConfigResolver', () => ({
  getScheduleConfigForLeague: getScheduleConfigForLeagueMock,
}))

import { buildCanonicalLeagueRulesFromResolved, type CanonicalLeagueRow } from '@/lib/league-runtime'
import { describeStarters, isCanonicalLeagueRules, receptionScoring, renderLeagueRules } from '@/lib/decision-os/grounding/leagueRulesText'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import type { DecisionOsGroundingPacket, GroundedSlice } from '@/lib/decision-os/grounding/packet'

const generatedAt = new Date('2026-07-02T12:00:00.000Z')

const baseLeague: CanonicalLeagueRow = {
  id: 'league-1',
  name: 'Canonical Redraft',
  sport: 'NFL',
  season: 2026,
  leagueType: 'redraft',
  leagueVariant: null,
  scoringPresetId: 'nfl_half_ppr',
  leagueSize: 12,
  rosterSize: 16,
  starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST', 'K'],
  settingsSnapshotVersion: 3,
  presetKey: 'af:v2|concept=redraft|sport=NFL',
  status: 'setup',
  lifecycleState: 'pre_draft',
  timezone: 'America/New_York',
  language: 'en',
  waiverType: 'FAAB',
  waiverBudget: 100,
  waiverMinBid: 1,
  waiverProcessTime: '02:00',
  tradeReviewHours: 48,
  tradeDeadlineWeek: 10,
  draftPickTrading: true,
  playoffStartWeek: 15,
  playoffTeams: 6,
  playoffWeeksPerRound: 1,
  playoffSeedingRule: 'standard_standings',
  playoffLowerBracket: 'consolation',
  irSlots: 2,
  irAllowOut: true,
  irAllowDoubtful: true,
  allowPreDraftMoves: true,
  preventBenchDrops: false,
  lockAllMoves: false,
  disableInviteLinks: false,
  overrideInviteCapacity: false,
  aiChimmyEnabled: true,
  aiWaiverSuggestions: true,
  aiPowerRankings: true,
  leagueSettings: {
    draftDateUtc: '2026-08-24T01:00:00.000Z',
    timezone: 'America/New_York',
    autostart: false,
    cpuAutoPick: true,
    draftType: 'snake',
    pickTimerCustomValue: 90,
    rounds: 16,
    draftOrderMethod: 'manual',
    draftOrderLocked: true,
    playerPool: 'all',
    aiRosterGuidance: true,
  },
}

const draftConfig = {
  draft_type: 'snake',
  rounds: 16,
  timer_seconds: 90,
  slow_timer_seconds: 3600,
  pick_order_rules: 'snake',
  snake_or_linear: 'snake',
  third_round_reversal: false,
  autopick_behavior: 'queue-first',
  queue_size_limit: null,
  pre_draft_ranking_source: 'adp',
  roster_fill_order: 'starter_first',
  position_filter_behavior: 'by_eligibility',
  sport: 'NFL',
  variant: null,
} as const

const draftUiSettings = {
  autoPickEnabled: false,
  timerMode: 'per_pick',
  commissionerForceAutoPickEnabled: true,
  pickTradeEnabled: true,
  importEnabled: true,
  executionMode: 'live',
} as const

const scoringConfig = {
  leagueId: 'league-1',
  sport: 'NFL',
  leagueVariant: null,
  formatType: 'redraft',
  templateId: 'nfl_half_ppr',
  rules: [
    {
      statKey: 'pass_yd',
      pointsValue: 0.04,
      multiplier: 1,
      enabled: true,
      defaultPointsValue: 0.04,
      defaultEnabled: true,
      isOverridden: false,
    },
    {
      statKey: 'rec',
      pointsValue: 0.5,
      multiplier: 1,
      enabled: true,
      defaultPointsValue: 1,
      defaultEnabled: true,
      isOverridden: true,
    },
    {
      statKey: 'misc_disabled',
      pointsValue: 10,
      multiplier: 1,
      enabled: false,
      defaultPointsValue: 10,
      defaultEnabled: false,
      isOverridden: false,
    },
  ],
}

const waiverConfig = {
  waiver_type: 'FAAB',
  processing_days: [2, 5],
  processing_time_utc: '07:00',
  claim_limit_per_period: 4,
  claim_priority_behavior: 'lowest_standing',
  game_lock_behavior: 'lock_at_game_start',
  drop_lock_behavior: 'unlock_after_game',
  same_day_add_drop_rules: 'allow',
  free_agent_unlock_behavior: 'after_clear',
  continuous_waivers: true,
  max_claims_per_period: 6,
  faab_enabled: true,
  faab_budget: 100,
  faab_reset_rules: 'season',
  sport: 'NFL',
  variant: null,
  tiebreak_rule: 'reverse_standings',
  instant_fa_after_clear: false,
}

const playoffConfig = {
  playoff_team_count: 6,
  playoff_weeks: 3,
  playoff_start_week: 15,
  playoff_start_point: null,
  first_round_byes: 2,
  bracket_type: 'single_elimination',
  matchup_length: 1,
  total_rounds: 3,
  consolation_bracket_enabled: true,
  third_place_game_enabled: true,
  toilet_bowl_enabled: false,
  championship_length: 1,
  consolation_plays_for: 'consolation',
  seeding_rules: 'standard_standings',
  tiebreaker_rules: ['points_for'],
  bye_rules: 'top_two',
  reseed_behavior: 'fixed_bracket',
  standings_tiebreakers: ['wins', 'points_for'],
  sport: 'NFL',
  variant: null,
}

const scheduleConfig = {
  schedule_unit: 'week',
  regular_season_length: 14,
  matchup_frequency: 'weekly',
  matchup_cadence: 'weekly',
  schedule_cadence: 'weekly',
  schedule_generation_strategy: 'round_robin',
  playoff_transition_point: 15,
  head_to_head_behavior: 'head_to_head',
  lock_time_behavior: 'first_game',
  lock_window_behavior: 'first_game_of_week',
  scoring_period_behavior: 'full_period',
  reschedule_handling: 'use_final_time',
  doubleheader_handling: 'all_games_count',
  sport: 'NFL',
  variant: null,
}

function buildRules(overrides: Partial<CanonicalLeagueRow> = {}) {
  return buildCanonicalLeagueRulesFromResolved({
    league: { ...baseLeague, ...overrides },
    draftConfig: draftConfig as any,
    draftUiSettings,
    scoringConfig,
    waiverConfig,
    playoffConfig,
    scheduleConfig,
    generatedAt,
  })
}


function absent<T>(): GroundedSlice<T> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: { reason: 'not_requested', detail: 'x', remedy: 'x' } } as unknown as GroundedSlice<T>
}
function packetWithRules(rules: unknown): DecisionOsGroundingPacket {
  return {
    leagueId: 'L1', userId: 'U1', builtAt: '2026-09-02T12:00:00.000Z',
    importAssertions: absent(), marketValues: absent(), devyValues: absent(), projections: absent(),
    leagueRules: { present: true, value: rules, asOf: '2026-09-02T08:00:00.000Z', servedFrom: 'store', confidence: null, conclusive: { ok: true }, gap: null },
    contextFacts: null, contextLookups: null, commissionerIntelligence: absent(), leagueIntelligence: absent(),
    portfolio: absent(), savedAnalysis: absent(), managerPsychology: absent(), gaps: [],
    meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
  } as unknown as DecisionOsGroundingPacket
}

describe('the league rules reach the prompt', () => {
  const rules = buildRules()

  it('recognises the real ruleset', () => {
    expect(isCanonicalLeagueRules(rules)).toBe(true)
    expect(isCanonicalLeagueRules({ version: 1, general: {} })).toBe(false)
  })

  it('🛑 the serialized packet carries PPR, FAAB, the deadline and the playoffs — not "present"', () => {
    const text = serializeDecisionOsGroundingForPrompt(packetWithRules(rules), Date.parse('2026-09-02T12:00:00.000Z'))
    expect(text).toContain('0.5 pts per reception (half PPR)')
    expect(text).toContain('FAAB budget 100, minimum bid')
    expect(text).toContain('Trades: deadline week 10; review period 48 hours; draft picks can be traded.')
    expect(text).toContain('Playoffs: 6 teams from week 15')
    expect(text).toContain('starters QB, RB×2, WR×2, TE, FLEX, DST, K')
    expect(text).toContain('rec=0.5*')
    // The scoring PRESET, not the league format.
    expect(text).toContain('Scoring: preset nfl_half_ppr;')
    expect(text).toContain('at 02:00 league time')
    expect(text).not.toMatch(/scoring: present|trades: present|waivers: present/)
  })

  it('a setting the league does not have on file reads "not on file", never a guessed default', () => {
    const lines = renderLeagueRules(buildRules({ tradeDeadlineWeek: null, tradeReviewHours: null })).join('\n')
    expect(lines).toContain('Trades: deadline not on file; review period not on file')
    expect(lines).toContain('never fill it in from what leagues usually do')
  })

  it('names the reception scoring conventionally, and says when there is none', () => {
    const r = (p: number) => receptionScoring([{ statKey: 'receptions', pointsValue: p, category: null, isOverridden: false }])
    expect(r(1)).toBe('1 pts per reception (full PPR)')
    expect(r(0)).toBe('0 pts per reception (standard (no PPR))')
    expect(r(1.5)).toBe('1.5 pts per reception (1.5 per reception)')
    expect(receptionScoring([])).toBeNull()
    expect(renderLeagueRules({ ...rules, scoring: { ...rules.scoring, activeRules: [] } }).join('\n')).toContain('no reception rule on file')
  })

  it('describes starters from a slot list or a count map, skipping bench and IR', () => {
    expect(describeStarters(['QB', 'RB', 'RB', 'BN', 'IR'])).toBe('QB, RB×2')
    expect(describeStarters({ QB: 1, WR: 3, TE: 0 })).toBe('QB, WR×3')
    expect(describeStarters(null)).toBeNull()
  })
})
