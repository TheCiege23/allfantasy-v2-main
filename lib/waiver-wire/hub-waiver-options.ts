/**
 * Waiver options the league settings hub (components/league-settings/tabs/WaiversTab.tsx) saves
 * through the `waivers` section of PATCH /api/leagues/:id/settings, beyond the League columns.
 *
 * The engine already honours all of them — `allow_zero_faab_bid`, `faab_min_bid` and the
 * season-phase rules (`offseason_waiver_rules`, `playoff_waiver_rules`) in `waiverEngineConfig`,
 * `tiebreakRule` and `waiverOrderResetPolicy` on `LeagueWaiverSettings` — so these keys only
 * validate and route the values there. Pure; the write is in
 * lib/league/execute-league-settings-patch.ts.
 */
import { HOLD_HOURS_BY_POSITION_KEY, parseHoldHoursByPositionInput } from './hold-by-position'

/** Hub patch keys. Each names "waiver" so the settings lock files it under the waivers group. */
export const HUB_WAIVER_OPTION_KEYS = [
  'waiverAllowZeroBid',
  'waiverTiebreakRule',
  'waiverOrderResetPolicy',
  'waiverOffseasonRule',
  'waiverPlayoffRule',
  'waiverFreeAgencyMode',
  'waiverFaabRollover',
  'waiverHoldHoursByPosition',
] as const

/**
 * FAAB bid-tie rules the hub offers. `faab_highest` (the registry default) is not a tiebreak — the
 * engine falls through to waiver priority for it — so it reads as `priority_lowest_first` here.
 */
export const HUB_TIEBREAK_RULES = ['priority_lowest_first', 'reverse_standings', 'earliest_claim'] as const
export type HubTiebreakRule = (typeof HUB_TIEBREAK_RULES)[number]

/**
 * `rolling` (the default, also null and any legacy value): a team that wins a claim drops to the
 * back and the order carries over. `weekly`: at the start of each scoring week the order resets to
 * reverse standings (lib/waiver-wire/weekly-priority-reset.ts) — the Yahoo/ESPN behaviour.
 */
export const WAIVER_ORDER_RESET_POLICIES = ['rolling', 'weekly'] as const
export type WaiverOrderResetPolicy = (typeof WAIVER_ORDER_RESET_POLICIES)[number]

/** Why a survivor league cannot take the weekly reset (owner's decision 2026-10-25). */
export const WEEKLY_RESET_SURVIVOR_REFUSAL =
  "Survivor leagues keep a rolling priority order: a weekly reset would erase survivor priority boosts."

/** The refusal for a save that turns the weekly reset on in a survivor league, else null. */
export function weeklyResetSurvivorRefusal(options: HubWaiverOptions, isSurvivor: boolean): string | null {
  return options.waiverOrderResetPolicy === 'weekly' && isSurvivor ? WEEKLY_RESET_SURVIVOR_REFUSAL : null
}

/** The waiver types whose order is a priority list a weekly reset can rewrite. */
export const PRIORITY_RESET_WAIVER_TYPES = ['rolling', 'standard'] as const

/** The highest minimum bid accepted, matching the hub's FAAB budget ceiling. */
export const MAX_FAAB_MIN_BID = 10_000

export function readHubTiebreakRule(stored: string | null | undefined): HubTiebreakRule {
  const v = String(stored ?? '').trim().toLowerCase()
  if (v === 'reverse_standings' || v === 'reverse_standings_order') return 'reverse_standings'
  if (v === 'earliest_claim' || v === 'earliest_claim_timestamp') return 'earliest_claim'
  return 'priority_lowest_first'
}

export function readWaiverOrderResetPolicy(stored: string | null | undefined): WaiverOrderResetPolicy {
  return String(stored ?? '').trim().toLowerCase() === 'weekly' ? 'weekly' : 'rolling'
}

/** The "Free agency only (no waivers)" preset: first-come free agency with no waiver period. */
export const FREE_AGENCY_ONLY_PRESET = { waiverType: 'fcfs', waiverHours: 0 } as const

export function isFreeAgencyOnly(waiverType: string | null | undefined, waiverHours: number | null | undefined): boolean {
  return String(waiverType ?? '') === 'fcfs' && Number(waiverHours ?? -1) === 0
}

/**
 * Offseason rule (`waiverEngineConfig.offseason_waiver_rules`), between the season's end and next
 * season's draft. `closed` (the default) keeps waivers and free agency shut, which is what the
 * lifecycle gate already did; `fcfs` opens first-come free agency with no claims and no waiver period.
 * A dynasty-family league is not governed by it: its offseason stays open (leagueLifecycleService).
 */
export const OFFSEASON_WAIVER_RULES = ['closed', 'fcfs'] as const
export type OffseasonWaiverRule = (typeof OFFSEASON_WAIVER_RULES)[number]

/**
 * Playoff rule (`waiverEngineConfig.playoff_waiver_rules`). `all_teams` (the default, as on most
 * hosts) keeps waivers running for everyone; `alive_only` lets only teams still alive in the title
 * bracket move; `locked` freezes every roster until the season ends.
 */
export const PLAYOFF_WAIVER_RULES = ['all_teams', 'alive_only', 'locked'] as const
export type PlayoffWaiverRule = (typeof PLAYOFF_WAIVER_RULES)[number]

export function readOffseasonWaiverRule(stored: unknown): OffseasonWaiverRule {
  return String(stored ?? '').trim().toLowerCase() === 'fcfs' ? 'fcfs' : 'closed'
}

export function readPlayoffWaiverRule(stored: unknown): PlayoffWaiverRule {
  const v = String(stored ?? '').trim().toLowerCase()
  return v === 'alive_only' || v === 'locked' ? v : 'all_teams'
}

/**
 * Free agency (`waiverEngineConfig.free_agency_mode`, lib/waiver-wire/after-run-free-agency.ts).
 * `standard` (the default, also null and any legacy value) keeps the league's existing rules.
 * `after_run` is Sleeper's: a player nobody rosters is on waivers until the league's scheduled run,
 * a free agent (instant, first come first served) after it, and back on waivers from his game's
 * start until the next run. A dropped player still serves the league's waiver period. It changes
 * nothing in an FCFS league (no waiver run to clear) or while a per-day schedule is on (the schedule
 * decides each day, lib/waivers/dailyWaiverSchedule.ts).
 */
export const FREE_AGENCY_MODES = ['standard', 'after_run'] as const
export type FreeAgencyMode = (typeof FREE_AGENCY_MODES)[number]

export function readFreeAgencyMode(stored: unknown): FreeAgencyMode {
  return String(stored ?? '').trim().toLowerCase() === 'after_run' ? 'after_run' : 'standard'
}

/**
 * FAAB at season rollover (`waiverEngineConfig.faab_rollover_rule`, lib/waiver-wire/faab-rollover.ts).
 * `reset` gives every team the starting budget again; `carry_over` keeps what each team has left.
 * Unset, a redraft renewal resets (what it always did) and a dynasty / keeper season carries over
 * (nothing ever touched its FAAB). Read by the renewal only, so a change never moves a balance now.
 */
export const FAAB_ROLLOVER_RULES = ['reset', 'carry_over'] as const
export type FaabRolloverRule = (typeof FAAB_ROLLOVER_RULES)[number]

/** The stored rule, or null when the commissioner never chose one. */
export function readFaabRolloverRule(stored: unknown): FaabRolloverRule | null {
  const v = String(stored ?? '').trim().toLowerCase()
  return v === 'reset' || v === 'carry_over' ? v : null
}

export type HubWaiverOptions = {
  allowZeroFaabBid?: boolean
  tiebreakRule?: HubTiebreakRule
  waiverOrderResetPolicy?: WaiverOrderResetPolicy
  offseasonWaiverRule?: OffseasonWaiverRule
  playoffWaiverRule?: PlayoffWaiverRule
  freeAgencyMode?: FreeAgencyMode
  faabRolloverRule?: FaabRolloverRule
  /** Per-position after-drop periods (lib/waiver-wire/hold-by-position.ts); `{}` clears them. */
  holdHoursByPosition?: Record<string, number>
}

/**
 * Validates the hub's waiver options in a settings patch. `waiverMinBid` is a League column, so it
 * is checked here and left in the body; the three option keys are returned for their own write.
 * `budget` is the FAAB budget the save leaves in place (the body's, else the stored one).
 */
export function parseHubWaiverOptions(
  body: Record<string, unknown>,
  ctx: { budget: number | null | undefined },
): { ok: true; options: HubWaiverOptions } | { ok: false; error: string } {
  const options: HubWaiverOptions = {}

  if (body.waiverMinBid !== undefined && body.waiverMinBid !== null) {
    const min = body.waiverMinBid
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || min > MAX_FAAB_MIN_BID) {
      return { ok: false, error: 'The minimum bid must be a whole number of dollars, $0 or more.' }
    }
    const budget = ctx.budget
    if (typeof budget === 'number' && Number.isFinite(budget) && min > budget) {
      return { ok: false, error: `The minimum bid cannot be more than the FAAB budget ($${budget}).` }
    }
  }

  if (body.waiverAllowZeroBid !== undefined) {
    if (typeof body.waiverAllowZeroBid !== 'boolean') return { ok: false, error: 'Invalid waiverAllowZeroBid' }
    options.allowZeroFaabBid = body.waiverAllowZeroBid
  }

  if (body.waiverTiebreakRule !== undefined) {
    const v = body.waiverTiebreakRule
    if (typeof v !== 'string' || !(HUB_TIEBREAK_RULES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverTiebreakRule' }
    }
    options.tiebreakRule = v as HubTiebreakRule
  }

  if (body.waiverOrderResetPolicy !== undefined) {
    const v = body.waiverOrderResetPolicy
    if (typeof v !== 'string' || !(WAIVER_ORDER_RESET_POLICIES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverOrderResetPolicy' }
    }
    options.waiverOrderResetPolicy = v as WaiverOrderResetPolicy
  }

  if (body.waiverOffseasonRule !== undefined) {
    const v = body.waiverOffseasonRule
    if (typeof v !== 'string' || !(OFFSEASON_WAIVER_RULES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverOffseasonRule' }
    }
    options.offseasonWaiverRule = v as OffseasonWaiverRule
  }

  if (body.waiverPlayoffRule !== undefined) {
    const v = body.waiverPlayoffRule
    if (typeof v !== 'string' || !(PLAYOFF_WAIVER_RULES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverPlayoffRule' }
    }
    options.playoffWaiverRule = v as PlayoffWaiverRule
  }

  if (body.waiverFreeAgencyMode !== undefined) {
    const v = body.waiverFreeAgencyMode
    if (typeof v !== 'string' || !(FREE_AGENCY_MODES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverFreeAgencyMode' }
    }
    options.freeAgencyMode = v as FreeAgencyMode
  }

  if (body.waiverFaabRollover !== undefined) {
    const v = body.waiverFaabRollover
    if (typeof v !== 'string' || !(FAAB_ROLLOVER_RULES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Invalid waiverFaabRollover' }
    }
    options.faabRolloverRule = v as FaabRolloverRule
  }

  if (body.waiverHoldHoursByPosition !== undefined) {
    const parsed = parseHoldHoursByPositionInput(body.waiverHoldHoursByPosition)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    options.holdHoursByPosition = parsed.value
  }

  return { ok: true, options }
}

/**
 * The `waiverEngineConfig` keys a hub save writes: the $0-bid flag, the season-phase rules
 * (lib/waiver-wire/season-phase-policy.ts), the free-agency mode, the FAAB rollover rule and the per-position after-drop periods. Empty when the save names none of them.
 */
export function hubWaiverEngineConfigPatch(options: HubWaiverOptions): Record<string, unknown> {
  return {
    ...(options.allowZeroFaabBid !== undefined ? { allow_zero_faab_bid: options.allowZeroFaabBid } : {}),
    ...(options.offseasonWaiverRule !== undefined ? { offseason_waiver_rules: options.offseasonWaiverRule } : {}),
    ...(options.playoffWaiverRule !== undefined ? { playoff_waiver_rules: options.playoffWaiverRule } : {}),
    ...(options.freeAgencyMode !== undefined ? { free_agency_mode: options.freeAgencyMode } : {}),
    ...(options.faabRolloverRule !== undefined ? { faab_rollover_rule: options.faabRolloverRule } : {}),
    ...(options.holdHoursByPosition !== undefined ? { [HOLD_HOURS_BY_POSITION_KEY]: options.holdHoursByPosition } : {}),
  }
}

export function hasHubWaiverOptions(options: HubWaiverOptions): boolean {
  return Object.keys(options).length > 0
}
