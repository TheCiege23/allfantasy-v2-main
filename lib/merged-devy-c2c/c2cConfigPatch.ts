/**
 * Validate a PATCH to /api/leagues/[leagueId]/merged-devy-c2c/config — the C2C / Merged Devy config
 * (`C2CLeagueConfig`) that league creation writes and the merged-devy-c2c stack reads. Pure.
 *
 * ⚠ THE ROUTE USED TO COERCE EVERYTHING: `Number('abc')` is NaN, which Prisma refuses for an Int
 * column (a 500 mid-save), and `Boolean('false')` is true. Every key is now type-checked; a wrong
 * type is a 400 naming the key, never a coerced value.
 *
 * Enumerations are checked only where the codebase has ONE definition (lib/merged-devy-c2c/types.ts
 * and the editor's own options). The rule strings that are spelled several ways across files
 * (promotion timing, declare/return handling, pick trade and order rules) are length-checked to
 * their VarChar column instead of being narrowed to a guess.
 */

type Rec = Record<string, unknown>

const ENUMS = {
  startupFormat: ['merged', 'separate'],
  standingsModel: ['unified', 'separate', 'hybrid'],
  startupDraftType: ['snake', 'linear', 'auction'],
  rookieDraftType: ['snake', 'linear'],
  collegeDraftType: ['snake', 'linear'],
  hybridPlayoffQualification: ['pro_only', 'college_only', 'combined', 'weighted'],
  hybridChampionshipTieBreaker: ['pro_first', 'college_first', 'total_points', 'head_to_head'],
} as const

/** Free-text rule keys and their VarChar column length (prisma/schema.prisma C2CLeagueConfig). */
const RULE_STRINGS = {
  promotionTiming: 48,
  earlyDeclareBehavior: 24,
  returnToSchoolHandling: 32,
  rookiePickTradeRules: 24,
  collegePickTradeRules: 24,
  rookiePickOrderMethod: 32,
  collegePickOrderMethod: 32,
} as const

const INTS = {
  collegeRosterSize: [0, 60],
  taxiSize: [0, 20],
  rookieDraftRounds: [0, 10],
  collegeDraftRounds: [0, 15],
  proBenchSize: [0, 30],
  proIRSize: [0, 10],
  hybridProWeight: [0, 100],
} as const

/** Ints that may also be cleared with null. */
const NULLABLE_INTS = {
  maxPromotionsPerYear: [0, 50],
  collegeFAABBudget: [0, 100_000],
} as const

const BOOLS = [
  'mergedStartupDraft',
  'separateStartupCollegeDraft',
  'bestBallPro',
  'bestBallCollege',
  'collegeScoringUntilDeadline',
  'mergedRookieCollegeDraft',
  'nflCollegeExcludeKDST',
  'collegeFAEnabled',
  'collegeFAABSeparate',
] as const

/** Lineup-slot maps: `{ QB: 1, RB: 2, ... }` — position keys to small whole numbers. */
const SLOT_MAPS = ['collegeActiveLineupSlots', 'proLineupSlots'] as const

export function parseC2CConfigPatch(raw: Rec): { ok: true; patch: Rec } | { ok: false; error: string } {
  const patch: Rec = {}
  const fail = (error: string) => ({ ok: false as const, error })

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (raw[key] === undefined) continue
    if (!(allowed as readonly unknown[]).includes(raw[key])) return fail(`${key} must be one of: ${allowed.join(', ')}`)
    patch[key] = raw[key]
  }
  for (const [key, max] of Object.entries(RULE_STRINGS)) {
    if (raw[key] === undefined) continue
    const v = raw[key]
    if (typeof v !== 'string' || !/^[a-z_]+$/.test(v) || v.length > max) {
      return fail(`${key} must be a lowercase rule name of at most ${max} characters`)
    }
    patch[key] = v
  }
  for (const [key, [min, max]] of Object.entries(INTS)) {
    if (raw[key] === undefined) continue
    const v = raw[key]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return fail(`${key} must be a whole number from ${min} to ${max}`)
    }
    patch[key] = v
  }
  for (const [key, [min, max]] of Object.entries(NULLABLE_INTS)) {
    if (raw[key] === undefined) continue
    const v = raw[key]
    if (v === null) {
      patch[key] = null
      continue
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return fail(`${key} must be a whole number from ${min} to ${max}, or empty`)
    }
    patch[key] = v
  }
  for (const key of BOOLS) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') return fail(`${key} must be true or false`)
    patch[key] = raw[key]
  }
  for (const key of SLOT_MAPS) {
    if (raw[key] === undefined) continue
    const v = raw[key]
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(`${key} must be a map of position to count`)
    for (const [pos, n] of Object.entries(v as Rec)) {
      if (!/^[A-Z_/]{1,12}$/.test(pos) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) {
        return fail(`${key}: each position needs a whole-number count from 0 to 10`)
      }
    }
    patch[key] = v
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change.')
  return { ok: true, patch }
}
