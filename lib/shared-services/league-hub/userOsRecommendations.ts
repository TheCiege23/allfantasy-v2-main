/**
 * User OS League-Specific Intelligence Wiring phase — Part 2, the single
 * canonical coordinator. Every consumer (the API route, League Hub UI,
 * Chimmy seam) calls this one function instead of independently invoking
 * lineup/waiver/trade/roster/playoff/strategy generators — matching the
 * explicit instruction not to require each consumer to call them
 * separately, and not to build a second recommendation architecture.
 */
import { assembleUserOsContext } from './userOsContext'
import { getEmptyRecommendationBundle, USER_OS_DOMAINS } from './recommendationContract'
import { generateLineupRecommendations } from './generators/lineupRecommendations'
import { generateWaiverRecommendations } from './generators/waiverRecommendations'
import { generateTradeRecommendations } from './generators/tradeRecommendations'
import { generateRosterRecommendations } from './generators/rosterRecommendations'
import { generatePlayoffRecommendations } from './generators/playoffRecommendations'
import { generateStrategyRecommendations } from './generators/strategyRecommendations'
import type { UserOsContext } from './userOsContext'
import type { LeagueRecommendation, LeagueRecommendationBundle, LeagueRecommendationDomain, SyncFreshness } from './types'

export type DomainStatus = 'ok' | 'unavailable' | 'unsupported' | 'stale_blocked' | 'engine_error'

export interface UserOsRecommendationResult {
  bundle: LeagueRecommendationBundle
  /** Real, per-domain status — distinguishes "no action needed" (ok, empty array) from every other reason a domain has no recommendations. Never inferred from an empty array alone. */
  domainStatus: Partial<Record<LeagueRecommendationDomain, DomainStatus>>
  generatedAt: string
  /** True only when the caller has no real relationship to the league — bundle/domainStatus are meaningless in this case, callers should treat this as 404/403. */
  accessDenied: boolean
}

type Generator = (context: UserOsContext, generatedAt: string) => LeagueRecommendation[]

const GENERATORS: Record<Exclude<LeagueRecommendationDomain, 'commissioner'>, Generator> = {
  lineup: generateLineupRecommendations,
  waiver: generateWaiverRecommendations,
  trade: generateTradeRecommendations,
  roster: generateRosterRecommendations,
  playoff: generatePlayoffRecommendations,
  strategy: generateStrategyRecommendations,
}

/**
 * The coordinator. Never trusts client-supplied league membership, roster
 * ownership, commissioner role, provider identity, team id, or scoring —
 * every one of those is resolved server-side by `assembleUserOsContext`
 * (itself built on the fail-closed `resolveActiveLeagueContext`). Callers
 * pass only `appUserId` (from their own session) and `canonicalLeagueId`.
 */
export async function assembleUserOsRecommendations(args: {
  appUserId: string
  canonicalLeagueId: string
  requestedDomains?: LeagueRecommendationDomain[]
  requestTime?: Date
}): Promise<UserOsRecommendationResult> {
  const generatedAt = (args.requestTime ?? new Date()).toISOString()
  const context = await assembleUserOsContext({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })

  if (!context) {
    return {
      bundle: getEmptyRecommendationBundle(),
      domainStatus: {},
      generatedAt,
      accessDenied: true,
    }
  }

  const domainsToRun = (args.requestedDomains?.length ? args.requestedDomains : USER_OS_DOMAINS).filter(
    (d): d is Exclude<LeagueRecommendationDomain, 'commissioner'> => d !== 'commissioner'
  )

  const bundle = getEmptyRecommendationBundle()
  const domainStatus: UserOsRecommendationResult['domainStatus'] = {}

  for (const domain of domainsToRun) {
    if (context.unavailableDomains.includes(domain)) {
      domainStatus[domain] = 'unsupported'
      continue
    }
    try {
      const recs = GENERATORS[domain](context, generatedAt)
      bundle[domain] = recs
      domainStatus[domain] = 'ok'
    } catch (err) {
      console.error(`[userOsRecommendations] generator failed for domain "${domain}":`, err)
      domainStatus[domain] = 'engine_error'
    }
  }

  bundle.totalCount = USER_OS_DOMAINS.reduce((sum, d) => sum + (d === 'commissioner' ? 0 : bundle[d].length), 0)

  return { bundle, domainStatus, generatedAt, accessDenied: false }
}

/**
 * Part 11 — prioritization. Returns at most one recommendation per domain
 * (the highest-priority one, ties broken by domain order), for a concise
 * dashboard surface. The full list remains available via the bundle itself
 * for the league workspace.
 */
const PRIORITY_RANK: Record<LeagueRecommendation['priority'], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

export function selectTopActions(bundle: LeagueRecommendationBundle, maxCount = 5): LeagueRecommendation[] {
  const perDomainTop: LeagueRecommendation[] = []
  for (const domain of USER_OS_DOMAINS) {
    const list = bundle[domain]
    if (!list.length) continue
    const top = [...list].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])[0]
    perDomainTop.push(top)
  }
  return perDomainTop
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, maxCount)
}

export interface ChimmyUserOsSummary {
  canonicalLeagueId: string
  provider: string
  sport: string
  season: number | string | null
  teamId: string | null
  rosterId: string | null
  syncFreshness: SyncFreshness
  topActions: LeagueRecommendation[]
}

/**
 * Part 17 — the focused seam Chimmy can consume later. Deliberately
 * narrower than `assembleUserOsRecommendations`'s own result: no full
 * bundle, no per-generator internals, no unavailable-domain diagnostics —
 * only what a conversational surface needs (identity, freshness, and a
 * short prioritized action list). This phase does not wire it into Chimmy
 * itself (`lib/chimmy-context/*` untouched) — only exposes the function.
 */
export async function getChimmyUserOsSummary(args: {
  appUserId: string
  canonicalLeagueId: string
}): Promise<ChimmyUserOsSummary | null> {
  const result = await assembleUserOsRecommendations({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })
  if (result.accessDenied) return null

  const context = await assembleUserOsContext({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })
  if (!context) return null

  return {
    canonicalLeagueId: context.canonicalLeagueId,
    provider: context.provider,
    sport: context.sport,
    season: context.season,
    teamId: context.teamId,
    rosterId: context.rosterId,
    syncFreshness: context.syncFreshness as never,
    topActions: selectTopActions(result.bundle, 3),
  }
}
