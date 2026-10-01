/**
 * ESPN men's college basketball — teams list and team rosters.
 *
 * ⚠ THIS IS THE ADAPTER. Every export is a live fetch or a pure parser for one, and the
 * only runtime importer is `lib/espn/ncaabEspnIngest.ts`. Keeping the fetch isolated is
 * what lets this file be allowlisted under the DB-first guard without exempting anything
 * that reads.
 *
 * Shapes are from `contracts/espn/` (fixtures captured 2026-10-01), not from memory:
 *   - `athletes` is a FLAT array for NCAAB (R-04);
 *   - `headshot` is OMITTED when ESPN has no photo, and the CDN then 404s (R-05);
 *   - `jersey` is a STRING (R-06).
 *
 * 🛑 NO SPOOFED HEADERS. A 403 throws `EspnBlockedError` and the caller stops the whole
 * pass — see `lib/providers/espnUrls.ts` for why getting past bot detection is not the fix.
 */

import { espnSiteApiUrl } from '@/lib/providers/espnUrls'

const NCAAB_PATH = 'basketball/mens-college-basketball'
const DEFAULT_TIMEOUT_MS = 15_000

/** ESPN refused the client. Not retryable by this code — record it and stop. */
export class EspnBlockedError extends Error {
  constructor(public readonly url: string) {
    super(`ESPN returned 403 for ${new URL(url).pathname}`)
    this.name = 'EspnBlockedError'
  }
}

export type EspnNcaabTeam = {
  /** ESPN team id — the same id space as CFBD team ids (contracts/espn GAPS R-02). */
  id: string
  abbreviation: string | null
  /** The SCHOOL name ("Abilene Christian"). `name` on the wire is the mascot. */
  location: string
  displayName: string | null
  logo: string | null
}

export type EspnNcaabAthlete = {
  id: string
  fullName: string
  jersey: string | null
  position: string | null
  /** Present only when ESPN has a photo; absent means none (R-05). */
  headshotUrl: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function pickLogo(logos: unknown): string | null {
  if (!Array.isArray(logos)) return null
  const rows = logos as Array<{ href?: unknown; rel?: unknown }>
  const isDefault = (l: { rel?: unknown }) => Array.isArray(l.rel) && l.rel.includes('default')
  return str((rows.find(isDefault) ?? rows[0])?.href)
}

/** Pure: `teams?limit=1000` body -> teams. Tolerates a missing level rather than throwing. */
export function parseEspnNcaabTeams(body: unknown): EspnNcaabTeam[] {
  const leagues = (body as { sports?: Array<{ leagues?: Array<{ teams?: unknown[] }> }> })?.sports?.[0]?.leagues
  const rows = Array.isArray(leagues?.[0]?.teams) ? (leagues![0]!.teams as Array<{ team?: Record<string, unknown> }>) : []
  const out: EspnNcaabTeam[] = []
  for (const row of rows) {
    const t = row?.team
    const id = str(t?.id)
    const location = str(t?.location)
    if (!t || !id || !location) continue
    out.push({
      id,
      abbreviation: str(t.abbreviation),
      location,
      displayName: str(t.displayName),
      logo: pickLogo(t.logos),
    })
  }
  return out
}

/** Pure: `teams/{id}/roster` body -> season year + athletes. */
export function parseEspnNcaabRoster(body: unknown): { seasonYear: number | null; athletes: EspnNcaabAthlete[] } {
  const b = body as { season?: { year?: unknown }; athletes?: unknown[] }
  const seasonYear = typeof b?.season?.year === 'number' ? b.season.year : null
  const athletes: EspnNcaabAthlete[] = []
  for (const raw of Array.isArray(b?.athletes) ? b.athletes : []) {
    const a = raw as Record<string, unknown>
    const id = str(a?.id)
    const fullName = str(a?.fullName) ?? str(a?.displayName)
    if (!id || !fullName) continue
    athletes.push({
      id,
      fullName,
      jersey: str(a.jersey),
      position: str((a.position as { abbreviation?: unknown } | undefined)?.abbreviation),
      headshotUrl: str((a.headshot as { href?: unknown } | undefined)?.href),
    })
  }
  return { seasonYear, athletes }
}

async function getJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 403) throw new EspnBlockedError(url)
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${new URL(url).pathname}`)
  return res.json()
}

export async function fetchEspnNcaabTeams(
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EspnNcaabTeam[]> {
  // `limit` is required in practice; 1000 returned all 362 (contracts/espn R-01).
  const url = espnSiteApiUrl(`${NCAAB_PATH}/teams`, { limit: 1000 })
  return parseEspnNcaabTeams(await getJson(url, opts.fetchImpl ?? fetch, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
}

export async function fetchEspnNcaabRoster(
  espnTeamId: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ seasonYear: number | null; athletes: EspnNcaabAthlete[] }> {
  if (!/^\d+$/.test(espnTeamId)) throw new Error(`not an ESPN team id: ${espnTeamId}`)
  const url = espnSiteApiUrl(`${NCAAB_PATH}/teams/${espnTeamId}/roster`)
  return parseEspnNcaabRoster(await getJson(url, opts.fetchImpl ?? fetch, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
}
