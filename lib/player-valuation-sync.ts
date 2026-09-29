/**
 * Player-valuation INGESTION: fetch Rolling Insights raw data per sport and write normalized
 * valuations to SportsDataCache (`player-valuations:{sport}`), which Market Movers
 * (`/market-movers` → `/api/player-valuations`) reads DB-first.
 *
 * Moved here verbatim from `scripts/sync-player-valuations.ts` on 2026-09-29 so it can have a
 * SCHEDULED caller. Until then the npm script `sync:player-valuations` was the only writer and
 * nothing ran it, so Market Movers served whatever a human last synced — `lib/enrichment-cache.ts`
 * listed the family as an "unscheduled writer". Two callers now:
 *   - `app/api/cron/adp-refresh` (daily 10:00 UTC), as a bounded, failure-isolated phase
 *   - `scripts/sync-player-valuations.ts` (the npm script), unchanged in behaviour
 *
 * Ingestion by name and nature: this module may call the provider (CLAUDE.md DB-first rule), and
 * `scripts/check-db-first-api-boundary.mjs` allowlists `lib/.*sync`. Request paths must keep
 * reading through `readPlayerValuationsFromDb`, never through this.
 *
 * Logging never includes a request URL — Rolling Insights carries its token as a query parameter.
 */
import { rollingInsightsProvider } from '@/lib/workers/providers/rolling-insights'
import {
  computePlayerValuation,
  writePlayerValuationsToDb,
  type PlayerValuation,
} from '@/lib/player-valuation-features'
import type { ApiChainSport } from '@/lib/workers/api-config'
import { redactAndCap } from '@/lib/security/redactSecrets'

export const PLAYER_VALUATION_SPORTS: ApiChainSport[] = ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'soccer_euro']

export const DEFAULT_VALUATION_TTL_HOURS = 6
const NFL_IDP_POSITIONS = new Set(['DL', 'DE', 'DT', 'EDGE', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS'])
const DEFENSIVE_STAT_KEYS = [
  'tackles',
  'total_tackles',
  'solo_tackles',
  'assisted_tackles',
  'tackles_for_loss',
  'tfl',
  'sacks',
  'qb_hits',
  'forced_fumbles',
  'fumbles_recovered',
  'passes_defended',
  'interceptions',
  'defensive_touchdowns',
  'defensive_tds',
  'safeties',
] as const

// ─── Raw player shape from Rolling Insights ──────────────────────────────────

interface RawRIPlayer {
  id?: string | number
  player_id?: string | number
  playerId?: string | number
  name?: string
  full_name?: string
  fullName?: string
  first_name?: string
  last_name?: string
  position?: string
  pos?: string
  team?: string
  team_abbr?: string
  teamAbbr?: string
  status?: string
  injury_status?: string
  injuryStatus?: string
  adp?: number
  average_draft_position?: number | string
  averageDraftPosition?: number | string
  stats?: Record<string, unknown>
  season_stats?: Record<string, unknown>
  seasonStats?: Record<string, unknown>
  [key: string]: unknown
}

interface RawRIInjury {
  player_id?: string | number
  playerId?: string | number
  name?: string
  player_name?: string
  status?: string
  injury_status?: string
  [key: string]: unknown
}

// ─── Data extraction helpers ──────────────────────────────────────────────────

function extractId(p: RawRIPlayer): string {
  const raw = p.id ?? p.player_id ?? p.playerId
  return raw != null ? String(raw) : ''
}

function extractName(p: RawRIPlayer): string {
  if (p.full_name) return String(p.full_name)
  if (p.fullName) return String(p.fullName)
  if ((p as Record<string, unknown>).player) return String((p as Record<string, unknown>).player)
  if (p.name) return String(p.name)
  if (p.first_name || p.last_name) return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
  return ''
}

function extractPosition(p: RawRIPlayer): string {
  return String(p.position ?? p.pos ?? 'UNK').toUpperCase()
}

function extractTeam(p: RawRIPlayer): string {
  return String(p.team ?? p.team_abbr ?? p.teamAbbr ?? 'UNK').toUpperCase()
}

function extractStats(p: RawRIPlayer): Record<string, unknown> {
  // RI may embed stats directly on the player object or under a stats sub-object
  const sub =
    p.stats ??
    p.season_stats ??
    p.seasonStats ??
    (p as Record<string, unknown>).regular_season ??
    (p as Record<string, unknown>).postseason
  if (sub && typeof sub === 'object') return sub as Record<string, unknown>
  // Fall back: extract any numeric fields that look like stats
  const inline: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number' && !['id', 'player_id', 'adp'].includes(k)) {
      inline[k] = v
    }
  }
  return inline
}

function extractInjuryStatus(p: RawRIPlayer, injuryMap: Map<string, string>): string | null {
  // Prefer injury map from dedicated /injuries endpoint
  const id = extractId(p)
  if (id && injuryMap.has(id)) return injuryMap.get(id)!
  // Fallback: status on player object itself
  const raw = p.injury_status ?? p.injuryStatus ?? p.status
  return raw ? String(raw) : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function extractAdpFromRecord(row: Record<string, unknown>): number | null {
  const candidates = [
    row.adp,
    row.ADP,
    row.average_draft_position,
    row.averageDraftPosition,
    row.avg_adp,
    row.avgAdp,
  ]
  for (const value of candidates) {
    const parsed = toFiniteNumber(value)
    if (parsed != null && parsed > 0) return parsed
  }
  return null
}

function extractAdpForPlayer(player: RawRIPlayer, adpMap: Map<string, number>): number | null {
  const playerId = extractId(player)
  if (playerId && adpMap.has(playerId)) return adpMap.get(playerId) ?? null

  const fromPlayer = extractAdpFromRecord(player as Record<string, unknown>)
  return fromPlayer != null ? fromPlayer : null
}

function toNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function hasDefensiveStats(stats: Record<string, unknown>): boolean {
  for (const key of DEFENSIVE_STAT_KEYS) {
    const n = toNumeric(stats[key])
    if (n != null && n > 0) return true
  }
  return false
}

function buildNflIdpFallbackStats(position: string): Record<string, number> {
  if (['LB', 'ILB', 'OLB'].includes(position)) {
    return {
      tackles: 40,
      solo_tackles: 26,
      assisted_tackles: 14,
      tackles_for_loss: 4,
      sacks: 2,
    }
  }
  if (['DL', 'DE', 'DT', 'EDGE'].includes(position)) {
    return {
      tackles: 28,
      solo_tackles: 18,
      assisted_tackles: 10,
      tackles_for_loss: 6,
      sacks: 4,
    }
  }
  return {
    tackles: 32,
    solo_tackles: 21,
    assisted_tackles: 11,
    passes_defended: 6,
    interceptions: 2,
  }
}

function toArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  return []
}

// ─── Dependencies (injectable so the phase unit-tests with no network and no DB) ────────────────

export interface PlayerValuationSyncDeps {
  fetchProvider: typeof rollingInsightsProvider
  writeValuations: typeof writePlayerValuationsToDb
  now: () => number
}

export const defaultPlayerValuationSyncDeps: PlayerValuationSyncDeps = {
  fetchProvider: rollingInsightsProvider,
  writeValuations: writePlayerValuationsToDb,
  now: () => Date.now(),
}

// ─── Per-sport sync ───────────────────────────────────────────────────────────

export async function syncPlayerValuationsForSport(
  sport: ApiChainSport,
  ttlMs: number,
  deps: PlayerValuationSyncDeps = defaultPlayerValuationSyncDeps,
): Promise<number> {
  console.log(`[player-valuations] [${sport}] fetching players…`)

  // 1. Fetch player list (includes bio + sometimes stats)
  const playersResult = await deps.fetchProvider({ sport, dataType: 'players' })
  const rawPlayers = toArray(playersResult.data) as RawRIPlayer[]

  if (!rawPlayers.length) {
    console.warn(`[player-valuations] [${sport}] no players returned — skipping`)
    return 0
  }
  console.log(`[player-valuations] [${sport}] got ${rawPlayers.length} players`)

  // 2. Fetch injuries for health overlay
  const injuriesResult = await deps.fetchProvider({ sport, dataType: 'injuries' })
  const rawInjuryRows = toArray(injuriesResult.data) as Array<RawRIInjury & { injuries?: unknown[] }>

  const rawInjuries: RawRIInjury[] = []
  for (const row of rawInjuryRows) {
    if (Array.isArray(row.injuries)) {
      for (const item of row.injuries) {
        if (!item || typeof item !== 'object') continue
        const injury = item as Record<string, unknown>
        const injuryPlayerId =
          typeof injury.player_id === 'string' || typeof injury.player_id === 'number'
            ? injury.player_id
            : undefined
        rawInjuries.push({
          player_id: injuryPlayerId,
          playerId: injuryPlayerId,
          name: typeof injury.player === 'string' ? injury.player : undefined,
          status: typeof injury.returns === 'string' ? injury.returns : undefined,
          injury_status: typeof injury.injury === 'string' ? injury.injury : undefined,
        })
      }
      continue
    }
    rawInjuries.push(row)
  }

  // Build injury map: playerId → status
  const injuryMap = new Map<string, string>()
  for (const inj of rawInjuries) {
    const pid = inj.player_id ?? inj.playerId
    const status = inj.status ?? inj.injury_status
    if (pid != null && status) {
      injuryMap.set(String(pid), String(status))
    }
  }
  console.log(`[player-valuations] [${sport}] injury overlay: ${injuryMap.size} records`)

  // 3. Fetch ADP (best-effort — not all sports have it)
  const adpResult = await deps.fetchProvider({ sport, dataType: 'adp' })
  const rawAdp = toArray(adpResult.data) as Array<Record<string, unknown>>
  const adpMap = new Map<string, number>()
  for (const row of rawAdp) {
    const pid = row.player_id ?? row.playerId ?? row.id
    const adp = extractAdpFromRecord(row)
    if (pid != null && adp != null) adpMap.set(String(pid), adp)
  }

  // 4. Optionally fetch projections/rankings for richer stats (best-effort)
  const projResult = await deps.fetchProvider({ sport, dataType: 'projections' })
  const rawProj = toArray(projResult.data) as RawRIPlayer[]
  const projMap = new Map<string, Record<string, unknown>>()
  for (const p of rawProj) {
    const id = extractId(p)
    if (id) projMap.set(id, extractStats(p))
  }

  // 5. Compute valuations
  const syncedAt = new Date(deps.now()).toISOString()
  const valuations: PlayerValuation[] = []
  let idpFallbackApplied = 0

  for (const raw of rawPlayers) {
    const playerId = extractId(raw)
    if (!playerId) continue

    const name = extractName(raw)
    if (!name) continue

    const position = extractPosition(raw)
    const team = extractTeam(raw)
    const playerStats = extractStats(raw)
    // Merge projection stats on top of player stats for richer signal
    const projStats = projMap.get(playerId) ?? {}
    let mergedStats = { ...projStats, ...playerStats }

    // Guarded fallback: if RI projections/ADP feeds are unavailable and an NFL IDP
    // player has no usable defensive stats, inject a conservative baseline bundle.
    if (sport === 'nfl' && NFL_IDP_POSITIONS.has(position) && !hasDefensiveStats(mergedStats)) {
      mergedStats = { ...mergedStats, ...buildNflIdpFallbackStats(position) }
      idpFallbackApplied++
    }

    const injuryStatus = extractInjuryStatus(raw, injuryMap)
    const adp = extractAdpForPlayer(raw, adpMap)

    const valuation = computePlayerValuation({
      playerId,
      name,
      sport,
      position,
      team,
      stats: mergedStats,
      injuryStatus,
      adp,
      syncedAt,
    })

    valuations.push(valuation)
  }

  // 6. Write to DB
  const result = await deps.writeValuations(sport, valuations, { ttlMs })
  if (sport === 'nfl') {
    console.log(`[player-valuations] [${sport}] IDP fallback applied: ${idpFallbackApplied}`)
  }
  console.log(
    `[player-valuations] [${sport}] ✓ ${result.count} valuations stored, key=${result.cacheKey}, expires=${result.expiresAt.toISOString()}`
  )
  return result.count
}

// ─── All sports ───────────────────────────────────────────────────────────────

export interface PlayerValuationSyncSummary {
  total: number
  /** Valuations written per sport that ran. */
  written: Partial<Record<ApiChainSport, number>>
  /** Per-sport failures — one sport's outage never stops the next. Redacted, then capped. */
  failed: Partial<Record<ApiChainSport, string>>
  /** Sports not attempted because `deadlineAt` had passed. */
  skipped: ApiChainSport[]
}

/**
 * Sync each sport in turn. Never throws for a single sport: its error is logged and recorded in
 * `failed`, exactly as the npm script always behaved. `deadlineAt` (epoch ms) bounds a scheduled
 * run — a sport is not STARTED after it, so a slow provider costs at most one sport past the line.
 */
export async function syncPlayerValuations(
  opts: { sports?: ApiChainSport[]; ttlMs?: number; deadlineAt?: number } = {},
  deps: PlayerValuationSyncDeps = defaultPlayerValuationSyncDeps,
): Promise<PlayerValuationSyncSummary> {
  const sports = opts.sports?.length ? opts.sports : PLAYER_VALUATION_SPORTS
  const ttlMs = opts.ttlMs ?? DEFAULT_VALUATION_TTL_HOURS * 60 * 60 * 1000
  const summary: PlayerValuationSyncSummary = { total: 0, written: {}, failed: {}, skipped: [] }

  for (const sport of sports) {
    if (opts.deadlineAt != null && deps.now() >= opts.deadlineAt) {
      summary.skipped.push(sport)
      continue
    }
    try {
      const count = await syncPlayerValuationsForSport(sport, ttlMs, deps)
      summary.written[sport] = count
      summary.total += count
    } catch (err) {
      // Redacted BEFORE it is logged or returned: a provider error can carry the request URL, and
      // Rolling Insights puts RSC_token in the query string. The cron echoes this in its response.
      const message = redactAndCap(err instanceof Error ? err.message : err, 160)
      console.error(`[player-valuations] [${sport}] sync failed: ${message}`)
      summary.failed[sport] = message
    }
  }
  if (summary.skipped.length) {
    console.warn(`[player-valuations] time budget spent — skipped ${summary.skipped.join(',')}`)
  }
  return summary
}
