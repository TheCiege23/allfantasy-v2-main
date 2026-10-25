import type { League, LeagueSport, Prisma } from '@prisma/client'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { capSlotTokens, readGamesLimits, type GamesLimits } from '@/lib/redraft/gamesLimits'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { readLineupMode, type LineupMode } from '@/lib/redraft/lineupModeSwitch'

/** Subset of `League` exposed to commissioner settings UI (GET + PATCH). */
export type CommissionerSettingsFormData = {
  sport?: LeagueSport | null
  season?: number | null
  language?: string | null
  logoUrl?: string | null
  timezone?: string | null
  waiverType?: string | null
  waiverBudget?: number | null
  waiverMinBid?: number | null
  waiverClearAfterGames?: boolean | null
  waiverHours?: number | null
  customDailyWaivers?: boolean | null
  waiverProcessTime?: string | null
  waiverSchedule?: Prisma.JsonValue | null
  tradeReviewHours?: number | null
  tradeDeadlineWeek?: number | null
  draftPickTrading?: boolean | null
  playoffStartWeek?: number | null
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
  /**
   * Weeks the final is scored over (`settings.playoff_structure.championship_length`); null when the
   * league never stored one. Not a column — PATCHed as `championshipLength` (execute-league-settings-patch).
   */
  championshipLength?: number | null
  /** `settings.games_limits` (lib/redraft/gamesLimits.ts); null = off. PATCHed as `gamesLimits`. */
  gamesLimits?: GamesLimits | null
  /** Whether the league scores daily lineups — games limits are refused without it. Read-only here. */
  dailyLineupsActive?: boolean
  /** Starter slots a games-played cap may name in this league (NBA/NHL/MLB; empty otherwise). */
  gamesLimitsCapSlots?: string[]
  /**
   * Daily or weekly lineups (NBA/NHL/MLB; lib/redraft/lineupModeSwitch.ts), read from the two
   * `settings.sportConfig` fields the scorer and the lock read. Not a column — PATCHed as `lineupMode`.
   */
  lineupMode?: LineupMode
  playoffSeedingRule?: string | null
  playoffLowerBracket?: string | null
  irSlots?: number | null
  irAllowCovid?: boolean | null
  irAllowOut?: boolean | null
  irAllowSuspended?: boolean | null
  irAllowNA?: boolean | null
  irAllowDNR?: boolean | null
  irAllowDoubtful?: boolean | null
  leagueType?: string | null
  medianGame?: boolean | null
  /**
   * Whether the league median also plays in playoff weeks (`settings.median_game_in_playoffs`,
   * lib/redraft/medianGame.ts); false unless stored true. Not a column — PATCHed as `medianGameInPlayoffs`.
   */
  medianGameInPlayoffs?: boolean
  allowPreDraftMoves?: boolean | null
  preventBenchDrops?: boolean | null
  lockAllMoves?: boolean | null
  dispersalDraftRounds?: number | null
  taxiSlots?: number | null
  taxiAllowNonRookies?: boolean | null
  taxiYearsLimit?: number | null
  taxiDeadlineWeek?: number | null
  overrideInviteCapacity?: boolean | null
  disableInviteLinks?: boolean | null
  aiChimmyEnabled?: boolean | null
  aiWaiverSuggestions?: boolean | null
  aiTradeAnalysis?: boolean | null
  aiLineupHelp?: boolean | null
  aiDraftRecs?: boolean | null
  aiRecaps?: boolean | null
  leagueAiCommissionerAlerts?: boolean | null
  aiModeration?: boolean | null
  aiPowerRankings?: boolean | null
  rosterSize?: number | null
  leagueSize?: number | null
  name?: string | null
  scoring?: string | null
  isDynasty?: boolean | null

  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperMaxYears?: number | null
  keeperWaiverAllowed?: boolean | null
  keeperEligibilityRule?: string | null
  keeperMinRoundsHeld?: number | null
  keeperRoundPenalty?: number | null
  keeperInflationRate?: number | null
  keeperAuctionPctIncrease?: number | null
  keeperSelectionDeadline?: string | null
  keeperPhaseActive?: boolean | null
  dynastySeasonPhase?: string | null
  keeperConflictRule?: string | null
  keeperMissedDeadlineRule?: string | null
}

export function commissionerLeagueFieldsFromRow(
  league: Pick<
    League,
    | 'name'
    | 'sport'
    | 'season'
    | 'language'
    | 'logoUrl'
    | 'timezone'
    | 'waiverType'
    | 'waiverBudget'
    | 'waiverMinBid'
    | 'waiverClearAfterGames'
    | 'waiverHours'
    | 'customDailyWaivers'
    | 'waiverProcessTime'
    | 'waiverSchedule'
    | 'tradeReviewHours'
    | 'tradeDeadlineWeek'
    | 'draftPickTrading'
    | 'playoffStartWeek'
    | 'playoffTeams'
    | 'playoffWeeksPerRound'
    | 'playoffSeedingRule'
    | 'playoffLowerBracket'
    | 'irSlots'
    | 'irAllowCovid'
    | 'irAllowOut'
    | 'irAllowSuspended'
    | 'irAllowNA'
    | 'irAllowDNR'
    | 'irAllowDoubtful'
    | 'leagueType'
    | 'medianGame'
    | 'allowPreDraftMoves'
    | 'preventBenchDrops'
    | 'lockAllMoves'
    | 'dispersalDraftRounds'
    | 'taxiSlots'
    | 'taxiAllowNonRookies'
    | 'taxiYearsLimit'
    | 'taxiDeadlineWeek'
    | 'overrideInviteCapacity'
    | 'disableInviteLinks'
    | 'aiChimmyEnabled'
    | 'aiWaiverSuggestions'
    | 'aiTradeAnalysis'
    | 'aiLineupHelp'
    | 'aiDraftRecs'
    | 'aiRecaps'
    | 'leagueAiCommissionerAlerts'
    | 'aiModeration'
    | 'aiPowerRankings'
    | 'rosterSize'
    | 'leagueSize'
    | 'scoring'
    | 'isDynasty'
    | 'keeperCount'
    | 'keeperCostSystem'
    | 'keeperMaxYears'
    | 'keeperWaiverAllowed'
    | 'keeperEligibilityRule'
    | 'keeperMinRoundsHeld'
    | 'keeperRoundPenalty'
    | 'keeperInflationRate'
    | 'keeperAuctionPctIncrease'
    | 'keeperSelectionDeadline'
    | 'keeperPhaseActive'
    | 'dynastySeasonPhase'
    | 'keeperConflictRule'
    | 'keeperMissedDeadlineRule'
  > & { settings?: unknown },
): CommissionerSettingsFormData {
  return {
    name: league.name,
    sport: league.sport,
    season: league.season,
    language: league.language,
    logoUrl: league.logoUrl,
    timezone: league.timezone,
    waiverType: league.waiverType,
    waiverBudget: league.waiverBudget,
    waiverMinBid: league.waiverMinBid,
    waiverClearAfterGames: league.waiverClearAfterGames,
    waiverHours: league.waiverHours,
    customDailyWaivers: league.customDailyWaivers,
    waiverProcessTime: league.waiverProcessTime,
    waiverSchedule: league.waiverSchedule,
    tradeReviewHours: league.tradeReviewHours,
    tradeDeadlineWeek: league.tradeDeadlineWeek,
    draftPickTrading: league.draftPickTrading,
    playoffStartWeek: league.playoffStartWeek,
    playoffTeams: league.playoffTeams,
    playoffWeeksPerRound: league.playoffWeeksPerRound,
    championshipLength: readChampionshipLength(league.settings),
    gamesLimits: readGamesLimits(league.settings, league.sport),
    dailyLineupsActive: isDailyLineupScoringEnabled(league.settings, league.sport),
    gamesLimitsCapSlots: ['NBA', 'NHL', 'MLB'].includes(String(league.sport)) ? capSlotTokens(String(league.sport), league.settings) : [],
    lineupMode: readLineupMode(league.settings, league.sport),
    playoffSeedingRule: league.playoffSeedingRule,
    playoffLowerBracket: league.playoffLowerBracket,
    irSlots: league.irSlots,
    irAllowCovid: league.irAllowCovid,
    irAllowOut: league.irAllowOut,
    irAllowSuspended: league.irAllowSuspended,
    irAllowNA: league.irAllowNA,
    irAllowDNR: league.irAllowDNR,
    irAllowDoubtful: league.irAllowDoubtful,
    leagueType: league.leagueType,
    medianGame: league.medianGame,
    medianGameInPlayoffs: readMedianGameInPlayoffs(league.settings),
    allowPreDraftMoves: league.allowPreDraftMoves,
    preventBenchDrops: league.preventBenchDrops,
    lockAllMoves: league.lockAllMoves,
    dispersalDraftRounds: league.dispersalDraftRounds,
    taxiSlots: league.taxiSlots,
    taxiAllowNonRookies: league.taxiAllowNonRookies,
    taxiYearsLimit: league.taxiYearsLimit,
    taxiDeadlineWeek: league.taxiDeadlineWeek,
    overrideInviteCapacity: league.overrideInviteCapacity,
    disableInviteLinks: league.disableInviteLinks,
    aiChimmyEnabled: league.aiChimmyEnabled,
    aiWaiverSuggestions: league.aiWaiverSuggestions,
    aiTradeAnalysis: league.aiTradeAnalysis,
    aiLineupHelp: league.aiLineupHelp,
    aiDraftRecs: league.aiDraftRecs,
    aiRecaps: league.aiRecaps,
    leagueAiCommissionerAlerts: league.leagueAiCommissionerAlerts,
    aiModeration: league.aiModeration,
    aiPowerRankings: league.aiPowerRankings,
    rosterSize: league.rosterSize,
    leagueSize: league.leagueSize,
    scoring: league.scoring,
    isDynasty: league.isDynasty,
    keeperCount: league.keeperCount,
    keeperCostSystem: league.keeperCostSystem,
    keeperMaxYears: league.keeperMaxYears,
    keeperWaiverAllowed: league.keeperWaiverAllowed,
    keeperEligibilityRule: league.keeperEligibilityRule,
    keeperMinRoundsHeld: league.keeperMinRoundsHeld,
    keeperRoundPenalty: league.keeperRoundPenalty,
    keeperInflationRate: league.keeperInflationRate,
    keeperAuctionPctIncrease: league.keeperAuctionPctIncrease,
    keeperSelectionDeadline: league.keeperSelectionDeadline?.toISOString() ?? null,
    keeperPhaseActive: league.keeperPhaseActive,
    dynastySeasonPhase: league.dynastySeasonPhase,
    keeperConflictRule: league.keeperConflictRule,
    keeperMissedDeadlineRule: league.keeperMissedDeadlineRule,
  }
}

/**
 * 🛑 `sport` is deliberately NOT patchable. A league's sport is fixed at creation: rosters, slot
 * definitions, scoring templates and the player pool all key off it, so flipping it on a live
 * league leaves an NBA league rendering NFL rosters and scoring. A settings form that defaulted
 * an unset sport to 'NFL' and auto-saved it is one way that happened.
 */
const LEAGUE_PATCH_KEYS: (keyof Prisma.LeagueUpdateInput)[] = [
  'name',
  'season',
  'language',
  'logoUrl',
  'timezone',
  'waiverType',
  'waiverBudget',
  'waiverMinBid',
  'waiverClearAfterGames',
  'waiverHours',
  'customDailyWaivers',
  'waiverProcessTime',
  'waiverSchedule',
  'tradeReviewHours',
  'tradeDeadlineWeek',
  'draftPickTrading',
  'playoffStartWeek',
  'playoffTeams',
  'playoffWeeksPerRound',
  'playoffSeedingRule',
  'playoffLowerBracket',
  'irSlots',
  'irAllowCovid',
  'irAllowOut',
  'irAllowSuspended',
  'irAllowNA',
  'irAllowDNR',
  'irAllowDoubtful',
  'leagueType',
  'medianGame',
  'allowPreDraftMoves',
  'preventBenchDrops',
  'lockAllMoves',
  'dispersalDraftRounds',
  'taxiSlots',
  'taxiAllowNonRookies',
  'taxiYearsLimit',
  'taxiDeadlineWeek',
  'overrideInviteCapacity',
  'disableInviteLinks',
  'aiChimmyEnabled',
  'aiWaiverSuggestions',
  'aiTradeAnalysis',
  'aiLineupHelp',
  'aiDraftRecs',
  'aiRecaps',
  'leagueAiCommissionerAlerts',
  'aiModeration',
  'aiPowerRankings',
  'rosterSize',
  'leagueSize',
  'scoring',
  'isDynasty',
  'keeperCount',
  'keeperCostSystem',
  'keeperMaxYears',
  'keeperWaiverAllowed',
  'keeperEligibilityRule',
  'keeperMinRoundsHeld',
  'keeperRoundPenalty',
  'keeperInflationRate',
  'keeperAuctionPctIncrease',
  'keeperSelectionDeadline',
  'keeperPhaseActive',
  'dynastySeasonPhase',
  'keeperConflictRule',
  'keeperMissedDeadlineRule',
]

export function buildLeagueUpdateFromBody(body: Record<string, unknown>): {
  data: Prisma.LeagueUpdateInput
  keys: string[]
} {
  const data: Prisma.LeagueUpdateInput = {}
  const keys: string[] = []

  for (const key of LEAGUE_PATCH_KEYS) {
    if (body[key as string] === undefined) continue
    const raw = body[key as string]
    if (key === 'keeperSelectionDeadline') {
      ;(data as Record<string, unknown>)[key] =
        raw === null ? null : new Date(String(raw))
    } else {
      ;(data as Record<string, unknown>)[key as string] = raw
    }
    keys.push(key as string)
  }

  return { data, keys }
}
