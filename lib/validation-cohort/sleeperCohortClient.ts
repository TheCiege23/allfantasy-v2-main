/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (Sleeper resolver — the provider seam).
 *
 * The ONLY Sleeper-aware code in the cohort pipeline. It resolves usernames → user ids → leagues and maps
 * each raw Sleeper league into provider-neutral `NormalizedLeagueFacts`. Everything downstream
 * (classifier, probe, report) sees only neutral facts, so no provider specifics leak.
 *
 * `fetchJson` is injected so tests use recorded fixtures and NEVER hit the live API (Step 11). The default
 * implementation adds a timeout + bounded retries; live calls happen only from the CLI command (Step 12).
 */
import type { NormalizedLeagueFacts } from './types'
import { anonymizeLeagueId } from './anonymize'

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: validation-only DB-less cohort tooling (CLI + tests, never customer runtime)

export type SleeperFetch = <T>(url: string) => Promise<T | null>

export type ResolveOptions = {
  season?: string
  sport?: string
  /** Weeks of transactions to sample for activity classification (bounded; default modest). */
  maxTxWeeks?: number
  timeoutMs?: number
  retries?: number
}

const DEFAULTS: Required<Omit<ResolveOptions, 'season'>> & { season?: string } = {
  sport: 'nfl',
  maxTxWeeks: 18,
  timeoutMs: 8000,
  retries: 2,
  season: undefined,
}

/** Default live fetch: timeout + bounded retries; returns null on 404/failure (never throws upward). */
export function makeDefaultFetch(timeoutMs = 8000, retries = 2): SleeperFetch {
  return async <T>(url: string): Promise<T | null> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as T
      } catch {
        clearTimeout(timer)
        if (attempt === retries) return null
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1))) // linear backoff
      }
    }
    return null
  }
}

// ── Sleeper raw shapes (minimal, only what we map) ────────────────────────────
type SleeperUser = { user_id: string; display_name?: string }
type SleeperLeague = {
  league_id: string
  season: string
  sport?: string
  total_rosters?: number
  status?: string
  draft_id?: string | null
  roster_positions?: string[]
  settings?: Record<string, number>
  scoring_settings?: Record<string, number>
}
type SleeperLeagueUser = { user_id: string; is_owner?: boolean }
type SleeperRoster = { owner_id?: string | null }
type SleeperTransaction = { type?: string; status?: string }

const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S', 'IDP'])

function formatFromType(type: number | undefined): NormalizedLeagueFacts['formatType'] {
  if (type === 2) return 'dynasty'
  if (type === 1) return 'keeper'
  if (type === 0) return 'redraft'
  return 'unknown'
}

function draftStateFrom(status: string | undefined, draftId: string | null | undefined): NormalizedLeagueFacts['draftState'] {
  if (!draftId) return 'unavailable'
  if (status === 'pre_draft' || status === 'drafting') return 'upcoming'
  if (status === 'in_season' || status === 'complete') return 'complete'
  return 'unavailable'
}

/**
 * PURE Sleeper→neutral mapping (the seam). Exported for fixture tests. Given a raw league + its users,
 * rosters, and sampled transactions, produce provider-neutral facts. Missing fields default honestly.
 */
export function mapLeagueToFacts(input: {
  league: SleeperLeague
  users: SleeperLeagueUser[]
  rosters: SleeperRoster[]
  transactions: SleeperTransaction[]
  cohortUserId: string
}): NormalizedLeagueFacts {
  const { league, users, rosters, transactions, cohortUserId } = input
  const rosterPositions = league.roster_positions ?? []
  const numTeams = league.total_rosters ?? rosters.length ?? 0

  const completedTx = transactions.filter((t) => t.status === 'complete' || t.status === undefined)
  const totalTrades = completedTx.filter((t) => t.type === 'trade').length
  const totalWaiverClaims = completedTx.filter((t) => t.type === 'waiver' || t.type === 'free_agent').length

  const activeManagers = rosters.filter((r) => !!r.owner_id).length || users.length
  const inactiveManagers = Math.max(0, numTeams - activeManagers)

  return {
    leagueReference: anonymizeLeagueId(league.league_id),
    season: league.season,
    sport: (league.sport ?? 'nfl').toUpperCase(),
    formatType: formatFromType(league.settings?.type),
    numTeams,
    hasSuperflex: rosterPositions.includes('SUPER_FLEX'),
    hasIdp: rosterPositions.some((p) => IDP_SLOTS.has(p)),
    tightEndPremium: (league.scoring_settings?.bonus_rec_te ?? 0) > 0,
    playoffTeams: league.settings?.playoff_teams ?? 6,
    waiverType: league.settings?.waiver_type === 2 ? 'FAAB' : league.settings?.waiver_type === 1 ? 'rolling' : 'reverse',
    totalTrades,
    totalWaiverClaims,
    totalTransactions: completedTx.length,
    draftState: draftStateFrom(league.status, league.draft_id),
    sourceIsCommissioner: users.find((u) => u.user_id === cohortUserId)?.is_owner === true,
    activeManagers,
    inactiveManagers,
  }
}

/** Resolve a username → { userId, displayName } via the public API (or null if it isn't a real account). */
export async function resolveUsername(
  username: string,
  fetchJson: SleeperFetch,
): Promise<{ userId: string; displayName?: string } | null> {
  const user = await fetchJson<SleeperUser>(`${SLEEPER_BASE}/user/${encodeURIComponent(username)}`)
  if (!user?.user_id) return null
  return { userId: user.user_id, displayName: user.display_name }
}

/** Fetch a user's leagues for a season/sport. */
export async function fetchUserLeagues(
  userId: string,
  season: string,
  sport: string,
  fetchJson: SleeperFetch,
): Promise<SleeperLeague[]> {
  const leagues = await fetchJson<SleeperLeague[]>(`${SLEEPER_BASE}/user/${userId}/leagues/${sport}/${season}`)
  return leagues ?? []
}

/** Fetch the neutral facts for one league (users + rosters + bounded transactions). */
export async function fetchLeagueFacts(
  league: SleeperLeague,
  cohortUserId: string,
  fetchJson: SleeperFetch,
  opts: ResolveOptions = {},
): Promise<NormalizedLeagueFacts> {
  const maxWeeks = opts.maxTxWeeks ?? DEFAULTS.maxTxWeeks
  const id = league.league_id
  const [users, rosters] = await Promise.all([
    fetchJson<SleeperLeagueUser[]>(`${SLEEPER_BASE}/league/${id}/users`),
    fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${id}/rosters`),
  ])
  const txByWeek = await Promise.all(
    Array.from({ length: maxWeeks }, (_, i) =>
      fetchJson<SleeperTransaction[]>(`${SLEEPER_BASE}/league/${id}/transactions/${i + 1}`),
    ),
  )
  const transactions = txByWeek.flatMap((w) => w ?? [])
  return mapLeagueToFacts({ league, users: users ?? [], rosters: rosters ?? [], transactions, cohortUserId })
}

/** Bounded-concurrency pool — never an unbounded import loop (Step 3). */
export async function runPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const idx = cursor++
        results[idx] = await worker(items[idx]!, idx)
      }
    }),
  )
  return results
}
