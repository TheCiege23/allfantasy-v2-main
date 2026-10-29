/**
 * Build a league's RuleSnapshot (./types.ts) from the stored rows. No database access here: the
 * read path (./load.ts) passes the extras it fetched, and the settings save passes the league row it
 * already holds before and after the write.
 *
 * Every reader below is the one the engine or the settings page already uses, so the popup can never
 * describe a rule differently from how it runs:
 *   playoff start week   resolvePlayoffStartWeek (the settings home row)
 *   series / final       readPlayoffSeriesLengths, readChampionshipLength
 *   third-place game     readThirdPlaceGameEnabled (stored value, else the sport default)
 *   lineup mode          readLineupMode (exactly what the scorer and the lock read)
 *   trade deadline time  readDeadlineAt (`settings.trade_deadline_at`)
 *   daily claim days     readDailyWaiverScheduleFromSettings
 *   guillotine endgame   resolveGuillotineEndgame; chop schedule readAdvanced; FAAB rule readFaabOnChop
 *   dynasty family       isDynastyFamilyLeague; pick trading isDraftPickTradingAllowed; pick deadline
 *                        readPickTradeDeadline; pick terms readPickTermsEnabled; taxi stealing
 *                        readTaxiStealingRule; taxi seasons readTaxiMaxYears
 *   imported playoffs    readPlayoffFormat (the import-aware reader the standings board uses)
 */

import { readChosenPlayoffStartWeek, resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { readPlayoffSeriesLengths } from '@/lib/playoff-runtime/playoffSeries'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { readThirdPlaceGameEnabled } from '@/lib/playoff-runtime/thirdPlaceGame'
import { readLineupMode } from '@/lib/redraft/lineupModeSwitch'
import { readDeadlineAt } from '@/lib/trade-deadline/tradeDeadlineTime'
import { isWaiverProcessingMode, readDailyWaiverScheduleFromSettings, WAIVER_DAY_KEYS } from '@/lib/waivers/dailyWaiverSchedule'
import { resolveGuillotineEndgame } from '@/lib/guillotine/endgameRules'
import { readAdvanced, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { readFaabOnChop } from '@/lib/guillotine/faabOnChop'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/dynastyFamily'
import { isDraftPickTradingAllowed } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { readPickTradeDeadline } from '@/lib/trade-deadline/pickTradeDeadline'
import { readPickTermsEnabled } from '@/lib/league-trade-engine/pickTerms'
import { readTaxiStealingRule } from '@/lib/taxi/taxiStealing'
import { readTaxiMaxYears } from '@/lib/taxi/taxiMaxYears'
import { supportsDailyLineups } from '@/lib/redraft/lineupModeSwitch'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'
import { readTankingPenaltyPolicy } from '@/lib/integrity/tankingPenalties'
import { readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'
import { RULES_EXPLAINER_SPORTS, type RuleSnapshot, type RulesConcept, type RulesFormat, type TankingPenaltyRule } from './types'

/** The `League` columns a snapshot reads. A full Prisma `League` row satisfies it. */
export type RulesLeagueRow = {
  platform?: string | null
  sport?: string | null
  leagueSize?: number | null
  scoring?: string | null
  leagueType?: string | null
  leagueVariant?: string | null
  guillotineMode?: boolean | null
  guillotineEndgame?: string | null
  isDynasty?: boolean | null
  bestBallMode?: boolean | null
  survivorMode?: boolean | null
  medianGame?: boolean | null
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  playoffWeeksPerRound?: number | null
  tradeDeadlineWeek?: number | null
  tradeReviewHours?: number | null
  waiverType?: string | null
  waiverBudget?: number | null
  waiverMinBid?: number | null
  waiverHours?: number | null
  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperMaxYears?: number | null
  draftPickTrading?: boolean | null
  settings?: unknown
}

/**
 * Formats that are their own game, explained by concept only (`specialty`). The variant or the league
 * type names them; either is enough.
 */
const SPECIALTY_CONCEPTS: Record<string, RulesConcept> = {
  survivor: 'survivor',
  survivor_guillotine: 'survivor_guillotine',
  big_brother: 'big_brother',
  zombie: 'zombie',
  tournament: 'tournament',
  salary_cap: 'salary_cap',
  contract_dynasty: 'salary_cap',
  king_of_the_hill: 'king_of_the_hill',
  koth: 'king_of_the_hill',
  pirate: 'pirate_vampire',
  vampire: 'pirate_vampire',
  pirate_vampire: 'pirate_vampire',
  royal: 'royal',
}
const BEST_BALL_VARIANTS = new Set(['best_ball', 'bestball'])
const DEVY_VARIANTS = new Set(['devy_dynasty', 'devy'])
const C2C_VARIANTS = new Set(['merged_devy_c2c', 'c2c'])
const DYNASTY_VARIANTS = new Set(['dynasty', 'dynasty_idp', ...DEVY_VARIANTS, ...C2C_VARIANTS])

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function posInt(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function nonNegNumber(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

export function rulesSportOf(sport: unknown): string {
  return String(sport ?? '').trim().toUpperCase()
}

function lower(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/** The specialty concept the variant or type names, if any. */
function specialtyConcept(row: RulesLeagueRow): RulesConcept | null {
  if (row.survivorMode) return lower(row.leagueVariant) === 'survivor_guillotine' ? 'survivor_guillotine' : 'survivor'
  return SPECIALTY_CONCEPTS[lower(row.leagueVariant)] ?? SPECIALTY_CONCEPTS[lower(row.leagueType)] ?? null
}

/**
 * The format the popup explains, or null when it cannot tell. Most specific first: a specialty game
 * (Survivor Guillotine is Survivor, not a guillotine league), then guillotine, best ball, the dynasty
 * family, keeper, redraft. IDP is a scoring modifier, not a format, so an `idp` variant on a redraft
 * league is redraft.
 */
export function resolveRulesFormat(row: RulesLeagueRow): RulesFormat | null {
  const variant = lower(row.leagueVariant)
  const type = lower(row.leagueType)
  if (specialtyConcept(row)) return 'specialty'
  if (row.guillotineMode === true || type === 'guillotine' || variant === 'guillotine') return 'guillotine'
  if (row.bestBallMode === true || BEST_BALL_VARIANTS.has(variant) || type === 'best_ball' || type === 'bestball') return 'best_ball'
  if (isDynastyFamilyLeague(row) || DYNASTY_VARIANTS.has(variant)) return 'dynasty'
  if (type === 'keeper' || variant === 'keeper') return 'keeper'
  return type === 'redraft' || variant === 'redraft' || variant === 'idp' ? 'redraft' : null
}

/** The concept the overview names beyond the format: Devy / C2C within dynasty, or the specialty game. */
export function resolveRulesConcept(row: RulesLeagueRow): RulesConcept | null {
  const special = specialtyConcept(row)
  if (special) return special
  const variant = lower(row.leagueVariant)
  const type = lower(row.leagueType)
  if (C2C_VARIANTS.has(variant) || type === 'c2c') return 'c2c'
  if (DEVY_VARIANTS.has(variant) || type === 'devy') return 'devy'
  return null
}

/** In scope: an AllFantasy-hosted league in a sport we host, whose format the popup can name. */
export function isRulesExplainerLeague(row: RulesLeagueRow): boolean {
  if (!isNativePlatform(row.platform ?? null)) return false
  if (!(RULES_EXPLAINER_SPORTS as readonly string[]).includes(rulesSportOf(row.sport))) return false
  return resolveRulesFormat(row) !== null
}

/**
 * An imported league gets the popup too, built only from what an import carries. Its rules change on
 * its platform, so it never has a "What changed" card.
 */
export function isImportedRulesLeague(row: RulesLeagueRow): boolean {
  return !isNativePlatform(row.platform ?? null) && (RULES_EXPLAINER_SPORTS as readonly string[]).includes(rulesSportOf(row.sport))
}

function normalizedWaiverType(raw: unknown): string | null {
  const t = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (!t) return null
  if (t === 'faab') return 'faab'
  if (t === 'reverse_standings' || t === 'reverse_order') return 'reverse_standings'
  if (t === 'rolling') return 'rolling'
  return null
}

/** The trade review the popup shows. Exported for saves that write it outside the settings patch. */
export function tradeReviewMode(settings: Record<string, unknown>): string | null {
  const json = record(settings.settingsJson)
  const raw = String(settings.trade_review_mode ?? settings.tradeReviewMode ?? json.tradeReviewMode ?? '').trim().toLowerCase()
  return ['commissioner', 'league_vote', 'instant', 'none'].includes(raw) ? raw : null
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function playoffByes(settings: Record<string, unknown>, teams: number | null): number | null {
  if (!teams || teams < 2) return null
  const plan = settings.playoff_bye_plan
  if (Array.isArray(plan) && plan.length > 0) {
    const n = plan.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).length
    return n
  }
  return nextPowerOfTwo(teams) - teams
}

/**
 * The rules readable from the `League` row alone. This is the half both the popup and the settings
 * save can compute, so a save's before/after uses exactly the readers the popup does.
 */
export function ruleSnapshotFromLeague(row: RulesLeagueRow): RuleSnapshot {
  const sport = rulesSportOf(row.sport)
  const format = resolveRulesFormat(row)
  const settings = record(row.settings)
  const playoffTeams = posInt(row.playoffTeams)
  const schedule = readDailyWaiverScheduleFromSettings(row.settings)
  const deadlineAt = readDeadlineAt(row.settings)
  const scoringMode = String(settings.scoring_mode ?? settings.scoringMode ?? '').trim().toLowerCase() || null
  const snapshot: RuleSnapshot = {
    sport,
    format,
    teamCount: posInt(row.leagueSize),
    scoringMode,
    scoringPreset: typeof row.scoring === 'string' && row.scoring.trim() ? row.scoring.trim().toLowerCase() : null,
    categoryRecordMode: scoringMode && scoringMode !== 'points' && typeof settings.category_record_mode === 'string' ? settings.category_record_mode : null,
    tradeDeadlineWeek: posInt(row.tradeDeadlineWeek),
    tradeDeadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
    tradeReview: tradeReviewMode(settings),
    tradeReviewHours: nonNegNumber(row.tradeReviewHours),
    waiverType: normalizedWaiverType(row.waiverType),
    waiverBudget: nonNegNumber(row.waiverBudget),
    waiverMinBid: nonNegNumber(row.waiverMinBid),
    waiverHours: nonNegNumber(row.waiverHours),
    waiverDays: schedule?.enabled ? WAIVER_DAY_KEYS.filter((d) => isWaiverProcessingMode(schedule.days[d])) : null,
    waiverProcessHour: schedule?.enabled ? schedule.processHour : null,
    lineupMode: supportsDailyLineups(sport) ? readLineupMode(row.settings, sport) : null,
    concept: resolveRulesConcept(row),
  }

  if (format === 'keeper') {
    snapshot.keeperCount = nonNegNumber(row.keeperCount)
    snapshot.keeperCost = typeof row.keeperCostSystem === 'string' && row.keeperCostSystem.trim() ? row.keeperCostSystem.trim().toLowerCase() : null
    snapshot.keeperMaxYears = posInt(row.keeperMaxYears)
  }
  if (format === 'keeper' || format === 'dynasty') {
    snapshot.pickTrading = isDraftPickTradingAllowed(row)
  }
  if (format === 'dynasty') {
    const pick = readPickTradeDeadline(row.settings)
    snapshot.pickTradeDeadline = pick.mode === 'week' ? pick.week : pick.mode
    snapshot.pickTerms = readPickTermsEnabled(row.settings)
    const steal = readTaxiStealingRule(row.settings)
    snapshot.taxiStealing = steal.enabled ? { hours: steal.protectHours, claims: steal.claimsPerSeason } : null
    snapshot.taxiMaxYears = readTaxiMaxYears(row.settings)
    // The rookie-draft order, rounds and type live on DynastyLeagueConfig (read path, ./load.ts).
    snapshot.rookieDraftAutoStartDays = readRookieDraftCalendarSettings(row.settings).autoStartDays
    snapshot.tankingPenalty = tankingPenaltyRule(row.settings)
  }

  if (format === 'guillotine') {
    snapshot.endgame = resolveGuillotineEndgame({ settings: row.settings, guillotineEndgame: row.guillotineEndgame ?? null }).format
    snapshot.faabOnChop = readFaabOnChop(row.settings)
    Object.assign(snapshot, guillotineAdvancedSnapshot(readAdvanced(row.settings)))
  } else if (format === 'redraft' || format === 'keeper' || format === 'dynasty') {
    snapshot.medianGame = row.medianGame === true
    snapshot.playoffTeams = playoffTeams
    snapshot.playoffStartWeek = playoffTeams
      ? resolvePlayoffStartWeek({ playoffStartWeek: row.playoffStartWeek, settings: row.settings, sport, leagueVariant: row.leagueVariant }).week
      : null
    snapshot.playoffWeeksPerRound = posInt(row.playoffWeeksPerRound)
    snapshot.championshipLength = readChampionshipLength(row.settings)
    snapshot.playoffSeries = sport === 'NBA' || sport === 'NHL' ? readPlayoffSeriesLengths(row.settings) : null
    snapshot.playoffByes = playoffByes(settings, playoffTeams)
    snapshot.thirdPlaceGame = playoffTeams ? readThirdPlaceGameEnabled(row.settings, sport, row.leagueVariant) : null
  }
  return snapshot
}

/** Sleeper-shaped settings nest the provider's league under a key; read through it as the rules card does. */
function providerBundle(settings: unknown): Record<string, unknown> {
  const s = record(settings)
  const nested = record(s.sleeper ?? s.sleeperLeague ?? s.league)
  return Object.keys(nested).length ? { ...s, ...nested } : s
}

/**
 * An imported league's rules, from what its import carries and nothing else.
 *
 * ⚠ ITS `League` COLUMNS ARE SCHEMA DEFAULTS, NOT RULES. An import never writes `waiverBudget`,
 * `tradeReviewHours` or `playoffTeams`, so reading them would state a $100 budget or a 48-hour review
 * the platform does not run. Only the format, the scoring preset, the roster positions and the playoff
 * field (read by `readPlayoffFormat`, the import-aware reader the standings board uses) are taken.
 */
export function importedRuleSnapshot(row: RulesLeagueRow): RuleSnapshot {
  const sport = rulesSportOf(row.sport)
  const teamCount = posInt(row.leagueSize)
  const bundle = providerBundle(row.settings)
  const positions = Array.isArray(bundle.roster_positions) ? bundle.roster_positions : []
  const slots: Record<string, number> = {}
  for (const p of positions) {
    const key = String(p ?? '').trim().toUpperCase()
    if (key) slots[key] = (slots[key] ?? 0) + 1
  }
  const playoff = teamCount ? readPlayoffFormat(bundle, Math.max(2, teamCount)) : null
  const playoffTeams = playoff && playoff.playoffTeamsSource === 'league' ? playoff.playoffTeams : null
  return {
    sport,
    format: resolveRulesFormat(row),
    concept: resolveRulesConcept(row),
    importedFrom: lower(row.platform) || null,
    teamCount,
    scoringPreset: typeof row.scoring === 'string' && row.scoring.trim() ? row.scoring.trim().toLowerCase() : null,
    rosterSlots: normalizeRosterSlots(slots),
    playoffTeams,
    // The week after the regular season, as readPlayoffFormat reads it (Sleeper's `playoff_week_start`,
    // ESPN's `regular_season_length`); the native JSON copies otherwise.
    playoffStartWeek: playoffTeams
      ? playoff!.regularSeasonEndWeek != null
        ? playoff!.regularSeasonEndWeek + 1
        : readChosenPlayoffStartWeek({ settings: bundle })
      : null,
    playoffByes: playoffTeams && playoff!.byeSource === 'league' ? playoff!.byeTeams : null,
  }
}

/** Roster slot counts with empty slots dropped, so `{ BN: 0 }` and `{}` are the same roster. */
export function normalizeRosterSlots(slots: unknown): Record<string, number> | null {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(slots as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) out[key.toUpperCase()] = n
  }
  return Object.keys(out).length ? out : null
}

/** The chop schedule and immunity (`settings.guillotine_advanced`, lib/guillotine/chopSchedule.ts). */
export function guillotineAdvancedSnapshot(advanced: GuillotineAdvanced): Pick<RuleSnapshot, 'chopSteps' | 'chopOverrides' | 'chopImmunity'> {
  const overrides: Record<string, number> = {}
  for (const [week, chops] of Object.entries(advanced.overrides ?? {})) overrides[String(week)] = Number(chops)
  return {
    chopSteps: advanced.steps?.length ? advanced.steps.map((s) => ({ fromWeek: s.fromWeek, chops: s.chops })) : null,
    chopOverrides: Object.keys(overrides).length ? overrides : null,
    chopImmunity: advanced.immunity ?? 'off',
  }
}

/** The guillotine "League rules" page values (lib/guillotine/guillotineRules.ts), as snapshot fields. */
export type GuillotineRulesLike = {
  teamsPerChop?: number
  eliminationEndWeek?: number
  endgame?: string
  tiebreakerOrder?: string[]
  statCorrectionHours?: number
  dangerMarginPoints?: number
  rosterReleaseTiming?: string
  faabOnChop?: string
}

export function guillotineRulesSnapshot(rules: GuillotineRulesLike, startWeek?: number | null): Partial<RuleSnapshot> {
  return {
    teamsPerChop: posInt(rules.teamsPerChop),
    chopStartWeek: posInt(startWeek),
    chopEndWeek: posInt(rules.eliminationEndWeek),
    endgame: rules.endgame ?? null,
    tiebreakers: Array.isArray(rules.tiebreakerOrder) ? [...rules.tiebreakerOrder] : null,
    statCorrectionHours: nonNegNumber(rules.statCorrectionHours),
    dangerMarginPoints: nonNegNumber(rules.dangerMarginPoints),
    releaseTiming: rules.rosterReleaseTiming ?? null,
    faabOnChop: rules.faabOnChop ?? null,
  }
}

/** A dynasty league's tanking penalty, as the rule members read. */
export function tankingPenaltyRule(settings: unknown): TankingPenaltyRule {
  const p = readTankingPenaltyPolicy(settings)
  return {
    enabled: p.enabled,
    penalty: p.penalty,
    atStrike: p.pickAtStrike,
    pickRound: p.pickRound,
    lotteryOddsCutPct: p.lotteryOddsCutPct,
    faabPercent: p.faabPercent,
  }
}

/**
 * A dynasty league's rookie-draft rules from its DynastyLeagueConfig row. No row reads the same
 * defaults the dynasty settings page shows. Shared by the popup and the dynasty settings save.
 */
export function dynastyRulesFromConfig(
  c: { rookiePickOrderMethod?: string | null; rookieDraftRounds?: number | null; rookieDraftType?: string | null } | null,
): Pick<RuleSnapshot, 'rookieDraftOrder' | 'rookieDraftRounds' | 'rookieDraftType'> {
  return {
    rookieDraftOrder: c?.rookiePickOrderMethod ?? 'max_pf',
    rookieDraftRounds: c?.rookieDraftRounds ?? 4,
    rookieDraftType: c?.rookieDraftType ?? 'linear',
  }
}

/**
 * A dynasty league's taxi squad from getEffectiveTaxiSettings (lib/taxi/TaxiSettingsService), which
 * applies the Devy / C2C slot override. Shared by the popup and the dynasty settings save, so a save
 * that does not move the effective squad publishes no change.
 */
export function taxiRulesFromEffective(
  t: { taxiSlotCount: number; taxiEligibilityYears: number; taxiDeadlineWeek: number | null },
): Pick<RuleSnapshot, 'taxiSlots' | 'taxiEligibilityYears' | 'taxiDeadlineWeek'> {
  return { taxiSlots: t.taxiSlotCount, taxiEligibilityYears: t.taxiEligibilityYears, taxiDeadlineWeek: t.taxiDeadlineWeek }
}

/**
 * The main draft's rules, already read from their stores by ./loadDraftRules.ts. Pure: this decides
 * what each value MEANS (a setting that changes nothing is not stated), the loader decides where it
 * lives.
 */
export type DraftRuleInputs = {
  /** `DraftSession.draftModeLabel` of the current draft; `rookie` = a dynasty rookie draft. */
  sessionLabel: string | null
  /** `DraftSession.status`; null before a session exists. */
  sessionStatus: string | null
  /** Engine type: snake, linear or auction. */
  draftType: string | null
  rounds: number | null
  /** Seconds per pick (an auction: per bid), as the room runs it; null = no clock. */
  pickSeconds: number | null
  thirdRoundReversal: boolean | null
  /** `draftUISettings.timerMode`: per_pick, soft_pause, overnight_pause, none. */
  timerMode: string | null
  pauseWindow: { start?: unknown; end?: unknown } | null
  picksDuringPause: boolean
  /** `draftUISettings.autoPickEnabled` — gates every expired-clock pick. */
  autoPickEnabled: boolean
  /** The session's (else LeagueSettings') CPU autopick for an absent manager. */
  cpuAutoPick: boolean
  /** `config.autopick_behavior`: `skip` skips a pick with nothing usable in the queue. */
  autopickBehavior: string | null
  /** Resolved order method: weighted_lottery, random, manual, standings, reverse_standings. */
  orderMethod: string | null
  /** The auction engine's budget and minimum bid (getAuctionConfigFromSession). */
  auction: { budget: number; minBid: number } | null
  startAt: string | null
  /** `LeagueSettings.autostart`, or a league whose scheduled draft starts at its time regardless. */
  autostart: boolean
  orphanEnabled: boolean
  orphanMode: string | null
}

const MAIN_DRAFT_TYPES = new Set(['snake', 'linear', 'auction'])
const MAIN_DRAFT_ORDERS = new Set(['weighted_lottery', 'random', 'manual', 'standings', 'reverse_standings'])
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function draftStatusOf(status: string | null): RuleSnapshot['draftStatus'] {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress' || status === 'paused') return 'in_progress'
  return 'scheduled'
}

export function draftRulesFromInputs(i: DraftRuleInputs): Partial<RuleSnapshot> {
  // A dynasty rookie draft is the Dynasty section's (rookieDraft* keys), never this one.
  if (lower(i.sessionLabel) === 'rookie') return {}
  const type = MAIN_DRAFT_TYPES.has(lower(i.draftType)) ? lower(i.draftType) : null
  const seconds = i.timerMode === 'none' ? null : posInt(i.pickSeconds)
  const from = typeof i.pauseWindow?.start === 'string' ? i.pauseWindow.start : ''
  const to = typeof i.pauseWindow?.end === 'string' ? i.pauseWindow.end : ''
  let onTimeout: string | null = null
  if ((type === 'snake' || type === 'linear') && seconds) {
    // processExpiredDraftPicks: no pick when auto-pick is off, the clock is soft, or the session's
    // CPU autopick is off; `skip` skips a pick whose queue has nothing usable; else queue → best.
    if (!i.autoPickEnabled || i.timerMode === 'soft_pause' || !i.cpuAutoPick) onTimeout = 'wait'
    else onTimeout = lower(i.autopickBehavior) === 'skip' ? 'skip' : 'autopick'
  }
  const startAt = typeof i.startAt === 'string' && Number.isFinite(Date.parse(i.startAt)) ? i.startAt : null
  return {
    draftStatus: draftStatusOf(i.sessionStatus),
    draftType: type,
    draftRounds: posInt(i.rounds),
    draftPickSeconds: seconds,
    draftOvernightPause:
      seconds && i.timerMode === 'overnight_pause' && HHMM.test(from) && HHMM.test(to) ? { from, to, picksAllowed: i.picksDuringPause === true } : null,
    draftOnTimeout: onTimeout,
    // An auction has no pick order: the nomination order is not what this setting decides.
    draftOrderMethod: type !== 'auction' && MAIN_DRAFT_ORDERS.has(lower(i.orderMethod)) ? lower(i.orderMethod) : null,
    draftThirdRoundReversal: type === 'snake' ? i.thirdRoundReversal === true : null,
    draftAuctionBudget: type === 'auction' ? posInt(i.auction?.budget) : null,
    draftAuctionMinBid: type === 'auction' ? posInt(i.auction?.minBid) : null,
    draftStartAt: startAt,
    draftAutostart: startAt ? i.autostart === true : null,
    draftOrphanPicks: i.orphanEnabled ? (i.orphanMode === 'ai' ? 'ai' : 'cpu') : null,
  }
}
