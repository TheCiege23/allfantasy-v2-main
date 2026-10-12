/**
 * Which `SportsPlayer` row speaks for a Sleeper id.
 *
 * One athlete has one row per ingest source (sleeper, rolling_insights, thesportsdb,
 * backfill), all stamped with the same `sleeperId`. The non-Sleeper rows got that id
 * from a NAME match at ingest time, so they inherit every namesake collision the
 * matcher made. Measured on production 2026-10-11:
 *
 *     sleeper 5864   Byron Murphy  CB  Minnesota Vikings   <- the athlete
 *     thesportsdb    Byron Murphy  DT  Seattle Seahawks    <- a different man
 *     sleeper 11304  E.J. Jenkins  TE  Philadelphia Eagles
 *     thesportsdb    Elgton Jenkins G  Cleveland Browns
 *     sleeper 6273   P.J. Johnson  DT  Las Vegas Raiders
 *     thesportsdb    Jackson Powers-Johnson G
 *     sleeper 6039   Ty Johnson    RB  Buffalo Bills
 *     thesportsdb    Tyler Johnson WR  Dallas Cowboys
 *
 * Picking "the freshest row" therefore picks whichever feed ran last — TheSportsDB on
 * most days — and `/players/{slug}` rendered "Byron Murphy (DT · Seattle Seahawks)"
 * for the Vikings corner.
 *
 * 🛑 THE RULE: for a Sleeper id, the `source = 'sleeper'` row is authoritative. The id
 * IS Sleeper's; no other feed can be more right about whom it names. Another source's
 * row may only fill a field the Sleeper row LACKS, and only when it demonstrably
 * describes the same man — same normalized name AND an agreeing position group. A row
 * that contradicts either is ignored outright, never blended.
 *
 * ⚠ `team` IS NEVER SUPPLEMENTED. A null team on a Sleeper row is a statement — free
 * agent or retired — not a gap. Measured the same day: 121 Sleeper rows carry a null
 * team while another source carries one, and the sample is free agents (Jason
 * Pierre-Paul "Tampa Bay Buccaneers", Graham Gano "New York Giants"): the other feed
 * holds his LAST team. Filling it would print a stale club as current.
 */

import { normalizeMatchName } from './verifiedNameMatch'

export interface PlayerSourceRow {
  source?: string | null
  sleeperId?: string | null
  name: string
  position?: string | null
  team?: string | null
  fetchedAt?: Date | string | null
}

/**
 * Football position groups. A label may sit in two groups on purpose: feeds disagree
 * about edge players (DE in one, OLB or LB in another, DL in a third), and that
 * disagreement is not evidence of a different athlete. CB vs DT, TE vs G, RB vs WR are.
 */
const POSITION_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['QB']),
  new Set(['RB', 'HB', 'FB']),
  new Set(['WR']),
  new Set(['TE']),
  new Set(['OL', 'OT', 'OG', 'T', 'G', 'C', 'IOL', 'LT', 'RT', 'LG', 'RG']),
  new Set(['DL', 'DE', 'DT', 'NT', 'IDL', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB']),
  new Set(['DB', 'CB', 'S', 'SS', 'FS', 'SAF']),
  new Set(['K', 'PK']),
  new Set(['P']),
  new Set(['LS']),
  new Set(['DEF', 'DST']),
]

function token(value: string | null | undefined): string | null {
  const t = String(value ?? '').trim().toUpperCase()
  return t || null
}

/**
 * True only when both positions are known and share a group. An unknown label agrees
 * only with itself. A missing position cannot verify anything, so it does not agree.
 */
export function positionGroupsAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = token(a)
  const tb = token(b)
  if (!ta || !tb) return false
  if (ta === tb) return true
  return POSITION_GROUPS.some((group) => group.has(ta) && group.has(tb))
}

/** Same normalized name and an agreeing position group. */
export function rowsDescribeSamePlayer(a: PlayerSourceRow, b: PlayerSourceRow): boolean {
  const na = normalizeMatchName(a.name)
  return na !== '' && na === normalizeMatchName(b.name) && positionGroupsAgree(a.position, b.position)
}

/**
 * Identity keys, plus `team` (see the header): never filled from another row.
 *
 * `teamId` too, for the same reason and one more. No NFL Sleeper row carries one (0 of 11,960,
 * 2026-10-12) while every Rolling Insights row does, so filling it would hand a free agent his
 * last club's id beside a null `team` — and the id is the vendor's own team numbering anyway,
 * meaningless next to another source's identity.
 */
const NEVER_SUPPLEMENTED = new Set(['source', 'sleeperId', 'externalId', 'sport', 'name', 'fetchedAt', 'team', 'teamId'])

function fetchedMs(row: PlayerSourceRow): number {
  if (row.fetchedAt == null) return Number.NEGATIVE_INFINITY
  const ms = new Date(row.fetchedAt).getTime()
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

export interface AuthoritativeRowResult<T> {
  /** The authoritative row with permitted gaps filled. Identity fields are the base row's. */
  row: T
  /** The row the identity comes from — the Sleeper row whenever one exists. */
  base: T
  /** Non-Sleeper rows that contradicted the Sleeper row and were ignored. */
  ignored: T[]
}

/**
 * Pick the row that speaks for one Sleeper id from all of its source rows.
 *
 * With a Sleeper row: that row, gaps filled from agreeing rows (freshest first).
 * Without one there is no authority to judge the others against, so the previous
 * order stands — a row with team and position, then one with a position, then the
 * freshest.
 */
export function selectAuthoritativePlayerRow<T extends PlayerSourceRow>(
  rows: readonly T[],
): AuthoritativeRowResult<T> | null {
  if (rows.length === 0) return null
  const ordered = [...rows].sort((a, b) => fetchedMs(b) - fetchedMs(a))
  const sleeperRow = ordered.find((r) => r.source === 'sleeper')

  if (!sleeperRow) {
    const best =
      ordered.find((r) => r.team != null && r.position != null) ??
      ordered.find((r) => r.position != null) ??
      ordered[0]!
    return { row: best, base: best, ignored: [] }
  }

  const merged: Record<string, unknown> = { ...(sleeperRow as object) }
  const ignored: T[] = []
  for (const other of ordered) {
    if (other === sleeperRow || other.source === 'sleeper') continue
    if (!rowsDescribeSamePlayer(sleeperRow, other)) {
      ignored.push(other)
      continue
    }
    for (const [key, value] of Object.entries(other)) {
      if (NEVER_SUPPLEMENTED.has(key) || value == null) continue
      if (merged[key] == null) merged[key] = value
    }
  }
  return { row: merged as T, base: sleeperRow, ignored }
}

/**
 * Group rows by Sleeper id (case-insensitively — the column stores `TB` for team
 * defences while callers send it lowercased) and pick each id's authoritative row.
 * Rows without a Sleeper id are dropped. Keys are lowercased ids.
 */
export function authoritativeRowsBySleeperId<T extends PlayerSourceRow>(rows: readonly T[]): Map<string, T> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const id = row.sleeperId?.trim().toLowerCase()
    if (!id) continue
    const bucket = groups.get(id)
    if (bucket) bucket.push(row)
    else groups.set(id, [row])
  }
  const out = new Map<string, T>()
  for (const [id, bucket] of groups) {
    const picked = selectAuthoritativePlayerRow(bucket)
    if (picked) out.set(id, picked.row)
  }
  return out
}
