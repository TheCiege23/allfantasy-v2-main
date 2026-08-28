/**
 * ESPN athlete names, from the one endpoint that needs no credential.
 *
 * ⚠ THIS IS THE ADAPTER — every export here is a live fetch or a pure helper for
 * one, and the only runtime importer is `ingestEspnAthleteIdentities`. Keeping the
 * fetch isolated is what lets that file be allowlisted under the DB-first guard
 * without exempting anything that reads.
 *
 * WHY THIS ENDPOINT
 * ESPN fantasy player ids ARE ESPN athlete ids. Verified against the ids on a real
 * imported draft board before a line of this was written:
 *
 *   4430737 -> Kyren Williams
 *   2577417 -> Dak Prescott
 *   12483   -> Matthew Stafford
 *
 * It is public: no cookie, no key, no quota. That matters because the league
 * import path CANNOT supply names — `mRoster` returns bare ids for this league, so
 * the roster directory is placeholders (`Player <id>`) and there is nothing to
 * harvest. The names had to come from somewhere, and this is the cheapest
 * somewhere.
 */

/** db-first-exception: provider adapter, sole importer is the ingestion module. */
const ESPN_CORE_ATHLETES = 'https://sports.core.api.espn.com/v3/sports/football/nfl/athletes'

export type EspnAthlete = { id: string; displayName: string }

export type EspnAthletePage = {
  items: EspnAthlete[]
  pageIndex: number
  pageCount: number
  count: number
}

/**
 * ⚠ THE LIST IS FULL OF THINGS THAT ARE NOT PEOPLE. ESPN carries pseudo-athletes
 * for play outcomes — ` [Downed]`, ` [Touchback]`, ` [35]` — and they are a large
 * share of the 20,277 rows, clustered at the start where a naive first-page test
 * would find nothing else. They arrive with a leading space and a bracketed body.
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
 * ⚠ ESPN DENOTES A D/ST WITH A NEGATIVE ID, and none of them appear in the athlete
 * list — `-16012` on a live board would stay unmapped forever while every human
 * player resolved. The convention is `-16000 - proTeamId`, so -16012 is team 12
 * and -16026 is team 26. Derived rather than fetched: it is arithmetic over a
 * table we already ship.
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

/** Shape one page of the athlete list, tolerating anything unexpected. */
export function parseEspnAthletePage(payload: unknown): EspnAthletePage {
  const body = (payload ?? {}) as Record<string, unknown>
  const rawItems = Array.isArray(body.items) ? body.items : []
  const items: EspnAthlete[] = []

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = String(row.id ?? '').trim()
    /* fullName and displayName agree for real players; displayName is the one
       ESPN populates for every row, so it is the one read. */
    const displayName = String(row.displayName ?? row.fullName ?? '').trim()
    if (!id) continue
    if (!isRealEspnAthleteName(displayName)) continue
    items.push({ id, displayName })
  }

  const toInt = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  return {
    items,
    pageIndex: toInt(body.pageIndex, 1),
    pageCount: toInt(body.pageCount, 1),
    count: toInt(body.count, items.length),
  }
}

/** One page, live. Throws on a non-OK response so the caller can stop cleanly. */
export async function fetchEspnAthletePage(page: number, limit = 1000): Promise<EspnAthletePage> {
  const url = `${ESPN_CORE_ATHLETES}?limit=${encodeURIComponent(String(limit))}&page=${encodeURIComponent(String(page))}`
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`ESPN athlete list returned ${response.status} for page ${page}`)
  }
  return parseEspnAthletePage(await response.json())
}
