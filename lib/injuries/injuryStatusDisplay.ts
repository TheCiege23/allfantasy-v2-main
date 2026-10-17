/**
 * Display-side reading of injury / roster-status strings. Pure and dependency-free, so client
 * components (roster board, league Players tab) and server code share ONE vocabulary.
 *
 * Two jobs, both born from the same confusion — a ROSTER CODE is not an INJURY DESIGNATION:
 *
 *  - `rosterBadgeStatus` maps any status string to the roster board's four-state badge. The old
 *    mapping (`useRosterManager.normalizeStatus`) matched exact upper-case tokens, so every real
 *    spelling that was not literally `IR` / `OUT` / `Q` fell through to "healthy":
 *      "Injured Reserve", "60-day IL", "PUP-R", "Physically Unable to Perform"  → were healthy, are ir
 *      "Suspension", "Sus", "Paternity", "COV"                                   → were healthy, are out
 *      "Day-To-Day" (hyphens), "QUES", "GTD"                                      → were healthy, are q
 *
 *  - `isRosterStatusCode` / `isDisplayableInjuryDesignation` stop roster codes from being rendered as
 *    injuries. Rolling Insights' `PlayerIdentityMap.status` / `SportsPlayer.status` hold "ACT" /
 *    "INACT"; surfaces that showed anything "not active" as an injury put "⚠ ACT" on healthy players.
 *
 * "Probable" is a designation but maps to a healthy BADGE: a Probable player is expected to play and
 * the board has no "P" badge, so "Q" would overstate it. Anything unrecognised is healthy too — a
 * missing badge is a gap, a wrong one is a false statement on the player's row.
 */
export type RosterBadgeStatus = 'healthy' | 'q' | 'out' | 'ir'

/** Upper-case, every run of non-alphanumerics → one space. "Day-To-Day" == "DAY_TO_DAY". */
function normalizeStatusText(raw: unknown): string {
  if (raw == null || typeof raw === 'object') return ''
  return String(raw).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Roster / transaction codes — "is he on the roster", never "is he hurt". */
const ROSTER_STATUS_CODES = new Set([
  'ACT',
  'ACTIVE',
  'INACT',
  'INACTIVE',
  'NA',
  'N A',
  'HEALTHY',
  'PRACTICE SQUAD',
  'PS',
  'FA',
  'FREE AGENT',
  'RET',
  'RETIRED',
  'NONE',
  'NULL',
  'UNKNOWN',
])

export function isRosterStatusCode(raw: unknown): boolean {
  return ROSTER_STATUS_CODES.has(normalizeStatusText(raw))
}

/** True for a non-empty status that is an injury/availability designation rather than a roster code. */
export function isDisplayableInjuryDesignation(raw: unknown): boolean {
  const v = normalizeStatusText(raw)
  return v !== '' && !ROSTER_STATUS_CODES.has(v)
}

/**
 * The league Players tab's amber "needs attention" dot. Used to be "anything not active/healthy", so
 * the RI roster code "ACT" — returned as `injuryStatus` by `/api/players/rolling-insights/batch` —
 * dotted every healthy RI-mapped player "Injury status: ACT". The route no longer returns roster
 * codes; this refuses them defensively in case another source does.
 */
export function injuryNeedsAttention(status: string | null | undefined): boolean {
  return isDisplayableInjuryDesignation(status)
}

// Order matters: reserve lists are checked before "out" so "Out (IR)" / "OUT_IR" read as ir.
const IR_PATTERNS: RegExp[] = [
  /\bIR\b/, // IR, OUT_IR, IR-R, "IR (designated to return)"
  /\bIL\d{0,2}\b/, // IL, IL10, IL60, "60-day IL", "7-day IL"
  /\bINJURED (RESERVE|LIST)\b/,
  /\bPUP\b/, // PUP, PUP-R, PUP-P
  /\bPHYSICALLY UNABLE\b/,
  /\bNFI\b/, // NFI, NFI-R
  /\bNON FOOTBALL\b/,
]

const OUT_PATTERNS: RegExp[] = [
  /\bOUT\b/,
  /\bSUSPEN/, // Suspension, Suspended
  /\bSUS\b/,
  /\bSSPD\b/,
  /\bPATERNITY\b/,
  /\bBEREAVEMENT\b/,
  /\bCOV\b/,
  /\bCOVID/,
]

const Q_PATTERNS: RegExp[] = [
  /^Q$/,
  /\bQUES\b/,
  /\bQUESTIONABLE\b/,
  /\bDOUBTFUL\b/,
  /\bDAY TO DAY\b/,
  /\bDTD\b/,
  /\bGTD\b/,
  /\bGAME TIME DECISION\b/,
]

export function rosterBadgeStatus(raw: unknown): RosterBadgeStatus {
  const v = normalizeStatusText(raw)
  if (!v || ROSTER_STATUS_CODES.has(v)) return 'healthy'
  if (IR_PATTERNS.some((re) => re.test(v))) return 'ir'
  if (OUT_PATTERNS.some((re) => re.test(v))) return 'out'
  if (Q_PATTERNS.some((re) => re.test(v))) return 'q'
  return 'healthy'
}
