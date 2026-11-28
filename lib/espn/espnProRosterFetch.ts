/**
 * ESPN NBA / NHL / MLB — teams list and team rosters, for current-team headshots (contracts/espn GAPS E-08).
 *
 * ⚠ THIS IS THE ADAPTER. Every export is a live fetch or a pure parser for one, and the only runtime
 * importer is `lib/espn/proEspnHeadshotIngest.ts`. That isolation is what lets this file be allowlisted
 * under the DB-first guard without exempting anything that reads.
 *
 * Shapes are from `contracts/espn/fixtures/roster.{NBA.team12,NHL.team13,MLB.team10}.json` (2026-11-27):
 *   - NBA `athletes` is a FLAT array; NHL and MLB GROUP it by position: `[{ position, items: [...] }]`;
 *   - `headshot` is omitted when ESPN has no photo; `jersey` is a string.
 *
 * 🛑 NO SPOOFED HEADERS. A 403 throws `EspnBlockedError` and the caller stops the whole pass — see
 * `lib/providers/espnUrls.ts` for why getting past bot detection is not the fix.
 */

import { espnSiteApiUrl } from '@/lib/providers/espnUrls'
import { EspnBlockedError, parseEspnNcaabTeams } from './espnNcaabFetch'
import { ESPN_PRO_SPORT_PATH, type EspnProSport } from './espnProHeadshots'

const DEFAULT_TIMEOUT_MS = 15_000

export type EspnProAthlete = {
  id: string
  fullName: string
  jersey: string | null
  /** Present only when ESPN has a photo. */
  headshotUrl: string | null
}

export type EspnProTeam = { id: string; abbreviation: string | null; displayName: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Pure: `teams/{id}/roster` body -> athletes, whether ESPN sent them flat (NBA) or grouped (NHL, MLB). */
export function parseEspnProRoster(body: unknown): { seasonYear: number | null; athletes: EspnProAthlete[]; rejectedCount: number } {
  const b = body as { season?: { year?: unknown }; athletes?: unknown[] }
  const seasonYear = typeof b?.season?.year === 'number' ? b.season.year : null
  const top = Array.isArray(b?.athletes) ? b.athletes : []
  const rows = top.flatMap((entry) => {
    const items = (entry as { items?: unknown })?.items
    return Array.isArray(items) ? items : [entry]
  })
  const athletes: EspnProAthlete[] = []
  let rejectedCount = 0
  for (const raw of rows) {
    const a = raw as Record<string, unknown>
    const id = str(a?.id)
    const fullName = str(a?.fullName) ?? str(a?.displayName)
    if (!id || !/^\d+$/.test(id) || !fullName) {
      rejectedCount++
      continue
    }
    athletes.push({
      id,
      fullName,
      jersey: str(a.jersey),
      headshotUrl: str((a.headshot as { href?: unknown } | undefined)?.href),
    })
  }
  return { seasonYear, athletes, rejectedCount }
}

async function getJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  if (res.status === 403) throw new EspnBlockedError(url)
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${new URL(url).pathname}`)
  return res.json()
}

export async function fetchEspnProTeams(sport: EspnProSport, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<EspnProTeam[]> {
  // The same envelope as the college teams list (contracts/espn fixtures/teams.{NBA,NHL,MLB}.json).
  const url = espnSiteApiUrl(`${ESPN_PRO_SPORT_PATH[sport]}/teams`, { limit: 1000 })
  return parseEspnNcaabTeams(await getJson(url, opts.fetchImpl ?? fetch, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)).map((t) => ({
    id: t.id,
    abbreviation: t.abbreviation,
    displayName: t.displayName,
  }))
}

export async function fetchEspnProRoster(
  sport: EspnProSport,
  espnTeamId: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ seasonYear: number | null; athletes: EspnProAthlete[]; rejectedCount: number }> {
  if (!/^\d+$/.test(espnTeamId)) throw new Error(`not an ESPN team id: ${espnTeamId}`)
  const url = espnSiteApiUrl(`${ESPN_PRO_SPORT_PATH[sport]}/teams/${espnTeamId}/roster`)
  return parseEspnProRoster(await getJson(url, opts.fetchImpl ?? fetch, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
}
