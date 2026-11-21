import { fetchSleeperJson } from './liveLeagueFetch'

/**
 * The live roster panel's Sleeper reads, through a short SHARED cache (security cleanup, 2026-11-15).
 *
 * Why not Postgres: this panel exists to show a pick seconds after it is made, so a scheduled copy would
 * be the wrong answer, the reason this file says "live" rather than DB-first. What it does instead is
 * stop every viewer of a league from asking Sleeper the same question every 20 seconds:
 *
 *   - rosters and the draft list are kept 60s — they change rarely, and a pick reaches the panel through
 *     the draft picks below, not the roster feed;
 *   - draft picks are kept 10s, so a pick still shows inside the panel's own 20s poll;
 *   - concurrent requests for the same key share ONE in-flight call;
 *   - a failed call (`null`) is never cached, so one bad response does not blank a minute.
 *
 * In-process only: each server process keeps its own copy (the web service runs one). Bounded at
 * MAX_ENTRIES; the oldest entry goes first.
 */

export type WireRoster = {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  starters?: string[] | null
  taxi?: string[] | null
  reserve?: string[] | null
  /** Co-owners manage the roster as much as `owner_id` does. */
  co_owners?: string[] | null
}
export type WireDraft = { draft_id: string; status: string }
export type WireDraftPick = { player_id?: string | null; picked_by?: string | null; round: number; pick_no: number }

export const ROSTER_TTL_MS = 60_000
export const DRAFT_LIST_TTL_MS = 60_000
export const PICKS_TTL_MS = 10_000
const MAX_ENTRIES = 1000

type Entry = { value: unknown; expiresAt: number }
const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<unknown>>()

/** For tests. */
export function resetLiveLeagueFeed(): void {
  cache.clear()
  inFlight.clear()
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T | null>, now: () => number): Promise<T | null> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now()) return hit.value as T
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T | null>
  const p = (async () => {
    try {
      const value = await load()
      if (value !== null) {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
        cache.set(key, { value, expiresAt: now() + ttlMs })
      }
      return value
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, p)
  return p
}

type Opts = { fetcher?: typeof fetchSleeperJson; now?: () => number }

const ID = /^[0-9A-Za-z_-]{1,40}$/

export function liveLeagueRosters(sleeperLeagueId: string, o: Opts = {}): Promise<WireRoster[] | null> {
  if (!ID.test(sleeperLeagueId)) return Promise.resolve(null)
  const f = o.fetcher ?? fetchSleeperJson
  return cached(`rosters:${sleeperLeagueId}`, ROSTER_TTL_MS, () => f<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`), o.now ?? Date.now)
}

export function liveLeagueDrafts(sleeperLeagueId: string, o: Opts = {}): Promise<WireDraft[] | null> {
  if (!ID.test(sleeperLeagueId)) return Promise.resolve(null)
  const f = o.fetcher ?? fetchSleeperJson
  return cached(`drafts:${sleeperLeagueId}`, DRAFT_LIST_TTL_MS, () => f<WireDraft[]>(`/league/${sleeperLeagueId}/drafts`), o.now ?? Date.now)
}

export function liveDraftPicks(draftId: string, o: Opts = {}): Promise<WireDraftPick[] | null> {
  if (!ID.test(draftId)) return Promise.resolve(null)
  const f = o.fetcher ?? fetchSleeperJson
  return cached(`picks:${draftId}`, PICKS_TTL_MS, () => f<WireDraftPick[]>(`/draft/${draftId}/picks`), o.now ?? Date.now)
}

/*
 * Live points for the C2C / Devy roster page (2026-11-21). Same shared cache, same reason: every viewer
 * polling once a minute must not each ask Sleeper. Matchups are kept 30s so a score still moves inside a
 * poll; the NFL week and team names change rarely and are kept longer.
 */
export type WireMatchup = {
  roster_id: number
  matchup_id: number | null
  points?: number | null
  players_points?: Record<string, number> | null
}
export type WireLeagueUser = { user_id: string; display_name?: string | null; metadata?: { team_name?: string | null } | null }
export type WireNflState = { week?: number | null; display_week?: number | null; season?: string | null; season_type?: string | null }

export const MATCHUPS_TTL_MS = 30_000
export const USERS_TTL_MS = 10 * 60_000
export const NFL_STATE_TTL_MS = 5 * 60_000

export function liveLeagueMatchups(sleeperLeagueId: string, week: number, o: Opts = {}): Promise<WireMatchup[] | null> {
  if (!ID.test(sleeperLeagueId) || !Number.isInteger(week) || week < 1 || week > 25) return Promise.resolve(null)
  const f = o.fetcher ?? fetchSleeperJson
  return cached(`matchups:${sleeperLeagueId}:${week}`, MATCHUPS_TTL_MS, () => f<WireMatchup[]>(`/league/${sleeperLeagueId}/matchups/${week}`), o.now ?? Date.now)
}

export function liveLeagueUsers(sleeperLeagueId: string, o: Opts = {}): Promise<WireLeagueUser[] | null> {
  if (!ID.test(sleeperLeagueId)) return Promise.resolve(null)
  const f = o.fetcher ?? fetchSleeperJson
  return cached(`users:${sleeperLeagueId}`, USERS_TTL_MS, () => f<WireLeagueUser[]>(`/league/${sleeperLeagueId}/users`), o.now ?? Date.now)
}

export function liveNflState(o: Opts = {}): Promise<WireNflState | null> {
  const f = o.fetcher ?? fetchSleeperJson
  return cached('state:nfl', NFL_STATE_TTL_MS, () => f<WireNflState>('/state/nfl'), o.now ?? Date.now)
}
