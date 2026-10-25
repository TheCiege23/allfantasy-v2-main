/**
 * Waiver options the league settings hub (components/league-settings/tabs/WaiversTab.tsx) saves
 * through the `waivers` section of PATCH /api/leagues/:id/settings, beyond the League columns.
 *
 * The engine already honours all of them — `allow_zero_faab_bid` and `faab_min_bid` in
 * `waiverEngineConfig`, `tiebreakRule` and `waiverOrderResetPolicy` on `LeagueWaiverSettings` — so
 * these keys only validate and route the values there. Pure; the write is in
 * lib/league/execute-league-settings-patch.ts.
 */

/** Hub patch keys. Each names "waiver" so the settings lock files it under the waivers group. */
export const HUB_WAIVER_OPTION_KEYS = ['waiverAllowZeroBid', 'waiverTiebreakRule', 'waiverOrderResetPolicy'] as const

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

export type HubWaiverOptions = {
  allowZeroFaabBid?: boolean
  tiebreakRule?: HubTiebreakRule
  waiverOrderResetPolicy?: WaiverOrderResetPolicy
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

  return { ok: true, options }
}

export function hasHubWaiverOptions(options: HubWaiverOptions): boolean {
  return Object.keys(options).length > 0
}
