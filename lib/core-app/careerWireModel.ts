import { ageMinutes, freshnessSeverity } from '@/lib/import-os/freshness'
import type { SeasonState } from '@/lib/import-os/season'
import { isLeagueGoneState } from '@/lib/import-os/collector/leagueGone'
import type { BriefStanding, StandingSnap } from './sinceLastVisit'

/**
 * Career Wire — the pure half. Every platform's health, this season's board, and what moved
 * since the last Career visit. The I/O lives in `careerWire.ts`; everything here is a function
 * of rows already read, so it is testable without a database.
 *
 * ⚠ "WE READ", NEVER "THIS DATA IS". `LeagueSyncState.lastSuccessfulSyncAt` is AllFantasy's own
 * collection time, not a provider timestamp (see the schema and `LeagueSync.tsx`). Every time
 * this module hands out is a read time, and the UI words it that way.
 *
 * ⚠ NOT `League.lastSyncedAt`. Measured on production (page.tsx, the sync-age note): null for
 * every league. It is only the fallback, after both sync-state lanes.
 */

export const IMPORT_PLATFORMS = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as const

export const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
  cbs: 'CBS',
  allfantasy: 'AllFantasy',
}

/** Leagues AllFantasy runs itself have nothing to sync — their data is written here. */
export function isNativePlatform(platform: string | null | undefined, platformLeagueId: string | null | undefined): boolean {
  const p = String(platform ?? '').toLowerCase()
  return !p || p === 'allfantasy' || p === 'manual' || p === 'native' || !platformLeagueId
}

export function platformKey(platform: string | null | undefined, platformLeagueId: string | null | undefined): string {
  return isNativePlatform(platform, platformLeagueId) ? 'allfantasy' : String(platform).toLowerCase()
}

export function platformLabel(key: string): string {
  return PLATFORM_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/** A league row as the page already holds it. */
export type WireLeagueInput = {
  id: string
  name: string | null
  platform: string | null
  platformLeagueId: string | null
  season: number | null
  sport?: string | null
  lastSyncedAt?: Date | string | null
}

/**
 * This season's leagues only: per sport, the newest season on file.
 *
 * ⚠ THE LEAGUE LIST CARRIES PAST SEASONS. A dynasty league imported for 2024 and 2025 is two
 * rows, and last year's row is never synced again — so without this the Wire would flag every
 * finished season as "needs attention". Per sport because seasons are numbered per sport. A row
 * with no season is kept: nothing says it is old.
 */
export function latestSeasonOnly<T extends WireLeagueInput>(leagues: readonly T[]): T[] {
  const newest = new Map<string, number>()
  for (const l of leagues) {
    if (l.season == null) continue
    const k = String(l.sport ?? '').toUpperCase()
    newest.set(k, Math.max(newest.get(k) ?? l.season, l.season))
  }
  return leagues.filter((l) => l.season == null || l.season === newest.get(String(l.sport ?? '').toUpperCase()))
}

/** The `LeagueSyncState` columns this reads, from either lane. */
export type WireSyncState = {
  runKey: string
  lastSuccessfulSyncAt: Date | null
  lastAttemptedSyncAt: Date | null
  consecutiveFailures: number
  syncStatus: string | null
  lastError: string | null
  seasonState: string | null
}

export type WireStatus = 'ok' | 'delayed' | 'attention' | 'never' | 'paused' | 'gone' | 'native'

export type WireLeague = {
  leagueId: string
  leagueName: string
  platform: string
  status: WireStatus
  /** ISO — when AllFantasy last read it. Null for native leagues and never-read ones. */
  lastReadAt: string | null
  record: string | null
  rank: number | null
}

export type PlatformHealth = {
  platform: string
  label: string
  native: boolean
  leagues: number
  paused: number
  /** Leagues that are failing, gone, never read, or past the critical freshness line. */
  needsAttention: number
  status: WireStatus
  /** The newest read across the platform's unpaused leagues. */
  lastReadAt: string | null
  /** The OLDEST read — the one that limits how far the platform's numbers can be trusted. */
  oldestReadAt: string | null
}

export type WireChange = BriefStanding & { platform: string; ask: string }

export type CareerWireData = {
  platforms: PlatformHealth[]
  leagues: WireLeague[]
  changes: WireChange[]
  sinceAt: string
  firstVisit: boolean
  windowCapped: boolean
  /** No previous Career snapshot to compare against — the first visit, or the first since this shipped. */
  comparisonPending: boolean
}

export function runKeyFor(l: WireLeagueInput): string | null {
  if (isNativePlatform(l.platform, l.platformLeagueId) || l.season == null) return null
  return `${String(l.platform).toLowerCase()}:${l.platformLeagueId}:${l.season}`
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const SEASON_STATES: readonly SeasonState[] = ['preseason', 'regular_season', 'postseason', 'offseason', 'unknown']
function seasonStateOf(raw: string | null | undefined): SeasonState {
  return SEASON_STATES.includes(raw as SeasonState) ? (raw as SeasonState) : 'unknown'
}

/**
 * One league's status, by the same precedence the per-league Sync screen uses (paused → gone →
 * never → failing/stale → fine), with staleness measured by the season-aware thresholds in
 * `import-os/freshness.ts` rather than a flat hour, so the off-season does not paint every
 * league red.
 */
export function leagueWireStatus(input: {
  league: WireLeagueInput
  full: WireSyncState | null
  active: WireSyncState | null
  paused: boolean
  now: Date
}): { status: WireStatus; lastReadAt: Date | null } {
  const { league, full, active, paused, now } = input
  if (isNativePlatform(league.platform, league.platformLeagueId)) return { status: 'native', lastReadAt: null }

  const reads = [full?.lastSuccessfulSyncAt, active?.lastSuccessfulSyncAt, toDate(league.lastSyncedAt)]
    .map((d) => toDate(d ?? null))
    .filter((d): d is Date => d != null)
  const lastReadAt = reads.length ? new Date(Math.max(...reads.map((d) => d.getTime()))) : null

  if (paused) return { status: 'paused', lastReadAt }

  // Only the NEWEST attempt across both lanes is the current answer — a later good read clears it.
  const newest = [full, active]
    .filter((r): r is WireSyncState => r != null && r.lastAttemptedSyncAt != null)
    .sort((a, b) => (b.lastAttemptedSyncAt as Date).getTime() - (a.lastAttemptedSyncAt as Date).getTime())
    .at(0)
  if (newest && isLeagueGoneState(newest)) return { status: 'gone', lastReadAt }

  if (!lastReadAt) return { status: 'never', lastReadAt: null }

  const severity = freshnessSeverity(
    seasonStateOf(full?.seasonState ?? active?.seasonState),
    ageMinutes(lastReadAt.toISOString(), now),
  )
  if ((full?.consecutiveFailures ?? 0) > 0 || severity === 'critical') return { status: 'attention', lastReadAt }
  if (severity === 'delayed') return { status: 'delayed', lastReadAt }
  return { status: 'ok', lastReadAt }
}

const STATUS_WEIGHT: Record<WireStatus, number> = {
  gone: 6,
  attention: 5,
  never: 4,
  delayed: 3,
  ok: 2,
  native: 1,
  paused: 0,
}

function recordOf(s: StandingSnap | undefined): string | null {
  if (!s) return null
  if (s.wins + s.losses + s.ties === 0) return null
  return `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`
}

export function buildWireLeagues(input: {
  leagues: WireLeagueInput[]
  states: Map<string, WireSyncState>
  pausedLeagueIds: ReadonlySet<string>
  standings: Record<string, StandingSnap>
  now: Date
}): WireLeague[] {
  return input.leagues.map((l) => {
    const key = runKeyFor(l)
    const { status, lastReadAt } = leagueWireStatus({
      league: l,
      full: key ? (input.states.get(key) ?? null) : null,
      active: key ? (input.states.get(`${key}:active`) ?? null) : null,
      paused: input.pausedLeagueIds.has(l.id),
      now: input.now,
    })
    const snap = input.standings[l.id]
    /*
     * 🛑 A RANK BEFORE ANY GAME IS THE IMPORTER'S ROW ORDER, NOT A STANDING — the same rule
     * `diffStandings` applies. "#1" in week 0 is roster id 1.
     */
    const played = snap ? snap.wins + snap.losses + snap.ties > 0 : false
    return {
      leagueId: l.id,
      leagueName: l.name ?? 'Your league',
      platform: platformKey(l.platform, l.platformLeagueId),
      status,
      lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
      record: recordOf(snap),
      rank: played ? (snap?.rank ?? null) : null,
    }
  })
}

export function buildPlatformHealth(leagues: WireLeague[]): PlatformHealth[] {
  const by = new Map<string, WireLeague[]>()
  for (const l of leagues) by.set(l.platform, [...(by.get(l.platform) ?? []), l])

  const out: PlatformHealth[] = []
  for (const [platform, rows] of by) {
    const native = platform === 'allfantasy'
    const live = rows.filter((r) => r.status !== 'paused')
    const reads = live.map((r) => r.lastReadAt).filter((d): d is string => d != null).sort()
    const worst = live.reduce<WireStatus>(
      (acc, r) => (STATUS_WEIGHT[r.status] > STATUS_WEIGHT[acc] ? r.status : acc),
      live.length ? live[0].status : 'paused',
    )
    out.push({
      platform,
      label: platformLabel(platform),
      native,
      leagues: rows.length,
      paused: rows.length - live.length,
      needsAttention: live.filter((r) => r.status === 'attention' || r.status === 'gone' || r.status === 'never').length,
      status: native ? 'native' : worst,
      lastReadAt: reads.at(-1) ?? null,
      oldestReadAt: reads.at(0) ?? null,
    })
  }
  /* Problems first, then the platform with the most leagues; AllFantasy last among equals. */
  return out.sort(
    (a, b) => STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status] || b.leagues - a.leagues || a.label.localeCompare(b.label),
  )
}

function changeAsk(c: BriefStanding): string {
  const result =
    c.won + c.lost + c.tied > 0
      ? `went ${c.won}-${c.lost}${c.tied ? `-${c.tied}` : ''} since I last checked`
      : 'moved in the standings'
  const rank = c.rank != null ? ` and I'm #${c.rank} now` : ''
  return `In ${c.leagueName} I ${result}${rank} (${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}). What should I focus on this week?`
}

export function decorateChanges(changes: BriefStanding[], leagues: WireLeague[]): WireChange[] {
  const platformOf = new Map(leagues.map((l) => [l.leagueId, l.platform]))
  return changes
    .map((c) => ({ ...c, platform: platformOf.get(c.leagueId) ?? 'allfantasy', ask: changeAsk(c) }))
    .sort((a, b) => b.won + b.lost + b.tied - (a.won + a.lost + a.tied) || a.leagueName.localeCompare(b.leagueName))
}

/** "12m ago" from an ISO read time. Server and client both call it, so it takes `now`. */
export function readAgo(iso: string | null, now: Date): string {
  const d = toDate(iso)
  if (!d) return 'not read yet'
  const min = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
