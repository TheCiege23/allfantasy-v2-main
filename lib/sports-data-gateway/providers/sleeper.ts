/**
 * Fantasy OS Phase 5 — Sleeper provider adapter (real; players capability).
 *
 * Sleeper is a public API (no key). This adapter transforms Sleeper's raw player map into CanonicalPlayer,
 * validates the payload shape (schema-drift protection), and attaches provenance. It does NOT resolve
 * canonical identity — it emits `unresolved:` provisional ids + `providerIds.sleeper`; the gateway's
 * resolution step assigns the real canonical id (canonical ids are never provider ids).
 */
import type { CanonicalPlayer } from '../contracts'
import type { ProviderCapabilityDeclaration } from '../capabilities'
import type { ProviderResult } from '../errors'
import { classifyError } from '../errors'
import { BaseProviderAdapter, type FetchPlayersInput, type ProviderHealth } from '../adapter'

const BASE = 'https://api.sleeper.app/v1' // db-first-exception: gateway provider adapter (server-side sports data)

type RawSleeperPlayer = {
  player_id?: string
  first_name?: string
  last_name?: string
  full_name?: string
  position?: string | null
  fantasy_positions?: string[] | null
  team?: string | null
  status?: string | null
  injury_status?: string | null
  active?: boolean
  birth_date?: string | null
  espn_id?: number | string | null
}

/**
 * Deterministic ESPN↔Sleeper crosswalk row from Sleeper's OWN player directory (each player record carries both
 * its `player_id` and an `espn_id`). This is a Tier-1 direct cross-reference — a single trusted provider record
 * holds both ids, no name matching. Provider-shaped fields are transformed here and never leak past the adapter.
 */
export type SleeperEspnCrosswalkRow = { sleeperId: string; espnId: string; fullName: string; position: string | null; team: string | null; active: boolean }

/** Fetch Sleeper's player directory and emit only rows that carry BOTH a sleeper id and an espn id (deterministic). */
export async function fetchSleeperEspnCrosswalk(): Promise<{ rows: SleeperEspnCrosswalkRow[]; totalPlayers: number; withEspn: number } | { error: string }> {
  const r = await getJson<Record<string, RawSleeperPlayer>>(`${BASE}/players/nfl`, 20000)
  if (!r.ok) return { error: r.status ? `HTTP ${r.status}` : 'fetch error' }
  const map = r.data
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: 'schema_mismatch: players payload not an object map' }
  const entries = Object.entries(map)
  if (entries.length === 0) return { error: 'schema_mismatch: players payload empty' }
  const rows: SleeperEspnCrosswalkRow[] = []
  for (const [id, raw] of entries) {
    const sleeperId = String(raw.player_id ?? id ?? '').trim()
    const espnRaw = raw.espn_id
    const espnId = espnRaw == null ? '' : String(espnRaw).trim()
    if (!sleeperId || !espnId) continue // only deterministic dual-id rows
    const fullName = (raw.full_name ?? `${raw.first_name ?? ''} ${raw.last_name ?? ''}`.trim()).trim()
    if (!fullName) continue
    rows.push({ sleeperId, espnId, fullName, position: raw.position ?? null, team: raw.team ?? null, active: raw.active === true })
  }
  return { rows, totalPlayers: entries.length, withEspn: rows.length }
}

async function getJson<T>(url: string, timeoutMs = 9000): Promise<{ ok: true; data: T } | { ok: false; status?: number; err: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'fantasy-os-gateway' } })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, status: res.status, err: new Error(`HTTP ${res.status}`) }
    return { ok: true, data: (await res.json()) as T }
  } catch (err) {
    clearTimeout(timer)
    return { ok: false, err }
  }
}

// ── Phase 5H-b: league-scoped Sleeper fetchers ─────────────────────────────────────────────────────────────
// Adapter purity — provider URLs + fetch for rosters/transactions/drafts live HERE, not in runtime modules.
// The runtime consumes these typed provider shapes and normalizes them into canonical contracts (the seam).
// Behavior is identical to the prior inline runtime fetches (9s timeout, null on any non-OK/error).

export type SleeperRawRoster = { roster_id: number; owner_id: string | null; players?: string[] | null; starters?: string[] | null; reserve?: string[] | null; taxi?: string[] | null }
export type SleeperRawTxn = {
  transaction_id?: string; type?: string; status?: string; status_updated?: number; roster_ids?: number[]
  adds?: Record<string, number> | null; drops?: Record<string, number> | null
  waiver_budget?: Array<{ sender?: number; receiver?: number; amount?: number }>
  draft_picks?: Array<{ season?: string; round?: number; roster_id?: number; previous_owner_id?: number; owner_id?: number }>
}
export type SleeperRawDraft = { draft_id?: string; season?: string; status?: string; type?: string; settings?: { rounds?: number; teams?: number }; start_time?: number; metadata?: { scoring_type?: string; name?: string } }
export type SleeperRawPick = { pick_no?: number; round?: number; roster_id?: number; player_id?: string; picked_by?: string; draft_slot?: number }

/** Internal: fetch typed JSON or null on any non-OK/error (mirrors the runtime modules' prior local getJson). */
async function fetchOrNull<T>(url: string, timeoutMs = 9000): Promise<T | null> {
  const r = await getJson<T>(url, timeoutMs)
  return r.ok ? r.data : null
}

/** League rosters (Sleeper `/league/:id/rosters`). Provider access confined to the adapter. */
export function fetchSleeperRosters(leagueId: string): Promise<SleeperRawRoster[] | null> {
  return fetchOrNull<SleeperRawRoster[]>(`${BASE}/league/${leagueId}/rosters`)
}

/** League transactions for one week (Sleeper `/league/:id/transactions/:week`). */
export function fetchSleeperLeagueTransactions(leagueId: string, week: number): Promise<SleeperRawTxn[] | null> {
  return fetchOrNull<SleeperRawTxn[]>(`${BASE}/league/${leagueId}/transactions/${week}`)
}

/** League drafts (Sleeper `/league/:id/drafts`). */
export function fetchSleeperLeagueDrafts(leagueId: string): Promise<SleeperRawDraft[] | null> {
  return fetchOrNull<SleeperRawDraft[]>(`${BASE}/league/${leagueId}/drafts`)
}

/** Draft picks (Sleeper `/draft/:id/picks`). */
export function fetchSleeperDraftPicks(draftId: string): Promise<SleeperRawPick[] | null> {
  return fetchOrNull<SleeperRawPick[]>(`${BASE}/draft/${draftId}/picks`)
}

export class SleeperAdapter extends BaseProviderAdapter {
  provider = 'sleeper'

  getCapabilities(): ProviderCapabilityDeclaration {
    return {
      provider: 'sleeper',
      sports: ['NFL'],
      capabilities: ['players', 'rosters', 'transactions', 'draft_data'],
      refreshSupport: { players: 'scheduled', rosters: 'scheduled', transactions: 'scheduled', draft_data: 'scheduled' },
      limitations: [
        'No projections, live scores, play-by-play, or weather.',
        'Injury data limited to a coarse player.injury_status field (not a full availability feed).',
        'The full player map is large — cache aggressively; do not refetch every run.',
      ],
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    const r = await getJson<{ season?: string }>(`${BASE}/state/nfl`, 6000)
    const latencyMs = Date.now() - started
    if (r.ok && r.data && typeof r.data === 'object') return { provider: this.provider, state: 'healthy', checkedAt: new Date().toISOString(), latencyMs }
    return { provider: this.provider, state: 'unavailable', checkedAt: new Date().toISOString(), latencyMs, detail: 'state endpoint unreachable' }
  }

  async fetchPlayers(input: FetchPlayersInput): Promise<ProviderResult<CanonicalPlayer[]>> {
    const sport = input.sport.toLowerCase()
    if (sport !== 'nfl') return { ok: false, provider: this.provider, error: classifyError(this.provider, new Error(`unsupported sport ${input.sport}`)) }
    const fetchedAt = new Date().toISOString()
    const snapshotVersion = `sleeper-players-nfl:${fetchedAt.slice(0, 10)}`

    const r = await getJson<Record<string, RawSleeperPlayer>>(`${BASE}/players/nfl`, 20000)
    if (!r.ok) return { ok: false, provider: this.provider, error: classifyError(this.provider, r.err, r.status) }

    // Schema-drift protection: the payload MUST be a non-empty object map of player records.
    const map = r.data
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      return { ok: false, provider: this.provider, error: { code: 'schema_mismatch', provider: this.provider, message: 'players payload was not an object map', retriable: false } }
    }
    const entries = Object.entries(map)
    if (entries.length === 0) {
      return { ok: false, provider: this.provider, error: { code: 'schema_mismatch', provider: this.provider, message: 'players payload was empty', retriable: false } }
    }

    const limit = input.limit ?? entries.length
    const players: CanonicalPlayer[] = []
    let rejected = 0
    for (const [id, raw] of entries) {
      if (players.length >= limit) break
      const canonical = mapPlayer(id, raw, fetchedAt, snapshotVersion)
      if (canonical) players.push(canonical)
      else rejected++
    }

    return { ok: true, provider: this.provider, data: players, partial: rejected > 0, fetchedAt, snapshotVersion }
  }
}

/** Pure Sleeper→CanonicalPlayer mapping (the seam). Rejects records missing the minimal required shape. */
export function mapPlayer(id: string, raw: RawSleeperPlayer, fetchedAt: string, snapshotVersion: string): CanonicalPlayer | null {
  const pid = raw.player_id ?? id
  if (!pid) return null
  const first = raw.first_name ?? ''
  const last = raw.last_name ?? ''
  const display = raw.full_name ?? `${first} ${last}`.trim()
  if (!display) return null
  return {
    canonicalPlayerId: `unresolved:sleeper:${pid}`, // gateway resolution assigns the real canonical id
    sport: 'NFL',
    providerIds: { sleeper: String(pid) },
    firstName: first,
    lastName: last,
    displayName: display,
    position: raw.position ?? null,
    positions: Array.isArray(raw.fantasy_positions) ? raw.fantasy_positions : raw.position ? [raw.position] : [],
    teamId: raw.team ?? null,
    status: raw.status ?? null,
    injuryStatus: raw.injury_status ?? null,
    active: raw.active === true,
    metadata: { needsResolution: true, birthDate: raw.birth_date ?? null },
    source: { primaryProvider: 'sleeper', providerRecordId: String(pid), fetchedAt, sourceUpdatedAt: null, snapshotVersion },
  }
}
