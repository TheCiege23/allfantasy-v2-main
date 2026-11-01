/**
 * Survivor governance settings: tribe swaps beyond the first, alliance chats, conduct strikes,
 * Survivor trade rules, Rooks vs Vets, the week-1 partial scoring window and tribe emoji in names.
 *
 * Pure and client-safe (no I/O). Stored as ONE object under `League.settings.survivorGovernance`,
 * so no column or table migration is needed and the foundation settings stay untouched.
 *
 * DEFAULTS KEEP EVERY EXISTING LEAGUE EXACTLY AS IT WAS: no extra swaps, alliances off, trade rules
 * off, no tribe split, week 1 scores the whole week, names unchanged. Strikes only matter once a
 * commissioner issues one; the default policy is the original league's ("first violation a warning,
 * second is removal") but removal is a commissioner switch.
 *
 * Times are US Eastern, like every other Survivor deadline (Torch Ceremony, vote close).
 */

export const SURVIVOR_GOVERNANCE_KEY = 'survivorGovernance'

export const SURVIVOR_GOVERNANCE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export type SurvivorGovernanceDay = (typeof SURVIVOR_GOVERNANCE_DAYS)[number]

/**
 * - random_shuffle: the existing redraw, same tribes, sizes within one.
 * - resize: redraw into `tribeCount` tribes (2 → 3 adds a tribe; 3 → 2 folds one).
 * - return_to_original: everyone still in the game goes back to the tribe they started in.
 * - custom_pattern: the commissioner's own pattern of tribe letters ("ABCCBA"), dealt over the cast
 *   in `order` (season points, best first, or a random order). The number of letters used is the
 *   number of tribes, so a pattern can also grow or shrink the tribe count.
 */
export const SURVIVOR_SWAP_MODES = ['random_shuffle', 'resize', 'return_to_original', 'custom_pattern'] as const
export type SurvivorSwapMode = (typeof SURVIVOR_SWAP_MODES)[number]
export const SURVIVOR_SWAP_ORDERS = ['season_points', 'random'] as const
export type SurvivorSwapOrder = (typeof SURVIVOR_SWAP_ORDERS)[number]

export interface SurvivorScheduledSwap {
  /** The swap is drawn (sealed) when this week ends; the new tribes are revealed at the next lineup lock. */
  week: number
  mode: SurvivorSwapMode
  /** `resize` only: 2–5. */
  tribeCount?: number
  /** `custom_pattern` only: 2–40 letters A–E. */
  pattern?: string
  /** `custom_pattern` only. */
  order?: SurvivorSwapOrder
}

export const SURVIVOR_CROSS_TRIBE_TRADE_MODES = ['allowed', 'window', 'banned'] as const
export type SurvivorCrossTribeTradeMode = (typeof SURVIVOR_CROSS_TRIBE_TRADE_MODES)[number]

/**
 * One cross-tribe trade window in `window` mode. It opens when that week's Tribal Council closes
 * (`tribal`) or at a weekday/time (ET), and closes at a weekday/time (ET). Up to three a week: the
 * original league allowed cross-tribe trades "before Thursday Night Football and before Sunday 1pm".
 *
 * BACKWARD COMPATIBLE: a league saved before windows existed has only `crossTribeCloseDay/Time`; it
 * reads as ONE window opened by Tribal Council. Those two keys are kept in step with the FIRST window
 * on every save, so anything still reading them sees the same close it always did.
 */
export const SURVIVOR_CROSS_TRIBE_WINDOW_OPENERS = ['tribal', 'time'] as const
export type SurvivorCrossTribeWindowOpener = (typeof SURVIVOR_CROSS_TRIBE_WINDOW_OPENERS)[number]
export interface SurvivorCrossTribeWindow {
  opensOn: SurvivorCrossTribeWindowOpener
  /** `time` only. */
  openDay?: SurvivorGovernanceDay
  /** `time` only, HH:MM ET. */
  openTime?: string
  closeDay: SurvivorGovernanceDay
  closeTime: string
}
export const SURVIVOR_CROSS_TRIBE_WINDOW_MAX = 3

/** What the trade check does when it cannot run (a database read failed). */
export const SURVIVOR_TRADE_CHECK_FAILURE_MODES = ['allow', 'hold'] as const
export type SurvivorTradeCheckFailureMode = (typeof SURVIVOR_TRADE_CHECK_FAILURE_MODES)[number]

export const SURVIVOR_TRIBE_SPLITS = ['none', 'rooks_vs_vets'] as const
export type SurvivorTribeSplit = (typeof SURVIVOR_TRIBE_SPLITS)[number]

export type SurvivorExperience = 'rookie' | 'veteran'

export interface SurvivorGovernanceSettings {
  swapSchedule: SurvivorScheduledSwap[]
  alliancesEnabled: boolean
  allianceMaxSize: number
  allianceSameTribeOnly: boolean
  /** A NON-playing host is added to each alliance as a read-only member. Off: members only (the existing private-channel rule). */
  allianceHostCanRead: boolean
  strikeLimit: number
  strikeAutoRemove: boolean
  tradeRulesEnabled: boolean
  crossTribeTrades: SurvivorCrossTribeTradeMode
  /** `window` mode: cross-tribe trades open after Tribal Council and close at this day/time (ET). */
  crossTribeCloseDay: SurvivorGovernanceDay
  crossTribeCloseTime: string
  /** `window` mode: 1–3 weekly windows. The first one's close mirrors `crossTribeCloseDay/Time`. */
  crossTribeWindows: SurvivorCrossTribeWindow[]
  /** The trade check could not run: `allow` the trade (the old behaviour) or `hold` it for the commissioner. */
  tradeCheckFailureMode: SurvivorTradeCheckFailureMode
  /** Within a tribe, only players who have not played yet this week may be traded. */
  withinTribeUnplayedOnly: boolean
  /** A player who has played this week cannot be traded until that week's Tribal Council is over. */
  playedLockUntilTribal: boolean
  weeklyTradeFreezeEnabled: boolean
  /** Trades freeze at this day/time (ET) and reopen after the week's Tribal Council. */
  weeklyTradeFreezeDay: SurvivorGovernanceDay
  weeklyTradeFreezeTime: string
  tribeSplit: SurvivorTribeSplit
  /** Commissioner's manual flags; win over anything read from earlier seasons. userId → experience. */
  experienceOverrides: Record<string, SurvivorExperience>
  /**
   * Off by default (privacy). On: a castaway who played an earlier Survivor season in ANY league on
   * AllFantasy (our own SurvivorPlayer rows) counts as a veteran. Only rookie/veteran is ever shown,
   * never which leagues. The manual flag still wins.
   */
  experienceCrossLeague: boolean
  /** Week 1 counts only games on or after this Eastern weekday. Null: the whole week counts. */
  weekOneScoringStartDay: SurvivorGovernanceDay | null
  /** Display only: show each castaway's tribe emoji beside their name on Survivor screens. */
  tribeEmojiInNames: boolean
}

export const SURVIVOR_GOVERNANCE_LIMITS = {
  allianceMaxSize: [2, 10],
  strikeLimit: [1, 5],
  swapTribeCount: [2, 5],
  swapScheduleLength: [0, 6],
  patternLength: [2, 40],
} as const

export const SURVIVOR_GOVERNANCE_DEFAULTS: SurvivorGovernanceSettings = {
  swapSchedule: [],
  alliancesEnabled: false,
  allianceMaxSize: 4,
  allianceSameTribeOnly: false,
  allianceHostCanRead: false,
  strikeLimit: 2,
  strikeAutoRemove: false,
  tradeRulesEnabled: false,
  crossTribeTrades: 'window',
  crossTribeCloseDay: 'Thursday',
  crossTribeCloseTime: '19:00',
  crossTribeWindows: [{ opensOn: 'tribal', closeDay: 'Thursday', closeTime: '19:00' }],
  tradeCheckFailureMode: 'allow',
  withinTribeUnplayedOnly: true,
  playedLockUntilTribal: true,
  weeklyTradeFreezeEnabled: false,
  weeklyTradeFreezeDay: 'Saturday',
  weeklyTradeFreezeTime: '23:59',
  tribeSplit: 'none',
  experienceOverrides: {},
  experienceCrossLeague: false,
  weekOneScoringStartDay: null,
  tribeEmojiInNames: false,
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const PATTERN = /^[A-E]+$/

function isDay(value: unknown): value is SurvivorGovernanceDay {
  return typeof value === 'string' && (SURVIVOR_GOVERNANCE_DAYS as readonly string[]).includes(value)
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

function intIn(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Normalise one swap entry; null when it cannot be a valid swap. */
export function readScheduledSwap(value: unknown): SurvivorScheduledSwap | null {
  const r = rec(value)
  const week = r.week
  if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > 30) return null
  const mode = oneOf(r.mode, SURVIVOR_SWAP_MODES, 'random_shuffle')
  if (r.mode !== undefined && r.mode !== mode) return null
  const swap: SurvivorScheduledSwap = { week, mode }
  if (mode === 'resize') {
    const count = r.tribeCount
    if (typeof count !== 'number' || !Number.isInteger(count) || count < SURVIVOR_GOVERNANCE_LIMITS.swapTribeCount[0] || count > SURVIVOR_GOVERNANCE_LIMITS.swapTribeCount[1]) return null
    swap.tribeCount = count
  }
  if (mode === 'custom_pattern') {
    const pattern = typeof r.pattern === 'string' ? r.pattern.toUpperCase().replace(/[\s,]/g, '') : ''
    const [min, max] = SURVIVOR_GOVERNANCE_LIMITS.patternLength
    if (!PATTERN.test(pattern) || pattern.length < min || pattern.length > max || new Set(pattern).size < 2) return null
    swap.pattern = pattern
    swap.order = oneOf(r.order, SURVIVOR_SWAP_ORDERS, 'season_points')
  }
  return swap
}

/** Normalise one cross-tribe window; null when it cannot be a valid window. */
export function readCrossTribeWindow(value: unknown): SurvivorCrossTribeWindow | null {
  const r = rec(value)
  if (!isDay(r.closeDay) || typeof r.closeTime !== 'string' || !TIME.test(r.closeTime)) return null
  const opensOn = r.opensOn === undefined ? 'tribal' : r.opensOn
  if (opensOn === 'tribal') return { opensOn: 'tribal', closeDay: r.closeDay, closeTime: r.closeTime }
  if (opensOn !== 'time' || !isDay(r.openDay) || typeof r.openTime !== 'string' || !TIME.test(r.openTime)) return null
  if (r.openDay === r.closeDay && r.openTime === r.closeTime) return null
  return { opensOn: 'time', openDay: r.openDay, openTime: r.openTime, closeDay: r.closeDay, closeTime: r.closeTime }
}

/** The stored windows, or the legacy single close read as one Tribal-opened window. */
function readCrossTribeWindows(g: Rec, closeDay: SurvivorGovernanceDay, closeTime: string): SurvivorCrossTribeWindow[] {
  if (Array.isArray(g.crossTribeWindows)) {
    const windows = g.crossTribeWindows.map(readCrossTribeWindow).filter((w): w is SurvivorCrossTribeWindow => w != null).slice(0, SURVIVOR_CROSS_TRIBE_WINDOW_MAX)
    if (windows.length > 0) return windows
  }
  return [{ opensOn: 'tribal', closeDay, closeTime }]
}

/**
 * Commissioner presets for the windows, by sport. NFL: the original league's two windows — after
 * Tribal Council until Thursday Night Football kicks off (8:15 PM ET), then from Friday 12:00 AM ET
 * until the Sunday 1 PM games. Other sports play most days, so a "before the big slate" preset would be
 * invented: they get the single default window only.
 */
export interface SurvivorCrossTribeWindowPreset {
  id: 'original_nfl' | 'single_default'
  windows: SurvivorCrossTribeWindow[]
}

export const SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS: SurvivorCrossTribeWindow[] = [
  { opensOn: 'tribal', closeDay: 'Thursday', closeTime: '20:15' },
  { opensOn: 'time', openDay: 'Friday', openTime: '00:00', closeDay: 'Sunday', closeTime: '13:00' },
]

export function crossTribeWindowPresetsFor(sport: string | null | undefined): SurvivorCrossTribeWindowPreset[] {
  const single: SurvivorCrossTribeWindowPreset = { id: 'single_default', windows: SURVIVOR_GOVERNANCE_DEFAULTS.crossTribeWindows.map((w) => ({ ...w })) }
  return String(sport ?? '').toUpperCase() === 'NFL'
    ? [{ id: 'original_nfl', windows: SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS.map((w) => ({ ...w })) }, single]
    : [single]
}

function readExperience(value: unknown): Record<string, SurvivorExperience> {
  const out: Record<string, SurvivorExperience> = {}
  for (const [userId, flag] of Object.entries(rec(value))) {
    if (userId && (flag === 'rookie' || flag === 'veteran')) out[userId] = flag
  }
  return out
}

/** The league's governance settings, every missing or invalid value at its default. */
export function readSurvivorGovernanceSettings(leagueSettings: unknown): SurvivorGovernanceSettings {
  const g = rec(rec(leagueSettings)[SURVIVOR_GOVERNANCE_KEY])
  const d = SURVIVOR_GOVERNANCE_DEFAULTS
  const closeDay = isDay(g.crossTribeCloseDay) ? g.crossTribeCloseDay : d.crossTribeCloseDay
  const closeTime = typeof g.crossTribeCloseTime === 'string' && TIME.test(g.crossTribeCloseTime) ? g.crossTribeCloseTime : d.crossTribeCloseTime
  const swaps = Array.isArray(g.swapSchedule) ? g.swapSchedule.map(readScheduledSwap).filter((s): s is SurvivorScheduledSwap => s != null) : []
  const byWeek = new Map<number, SurvivorScheduledSwap>()
  for (const swap of swaps) if (!byWeek.has(swap.week)) byWeek.set(swap.week, swap)
  return {
    swapSchedule: [...byWeek.values()].sort((a, b) => a.week - b.week).slice(0, SURVIVOR_GOVERNANCE_LIMITS.swapScheduleLength[1]),
    alliancesEnabled: bool(g.alliancesEnabled, d.alliancesEnabled),
    allianceMaxSize: intIn(g.allianceMaxSize, SURVIVOR_GOVERNANCE_LIMITS.allianceMaxSize, d.allianceMaxSize),
    allianceSameTribeOnly: bool(g.allianceSameTribeOnly, d.allianceSameTribeOnly),
    allianceHostCanRead: bool(g.allianceHostCanRead, d.allianceHostCanRead),
    strikeLimit: intIn(g.strikeLimit, SURVIVOR_GOVERNANCE_LIMITS.strikeLimit, d.strikeLimit),
    strikeAutoRemove: bool(g.strikeAutoRemove, d.strikeAutoRemove),
    tradeRulesEnabled: bool(g.tradeRulesEnabled, d.tradeRulesEnabled),
    crossTribeTrades: oneOf(g.crossTribeTrades, SURVIVOR_CROSS_TRIBE_TRADE_MODES, d.crossTribeTrades),
    crossTribeCloseDay: closeDay,
    crossTribeCloseTime: closeTime,
    crossTribeWindows: readCrossTribeWindows(g, closeDay, closeTime),
    tradeCheckFailureMode: oneOf(g.tradeCheckFailureMode, SURVIVOR_TRADE_CHECK_FAILURE_MODES, d.tradeCheckFailureMode),
    withinTribeUnplayedOnly: bool(g.withinTribeUnplayedOnly, d.withinTribeUnplayedOnly),
    playedLockUntilTribal: bool(g.playedLockUntilTribal, d.playedLockUntilTribal),
    weeklyTradeFreezeEnabled: bool(g.weeklyTradeFreezeEnabled, d.weeklyTradeFreezeEnabled),
    weeklyTradeFreezeDay: isDay(g.weeklyTradeFreezeDay) ? g.weeklyTradeFreezeDay : d.weeklyTradeFreezeDay,
    weeklyTradeFreezeTime: typeof g.weeklyTradeFreezeTime === 'string' && TIME.test(g.weeklyTradeFreezeTime) ? g.weeklyTradeFreezeTime : d.weeklyTradeFreezeTime,
    tribeSplit: oneOf(g.tribeSplit, SURVIVOR_TRIBE_SPLITS, d.tribeSplit),
    experienceOverrides: readExperience(g.experienceOverrides),
    experienceCrossLeague: bool(g.experienceCrossLeague, d.experienceCrossLeague),
    weekOneScoringStartDay: isDay(g.weekOneScoringStartDay) ? g.weekOneScoringStartDay : null,
    tribeEmojiInNames: bool(g.tribeEmojiInNames, d.tribeEmojiInNames),
  }
}

export type SurvivorGovernanceKey = keyof SurvivorGovernanceSettings

/** What the save path knows about the season, for locks and swap-week validation. */
export interface SurvivorGovernanceContext {
  /** The Survivor week in play now; 0 before the season. */
  currentWeek: number
  /** The first Survivor week (the plan's start week, or 1). */
  firstWeek: number
  /** Tribes are assigned (or the tribe plan is locked). */
  tribesLocked: boolean
  /** The merge week when it is known (week trigger); swaps must come before it. */
  mergeWeek?: number | null
  /** The first swap, set on the setup screen (`League.survivorSwapWeek`); no second swap that week. */
  primarySwapWeek?: number | null
  /** The tribes have merged: no further swaps can run. */
  merged?: boolean
}

/**
 * Which keys cannot change right now. The tribe split shapes the first assignment, so it locks with
 * the tribes; the week-1 window locks once week 1 is over (its scores are final). Everything else is a
 * season rule the commissioner may change at any time; the swap schedule is checked per entry.
 */
export function lockedGovernanceKeys(ctx: SurvivorGovernanceContext): SurvivorGovernanceKey[] {
  const locked: SurvivorGovernanceKey[] = []
  if (ctx.tribesLocked) locked.push('tribeSplit')
  if (ctx.currentWeek > ctx.firstWeek) locked.push('weekOneScoringStartDay')
  return locked
}

export type GovernancePatchResult =
  | { ok: true; patch: Partial<SurvivorGovernanceSettings>; next: SurvivorGovernanceSettings }
  | { ok: false; error: string; code: 'invalid' | 'locked' }

const sameSwap = (a: SurvivorScheduledSwap | undefined, b: SurvivorScheduledSwap | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Validate a commissioner's patch against the current settings. Unknown keys are refused, values
 * are checked strictly (a bad value is an error, never silently replaced by a default), and locked
 * keys refuse any change. Swap entries in weeks already played can be neither added, edited nor
 * removed: the draw for them has happened (or was skipped) and history stays as it was.
 */
export function validateSurvivorGovernancePatch(
  input: unknown,
  current: SurvivorGovernanceSettings,
  ctx: SurvivorGovernanceContext,
): GovernancePatchResult {
  const body = rec(input)
  const keys = Object.keys(body)
  if (keys.length === 0) return { ok: false, code: 'invalid', error: 'Nothing to save.' }
  const known = new Set(Object.keys(SURVIVOR_GOVERNANCE_DEFAULTS))
  const unknown = keys.filter((k) => !known.has(k))
  if (unknown.length) return { ok: false, code: 'invalid', error: `Unknown setting: ${unknown.join(', ')}.` }
  const patch: Partial<SurvivorGovernanceSettings> = {}
  const bad = (error: string): GovernancePatchResult => ({ ok: false, code: 'invalid', error })

  for (const key of ['alliancesEnabled', 'allianceSameTribeOnly', 'allianceHostCanRead', 'strikeAutoRemove', 'tradeRulesEnabled',
    'withinTribeUnplayedOnly', 'playedLockUntilTribal', 'weeklyTradeFreezeEnabled', 'tribeEmojiInNames', 'experienceCrossLeague'] as const) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'boolean') return bad(`${key} must be on or off.`)
    patch[key] = body[key] as boolean
  }
  if ('allianceMaxSize' in body) {
    const [min, max] = SURVIVOR_GOVERNANCE_LIMITS.allianceMaxSize
    const v = body.allianceMaxSize
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return bad(`An alliance holds between ${min} and ${max} castaways.`)
    patch.allianceMaxSize = v
  }
  if ('strikeLimit' in body) {
    const [min, max] = SURVIVOR_GOVERNANCE_LIMITS.strikeLimit
    const v = body.strikeLimit
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return bad(`Removal comes after between ${min} and ${max} strikes.`)
    patch.strikeLimit = v
  }
  if ('crossTribeTrades' in body) {
    if (!(SURVIVOR_CROSS_TRIBE_TRADE_MODES as readonly unknown[]).includes(body.crossTribeTrades)) return bad('Cross-tribe trades are allowed, in a window, or banned.')
    patch.crossTribeTrades = body.crossTribeTrades as SurvivorCrossTribeTradeMode
  }
  for (const [dayKey, timeKey] of [['crossTribeCloseDay', 'crossTribeCloseTime'], ['weeklyTradeFreezeDay', 'weeklyTradeFreezeTime']] as const) {
    if (dayKey in body) {
      if (!isDay(body[dayKey])) return bad('Pick a day of the week.')
      patch[dayKey] = body[dayKey] as SurvivorGovernanceDay
    }
    if (timeKey in body) {
      if (typeof body[timeKey] !== 'string' || !TIME.test(body[timeKey] as string)) return bad('Pick a time as HH:MM.')
      patch[timeKey] = body[timeKey] as string
    }
  }
  if ('tradeCheckFailureMode' in body) {
    if (!(SURVIVOR_TRADE_CHECK_FAILURE_MODES as readonly unknown[]).includes(body.tradeCheckFailureMode)) return bad('If the trade check cannot run, allow the trade or hold it for the commissioner.')
    patch.tradeCheckFailureMode = body.tradeCheckFailureMode as SurvivorTradeCheckFailureMode
  }
  if ('crossTribeWindows' in body) {
    const raw = body.crossTribeWindows
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > SURVIVOR_CROSS_TRIBE_WINDOW_MAX) return bad(`Set between 1 and ${SURVIVOR_CROSS_TRIBE_WINDOW_MAX} cross-tribe windows a week.`)
    const windows: SurvivorCrossTribeWindow[] = []
    for (const entry of raw) {
      const w = readCrossTribeWindow(entry)
      if (!w) return bad('Each window closes at a day and time (HH:MM ET) and opens after Tribal Council or at a different day and time.')
      windows.push(w)
    }
    patch.crossTribeWindows = windows
    // The legacy single close mirrors the first window, for every reader of the old keys.
    patch.crossTribeCloseDay = windows[0].closeDay
    patch.crossTribeCloseTime = windows[0].closeTime
  } else if (('crossTribeCloseDay' in patch || 'crossTribeCloseTime' in patch) && current.crossTribeWindows.length === 1 && current.crossTribeWindows[0].opensOn === 'tribal') {
    // An older client editing the single close: keep the one window in step with it.
    patch.crossTribeWindows = [{ opensOn: 'tribal', closeDay: patch.crossTribeCloseDay ?? current.crossTribeCloseDay, closeTime: patch.crossTribeCloseTime ?? current.crossTribeCloseTime }]
  }
  if ('tribeSplit' in body) {
    if (!(SURVIVOR_TRIBE_SPLITS as readonly unknown[]).includes(body.tribeSplit)) return bad('The tribe split is none or Rooks vs Vets.')
    patch.tribeSplit = body.tribeSplit as SurvivorTribeSplit
  }
  if ('weekOneScoringStartDay' in body) {
    const v = body.weekOneScoringStartDay
    if (v !== null && !isDay(v)) return bad('Pick the first day of week 1 that counts, or count the whole week.')
    patch.weekOneScoringStartDay = v as SurvivorGovernanceDay | null
  }
  if ('experienceOverrides' in body) {
    const raw = rec(body.experienceOverrides)
    if (body.experienceOverrides !== null && (typeof body.experienceOverrides !== 'object' || Array.isArray(body.experienceOverrides))) return bad('Experience flags must be a map of castaways.')
    for (const flag of Object.values(raw)) if (flag !== 'rookie' && flag !== 'veteran') return bad('A castaway is a rookie or a veteran.')
    patch.experienceOverrides = readExperience(raw)
  }
  if ('swapSchedule' in body) {
    if (!Array.isArray(body.swapSchedule)) return bad('The swap schedule is a list of weeks.')
    const [, maxLen] = SURVIVOR_GOVERNANCE_LIMITS.swapScheduleLength
    if (body.swapSchedule.length > maxLen) return bad(`Schedule at most ${maxLen} extra swaps.`)
    const parsed: SurvivorScheduledSwap[] = []
    for (const entry of body.swapSchedule) {
      const swap = readScheduledSwap(entry)
      if (!swap) return bad('Each swap needs a week and a valid type (a resize needs 2–5 tribes, a pattern needs letters A–E using at least two tribes).')
      parsed.push(swap)
    }
    const weeks = parsed.map((s) => s.week)
    if (new Set(weeks).size !== weeks.length) return bad('Schedule one swap per week.')
    const played = (week: number) => ctx.currentWeek > 0 && week <= ctx.currentWeek
    for (const swap of parsed) {
      const before = current.swapSchedule.find((s) => s.week === swap.week)
      if (played(swap.week) && !sameSwap(before, swap)) return bad(`Week ${swap.week} has already been played; its swap cannot change.`)
      if (!played(swap.week)) {
        if (swap.week <= ctx.firstWeek) return bad('A swap must come after the first week.')
        if (ctx.mergeWeek != null && swap.week >= ctx.mergeWeek) return bad('A swap must come before the merge.')
        if (ctx.primarySwapWeek != null && swap.week === ctx.primarySwapWeek) return bad(`Week ${swap.week} already has the setup screen's swap.`)
        if (ctx.merged) return bad('The tribes have merged; no more swaps can run.')
      }
    }
    for (const old of current.swapSchedule) {
      if (played(old.week) && !parsed.some((s) => s.week === old.week)) return bad(`Week ${old.week} has already been played; its swap cannot be removed.`)
    }
    patch.swapSchedule = parsed.sort((a, b) => a.week - b.week)
  }

  const locked = lockedGovernanceKeys(ctx).filter((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(current[k]))
  if (locked.length) {
    return { ok: false, code: 'locked', error: locked.includes('tribeSplit') ? 'The tribe split locks once tribes are assigned.' : 'The week 1 window locks once week 1 is over.' }
  }
  const next: SurvivorGovernanceSettings = { ...current, ...patch }
  if (next.alliancesEnabled && next.allianceMaxSize < 2) return bad('An alliance holds at least two castaways.')
  return { ok: true, patch, next }
}

/** The league settings object with a governance patch merged in (returns a new object). */
export function mergeSurvivorGovernanceIntoSettings(leagueSettings: unknown, next: SurvivorGovernanceSettings): Record<string, unknown> {
  return { ...rec(leagueSettings), [SURVIVOR_GOVERNANCE_KEY]: next as unknown as Record<string, unknown> }
}

/** The scheduled swap for a week, if any. */
export function scheduledSwapForWeek(settings: SurvivorGovernanceSettings, week: number): SurvivorScheduledSwap | null {
  return settings.swapSchedule.find((s) => s.week === week) ?? null
}
