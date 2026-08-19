/**
 * Hydrate the injured-starter signal from the portfolio, across every league a user rosters.
 *
 * WHY A SEPARATE MODULE. `hydrateSignalBundle` is per-league and takes a leagueId. This
 * question is inherently cross-league — one injured player can be a starter in four of a
 * user's leagues and a bench player in two others, and a sweep that ran per-league would
 * re-derive the same portfolio once per league.
 *
 * SOURCE MATTERS. This reads `assembleCrossLeaguePlayerPortfolio`, which resolves injuries
 * through `lib/injuries/injuryReadPort` — the path backed by `sportsInjury` (refreshed every
 * 15 minutes). It deliberately does NOT read `SportsPlayerRecord.injuryStatus`, which was
 * measured to be ~92% ROSTER status (`INACT`/`ACT`) mislabelled as injury data, with exactly
 * one player league-wide carrying `Out`.
 */

import type { InjuredStarterSignal } from './types'

/** Designations that put availability genuinely in doubt. Mirrors the detector's tier. */
const URGENT_STATUSES = new Set(['out', 'doubtful', 'ir', 'suspended'])

/** Presentation names for the platform a manager must actually go to. */
const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  fantrax: 'Fantrax',
}

function platformLabel(provider: string | null | undefined): string | null {
  const key = String(provider ?? '').trim().toLowerCase()
  if (!key || key === 'manual' || key === 'allfantasy') return null
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

export interface HydrateInjuredStartersResult {
  injuredStarters: InjuredStarterSignal[]
  /** Leagues scanned, so a caller can tell "none found" from "nothing to scan". */
  leaguesScanned: number
  /** True when the injury feed itself is stale — every designation inherits the caveat. */
  feedStale: boolean
}

/**
 * Build the signal. Pure over the portfolio shape so it can be tested without a database;
 * the caller supplies the already-assembled portfolio.
 */
export function buildInjuredStarterSignals(portfolio: {
  items: Array<{
    displayName: string
    position: string | null
    injury: { status: string; freshness?: { stale?: boolean } | null } | null
    projection?: { projectedPoints: number } | null
    schedule?: { nextGameAt?: string | null } | null
    leagueAppearances: Array<{
      canonicalLeagueId: string
      leagueName: string
      provider: string
      rosterStatus: string
    }>
  }>
  connectedLeagueCount?: number
  injuryPort?: { feedStale?: boolean } | null
}): HydrateInjuredStartersResult {
  const feedStale = Boolean(portfolio.injuryPort?.feedStale)
  const out: InjuredStarterSignal[] = []

  // Bench candidates per league, so a suggested replacement is one this manager actually
  // owns in THAT league — suggesting a player from a different league would be nonsense.
  const benchByLeague = new Map<string, Array<{ playerName: string; projectedPoints: number | null }>>()
  for (const item of portfolio.items) {
    for (const appearance of item.leagueAppearances) {
      if (appearance.rosterStatus !== 'bench') continue
      // An injured bench player is not a replacement.
      const status = String(item.injury?.status ?? '').toLowerCase()
      if (URGENT_STATUSES.has(status)) continue
      const list = benchByLeague.get(appearance.canonicalLeagueId) ?? []
      list.push({
        playerName: item.displayName,
        projectedPoints: item.projection?.projectedPoints ?? null,
      })
      benchByLeague.set(appearance.canonicalLeagueId, list)
    }
  }
  for (const list of benchByLeague.values()) {
    // Rank by projection where one exists. Players without a projection sort last rather
    // than being dropped — "we have no number for him" is not "he is a bad option".
    list.sort((a, b) => (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1))
  }

  for (const item of portfolio.items) {
    const status = String(item.injury?.status ?? '').toLowerCase()
    if (!URGENT_STATUSES.has(status)) continue

    for (const appearance of item.leagueAppearances) {
      if (appearance.rosterStatus !== 'starter') continue

      const bench = benchByLeague.get(appearance.canonicalLeagueId) ?? []
      const replacement = bench.length > 0 ? bench[0]! : null

      out.push({
        playerName: item.displayName,
        position: item.position,
        // Present the designation as the port stated it, capitalised for display only.
        designation: status.charAt(0).toUpperCase() + status.slice(1),
        leagueId: appearance.canonicalLeagueId,
        leagueName: appearance.leagueName,
        platform: platformLabel(appearance.provider),
        // The player's own kickoff is his lock. Null on a bye or a missing schedule row —
        // the detector degrades to a lower urgency rather than inventing a deadline.
        lockAt: item.schedule?.nextGameAt ?? null,
        replacement,
        // Either the individual row or the whole feed being stale taints the claim.
        stale: feedStale || Boolean(item.injury?.freshness?.stale),
      })
    }
  }

  return {
    injuredStarters: out,
    leaguesScanned: portfolio.connectedLeagueCount ?? 0,
    feedStale,
  }
}

/**
 * DB-backed entry point. Assembles the portfolio for a user and derives the signal.
 * Returns an empty signal (not a throw) when the user has no connected leagues — that is a
 * normal state, not an error.
 */
export async function hydrateInjuredStarters(args: {
  appUserId: string
  sport?: string
  requestTime?: Date
}): Promise<HydrateInjuredStartersResult> {
  const { assembleCrossLeaguePlayerPortfolio } = await import(
    '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'
  )
  const portfolio = await assembleCrossLeaguePlayerPortfolio({
    appUserId: args.appUserId,
    sport: args.sport ?? 'NFL',
    requestTime: args.requestTime,
  })
  return buildInjuredStarterSignals(portfolio as never)
}
