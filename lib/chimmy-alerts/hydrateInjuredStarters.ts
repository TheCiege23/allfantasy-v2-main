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

type AlertPortfolio = Parameters<typeof buildInjuredStarterSignals>[0]

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
    sport?: string | null
    position: string | null
    injury: { status: string; reportedAt?: string | null; freshness?: { stale?: boolean } | null } | null
    projection?: { projectedPoints: number } | null
    schedule?: { nextGameAt?: string | null } | null
    leagueAppearances: Array<{
      canonicalLeagueId: string
      leagueName: string
      provider: string
      playerId: string
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
  const benchByLeague = new Map<string, Array<{ playerName: string; position: string | null; projectedPoints: number | null }>>()
  for (const item of portfolio.items) {
    for (const appearance of item.leagueAppearances) {
      if (appearance.rosterStatus !== 'bench') continue
      // An injured bench player is not a replacement.
      const status = String(item.injury?.status ?? '').toLowerCase()
      if (URGENT_STATUSES.has(status)) continue
      const list = benchByLeague.get(appearance.canonicalLeagueId) ?? []
      list.push({
        playerName: item.displayName,
        position: item.position,
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
    // A Sleeper appearance's playerId IS his Sleeper id; ESPN/Yahoo ids are not, so they are never used for the link.
    const sleeperId = item.leagueAppearances.find((a) => String(a.provider).toLowerCase() === 'sleeper')?.playerId ?? null

    for (const appearance of item.leagueAppearances) {
      if (appearance.rosterStatus !== 'starter') continue

      const bench = benchByLeague.get(appearance.canonicalLeagueId) ?? []
      // Slot eligibility is not present in this portfolio. Only suggest a same-position
      // candidate; never tell a manager to replace a tight end with a quarterback.
      const replacement = item.position
        ? bench.find((candidate) => candidate.position?.toUpperCase() === item.position?.toUpperCase()) ?? null
        : null

      out.push({
        playerName: item.displayName,
        position: item.position,
        sleeperId,
        sport: item.sport ?? null,
        // Present the designation as the port stated it, capitalised for display only.
        designation: status.charAt(0).toUpperCase() + status.slice(1),
        leagueId: appearance.canonicalLeagueId,
        leagueName: appearance.leagueName,
        platform: platformLabel(appearance.provider),
        // The player's own kickoff is his lock. Null on a bye or a missing schedule row —
        // the detector degrades to a lower urgency rather than inventing a deadline.
        lockAt: item.schedule?.nextGameAt ?? null,
        // When the word landed, so the detector can tell an inactive from a Friday ruling.
        reportedAt: item.injury?.reportedAt ?? null,
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
  /**
   * One sport, or `null` for EVERY sport (the game-day sweep, 2026-10-08). Every sport reads NFL
   * leagues exactly as before and other sports' leagues only when they are being played now
   * (gameDayScope.ts `isCurrentSeasonLeague`). Omitted = 'NFL', the historical default.
   */
  sport?: string | null
  requestTime?: Date
}): Promise<HydrateInjuredStartersResult> {
  const [{ assembleCrossLeaguePlayerPortfolio }, { isCurrentSeasonLeague }] = await Promise.all([
    import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'),
    import('./gameDayScope'),
  ])
  const now = args.requestTime ?? new Date()
  const allSports = args.sport === null
  const portfolio = await assembleCrossLeaguePlayerPortfolio({
    appUserId: args.appUserId,
    ...(allSports
      ? { leagueFilter: (l: { sport: string; season: number }) => String(l.sport).toUpperCase() === 'NFL' || isCurrentSeasonLeague(l.sport, l.season, now) }
      : { sport: args.sport ?? 'NFL' }),
    requestTime: args.requestTime,
  })
  const verified = await verifySleeperLineupAssignments(portfolio as never, args.appUserId)
  const withoutBestBall = await dropBestBallAppearances(verified)
  return buildInjuredStarterSignals(withoutBestBall)
}

/**
 * ⚠ BEST BALL HAS NO LINEUP TO FIX. The platform starts the best scorers after the fact, so
 * "X is Out and still starting" in a best-ball league is an alert about a decision nobody can
 * make — the same false alarm the game-day list stopped showing (lib/core-app/leagueBestBall.ts).
 * One read of the leagues the portfolio names; a failed read drops nothing.
 */
async function dropBestBallAppearances(portfolio: AlertPortfolio): Promise<AlertPortfolio> {
  const ids = [...new Set(portfolio.items.flatMap((item) => item.leagueAppearances.map((a) => a.canonicalLeagueId)))]
  if (ids.length === 0) return portfolio
  const [{ prisma }, { isBestBallLeagueRow }] = await Promise.all([import('@/lib/prisma'), import('@/lib/core-app/leagueBestBall')])
  const leagues = await prisma.league
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, bestBallMode: true, leagueVariant: true, leagueType: true, settings: true } })
    .catch(() => [])
  return withoutBestBallAppearances(portfolio, new Set(leagues.filter((l) => isBestBallLeagueRow(l)).map((l) => l.id)))
}

/** Pure: the portfolio with every appearance in a best-ball league removed. */
export function withoutBestBallAppearances(portfolio: AlertPortfolio, bestBallLeagueIds: ReadonlySet<string>): AlertPortfolio {
  if (bestBallLeagueIds.size === 0) return portfolio
  return {
    ...portfolio,
    items: portfolio.items.map((item) => ({
      ...item,
      leagueAppearances: item.leagueAppearances.filter((a) => !bestBallLeagueIds.has(a.canonicalLeagueId)),
    })),
  }
}

/**
 * Re-check Sleeper against the provider's lineup for the league's current scoring week.
 * The portfolio is a useful cross-league cache, but it can lag a lineup move. An alert that
 * says a benched player is "still starting" is worse than no alert, so Sleeper appearances
 * fail closed when the live roster/week cannot be verified.
 */
async function verifySleeperLineupAssignments(
  portfolio: AlertPortfolio,
  appUserId: string,
): Promise<AlertPortfolio> {
  const sleeperLeagueIds = new Set(
    portfolio.items.flatMap((item) => item.leagueAppearances)
      .filter((appearance) => appearance.provider === 'sleeper')
      .map((appearance) => appearance.canonicalLeagueId),
  )
  if (sleeperLeagueIds.size === 0) return portfolio

  const [{ prisma }, { resolveLinkedPlatformUserIds }, { currentSleeperRoster }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/shared-services/game-day/UserPlayerExposureService'),
    import('@/lib/core-app/currentSleeperRoster'),
  ])
  const linkedIds = await resolveLinkedPlatformUserIds(appUserId)
  if (linkedIds.length === 0) return withoutUnverifiedSleeperAppearances(portfolio, new Map())

  const rosters = await prisma.roster.findMany({
    where: { leagueId: { in: [...sleeperLeagueIds] }, platformUserId: { in: linkedIds } },
    select: {
      leagueId: true,
      platformUserId: true,
      league: { select: { platform: true, platformLeagueId: true } },
    },
  })
  const liveByLeague = new Map<string, { starters: Set<string>; players: Set<string> }>()
  await Promise.all(rosters.map(async (roster) => {
    if (String(roster.league.platform).toLowerCase() !== 'sleeper') return
    const live = await currentSleeperRoster(roster.league.platformLeagueId, {
      platformUserId: roster.platformUserId,
    }).catch(() => null)
    if (!live || !Array.isArray(live.starters) || !Array.isArray(live.players)) return
    liveByLeague.set(roster.leagueId, {
      starters: new Set(live.starters.filter((id): id is string => typeof id === 'string' && id !== '0')),
      players: new Set(live.players.filter((id): id is string => typeof id === 'string')),
    })
  }))
  return withoutUnverifiedSleeperAppearances(portfolio, liveByLeague)
}

export function withoutUnverifiedSleeperAppearances(
  portfolio: AlertPortfolio,
  liveByLeague: Map<string, { starters: Set<string>; players: Set<string> }>,
): AlertPortfolio {
  return {
    ...portfolio,
    items: portfolio.items.map((item) => ({
      ...item,
      leagueAppearances: item.leagueAppearances.flatMap((appearance) => {
        if (appearance.provider !== 'sleeper') return [appearance]
        const live = liveByLeague.get(appearance.canonicalLeagueId)
        if (!live || !live.players.has(appearance.playerId)) return []
        return [{ ...appearance, rosterStatus: live.starters.has(appearance.playerId) ? 'starter' : 'bench' }]
      }),
    })),
  }
}
