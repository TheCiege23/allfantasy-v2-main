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

/** db-first-exception: provider adapter, sole importer is the ingestion module. */
const ESPN_CORE_ATHLETES = 'https://sports.core.api.espn.com/v3/sports/football/nfl/athletes'

export type EspnAthlete = { id: string; displayName: string }

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
  return { id, displayName }
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
