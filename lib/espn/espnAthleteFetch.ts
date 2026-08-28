/**
 * ESPN athlete names, from the one endpoint that needs no credential.
 *
 * ⚠ THIS IS THE ADAPTER — every export is a live fetch or a pure helper for one,
 * and the only runtime importer is `ingestEspnAthleteIdentities`. Keeping the
 * fetch isolated is what lets this file be allowlisted under the DB-first guard
 * without exempting anything that reads.
 *
 * WHY PER ID, AND NOT THE LIST
 * The list endpoint is a trap, measured rather than assumed. It reports
 * `count: 20277` and `pageCount: 21` — and then serves the SAME first rows for
 * every `page`, ignores `offset`, and caps `limit` at 1000 server-side:
 *
 *   page=1 -> 4246273, 4246281, 4246289
 *   page=2 -> 4246273, 4246281, 4246289      (identical)
 *   limit=25000 -> 1000 ids
 *
 * A first version of this walked 21 "pages", fetched page one twenty-one times,
 * and wrote 994 athletes while reporting 20,874 seen. The pagination metadata is
 * describing a capability the parameters do not deliver.
 *
 * Per id is also the smaller job. We do not need ESPN's 20,277 athletes; we need
 * the ids our own leagues actually reference — 252 across both imported ESPN
 * leagues, 224 of them unknown. Bounded by our data instead of theirs, and it
 * grows only as leagues import.
 *
 *   4430737 -> Kyren Williams
 *   2577417 -> Dak Prescott
 *   12483   -> Matthew Stafford
 */

import {
  ESPN_POSITION_LABELS,
  ESPN_TEAM_ABBREVIATIONS,
} from '@/lib/league-import/espn/EspnLeagueFetchService'

/** db-first-exception: provider adapter, sole importer is the ingestion module. */
const ESPN_CORE_ATHLETES = 'https://sports.core.api.espn.com/v3/sports/football/nfl/athletes'

export type EspnAthlete = {
  id: string
  displayName: string
  /**
   * The fields that let a name become an identity.
   *
   * ⚠ THESE COST NOTHING EXTRA. The athlete document was already being fetched and
   * these were already in it; the previous parser kept the name and dropped the rest,
   * which is why linking a provider id to a canonical player was impossible.
   *
   * Each is optional and each is allowed to be absent. `matchProviderAthlete` treats a
   * missing field as no evidence rather than as agreement, so an unexpected payload
   * shape costs us a link we would not otherwise have made - it can never cause a
   * WRONG one. That asymmetry is why the parser below can afford to be tolerant.
   */
  position?: string | null
  team?: string | null
  dob?: string | null
}

/**
 * ⚠ ESPN'S ATHLETE SPACE CONTAINS THINGS THAT ARE NOT PEOPLE — pseudo-athletes for
 * play outcomes, ` [Downed]`, ` [Touchback]`, ` [35]`, arriving with a leading
 * space and a bracketed body.
 *
 * Rejecting on the bracket rather than on `active: false` is deliberate: plenty of
 * real players are inactive, and a draft board from an earlier season needs them.
 */
export function isRealEspnAthleteName(name: unknown): boolean {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return false
  if (trimmed.startsWith('[')) return false
  return true
}

/**
 * The team defence behind a negative id, without asking anyone.
 *
 * ⚠ ESPN DENOTES A D/ST WITH A NEGATIVE ID, and none of them resolve as athletes —
 * `-16012` would stay unmapped for ever while every human player resolved. The
 * convention is `-16000 - proTeamId`, so -16012 is team 12 and -16026 is team 26.
 * Derived rather than fetched: arithmetic over a table we already ship.
 */
export function espnDefenseIdentity(
  providerPlayerId: string,
  teamAbbreviations: Record<number, string>,
): EspnAthlete | null {
  const n = Number(String(providerPlayerId ?? '').trim())
  if (!Number.isInteger(n) || n > -16001 || n < -16099) return null
  const teamId = -16000 - n
  const abbreviation = teamAbbreviations[teamId]
  if (!abbreviation) return null
  return { id: String(n), displayName: `${abbreviation} D/ST` }
}

/** First non-empty string among several candidate shapes, or null. */
function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

function nested(row: Record<string, unknown>, key: string, inner: string): unknown {
  const value = row[key]
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[inner]
}

/**
 * The athlete's position, from whichever shape this document happens to use.
 *
 * ESPN is not consistent across its own surfaces: the athlete document carries a
 * `position` object, while league payloads carry a numeric `defaultPositionId`. Both
 * are accepted here, the numeric one through the SAME table the league importer
 * already uses - restating that mapping is how two parts of one codebase come to
 * disagree about what position 16 is.
 */
export function readEspnPosition(row: Record<string, unknown>): string | null {
  const direct = firstString(
    nested(row, 'position', 'abbreviation'),
    nested(row, 'position', 'displayName'),
    typeof row.position === 'string' ? row.position : undefined,
  )
  if (direct) return direct
  const id = Number(row.defaultPositionId)
  if (Number.isInteger(id) && ESPN_POSITION_LABELS[id]) return ESPN_POSITION_LABELS[id]!
  return null
}

/** The athlete's pro team abbreviation, same tolerance, same shared table. */
export function readEspnTeam(row: Record<string, unknown>): string | null {
  const direct = firstString(
    nested(row, 'team', 'abbreviation'),
    row.proTeamAbbrev,
    typeof row.team === 'string' ? row.team : undefined,
  )
  if (direct) return direct
  const id = Number(row.proTeamId)
  if (Number.isInteger(id) && ESPN_TEAM_ABBREVIATIONS[id]) return ESPN_TEAM_ABBREVIATIONS[id]!
  return null
}

/** Shape one athlete document, tolerating anything unexpected. */
export function parseEspnAthlete(payload: unknown, requestedId: string): EspnAthlete | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const displayName = String(row.displayName ?? row.fullName ?? '').trim()
  if (!isRealEspnAthleteName(displayName)) return null
  /* ESPN echoes the id; prefer it, and fall back to what we asked for so a
     response that omits it is still usable against the id we hold. */
  const id = String(row.id ?? requestedId).trim()
  if (!id) return null
  return {
    id,
    displayName,
    position: readEspnPosition(row),
    team: readEspnTeam(row),
    dob: firstString(row.dateOfBirth, row.birthDate, row.dob),
  }
}

/**
 * One athlete, live.
 *
 * Returns null rather than throwing on a 404: an id ESPN does not know is a fact
 * about that id, not a failure of the run, and the caller is walking a list where
 * one miss must not stop the rest.
 */
export async function fetchEspnAthleteById(id: string): Promise<EspnAthlete | null> {
  const trimmed = String(id ?? '').trim()
  if (!trimmed) return null
  const response = await fetch(`${ESPN_CORE_ATHLETES}/${encodeURIComponent(trimmed)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`ESPN athlete ${trimmed} returned ${response.status}`)
  }
  return parseEspnAthlete(await response.json(), trimmed)
}
