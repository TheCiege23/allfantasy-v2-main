/**
 * The guillotine league rules a commissioner can edit after creation, on one settings page
 * ("League rules"). Pure: validation and the paid/free split. Persistence is in
 * ./guillotineRulesSave.ts.
 *
 * Every field here is READ BY THE ENGINE — that is the bar for being on the page:
 *   teamsPerChop          GuillotineEliminationEngine / TiebreakResolver (base chops a week)
 *   eliminationEndWeek    nativeGuillotineWeek (last week a chop can happen)
 *   endgame               endgameRules.resolveGuillotineEndgame (how the season finishes)
 *   tiebreakerOrder       GuillotineTiebreakResolver (who goes when the lowest scores tie)
 *   statCorrectionHours   nativeGuillotineWeek (how long to wait before a chop is final)
 *   dangerMarginPoints    GuillotineDangerEngine (who shows as "in danger")
 *   rosterReleaseTiming   GuillotineEliminationEngine → releaseChoppedRosters
 *   freeAgencyFromWeek    lib/waiver-wire/dropped-player-waivers.ts (no waiver hold from week N; ./freeAgencyFromWeek.ts)
 *   tradesAllowed /
 *   tradesCloseAtTeamsLeft  lib/league-trade-engine/tradeSettingsResolver.ts + every trade gate (./guillotineTrades.ts)
 *   faabOnChop            GuillotineEliminationEngine → redistributeChoppedFaab (./faabOnChop.ts)
 *   bestBall              scoringEngine.leagueIsBestBall → each team's best lineup (./guillotineBestBall.ts)
 *   periodWeeks           nativeGuillotineWeek → which weeks chop and how many weeks a score adds (./eliminationPeriods.ts)
 *
 * components/league/GuillotineFormatTab.tsx used to list ~25 settings, most of which nothing read
 * (AI toggles, "Chop Clock", "FAAB visible"…) and whose save always failed. It was deleted rather
 * than wired up: a setting that saves but changes nothing is worse than no setting.
 */

import type { GuillotineEndgameFormat } from './endgameRules'
import type { TiebreakStep } from './types'
import { MAX_CHOPS_PER_WEEK } from './chopSchedule'
import { DEFAULT_FAAB_ON_CHOP_PERCENT, FAAB_ON_CHOP_OPTIONS, isFaabOnChopPercent, type FaabOnChop } from './faabOnChop'
import { isChopListOrder, type ChopListOrder } from './chopListOrder'
import { isFreeAgencyFromWeek } from './freeAgencyFromWeek'
import { isTradesCloseAt } from './guillotineTradeRules'

export type GuillotineRules = {
  teamsPerChop: number
  eliminationEndWeek: number
  endgame: GuillotineEndgameFormat
  tiebreakerOrder: TiebreakStep[]
  statCorrectionHours: number
  dangerMarginPoints: number
  rosterReleaseTiming: 'immediate' | 'next_waiver_run'
  /**
   * From this week on, chopped players skip waivers and are free agents right after the chop
   * (./freeAgencyFromWeek.ts). null = never. Stored in League.settings (FREE_AGENCY_FROM_WEEK_KEY).
   */
  freeAgencyFromWeek: number | null
  /** Trades between teams still alive (./guillotineTrades.ts). Stored in League.settings.guillotineSettings; absent = off. */
  tradesAllowed: boolean
  /** Trades close once this many teams (or fewer) are left. null = never. Same place. */
  tradesCloseAtTeamsLeft: number | null
  /** Chimmy writes the weekly recap after each chop (paid leagues; ./weeklyRecap.ts). Stored in League.settings. */
  aiRecapAuto: boolean
  /** What happens to a chopped team's unspent FAAB. Stored in League.settings (FAAB_ON_CHOP_KEY). */
  faabOnChop: FaabOnChop
  /**
   * The share of a chopped team's FAAB that `faabOnChop` passes on, 1 to 100; the rest leaves with the team.
   * Stored in League.settings (FAAB_ON_CHOP_PERCENT_KEY); absent = 100.
   */
  faabOnChopPercent: number
  /**
   * Lineups set themselves: every team is scored on its best possible lineup each week. Stored as
   * League.settings.best_ball (./guillotineBestBall.ts); changeable only before the draft.
   */
  bestBall: boolean
  /**
   * Weeks per elimination period: 1, or 2 for MLB (both weeks' scores added, one chop at the end of the
   * pair). Stored as League.settings.guillotine_period_weeks (./eliminationPeriods.ts); fixed once the
   * first chop has happened.
   */
  periodWeeks: 1 | 2
  /**
   * Which end of the Chop page's list the chop zone sits at (./chopListOrder.ts). A display choice, free for
   * every commissioner. Stored in League.settings (CHOP_LIST_ORDER_KEY); absent = chop zone on top.
   */
  chopListOrder: ChopListOrder
}

/** League.settings key for `aiRecapAuto`. Absent = on. */
export const AI_RECAP_AUTO_KEY = 'guillotineAiRecapAuto'

export type GuillotineRuleField = keyof GuillotineRules

/**
 * Which fields need AF Commissioner (`commissioner_automation`, the same feature the chop schedule
 * and immunity use). Free: the two choices every guillotine league has to make. Paid: tuning the
 * engine. Move a field between the lists to change the tier — the server and the page both read
 * this one set.
 */
export const GUILLOTINE_PAID_RULE_FIELDS: ReadonlySet<GuillotineRuleField> = new Set<GuillotineRuleField>([
  'teamsPerChop',
  'eliminationEndWeek',
  'tiebreakerOrder',
  'statCorrectionHours',
  'dangerMarginPoints',
  // Owner's call, 2026-10-25: sharing a chopped team's FAAB is an AF Commissioner rule. Gating the
  // setting rather than the chop means a lapsed plan never changes a league's rules mid-season.
  'faabOnChop',
  'faabOnChopPercent',
])

export const ENDGAME_OPTIONS: ReadonlyArray<{ value: GuillotineEndgameFormat; label: string; help: string }> = [
  { value: 'last_team_standing', label: 'Last team standing', help: 'Chops continue until one team is left.' },
  { value: 'final_four', label: 'Final four', help: 'When four teams remain, chops stop and the best total over three weeks wins.' },
  { value: 'final_three', label: 'Final three', help: 'When three teams remain, the best total over three weeks wins.' },
  { value: 'final_two', label: 'Final two showdown', help: 'When two teams remain, the best total over three weeks wins.' },
]

const TIEBREAK_OPTIONS: ReadonlyArray<{ value: TiebreakStep; label: string }> = [
  { value: 'bench_points', label: 'Fewer bench points is chopped' },
  { value: 'season_points', label: 'Fewer season points is chopped' },
  { value: 'previous_period', label: 'Lower score last week is chopped' },
  { value: 'draft_slot', label: 'Later draft slot is chopped (week 1 only)' },
  { value: 'commissioner', label: 'Commissioner decides (12 hours to pick, then the next rule)' },
  { value: 'random', label: 'Random' },
]

/**
 * A tiebreak step's label for this league. In an MLB two-week league (./eliminationPeriods.ts) the
 * previous-period step compares the last PERIOD, so it says so; every other label is the plain one.
 */
export function tiebreakLabel(step: string, periodWeeks?: number): string {
  if (step === 'previous_period' && (periodWeeks ?? 1) > 1) return 'Lower score last period is chopped'
  return TIEBREAK_OPTIONS.find((o) => o.value === step)?.label ?? step
}

export const RELEASE_OPTIONS: ReadonlyArray<{ value: GuillotineRules['rosterReleaseTiming']; label: string; help: string }> = [
  { value: 'next_waiver_run', label: 'At the next waiver run', help: 'Everyone bids on the chopped roster at the same time.' },
  { value: 'immediate', label: 'Right after the chop', help: 'Players hit free agency as soon as the chop is final.' },
]

export const RULE_LIMITS = {
  statCorrectionHours: { min: 0, max: 72 },
  dangerMarginPoints: { min: 0, max: 100 },
} as const

/** Values a lapsed plan may always return to, so a league is never stuck on rules it cannot edit. */
export const RULE_DEFAULTS: Pick<GuillotineRules, 'teamsPerChop' | 'tiebreakerOrder' | 'statCorrectionHours' | 'dangerMarginPoints' | 'faabOnChop' | 'faabOnChopPercent'> = {
  teamsPerChop: 1,
  // Anyone may put the FAAB rule back to "keep", so a league left on "split" by a lapsed plan can undo it.
  faabOnChop: 'keep',
  faabOnChopPercent: DEFAULT_FAAB_ON_CHOP_PERCENT,
  tiebreakerOrder: ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'],
  statCorrectionHours: 48,
  dangerMarginPoints: 10,
}

type RulesPatchError = { field: GuillotineRuleField | null; message: string }

const ENDGAMES = new Set(ENDGAME_OPTIONS.map((o) => o.value))
const TIEBREAKS = new Set(TIEBREAK_OPTIONS.map((o) => o.value))
const RELEASES = new Set(RELEASE_OPTIONS.map((o) => o.value))
const FAAB_ON_CHOP = new Set<string>(FAAB_ON_CHOP_OPTIONS.map((o) => o.value))

function int(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof n === 'number' && Number.isInteger(n) ? n : null
}

/**
 * Validate a partial patch. `bounds` comes from the league: the first chop week (the end week cannot
 * precede it) and the sport's season length (it cannot run past it).
 */
export function normalizeGuillotineRulesPatch(
  raw: unknown,
  bounds: { startWeek: number; seasonWeeks: number },
): { ok: true; value: Partial<GuillotineRules> } | { ok: false; error: RulesPatchError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: { field: null, message: 'Nothing to save.' } }
  }
  const r = raw as Record<string, unknown>
  const out: Partial<GuillotineRules> = {}

  if ('teamsPerChop' in r) {
    const n = int(r.teamsPerChop)
    if (n == null || n < 1 || n > MAX_CHOPS_PER_WEEK) {
      return { ok: false, error: { field: 'teamsPerChop', message: `Teams chopped each week must be 1 to ${MAX_CHOPS_PER_WEEK}.` } }
    }
    out.teamsPerChop = n
  }
  if ('eliminationEndWeek' in r) {
    const n = int(r.eliminationEndWeek)
    if (n == null || n < bounds.startWeek || n > bounds.seasonWeeks) {
      return {
        ok: false,
        error: { field: 'eliminationEndWeek', message: `The last chop week must be between week ${bounds.startWeek} and week ${bounds.seasonWeeks}.` },
      }
    }
    out.eliminationEndWeek = n
  }
  if ('endgame' in r) {
    if (typeof r.endgame !== 'string' || !ENDGAMES.has(r.endgame as GuillotineEndgameFormat)) {
      return { ok: false, error: { field: 'endgame', message: 'Pick how the season ends.' } }
    }
    out.endgame = r.endgame as GuillotineEndgameFormat
  }
  if ('tiebreakerOrder' in r) {
    const list = r.tiebreakerOrder
    if (!Array.isArray(list) || list.length === 0 || list.some((s) => typeof s !== 'string' || !TIEBREAKS.has(s as TiebreakStep))) {
      return { ok: false, error: { field: 'tiebreakerOrder', message: 'Tiebreakers must come from the list.' } }
    }
    if (new Set(list).size !== list.length) {
      return { ok: false, error: { field: 'tiebreakerOrder', message: 'Each tiebreaker can be used once.' } }
    }
    out.tiebreakerOrder = list as TiebreakStep[]
  }
  for (const key of ['statCorrectionHours', 'dangerMarginPoints'] as const) {
    if (!(key in r)) continue
    const n = int(r[key])
    const { min, max } = RULE_LIMITS[key]
    if (n == null || n < min || n > max) {
      const label = key === 'statCorrectionHours' ? 'The stat-correction wait' : 'The danger margin'
      return { ok: false, error: { field: key, message: `${label} must be a whole number from ${min} to ${max}.` } }
    }
    out[key] = n
  }
  if ('rosterReleaseTiming' in r) {
    if (typeof r.rosterReleaseTiming !== 'string' || !RELEASES.has(r.rosterReleaseTiming as GuillotineRules['rosterReleaseTiming'])) {
      return { ok: false, error: { field: 'rosterReleaseTiming', message: 'Pick when chopped players are released.' } }
    }
    out.rosterReleaseTiming = r.rosterReleaseTiming as GuillotineRules['rosterReleaseTiming']
  }
  if ('aiRecapAuto' in r) {
    if (typeof r.aiRecapAuto !== 'boolean') return { ok: false, error: { field: 'aiRecapAuto', message: 'Turn the Chimmy recap on or off.' } }
    out.aiRecapAuto = r.aiRecapAuto
  }
  if ('faabOnChop' in r) {
    if (typeof r.faabOnChop !== 'string' || !FAAB_ON_CHOP.has(r.faabOnChop)) {
      return { ok: false, error: { field: 'faabOnChop', message: "Pick what happens to a chopped team's FAAB." } }
    }
    out.faabOnChop = r.faabOnChop as FaabOnChop
  }
  if ('faabOnChopPercent' in r) {
    const n = int(r.faabOnChopPercent)
    if (!isFaabOnChopPercent(n)) {
      return { ok: false, error: { field: 'faabOnChopPercent', message: "The share of a chopped team's FAAB must be a whole number from 1 to 100." } }
    }
    out.faabOnChopPercent = n
  }
  if ('bestBall' in r) {
    if (typeof r.bestBall !== 'boolean') return { ok: false, error: { field: 'bestBall', message: 'Turn best ball lineups on or off.' } }
    out.bestBall = r.bestBall
  }
  if ('freeAgencyFromWeek' in r) {
    if (r.freeAgencyFromWeek !== null && !isFreeAgencyFromWeek(r.freeAgencyFromWeek)) {
      return { ok: false, error: { field: 'freeAgencyFromWeek', message: 'Pick the week chopped players start going straight to free agency, or never.' } }
    }
    out.freeAgencyFromWeek = r.freeAgencyFromWeek as number | null
  }
  if ('tradesAllowed' in r) {
    if (typeof r.tradesAllowed !== 'boolean') return { ok: false, error: { field: 'tradesAllowed', message: 'Turn trades on or off.' } }
    out.tradesAllowed = r.tradesAllowed
  }
  if ('tradesCloseAtTeamsLeft' in r) {
    if (r.tradesCloseAtTeamsLeft !== null && !isTradesCloseAt(r.tradesCloseAtTeamsLeft)) {
      return { ok: false, error: { field: 'tradesCloseAtTeamsLeft', message: 'Pick how many teams are left when trades close, or never.' } }
    }
    out.tradesCloseAtTeamsLeft = r.tradesCloseAtTeamsLeft as number | null
  }
  if ('chopListOrder' in r) {
    if (!isChopListOrder(r.chopListOrder)) return { ok: false, error: { field: 'chopListOrder', message: 'Pick where the chop zone sits in the list.' } }
    out.chopListOrder = r.chopListOrder
  }
  if ('periodWeeks' in r) {
    const n = int(r.periodWeeks)
    if (n !== 1 && n !== 2) return { ok: false, error: { field: 'periodWeeks', message: 'An elimination period is one week or two.' } }
    out.periodWeeks = n
  }
  if (Object.keys(out).length === 0) return { ok: false, error: { field: null, message: 'Nothing to save.' } }
  return { ok: true, value: out }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The paid fields this patch actually CHANGES. A free commissioner can save the page with paid
 * values untouched, and anyone may put a paid field back to its default.
 */
export function paidFieldsChanged(patch: Partial<GuillotineRules>, current: GuillotineRules): GuillotineRuleField[] {
  return (Object.keys(patch) as GuillotineRuleField[]).filter((field) => {
    if (!GUILLOTINE_PAID_RULE_FIELDS.has(field)) return false
    if (same(patch[field], current[field])) return false
    const fallback = (RULE_DEFAULTS as Partial<GuillotineRules>)[field]
    return fallback === undefined || !same(patch[field], fallback)
  })
}
