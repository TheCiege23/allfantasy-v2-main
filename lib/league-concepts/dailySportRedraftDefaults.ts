/**
 * Redraft concept preset for the daily-lineup sports — NBA, NHL and MLB — beside the football one in
 * `redraftDefaults.ts` (which stays NFL/NCAAF only: its scoring, team-defense and player-pool rules
 * are football's).
 *
 * Every number here is READ, not restated: the roster from the one layout table
 * (`lib/sportConfig/dailySportRedraftRoster.ts`), the season and bracket from
 * `DAILY_SPORT_SEASON_SHAPE` via the playoff resolver, and the waiver / draft behaviour from the
 * sport-defaults registry. So league creation produces the same defaults that the lineup screen, the
 * lineup validator and the draft room read back.
 *
 * Scoring is deliberately not rebuilt here. The existing per-sport scoring path (format-engine
 * resolution, then the NBA/MLB category presets applied in `getLeagueDefaults` and
 * `createCanonicalLeagueInTransaction`) is unchanged; this contract only resolves WHICH preset id a
 * new league defaults to.
 */
import type { LeagueSport } from '@prisma/client'
import {
  DAILY_REDRAFT_WAIVER_PROCESSING_DAYS,
  dailyRedraftDraftableRosterSize,
  dailyRedraftFlexDefinitions,
  dailyRedraftReserveCount,
  dailyRedraftRosterSlotMap,
  dailyRedraftStarterCount,
  dailyRedraftStarterSlotOrder,
  dailyRedraftStarterSlots,
  dailyRedraftTotalRosterSize,
  getDailyRedraftRosterLayout,
  isDailyRedraftSport,
  type DailyRedraftSport,
} from '@/lib/sportConfig/dailySportRedraftRoster'
import { DAILY_SPORT_SEASON_SHAPE, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'
import { getDraftDefaults, getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { isScoringPresetValidForContext } from '@/lib/league-creation-preset/scoring-presets'
import {
  getRedraftEngineDraftType,
  normalizeRedraftDraftType,
  type RedraftDraftType,
} from '@/lib/league-concepts/redraftDefaults'

export type { DailyRedraftSport }

export const DAILY_REDRAFT_DEFAULTS_VERSION = 1

export interface DailyRedraftRosterTemplate {
  rosterMode: 'redraft'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  reserveSlots: Record<string, number>
  taxiSlots: 0
  keeperSlots: 0
  rosterSlots: number
  draftableRosterSlots: number
  totalRosterSlots: number
  starterSlotOrder: string[]
  rosterSlotOrder: string[]
  /** `{ slot: count }` incl. BN and reserve — the `<sport>_roster_config.slots` shape. */
  rosterSlotMap: Record<string, number>
  draftablePlayerPositions: string[]
}

export interface DailyRedraftDefaultContract {
  sport: DailyRedraftSport
  leagueType: 'redraft'
  draft_type: 'snake' | 'linear' | 'auction'
  requested_draft_type: RedraftDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'redraft'
  lineupFrequency: 'daily'
  rosterTemplate: DailyRedraftRosterTemplate
  draftSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  playoffSettings: Record<string, unknown>
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDailyRedraftDefaultsSport(sport: unknown): sport is DailyRedraftSport {
  return isDailyRedraftSport(sport)
}

/** `<sport>_points` unless the caller named a preset that is valid for a redraft league of this sport. */
export function resolveDailyRedraftScoringPresetId(sport: DailyRedraftSport, presetId?: string | null): string {
  const raw = typeof presetId === 'string' ? presetId.trim() : ''
  if (raw && isScoringPresetValidForContext(raw, { sport, leagueType: 'redraft', idpSelected: false })) return raw
  return `${sport.toLowerCase()}_points`
}

function buildRosterTemplate(sport: DailyRedraftSport): DailyRedraftRosterTemplate {
  const layout = getDailyRedraftRosterLayout(sport)!
  const starterSlotOrder = dailyRedraftStarterSlotOrder(layout)
  const reserveOrder = Object.entries(layout.reserveSlots).flatMap(([key, count]) =>
    Array.from({ length: count }, () => key),
  )
  return {
    rosterMode: 'redraft',
    starterSlots: dailyRedraftStarterSlots(layout),
    flexDefinitions: dailyRedraftFlexDefinitions(layout),
    benchSlots: layout.benchSlots,
    irSlots: dailyRedraftReserveCount(layout),
    reserveSlots: { ...layout.reserveSlots },
    taxiSlots: 0,
    keeperSlots: 0,
    rosterSlots: dailyRedraftStarterCount(layout),
    draftableRosterSlots: dailyRedraftDraftableRosterSize(layout),
    totalRosterSlots: dailyRedraftTotalRosterSize(layout),
    starterSlotOrder,
    rosterSlotOrder: [...starterSlotOrder, ...Array.from({ length: layout.benchSlots }, () => 'BN'), ...reserveOrder],
    rosterSlotMap: dailyRedraftRosterSlotMap(layout),
    draftablePlayerPositions: [...layout.draftablePlayerPositions],
  }
}

function buildDraftSettings(
  sport: DailyRedraftSport,
  requestedDraftType: RedraftDraftType,
  rosterTemplate: DailyRedraftRosterTemplate,
): Record<string, unknown> {
  const registry = getDraftDefaults(sport)
  const draftType = getRedraftEngineDraftType(requestedDraftType)
  const pickOrderRules = draftType === 'linear' ? 'linear' : 'snake'
  return {
    draftType,
    requestedDraftType,
    // Rounds = the players a team drafts (starters + bench); reserve slots are not drafted.
    rounds: rosterTemplate.draftableRosterSlots,
    timerSeconds: registry.timer_seconds_default ?? 90,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false,
    autopickBehavior: registry.autopick_behavior,
    queueSizeLimit: registry.queue_size_limit,
    preDraftRankingSource: registry.pre_draft_ranking_source,
    rosterFillOrder: registry.roster_fill_order,
    positionFilterBehavior: registry.position_filter_behavior,
    auctionBudgetPerTeam: draftType === 'auction' ? 200 : null,
  }
}

/** Both spellings, one value each — the mirror `getLeagueDefaults` projects. */
function buildWaiverSettings(sport: DailyRedraftSport): Record<string, unknown> {
  const registry = getWaiverDefaults(sport, 'redraft')
  const processingDays = [...DAILY_REDRAFT_WAIVER_PROCESSING_DAYS]
  return {
    ...registry,
    processing_days: processingDays,
    waiverType: registry.waiver_type,
    faabBudget: registry.FAAB_budget_default,
    processingDays,
    processingTimeUtc: registry.processing_time_utc,
    freeAgentUnlockBehavior: registry.free_agent_unlock_behavior,
    gameLockBehavior: registry.game_lock_behavior,
  }
}

/** A bracket never seats more teams than the league has (same rule as football redraft). */
function fitPlayoffTeams(sport: DailyRedraftSport, teamCount: number): number {
  const seats = Math.max(2, Math.floor(teamCount) || 2)
  const target = seats >= 10 ? DAILY_SPORT_SEASON_SHAPE[sport].playoffTeams : 4
  const fitted = Math.min(target, seats)
  return fitted % 2 === 0 ? fitted : fitted - 1
}

function buildPlayoffSettings(sport: DailyRedraftSport, teamCount: number): Record<string, unknown> {
  const registry = resolveDefaultPlayoffConfig(sport)
  const playoffTeams = fitPlayoffTeams(sport, teamCount)
  const regularSeasonEndWeek = regularSeasonWeeksFor(sport)
  return {
    ...registry,
    playoff_team_count: playoffTeams,
    enabled: true,
    regularSeasonStartWeek: 1,
    regularSeasonEndWeek,
    playoffTeams,
    playoffStartWeek: registry.playoff_start_week,
    playoffWeeks: registry.playoff_weeks,
    championshipWeek: DAILY_SPORT_SEASON_SHAPE[sport].totalWeeks,
    playoffWeeksPerRound: registry.matchup_length ?? 1,
    topSeedByes: playoffTeams === 6 && (registry.first_round_byes ?? 0) > 0,
    lowerBracket: registry.consolation_bracket_enabled ? 'consolation' : 'none',
  }
}

export function getDailyRedraftDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): DailyRedraftDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isDailyRedraftSport(normalizedSport)) return null
  const sport = normalizedSport
  const teams = asPositiveInt(input.teamCount, 12)
  const requestedDraftType = normalizeRedraftDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  return {
    sport,
    leagueType: 'redraft',
    draft_type: draftSettings.draftType as 'snake' | 'linear' | 'auction',
    requested_draft_type: requestedDraftType,
    teams,
    rounds: rosterTemplate.draftableRosterSlots,
    timer_seconds: draftSettings.timerSeconds as number,
    scoring_preset_id: resolveDailyRedraftScoringPresetId(sport, input.scoringPresetId),
    roster_mode: 'redraft',
    lineupFrequency: 'daily',
    rosterTemplate,
    draftSettings,
    waiverSettings: buildWaiverSettings(sport),
    playoffSettings: buildPlayoffSettings(sport, teams),
  }
}

/**
 * The `League.settings` keys a new NBA/NHL/MLB redraft league is created with. No `scoringSettings`
 * key on purpose — see the module header.
 */
export function buildDailyRedraftSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getDailyRedraftDefaultContract(input)
  if (!contract) return null
  const { rosterTemplate, draftSettings } = contract
  return {
    dailyRedraftDefaultsVersion: DAILY_REDRAFT_DEFAULTS_VERSION,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'redraft',
    league_type: 'redraft',
    roster_mode: 'redraft',
    lineup_frequency: contract.lineupFrequency,
    teams: contract.teams,
    default_team_count: contract.teams,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    draft_type: contract.draft_type,
    requested_draft_type: contract.requested_draft_type,
    draft_rounds: contract.rounds,
    rounds: contract.rounds,
    draft_timer_seconds: contract.timer_seconds,
    timer_seconds: contract.timer_seconds,
    roster_size: rosterTemplate.draftableRosterSlots,
    rosterSize: rosterTemplate.draftableRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    starter_slot_order: rosterTemplate.starterSlotOrder,
    roster_slot_order: rosterTemplate.rosterSlotOrder,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'redraft',
      starterSlots: rosterTemplate.starterSlots,
      starter_slots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      reserveSlots: rosterTemplate.reserveSlots,
      taxiSlots: 0,
      devySlots: 0,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.draftableRosterSlots,
      totalRosterSlots: rosterTemplate.totalRosterSlots,
      starterSlotOrder: rosterTemplate.starterSlotOrder,
      rosterSlotOrder: rosterTemplate.rosterSlotOrder,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
    },
    draftSettings,
    waiverSettings: contract.waiverSettings,
    waiver_settings: contract.waiverSettings,
    playoffSettings: contract.playoffSettings,
    playoff_settings: contract.playoffSettings,
    taxi: false,
    keepers: false,
    keepers_enabled: false,
    devy: false,
    c2c: false,
    isDynasty: false,
  }
}

/**
 * Defaults, then the incoming settings, then the structural roster keys put back — a commissioner's
 * later roster edit goes through the roster engine (`<sport>_roster_config`), not through creation.
 */
export function normalizeDailyRedraftSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const defaults =
    buildDailyRedraftSettingsSnapshot({
      sport: input.sport,
      draftType: input.draftType ?? incoming.requested_draft_type ?? incoming.draft_type,
      scoringPresetId:
        typeof incoming.scoring_preset_id === 'string' ? incoming.scoring_preset_id : input.scoringPresetId,
      teamCount:
        typeof incoming.default_team_count === 'number' ? incoming.default_team_count : input.teamCount,
    }) ?? {}
  const merged: Record<string, unknown> = { ...defaults, ...incoming }
  for (const key of [
    'roster_mode',
    'league_type',
    'leagueType',
    'rosterTemplate',
    'rosterSettings',
    'starter_slots',
    'starter_slot_order',
    'roster_slot_order',
    'bench_slots',
    'ir_slots',
    'taxi_slots',
    'roster_size',
    'rosterSize',
    'scoring_preset_id',
    'draft_type',
    'requested_draft_type',
  ]) {
    if (key in defaults) merged[key] = defaults[key]
  }
  const draftSettings = isRecord(incoming.draftSettings) ? incoming.draftSettings : {}
  const rounds = asPositiveInt(incoming.draft_rounds ?? draftSettings.rounds, Number(defaults.draft_rounds) || 1)
  merged.draft_rounds = rounds
  merged.rounds = rounds
  merged.draftSettings = { ...((defaults.draftSettings as Record<string, unknown>) ?? {}), ...draftSettings, rounds }
  return merged
}
