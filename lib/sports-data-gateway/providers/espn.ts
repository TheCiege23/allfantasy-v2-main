/**
 * Fantasy OS Phase 5D-b — ESPN provider adapter (real; schedules/games; public API, no key).
 *
 * Verified minimally against `site.api.espn.com/.../nfl/scoreboard`. Provider-specific fields are transformed
 * to CanonicalGameSchedule inside this file and never leak. Schema-validated; unexpected shapes are rejected.
 */
import type { CanonicalGameSchedule, CanonicalGameStatus } from '../contracts'
import type { ProviderCapabilityDeclaration } from '../capabilities'
import { BaseProviderAdapter, type ProviderHealth } from '../adapter'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl' // db-first-exception: gateway schedule provider (server-side)

/** Raw, provider-shaped box-score athlete row. Provider fields are transformed by the normalizer and never leak. */
export type EspnBoxScoreAthlete = { providerAthleteId: string; name: string; teamAbbrev: string; position: string | null; stats: Record<string, number> }
export type EspnBoxScoreFetch = { eventId: string; season: string; week: string | null; statusName: string | null; homeAbbrev: string | null; awayAbbrev: string | null; athletes: EspnBoxScoreAthlete[] }

/** Parse only stat values that are genuinely numeric (ESPN reports strings like "12/18", "85", "-"). Non-numeric → skipped. */
function toNumericStats(labels: string[], values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < labels.length && i < values.length; i++) {
    const raw = values[i]
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const n = Number(raw)
    if (Number.isFinite(n)) out[String(labels[i])] = n
  }
  return out
}

/**
 * Real ESPN box-score fetch for one game (public summary endpoint — same source lib/espn-data.ts already uses).
 * Returns provider-shaped athlete rows; canonicalization happens in the statistics runtime, not here.
 */
export async function fetchEspnBoxScore(eventId: string): Promise<EspnBoxScoreFetch | { error: string }> {
  const url = `${BASE}/summary?event=${encodeURIComponent(eventId)}`
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 15000)
  let data: Record<string, unknown> | null = null
  try {
    const res = await fetch(url, { signal: c.signal, headers: { 'user-agent': 'fantasy-os-gateway' } })
    clearTimeout(t)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    data = await res.json()
  } catch (e) {
    clearTimeout(t)
    return { error: e instanceof Error ? e.message : 'fetch error' }
  }
  if (!data || typeof data !== 'object') return { error: 'schema_mismatch: summary not an object' }
  const header = (data.header as { competitions?: Array<Record<string, unknown>>; season?: { year?: number }; week?: number } | undefined)
  const comp = header?.competitions?.[0] as { competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string }; score?: string }>; status?: { type?: { name?: string } } } | undefined
  const competitors = comp?.competitors ?? []
  const homeAbbrev = competitors.find((x) => x.homeAway === 'home')?.team?.abbreviation ?? null
  const awayAbbrev = competitors.find((x) => x.homeAway === 'away')?.team?.abbreviation ?? null
  const statusName = comp?.status?.type?.name ?? null
  const season = header?.season?.year != null ? String(header.season.year) : 'unknown'
  const week = header?.week != null ? String(header.week) : null

  const athletes: EspnBoxScoreAthlete[] = []
  const boxscore = data.boxscore as { players?: Array<{ team?: { abbreviation?: string }; statistics?: Array<{ name?: string; labels?: string[]; athletes?: Array<{ athlete?: { id?: string; displayName?: string }; stats?: string[] }> }> }> } | undefined
  for (const teamBox of boxscore?.players ?? []) {
    const teamAbbrev = teamBox.team?.abbreviation ?? ''
    for (const group of teamBox.statistics ?? []) {
      const labels = group.labels ?? []
      for (const a of group.athletes ?? []) {
        const id = String(a.athlete?.id ?? '')
        if (!id) continue
        athletes.push({ providerAthleteId: id, name: a.athlete?.displayName ?? '', teamAbbrev, position: group.name ?? null, stats: toNumericStats(labels, a.stats ?? []) })
      }
    }
  }
  return { eventId, season, week, statusName, homeAbbrev, awayAbbrev, athletes }
}

type EspnEvent = {
  id?: string
  date?: string
  season?: { year?: number }
  week?: { number?: number }
  status?: { type?: { state?: string; name?: string } }
  competitions?: Array<{
    venue?: { fullName?: string }
    status?: { type?: { state?: string; name?: string } }
    competitors?: Array<{ homeAway?: string; team?: { id?: string; abbreviation?: string } }>
  }>
}

/** Pure ESPN status → canonical status. */
export function mapEspnStatus(name: string | undefined | null): CanonicalGameStatus {
  switch ((name ?? '').toUpperCase()) {
    case 'STATUS_SCHEDULED': return 'scheduled'
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_HALFTIME':
    case 'STATUS_END_PERIOD': return 'live'
    case 'STATUS_FINAL':
    case 'STATUS_FINAL_OVERTIME': return 'final'
    case 'STATUS_POSTPONED': return 'postponed'
    case 'STATUS_SUSPENDED': return 'suspended'
    case 'STATUS_CANCELED':
    case 'STATUS_CANCELLED': return 'cancelled'
    case 'STATUS_DELAYED': return 'delayed'
    default: return 'unknown'
  }
}

/** Pure ESPN event → CanonicalGameSchedule (the seam). Returns null on a malformed record (schema drift). */
export function normalizeEspnGame(ev: EspnEvent, fetchedAt: string, snapshotVersion: string): CanonicalGameSchedule | null {
  const comp = ev.competitions?.[0]
  const competitors = comp?.competitors ?? []
  const home = competitors.find((c) => c.homeAway === 'home')?.team
  const away = competitors.find((c) => c.homeAway === 'away')?.team
  if (!ev.id || !ev.date || !home?.id || !away?.id) return null // required identity fields missing
  const statusName = comp?.status?.type?.name ?? ev.status?.type?.name
  return {
    canonicalGameId: `espn:nfl:${ev.id}`,
    sport: 'NFL',
    season: ev.season?.year ? String(ev.season.year) : 'unknown',
    weekOrRound: ev.week?.number != null ? String(ev.week.number) : null,
    homeTeamId: `espn:nfl:team:${home.id}`,
    awayTeamId: `espn:nfl:team:${away.id}`,
    scheduledStart: ev.date,
    status: mapEspnStatus(statusName),
    venue: comp?.venue?.fullName ?? null,
    source: { primaryProvider: 'espn', providerRecordId: String(ev.id), fetchedAt, sourceUpdatedAt: ev.date, snapshotVersion },
  }
}

export type EspnScheduleFetch = { games: CanonicalGameSchedule[]; attempts: number; logical: number; season: string; week: string | null; rejected: number }

/** Real minimal ESPN schedule fetch (schema-validated). Optional week (defaults to current scoreboard). */
export async function fetchEspnSchedule(opts: { week?: number } = {}): Promise<EspnScheduleFetch | { error: string }> {
  const url = `${BASE}/scoreboard${opts.week ? `?week=${opts.week}` : ''}`
  const fetchedAt = new Date().toISOString()
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 9000)
  let raw: { events?: EspnEvent[]; season?: { year?: number }; week?: { number?: number } } | null = null
  try {
    const res = await fetch(url, { signal: c.signal, headers: { 'user-agent': 'fantasy-os-gateway' } })
    clearTimeout(t)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    raw = await res.json()
  } catch (e) {
    clearTimeout(t)
    return { error: e instanceof Error ? e.message : 'fetch error' }
  }
  if (!raw || !Array.isArray(raw.events)) return { error: 'schema_mismatch: events not an array' }
  const season = raw.season?.year ? String(raw.season.year) : 'unknown'
  const week = raw.week?.number != null ? String(raw.week.number) : null
  const snapshotVersion = `nfl-schedule-${season}-w${week ?? 'x'}`
  let rejected = 0
  const games: CanonicalGameSchedule[] = []
  for (const ev of raw.events) {
    const g = normalizeEspnGame(ev, fetchedAt, snapshotVersion)
    if (g) games.push(g)
    else rejected++
  }
  return { games, attempts: 1, logical: 1, season, week, rejected }
}

export class EspnAdapter extends BaseProviderAdapter {
  provider = 'espn'
  getCapabilities(): ProviderCapabilityDeclaration {
    return {
      provider: 'espn',
      sports: ['NFL'],
      capabilities: ['schedules', 'games', 'team_branding', 'statistics'],
      refreshSupport: { schedules: 'scheduled', games: 'live', team_branding: 'static', statistics: 'live' },
      limitations: ['Public API — undocumented rate limits.', 'Scoreboard does not expose player injuries/availability.', 'Box-score athlete ids are ESPN-native; canonical player identity resolution across providers is not yet built (Phase 5F-a certifies stats with unresolved player identities disclosed).'],
    }
  }
  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    const r = await fetchEspnSchedule()
    const latencyMs = Date.now() - started
    if ('error' in r) return { provider: this.provider, state: 'unavailable', checkedAt: new Date().toISOString(), latencyMs, detail: r.error }
    return { provider: this.provider, state: 'healthy', checkedAt: new Date().toISOString(), latencyMs }
  }
}
