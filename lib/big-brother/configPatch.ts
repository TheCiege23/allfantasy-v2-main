/**
 * One rule for what a commissioner may change in a Big Brother league's game config, used by every write path:
 * the config PATCH route (the rules editor) and the admin `update_config` action.
 *
 * 🛑 BOTH PATHS USED TO WRITE WHATEVER THEY WERE SENT. `Number("abc")` stored NaN, a deadline day of 9 or a time of
 * "25:00" was saved and then silently left that deadline unscheduled (lib/big-brother/schedule.ts skips anything
 * out of range), and an unknown tie-break string fell through to a default nobody chose. Now a bad value is refused
 * with the setting's name, and nothing is written.
 *
 * ONLY SETTINGS THE GAME READS ARE EDITABLE. Four config columns have no reader anywhere — `finalNomineeCount`
 * (the engine always nominates two), `antiCollusionLogging`, `inactivePlayerHandling`, and `waiverReleaseTiming`
 * (its getter has no caller) — so they are refused as unknown rather than offered as rules that do nothing.
 *
 * ⚠ JURY AND FINALE ARE SET BEFORE THE FIRST EVICTION ONLY. They decide who is already a juror and how the season
 * ends, so changing them once someone has been evicted would rewrite the game being played. The same line the
 * setup-rules pass draws (./bigBrotherSetupRules.ts `setupRulesForExistingLeague`). Every other rule governs the
 * next competition, vote or deadline and may change at any time — subject to the league's "Format rules" lock,
 * which the routes check.
 *
 * Pure (no I/O).
 */
import { BB_DEADLINES } from './schedule'
import type { BigBrotherConfigUpsertInput } from './BigBrotherLeagueConfig'
import { AUTO_NOMINATION_FALLBACK_OPTIONS, CHALLENGE_MODES, FINALE_FORMATS, JURY_START_MODES, PUBLIC_VOTE_TOTALS_OPTIONS } from './constants'

export const EVICTION_TIE_BREAK_MODES = ['season_points', 'hoh_vote', 'random', 'commissioner'] as const
/** HOH and both nominees always play; the rest are drawn. More than 12 is more players than most leagues have. */
export const VETO_COMPETITORS_MIN = 3
export const VETO_COMPETITORS_MAX = 12

const DEADLINE_DAY_FIELDS = BB_DEADLINES.map((d) => `${d.prefix}DayOfWeek` as const)
const DEADLINE_TIME_FIELDS = BB_DEADLINES.map((d) => `${d.prefix}TimeUtc` as const)
const JURY_FIELDS = ['juryStartMode', 'juryStartAfterEliminations', 'juryStartWhenRemaining', 'juryStartWeek'] as const
/** Fields that shape the season already under way; see the header. */
export const BEFORE_FIRST_EVICTION_FIELDS: readonly string[] = [...JURY_FIELDS, 'finaleFormat']

const ENUMS: Record<string, readonly string[]> = {
  evictionTieBreakMode: EVICTION_TIE_BREAK_MODES,
  challengeMode: CHALLENGE_MODES,
  publicVoteTotalsVisibility: PUBLIC_VOTE_TOTALS_OPTIONS,
  autoNominationFallback: AUTO_NOMINATION_FALLBACK_OPTIONS,
  finaleFormat: FINALE_FORMATS,
  juryStartMode: JURY_START_MODES,
}
const BOOLEANS = ['consecutiveHohAllowed', 'hohVotesOnlyInTie', 'weekProgressionPaused'] as const

export const EDITABLE_BIG_BROTHER_FIELDS: readonly string[] = [
  ...DEADLINE_DAY_FIELDS,
  ...DEADLINE_TIME_FIELDS,
  ...Object.keys(ENUMS),
  ...BOOLEANS,
  'vetoCompetitorCount',
  'juryStartAfterEliminations',
  'juryStartWhenRemaining',
  'juryStartWeek',
]

export type ConfigPatchResult =
  | { ok: true; input: BigBrotherConfigUpsertInput; fields: string[] }
  | { ok: false; status: 400 | 409; field: string; error: string }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Validate a requested change. `current` is the config as stored now; it decides which jury number the chosen jury
 * mode needs when the request does not carry one.
 */
export function parseBigBrotherConfigPatch(
  body: unknown,
  opts: { evictionsSoFar: number; current: { juryStartMode?: string | null; juryStartAfterEliminations?: number | null; juryStartWhenRemaining?: number | null; juryStartWeek?: number | null } },
): ConfigPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, field: '', error: 'Send the settings to change as an object.' }
  const raw = body as Record<string, unknown>
  const fields = Object.keys(raw).filter((k) => raw[k] !== undefined)
  if (!fields.length) return { ok: false, status: 400, field: '', error: 'No settings to change.' }
  const bad = (field: string, error: string): ConfigPatchResult => ({ ok: false, status: 400, field, error })

  for (const f of fields) {
    if (!EDITABLE_BIG_BROTHER_FIELDS.includes(f)) return bad(f, `"${f}" is not a Big Brother setting the game uses.`)
  }
  if (opts.evictionsSoFar > 0) {
    const late = fields.find((f) => BEFORE_FIRST_EVICTION_FIELDS.includes(f))
    if (late) return { ok: false, status: 409, field: late, error: 'Jury and finale rules can only change before the first eviction.' }
  }

  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = raw[f]
    if ((DEADLINE_DAY_FIELDS as readonly string[]).includes(f)) {
      if (v === null) out[f] = null
      else if (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 7) out[f] = v
      else return bad(f, 'A deadline day is 1 (Monday) to 7 (Sunday), or empty to leave it unscheduled.')
    } else if ((DEADLINE_TIME_FIELDS as readonly string[]).includes(f)) {
      if (v === null) out[f] = null
      else if (typeof v === 'string' && TIME.test(v)) out[f] = v
      else return bad(f, 'A deadline time is HH:MM in UTC, 00:00 to 23:59.')
    } else if (f in ENUMS) {
      if (typeof v === 'string' && ENUMS[f].includes(v)) out[f] = v
      else return bad(f, `"${f}" must be one of: ${ENUMS[f].join(', ')}.`)
    } else if ((BOOLEANS as readonly string[]).includes(f)) {
      if (typeof v === 'boolean') out[f] = v
      else return bad(f, `"${f}" must be true or false.`)
    } else if (f === 'vetoCompetitorCount') {
      if (Number.isInteger(v) && (v as number) >= VETO_COMPETITORS_MIN && (v as number) <= VETO_COMPETITORS_MAX) out[f] = v
      else return bad(f, `Veto competitors is ${VETO_COMPETITORS_MIN} to ${VETO_COMPETITORS_MAX} (the HOH and both nominees always play).`)
    } else {
      // The three jury numbers.
      if (v === null) out[f] = null
      else if (positiveInt(v) != null) out[f] = positiveInt(v)
      else return bad(f, `"${f}" must be a whole number above zero.`)
    }
  }

  // A jury mode is only as good as its number: the engine reads a missing one as 0 ("when 0 remain" never starts a
  // jury; "from week 0" starts it at the first eviction — see ./bigBrotherSetupRules.ts).
  const mode = (out.juryStartMode as string | undefined) ?? opts.current.juryStartMode ?? null
  if (fields.some((f) => (JURY_FIELDS as readonly string[]).includes(f)) && mode) {
    const need = mode === 'after_eliminations' ? 'juryStartAfterEliminations' : mode === 'when_remaining' ? 'juryStartWhenRemaining' : 'juryStartWeek'
    const value = need in out ? out[need] : opts.current[need as keyof typeof opts.current]
    if (positiveInt(value) == null) return bad(need, 'Choose the number this jury start needs.')
  }

  return { ok: true, input: out as BigBrotherConfigUpsertInput, fields }
}
