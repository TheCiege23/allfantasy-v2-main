/**
 * Fantasy OS Suite — Phase V7.2: historical portfolio discovery.
 *
 * Extends the V7.1 resolver with MULTI-SEASON discovery: for a resolved account, enumerate a BOUNDED set
 * of seasons, collect the leagues found, resolve role, and link each league to its prior-season instance
 * (Sleeper `previous_league_id`) so continuity chains can be assembled. Everything is provider-neutral and
 * anonymized (opaque `lg_`/`acct_` refs). Bounded by an explicit season list + concurrency — never an
 * unbounded crawl, and it never walks into other members' unrelated leagues.
 */
import type { DiscoveredLeague, AccountPortfolio, ValidationAccount, PortfolioManifest, HistoricalCoverageMatrix } from './types'
import { anonymizeLeagueId, anonymizeAccount } from './anonymize'
import { runPool, resolveUsername, type SleeperFetch } from './sleeperCohortClient'
import { resolvableCandidates } from './normalizeCohort'
import { buildPortfolioManifest, buildHistoricalCoverageMatrix } from './portfolioManifest'

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: validation-only DB-less cohort tooling (CLI + tests, never customer runtime)

/** Raw Sleeper league shape (only the discovery-relevant fields). */
type RawLeague = {
  league_id: string
  season: string
  sport?: string
  previous_league_id?: string | null
  settings?: Record<string, number>
}
type RawLeagueUser = { user_id: string; is_owner?: boolean }

export type DiscoveryOptions = {
  /** Explicit, bounded list of seasons to check, e.g. ['2024','2023','2022']. Required (no open range). */
  seasons: string[]
  sport?: string
  concurrency?: number
  /** Resolve commissioner/member role per league (one extra call each). Default true. */
  resolveRoles?: boolean
}

/** Enumerate a bounded season list for a user and return the raw leagues found per season. */
async function enumerateSeasons(
  userId: string,
  seasons: string[],
  sport: string,
  fetchJson: SleeperFetch,
): Promise<RawLeague[]> {
  const perSeason = await Promise.all(
    seasons.map((season) =>
      fetchJson<RawLeague[]>(`${SLEEPER_BASE}/user/${userId}/leagues/${sport}/${season}`),
    ),
  )
  return perSeason.flatMap((leagues) => leagues ?? [])
}

/** Resolve the account's role in a league via the users endpoint (is_owner ⇒ commissioner). */
async function resolveRole(
  leagueId: string,
  userId: string,
  fetchJson: SleeperFetch,
): Promise<DiscoveredLeague['role']> {
  const users = await fetchJson<RawLeagueUser[]>(`${SLEEPER_BASE}/league/${leagueId}/users`)
  if (!users) return 'unknown'
  const me = users.find((u) => u.user_id === userId)
  if (!me) return 'unknown'
  return me.is_owner ? 'commissioner' : 'member'
}

/**
 * Discover one resolved account's historical portfolio across the given bounded seasons.
 * `userId` must already be resolved (via `resolveUsername`). Returns provider-neutral, anonymized data.
 */
export async function discoverAccountPortfolio(
  userId: string,
  fetchJson: SleeperFetch,
  opts: DiscoveryOptions,
): Promise<AccountPortfolio> {
  const sport = opts.sport ?? 'nfl'
  const concurrency = opts.concurrency ?? 3
  const resolveRoles = opts.resolveRoles ?? true

  const raw = await enumerateSeasons(userId, opts.seasons, sport, fetchJson)

  // Dedupe by league id (a league can only appear once per season, but guard anyway).
  const byId = new Map<string, RawLeague>()
  for (const lg of raw) if (!byId.has(lg.league_id)) byId.set(lg.league_id, lg)
  const uniqueRaw = [...byId.values()]

  const leagues = await runPool(uniqueRaw, concurrency, async (lg): Promise<DiscoveredLeague> => {
    const role = resolveRoles ? await resolveRole(lg.league_id, userId, fetchJson) : 'unknown'
    return {
      leagueReference: anonymizeLeagueId(lg.league_id),
      season: lg.season,
      sport: (lg.sport ?? sport).toUpperCase(),
      previousLeagueRef: lg.previous_league_id ? anonymizeLeagueId(lg.previous_league_id) : null,
      role,
    }
  })

  const seasonsDiscovered = [...new Set(leagues.map((l) => l.season))].sort()

  return {
    accountReference: anonymizeAccount(userId),
    status: 'resolved',
    seasonsDiscovered,
    leagues: leagues.sort((a, b) => a.leagueReference.localeCompare(b.leagueReference)),
  }
}

/**
 * Orchestrate discovery across a normalized cohort: resolve each pending username, discover its bounded
 * historical portfolio, and assemble the manifest + coverage matrix. Unresolved usernames are recorded
 * (status updated on the account + an `unresolved` portfolio entry), never guessed. Mutates `accounts`
 * statuses in place (same contract as `runCohort`).
 */
export async function runDiscovery(
  accounts: ValidationAccount[],
  fetchJson: SleeperFetch,
  opts: DiscoveryOptions,
): Promise<{ accounts: ValidationAccount[]; manifest: PortfolioManifest; coverage: HistoricalCoverageMatrix }> {
  const concurrency = opts.concurrency ?? 3
  const portfolios: AccountPortfolio[] = []

  await runPool(resolvableCandidates(accounts), concurrency, async (acct) => {
    try {
      const resolved = await resolveUsername(acct.normalizedUsername, fetchJson)
      if (!resolved) {
        acct.status = 'unresolved'
        acct.notes.push('Sleeper API returned no account for this username')
        portfolios.push({ accountReference: anonymizeAccount(acct.normalizedUsername), status: 'unresolved', seasonsDiscovered: [], leagues: [] })
        return
      }
      acct.status = 'resolved'
      acct.sleeperUserId = resolved.userId
      acct.displayName = resolved.displayName
      portfolios.push(await discoverAccountPortfolio(resolved.userId, fetchJson, opts))
    } catch {
      acct.status = 'failed'
      acct.notes.push('error during portfolio discovery')
      portfolios.push({ accountReference: anonymizeAccount(acct.normalizedUsername), status: 'failed', seasonsDiscovered: [], leagues: [] })
    }
  })

  return {
    accounts,
    manifest: buildPortfolioManifest(portfolios),
    coverage: buildHistoricalCoverageMatrix(portfolios),
  }
}
