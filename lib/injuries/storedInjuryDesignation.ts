/**
 * Is this value an INJURY / AVAILABILITY DESIGNATION, fit to sit in `SportsPlayerRecord.injuryStatus`?
 *
 * No prisma, no `server-only` — a pure predicate, so the importer's write path, its column guard and
 * any other writer of that column apply ONE rule. Two implementations of one rule is how this column
 * went bad in the first place.
 *
 * 🛑 AN ALLOWLIST, ON PURPOSE. Measured in production 2026-10-11, rows the importer had not rewritten
 * since e71912b3 carried, as "injury status":
 *
 *     INACT 84,468 · ACT 33,446 · Active 8,995 · active 7,101 · Inactive 2,936 · Unknown · Coaching ·
 *     Free Agent · NA · Retired · Practice Squad · Deceased · "Hamstring injury" · "Knee injury" · …
 *
 * Every one of those is roster bookkeeping or free text, and every surface that reads the column
 * (trade analyzer, draft room, value snapshots, Chimmy, waiver tools) reads a non-null value as a
 * designation. A denylist would have to anticipate the next roster code a provider invents; an
 * allowlist fails the safe way — an unrecognised value is stored as null, which readers treat as
 * "no designation on file", rather than asserted as an injury.
 *
 * Decisions on the borderline values (case-insensitive, whitespace-collapsed, a leading
 * `Reserve/` and ESPN's `INJURY_STATUS_` prefix stripped first):
 *
 *   DESIGNATION
 *     Out (and "Out for season", "Out (ankle)"…) · Doubtful · Questionable · QUES · Probable ·
 *     GTD / game-time decision · Day-To-Day / DTD
 *     IR · IR-R · LTIR · Injured Reserve(…) · IL · IL10 / IL-60 · "10-day IL" / "60-Day-IL" ·
 *     Injured List · Injured
 *     PUP (+ -R/-P) · Physically Unable to Perform · NFI (+ -R/-A) · Non-Football Injury/Illness
 *     Suspended · Suspension · Sus · SUSP · SSPD
 *     COV · COVID / COVID-19 · Concussion Protocol
 *     DNR / Did Not Report — the player is not with the team, which is an availability fact
 *     Paternity (List) · Bereavement (List) · Personal (Reasons) — real absences on MLB/NBA lists
 *     Q · O · D — the bare letters some feeds abbreviate to; `lib/redraft/lineupValidation.ts`
 *       already reads Q and D as designations
 *
 *   NOT A DESIGNATION
 *     Active / ACT / Healthy / Inactive / INACT / NA / N/A / Unknown / Free Agent / Practice Squad /
 *       Coaching / Retired / Deceased — roster status, not availability
 *     Limited / Full / DNP — PRACTICE participation. A "Limited" player is active for the game unless
 *       separately designated; storing it as an injury is the false-positive this column must avoid
 *     P — would be "Probable", but it is also a position code (pitcher, punter); "Probable" spelled
 *       out is accepted
 *     Free text ("Hamstring injury", "Knee injury", "surgery") — a body part is not a designation,
 *       and in production these were all unrefreshed leftovers
 */

const EXACT_DESIGNATIONS = new Set<string>([
  'out',
  'o',
  'doubtful',
  'd',
  'questionable',
  'ques',
  'q',
  'probable',
  'gtd',
  'game-time decision',
  'game time decision',
  'day-to-day',
  'day to day',
  'dtd',
  'ir',
  'ir-r',
  'ir-lt',
  'ltir',
  'il',
  'injured',
  'injured list',
  'pup',
  'pup-r',
  'pup-p',
  'nfi',
  'nfi-r',
  'nfi-a',
  'sus',
  'susp',
  'sspd',
  'cov',
  'covid',
  'covid-19',
  'dnr',
  'did not report',
  'paternity',
  'paternity list',
  'bereavement',
  'bereavement list',
  'personal',
  'personal reasons',
])

const DESIGNATION_PATTERNS: readonly RegExp[] = [
  /^out\b/, // "out for season", "out (ankle)", "out indefinitely"
  /^injured reserve\b/, // "injured reserve - designated to return"
  /^il[- ]?\d+$/, // IL10, IL-60
  /^\d+[- ]day[- ]?(il|injured list)$/, // "10-day IL", "60-Day-IL", "15-day injured list"
  /^suspen/, // suspended, suspension
  /^covid/,
  /^concussion\b/, // "concussion protocol"
  /^physically unable\b/,
  /^non[- ]football\b/,
  /^day[- ]to[- ]day\b/,
  /^paternity\b/,
  /^bereavement\b/,
]

function normalizeStoredStatus(value: string): string {
  let t = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '')
  if (t.startsWith('injury_status_')) t = t.slice('injury_status_'.length).replace(/_/g, ' ')
  if (t.startsWith('reserve/')) t = t.slice('reserve/'.length).trim()
  return t
}

export function isStoredInjuryDesignation(status: string | null | undefined): status is string {
  if (typeof status !== 'string') return false
  const t = normalizeStoredStatus(status)
  if (!t) return false
  if (EXACT_DESIGNATIONS.has(t)) return true
  return DESIGNATION_PATTERNS.some((re) => re.test(t))
}

/**
 * The `{ injuryStatus, injuryNotes }` pair a writer may store: the status only if it is a
 * designation, and the note only alongside a stored status. A note with no status is not kept —
 * `FantasyValueSnapshotService` reads `injuryStatus ?? injuryNotes`, so an orphan note is read as
 * an injury on its own.
 */
export function storedInjuryFields(
  status: string | null | undefined,
  notes: string | null | undefined,
): { injuryStatus: string | null; injuryNotes: string | null } {
  if (!isStoredInjuryDesignation(status)) return { injuryStatus: null, injuryNotes: null }
  const trimmedNotes = typeof notes === 'string' ? notes.trim() : ''
  return { injuryStatus: status.trim(), injuryNotes: trimmedNotes || null }
}
