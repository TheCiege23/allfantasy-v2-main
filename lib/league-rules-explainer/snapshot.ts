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
 */

import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
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
import { readTankingPenaltyPolicy } from '@/lib/integrity/tankingPenalties'
import { readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'
import { RULES_EXPLAINER_SPORTS, type RuleSnapshot, type RulesFormat, type TankingPenaltyRule } from './types'

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
  settings?: unknown
}

/** Variants that are their own format — out of scope even when `leagueType` reads redraft. */
const SPECIALTY_VARIANTS = new Set([
  'survivor',
  'survivor_guillotine',
  'big_brother',
  'zombie',
  'best_ball',
  'bestball',
  'idp',
  'dynasty_idp',
  'devy_dynasty',
  'merged_devy_c2c',
  'salary_cap',
  'contract_dynasty',
  'keeper',
  'dynasty',
  'devy',
  'c2c',
  'tournament',
])

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

const DYNASTY_TYPES = new Set(['dynasty', 'devy', 'c2c'])

/** Redraft, guillotine, dynasty, or null when the league is outside this feature's scope. */
export function resolveRulesFormat(row: RulesLeagueRow): RulesFormat | null {
  const variant = String(row.leagueVariant ?? '').trim().toLowerCase()
  const type = String(row.leagueType ?? '').trim().toLowerCase()
  if (variant === 'survivor_guillotine' || row.survivorMode) return null
  if (row.guillotineMode === true || type === 'guillotine' || variant === 'guillotine') return 'guillotine'
  if (SPECIALTY_VARIANTS.has(variant)) return null
  if (row.bestBallMode) return null
  if (row.isDynasty || DYNASTY_TYPES.has(type)) return 'dynasty'
  return type === 'redraft' ? 'redraft' : null
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
 * A dynasty league's rookie-draft and taxi rules from its DynastyLeagueConfig row. No row reads the
 * same defaults the dynasty settings page shows. Shared by the popup and the dynasty settings save.
 */
export function dynastyRulesFromConfig(
  c: {
    rookiePickOrderMethod?: string | null
    rookieDraftRounds?: number | null
    rookieDraftType?: string | null
    taxiSlots?: number | null
    taxiEligibilityYears?: number | null
    futurePicksYearsOut?: number | null
  } | null,
): Partial<RuleSnapshot> {
  return {
    rookieDraftOrder: c?.rookiePickOrderMethod ?? 'max_pf',
    rookieDraftRounds: c?.rookieDraftRounds ?? 4,
    rookieDraftType: c?.rookieDraftType ?? 'linear',
    taxiSlots: c?.taxiSlots ?? 4,
    taxiEligibilityYears: c?.taxiEligibilityYears ?? 1,
    futurePicksYearsOut: c?.futurePicksYearsOut ?? 3,
  }
}

/** In scope: an AllFantasy-hosted redraft, guillotine or dynasty league in any sport AF hosts. */
export function isRulesExplainerLeague(row: RulesLeagueRow): boolean {
  if (!isNativePlatform(row.platform ?? null)) return false
  if (!(RULES_EXPLAINER_SPORTS as readonly string[]).includes(rulesSportOf(row.sport))) return false
  return resolveRulesFormat(row) !== null
}

function normalizedWaiverType(raw: unknown): string | null {
  const t = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (!t) return null
  if (t === 'faab') return 'faab'
  if (t === 'reverse_standings' || t === 'reverse_order') return 'reverse_standings'
  if (t === 'rolling') return 'rolling'
  return null
}

function tradeReviewMode(settings: Record<string, unknown>): string | null {
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
    lineupMode: sport === 'NBA' || sport === 'NHL' ? readLineupMode(row.settings, sport) : null,
  }

  if (format === 'guillotine') {
    snapshot.endgame = resolveGuillotineEndgame({ settings: row.settings, guillotineEndgame: row.guillotineEndgame ?? null }).format
    snapshot.faabOnChop = readFaabOnChop(row.settings)
    Object.assign(snapshot, guillotineAdvancedSnapshot(readAdvanced(row.settings)))
  } else {
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
  if (format === 'dynasty') {
    // The rookie-draft order, rounds and taxi squad live on DynastyLeagueConfig (read path, ./load.ts).
    snapshot.tankingPenalty = tankingPenaltyRule(row.settings)
    snapshot.rookieDraftAutoStartDays = readRookieDraftCalendarSettings(row.settings).autoStartDays
  }
  return snapshot
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
