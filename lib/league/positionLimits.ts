/**
 * Position limits: the most players of one position a team may roster (e.g. at most 4 QBs, 1 K).
 *
 * Stored at `League.settings.position_limits` as `{ QB: 4, K: 1 }` — a missing position has no limit.
 * Enforced where a player JOINS a team on a league hosted on AllFantasy: free-agent adds and waiver
 * claims (submission and overnight processing) and trades. A commish's Edit Rosters move is a
 * deliberate override and is not limited, the same way it skips roster locks.
 *
 * ⚠ A MOVE IS REFUSED ONLY WHEN IT RAISES A POSITION ABOVE ITS LIMIT. A limit set mid-season can leave
 * a team already over; that team may still drop, trade away or swap like-for-like, and is only stopped
 * from adding MORE of that position. Refusing every move until it complies would freeze the team.
 *
 * ⚠ THE WHOLE ROSTER COUNTS, IR AND TAXI INCLUDED — "how many QBs does this team hold".
 *
 * ⚠ A PLAYER WHOSE POSITION CANNOT BE RESOLVED IS NOT COUNTED. Refusing a move over a lookup gap would
 * block legitimate adds; under-counting one unknown player is the safer failure.
 *
 * Pure: no database. The position lookup is lib/league/positionLimitsServer.ts.
 */

export const POSITION_LIMITS_SETTINGS_KEY = 'position_limits'
export const MAX_POSITION_LIMIT = 99

/** Alias spellings to the one key a limit is stored under (DST and D/ST are DEF; PK is K). */
const ALIASES: Record<string, string> = { DST: 'DEF', 'D/ST': 'DEF', D: 'DEF', PK: 'K', GK: 'GKP' }

export function normalizeLimitPosition(position: unknown): string {
  const p = String(position ?? '').trim().toUpperCase()
  return ALIASES[p] ?? p
}

export type PositionLimits = Record<string, number>

/**
 * A clean limits map from untrusted input: upper-cased positions, whole numbers 1..99. A 0, blank or
 * null entry means "no limit" and is dropped. Returns null when the input is not an object or names a
 * malformed position.
 */
export function parsePositionLimits(raw: unknown): PositionLimits | null {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: PositionLimits = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pos = normalizeLimitPosition(key)
    if (!/^[A-Z][A-Z0-9_/]{0,7}$/.test(pos)) return null
    if (value === null || value === '' || value === 0 || value === '0') continue
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > MAX_POSITION_LIMIT) return null
    out[pos] = n
  }
  return out
}

/** The league's limits, tolerating anything stored. */
export function readPositionLimits(settings: unknown): PositionLimits {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return parsePositionLimits(s[POSITION_LIMITS_SETTINGS_KEY]) ?? {}
}

export function countPositions(positions: Iterable<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of positions) {
    if (!raw) continue
    const p = normalizeLimitPosition(raw)
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return counts
}

export type PositionLimitBreach = { position: string; limit: number; before: number; after: number }

/**
 * Positions this move pushes over their limit: `after > limit` AND `after > before`. A team already
 * over a limit is not stopped from moves that do not add to it.
 */
export function positionLimitBreaches(
  limits: PositionLimits,
  before: Iterable<string | null | undefined>,
  after: Iterable<string | null | undefined>,
): PositionLimitBreach[] {
  const b = countPositions(before)
  const a = countPositions(after)
  const out: PositionLimitBreach[] = []
  for (const [position, limit] of Object.entries(limits)) {
    const pa = a.get(position) ?? 0
    const pb = b.get(position) ?? 0
    if (pa > limit && pa > pb) out.push({ position, limit, before: pb, after: pa })
  }
  return out
}

export function positionLimitMessage(breach: PositionLimitBreach, teamLabel = 'This team'): string {
  return `${teamLabel} can roster at most ${breach.limit} ${breach.position}${breach.limit === 1 ? '' : 's'}; this move would make it ${breach.after}.`
}
