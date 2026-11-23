/**
 * Partner code names. A commissioner picks their own ("TheCiege").
 *
 * - Shown exactly as typed, matched case-insensitively (stored normalized UPPER).
 * - Letters and numbers only, 4–20. No dashes: Apple offer codes and Google
 *   promo codes are alphanumeric, and one code has to work on web, iPhone and
 *   Android alike.
 */

export const CODE_MIN = 4
export const CODE_MAX = 20
const CODE_RE = /^[A-Za-z0-9]+$/

/** Never claimable. Compared against the normalized code. */
export const RESERVED_CODES = new Set([
  'ADMIN', 'ADMINISTRATOR', 'ALLFANTASY', 'AF', 'AFPRO', 'AFSUPREME', 'AFCOMMISSIONER',
  'SUPREME', 'PRO', 'COMMISSIONER', 'CHIMMY', 'SUPPORT', 'HELP', 'STAFF', 'MOD', 'MODERATOR',
  'OFFICIAL', 'FREE', 'TEST', 'DEMO', 'DISCOUNT', 'PROMO', 'COUPON', 'REFUND', 'BILLING',
  'STRIPE', 'APPLE', 'GOOGLE', 'NFL', 'NBA', 'MLB', 'NHL', 'NCAA', 'ESPN', 'SLEEPER', 'YAHOO',
  'FANTRAX', 'DRAFTKINGS', 'FANDUEL', 'UNDERDOG', 'PRIZEPICKS',
])

/** Codes that look like gambling are refused — this is a fantasy app, not a sportsbook. */
const BLOCKED_FRAGMENTS = ['BET', 'CASINO', 'GAMBL', 'WAGER', 'PARLAY', 'SPORTSBOOK', 'ODDS']

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export type CodeCheck =
  | { ok: true; display: string; normalized: string }
  | { ok: false; reason: 'length' | 'characters' | 'reserved' | 'not_allowed' }

/**
 * Shape and policy only. Availability (is it taken?) is a database question —
 * see claimPartnerCode. `isOffensive` is the app's existing profanity check,
 * passed in so this file stays pure and testable.
 */
export function checkCodeShape(raw: string, isOffensive: (s: string) => boolean = () => false): CodeCheck {
  const display = raw.trim()
  if (display.length < CODE_MIN || display.length > CODE_MAX) return { ok: false, reason: 'length' }
  if (!CODE_RE.test(display)) return { ok: false, reason: 'characters' }
  const normalized = normalizeCode(display)
  if (RESERVED_CODES.has(normalized) || normalized.startsWith('ALLFANTASY') || normalized.startsWith('CHIMMY')) {
    return { ok: false, reason: 'reserved' }
  }
  if (BLOCKED_FRAGMENTS.some((f) => normalized.includes(f)) || isOffensive(display)) {
    return { ok: false, reason: 'not_allowed' }
  }
  return { ok: true, display, normalized }
}

export const CODE_REASON_COPY: Record<'length' | 'characters' | 'reserved' | 'not_allowed' | 'taken' | 'change_limit', string> = {
  length: `Use ${CODE_MIN} to ${CODE_MAX} letters or numbers`,
  characters: 'Letters and numbers only, no spaces or symbols',
  reserved: 'That one is reserved, try another',
  not_allowed: "That code isn't allowed, try another",
  taken: 'Someone already has that code',
  change_limit: "You've changed your code the most times allowed this year",
}

/** The link a commissioner shares. */
export function joinPath(display: string): string {
  return `/with/${encodeURIComponent(display)}`
}
