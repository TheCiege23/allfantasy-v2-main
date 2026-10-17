/**
 * lib/draft/draftSettingsPolicy.ts
 *
 * Pure rules for the commissioner Draft settings tab — shared by the panel (what to offer) and by
 * `PATCH /api/leagues/[leagueId]/draft/settings` (what to accept). No I/O here, so the client and
 * the server cannot disagree about a timer value, a pace label or a round count.
 */

// ---------------------------------------------------------------------------
// Time per pick
// ---------------------------------------------------------------------------

/** The standard list every commissioner sees: 30s, 1m, 90s, 2m, 5m, 10m, 20m, 30m, 1h, 2h, 4h, 6h, 8h. */
export const STANDARD_TIMER_SECONDS: readonly number[] = [
  30, 60, 90, 120, 300, 600, 1200, 1800, 3600, 7200, 14400, 21600, 28800,
]

/**
 * Values the old list offered (12h, 24h). Not offered any more, but a league that already saved one
 * must keep it — the panel shows it as the selected value and the server still accepts it.
 */
export const LEGACY_TIMER_SECONDS: readonly number[] = [43200, 86400]

/** Custom timer bounds (AF Commissioner only): 10 seconds .. 72 hours. */
export const CUSTOM_TIMER_MIN_SECONDS = 10
export const CUSTOM_TIMER_MAX_SECONDS = 72 * 3600

export type CustomTimerUnit = 'minutes' | 'hours'

export type TimerValidationResult =
  | { ok: true; seconds: number }
  | { ok: false; code: 'TIMER_INVALID' | 'TIMER_OUT_OF_RANGE' | 'TIMER_CUSTOM_REQUIRES_SUBSCRIPTION'; error: string }

/**
 * Is this pick timer acceptable?
 * - Any standard or legacy value is always accepted.
 * - The league's currently saved value is always accepted (re-saving must never fail).
 * - Anything else is a custom timer: AF Commissioner only, whole seconds within 10s..72h.
 */
export function validateDraftTimerSeconds(
  value: unknown,
  opts: { allowCustom: boolean; currentSeconds?: number | null },
): TimerValidationResult {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, code: 'TIMER_INVALID', error: 'Time per pick must be a number of seconds.' }
  }
  const seconds = Math.round(n)
  if (STANDARD_TIMER_SECONDS.includes(seconds) || LEGACY_TIMER_SECONDS.includes(seconds)) return { ok: true, seconds }
  if (opts.currentSeconds != null && seconds === Math.round(opts.currentSeconds)) return { ok: true, seconds }
  if (!opts.allowCustom) {
    return {
      ok: false,
      code: 'TIMER_CUSTOM_REQUIRES_SUBSCRIPTION',
      error: 'Custom pick timers require the AF Commissioner subscription.',
    }
  }
  if (seconds < CUSTOM_TIMER_MIN_SECONDS || seconds > CUSTOM_TIMER_MAX_SECONDS) {
    return {
      ok: false,
      code: 'TIMER_OUT_OF_RANGE',
      error: `Time per pick must be between ${CUSTOM_TIMER_MIN_SECONDS} seconds and ${CUSTOM_TIMER_MAX_SECONDS / 3600} hours.`,
    }
  }
  return { ok: true, seconds }
}

/** Custom amount + unit → seconds, or null when it is not a usable timer. Decimals allowed (1.5 hours). */
export function customTimerToSeconds(amount: number | string, unit: CustomTimerUnit): number | null {
  const n = typeof amount === 'string' ? Number(amount.trim()) : amount
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  const seconds = Math.round(n * (unit === 'hours' ? 3600 : 60))
  if (seconds < CUSTOM_TIMER_MIN_SECONDS || seconds > CUSTOM_TIMER_MAX_SECONDS) return null
  return seconds
}

/** Best amount + unit to pre-fill the custom editor from a saved value. */
export function secondsToCustomParts(seconds: number): { amount: number; unit: CustomTimerUnit } {
  if (seconds >= 3600 && seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'hours' }
  return { amount: Math.round((seconds / 60) * 100) / 100, unit: 'minutes' }
}

/** Options for the select: the standard list, plus the saved value when it is off-list. Sorted ascending. */
export function timerOptionsFor(currentSeconds: number | null | undefined): number[] {
  const out = [...STANDARD_TIMER_SECONDS]
  if (currentSeconds != null && currentSeconds > 0 && !out.includes(currentSeconds)) out.push(currentSeconds)
  return out.sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/** ≥ 30 min per pick is a slow draft. */
export const SLOW_DRAFT_MIN_SECONDS = 30 * 60
/** 3 min up to < 30 min per pick is a "middy" (semi-slow) draft. Under 3 min is live/fast. */
export const MIDDY_DRAFT_MIN_SECONDS = 3 * 60

export type DraftPace = 'slow' | 'middy' | 'fast'

/** Pace for a pick timer; null when there is no timer (0 / null / not a number). */
export function classifyDraftPace(seconds: number | null | undefined): DraftPace | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds >= SLOW_DRAFT_MIN_SECONDS) return 'slow'
  if (seconds >= MIDDY_DRAFT_MIN_SECONDS) return 'middy'
  return 'fast'
}

/** The overnight auto-pause only makes sense for a slow draft. */
export function slowDraftPauseAllowed(seconds: number | null | undefined): boolean {
  return classifyDraftPace(seconds) === 'slow'
}

// ---------------------------------------------------------------------------
// Rounds = draftable roster spots
// ---------------------------------------------------------------------------

export type RosterSlotCounts = {
  slotName?: string | null
  starterCount?: number | null
  benchCount?: number | null
  reserveCount?: number | null
  taxiCount?: number | null
  devyCount?: number | null
}

export type DraftRoundsBreakdown = {
  /** Rounds the draft should have (never below 1 when any spot exists). */
  rounds: number
  /** Draftable spots that produced `rounds`. */
  rosterSpots: number
  starters: number
  bench: number
  /** Taxi + devy spots that were counted (0 when the format does not count them). */
  taxiDevyCounted: number
  /** IR/IL spots, always excluded. */
  irExcluded: number
  /** Taxi/devy spots present but not counted (redraft-style formats). */
  taxiDevyExcluded: number
}

const IR_SLOT_RE = /^(IR|IL|IR\d+|IL\d+|INJURED[_\s-]?RESERVE|INJURED[_\s-]?LIST|RESERVE|RES)$/i
const TAXI_SLOT_RE = /^TAXI$/i
const DEVY_SLOT_RE = /^(DEVY|COLLEGE)$/i

const nz = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * Formats whose drafts fill taxi and devy spots too: dynasty, devy, C2C (campus-to-canton) and
 * salary-cap leagues. Pass every variant/type token the league carries (leagueVariant, leagueType,
 * settings.league_type…); any one matching is enough.
 */
export function formatCountsTaxiAndDevy(tokens: ReadonlyArray<string | null | undefined>, isDynasty?: boolean | null): boolean {
  if (isDynasty === true) return true
  return tokens.some((raw) => {
    const t = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (!t) return false
    return (
      t.includes('dynasty') ||
      t.includes('devy') ||
      t === 'c2c' ||
      t.startsWith('c2c_') ||
      t.includes('campus') ||
      t.includes('salary_cap') ||
      t.includes('salarycap')
    )
  })
}

/**
 * Rounds = draftable roster spots. Starters + bench always count; IR/IL never counts; taxi and devy
 * count only when `countTaxiAndDevy` (dynasty / devy / C2C / salary cap).
 */
export function computeDraftRoundsFromSlots(
  slots: ReadonlyArray<RosterSlotCounts>,
  countTaxiAndDevy: boolean,
): DraftRoundsBreakdown {
  let starters = 0
  let bench = 0
  let taxiDevy = 0
  let ir = 0
  for (const s of slots) {
    const name = String(s.slotName ?? '').trim()
    const all = nz(s.starterCount) + nz(s.benchCount) + nz(s.reserveCount) + nz(s.taxiCount) + nz(s.devyCount)
    if (IR_SLOT_RE.test(name)) { ir += all; continue }
    if (TAXI_SLOT_RE.test(name) || DEVY_SLOT_RE.test(name)) { taxiDevy += all; continue }
    starters += nz(s.starterCount)
    bench += nz(s.benchCount)
    ir += nz(s.reserveCount)
    taxiDevy += nz(s.taxiCount) + nz(s.devyCount)
  }
  const taxiDevyCounted = countTaxiAndDevy ? taxiDevy : 0
  const rosterSpots = starters + bench + taxiDevyCounted
  return {
    rounds: Math.max(rosterSpots > 0 ? 1 : 0, Math.min(50, rosterSpots)),
    rosterSpots,
    starters,
    bench,
    taxiDevyCounted,
    irExcluded: ir,
    taxiDevyExcluded: countTaxiAndDevy ? 0 : taxiDevy,
  }
}

// ---------------------------------------------------------------------------
// Multi-randomize
// ---------------------------------------------------------------------------

export const RANDOMIZE_MAX_TIMES = 100

/** Clamp a requested shuffle count; non-subscribers always get exactly one shuffle. */
export function clampRandomizeTimes(value: unknown, allowMultiple: boolean): number | null {
  if (!allowMultiple) return 1
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value ?? 1
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < 1 || n > RANDOMIZE_MAX_TIMES) return null
  return n
}

/** Fisher–Yates, `times` passes. `random` is injectable for tests. */
export function shuffleTimes<T>(items: readonly T[], times: number, random: () => number = Math.random): T[] {
  let a = [...items]
  for (let pass = 0; pass < Math.max(1, times); pass++) {
    a = [...a]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
  }
  return a
}

/** League chat text for a randomize run. Plain text; names come from the league. */
export function buildRandomizeChatMessage(times: number, orderedNames: readonly string[]): string {
  const head = times === 1 ? '🎲 Draft order randomized' : `🎲 Draft order randomized ${times} times`
  const lines = orderedNames.map((n, i) => `${i + 1}. ${n}`)
  return lines.length ? `${head} — final order:\n${lines.join('\n')}` : head
}

// ---------------------------------------------------------------------------
// In-room commissioner timer (draft/controls `set_timer_seconds`)
// ---------------------------------------------------------------------------

export type CommissionerTimerDecision =
  | { ok: true; seconds: number }
  | {
      ok: false
      status: 400 | 403
      code: 'COMMISSIONER_TIMER_INVALID' | 'COMMISSIONER_TIMER_OUT_OF_RANGE' | 'COMMISSIONER_TIMER_CUSTOM_REQUIRES_SUBSCRIPTION'
      error: string
    }

/**
 * Same rule as the settings tab: standard / legacy values and the session's current value are always
 * accepted; anything else is a custom timer (10s..72h) that needs the AF Commissioner entitlement.
 * The entitlement is only looked up when a custom value actually needs it.
 */
export async function decideCommissionerTimerSeconds(input: {
  rawSeconds: unknown
  currentSeconds: number | null | undefined
  hasCustomEntitlement: () => Promise<boolean>
}): Promise<CommissionerTimerDecision> {
  const n = typeof input.rawSeconds === 'string' && input.rawSeconds.trim() !== '' ? Number(input.rawSeconds) : input.rawSeconds
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, status: 400, code: 'COMMISSIONER_TIMER_INVALID', error: 'Timer seconds must be a finite number.' }
  }
  const seconds = Math.round(n)
  if (seconds < CUSTOM_TIMER_MIN_SECONDS || seconds > CUSTOM_TIMER_MAX_SECONDS) {
    return {
      ok: false,
      status: 400,
      code: 'COMMISSIONER_TIMER_OUT_OF_RANGE',
      error: `Timer must be between ${CUSTOM_TIMER_MIN_SECONDS} and ${CUSTOM_TIMER_MAX_SECONDS} seconds.`,
    }
  }
  const plain = validateDraftTimerSeconds(seconds, { allowCustom: false, currentSeconds: input.currentSeconds })
  if (plain.ok) return plain
  if (await input.hasCustomEntitlement().catch(() => false)) return { ok: true, seconds }
  return {
    ok: false,
    status: 403,
    code: 'COMMISSIONER_TIMER_CUSTOM_REQUIRES_SUBSCRIPTION',
    error: 'Custom pick timers require the AF Commissioner subscription. Choose a standard time per pick.',
  }
}

/** Pick clock that "Fill with CI" (POST /fill-empty-slots) sets, in every store that carries one. */
export const FILL_WITH_CI_PICK_TIMER_SECONDS = 30
