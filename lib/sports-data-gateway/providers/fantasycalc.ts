import 'server-only'
/**
 * Fantasy OS Phase 5F-d — FantasyCalc identity crosswalk adapter (Tier-1 direct cross-reference source B).
 *
 * FantasyCalc's public players directory carries, per player, BOTH a `sleeperId` and an `espnId` in the same
 * trusted record — a deterministic cross-reference (no name matching). This is a SECOND source alongside
 * Sleeper's own directory; it covers some players Sleeper leaves with a null espn id. Provider-shaped fields are
 * transformed here and never leak past the adapter.
 */
import type { SleeperEspnCrosswalkRow } from './sleeper'

const FC_PLAYERS = 'https://api.fantasycalc.com/players' // db-first-exception: gateway identity crosswalk fetcher (server-side)

type RawFcPlayer = { name?: string; sleeperId?: string | number | null; espnId?: string | number | null; position?: string | null; maybeTeam?: string | null; team?: string | null }

/** Fetch FantasyCalc's player directory and emit only rows carrying BOTH a sleeper id and an espn id (deterministic). */
export async function fetchFantasyCalcEspnCrosswalk(): Promise<{ rows: SleeperEspnCrosswalkRow[]; totalPlayers: number; withEspn: number } | { error: string }> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 20000)
  let data: unknown
  try {
    const res = await fetch(FC_PLAYERS, { signal: c.signal, headers: { Accept: 'application/json', 'user-agent': 'fantasy-os-gateway' } })
    clearTimeout(t)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    data = await res.json()
  } catch (e) {
    clearTimeout(t)
    return { error: e instanceof Error ? e.message : 'fetch error' }
  }
  if (!Array.isArray(data)) return { error: 'schema_mismatch: players payload not an array' }
  const rows: SleeperEspnCrosswalkRow[] = []
  for (const raw of data as RawFcPlayer[]) {
    const sleeperId = raw?.sleeperId == null ? '' : String(raw.sleeperId).trim()
    const espnId = raw?.espnId == null ? '' : String(raw.espnId).trim()
    if (!sleeperId || !espnId) continue // only deterministic dual-id rows
    const fullName = (raw?.name ?? '').trim()
    if (!fullName) continue
    rows.push({ sleeperId, espnId, fullName, position: raw?.position ?? null, team: raw?.team ?? raw?.maybeTeam ?? null, active: true })
  }
  return { rows, totalPlayers: Array.isArray(data) ? data.length : 0, withEspn: rows.length }
}
