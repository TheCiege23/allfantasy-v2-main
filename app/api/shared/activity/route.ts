import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getActivityLeaguesForUser } from "@/lib/dashboard/get-dashboard-league-list"
import {
  getAllPlayers,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
  getNflState,
  getPlayerName,
  type SleeperTransaction,
} from "@/lib/sleeper-client"
import type { ActivityFeedItem, ActivitySourceContext } from "@/lib/activity/types"
import { mergeActivityItems } from "@/lib/activity/merge"
import { collectNativeLeagueActivity } from "@/lib/activity/sources/nativeLeagueActivity"
import { collectRosterInjuryActivity } from "@/lib/activity/sources/rosterInjuryActivity"
import { consumeRateLimit } from "@/lib/rate-limit"
import {
  buildActivityCacheKey,
  getCachedActivityFeed,
  setCachedActivityFeed,
} from "@/lib/activity/activity-response-cache"

export const dynamic = "force-dynamic"

// Per-user request budget for this endpoint. Keyed on the viewer's userId *alone* (not the
// per-league query params), so every card in a dashboard fan-out shares one bucket — a tab that
// mounts hundreds of MyLeagueCard polls can't multiply its way past this. The incident that
// motivated it: a pre-deploy client bundle polled this route at ~6 req/s for 29+ hours and
// exhausted production Postgres (53200 out of memory); a server deploy can't fix an already-loaded
// bundle, so the endpoint caps itself. Cache hits are served *before* this check (they cost no
// Postgres), so a steadily-polling dashboard warms up and stays populated without ever tripping it.
const ACTIVITY_RATE_LIMIT_MAX = 1
const ACTIVITY_RATE_LIMIT_WINDOW_MS = 10_000

// Bounds how many of the viewer's Sleeper leagues get a live transactions call per request —
// this endpoint is polled every ~90s by useActivityFeed, so an unbounded per-league fetch
// fan-out isn't worth the real per-request cost for what's meant to be a lightweight feed.
const MAX_LEAGUES_TO_CHECK = 6
const WEEKS_TO_CHECK = 2

function describeTransaction(
  tx: SleeperTransaction,
  rosterNames: Map<number, string>,
  players: Record<string, unknown>
): { type: ActivityFeedItem["type"]; description: string } {
  const playerName = (id: string) => getPlayerName(players as never, id)
  const teamsInvolved = tx.roster_ids.map((rid) => rosterNames.get(rid) ?? `Team ${rid}`)

  if (tx.type === "trade") {
    const summary = tx.roster_ids
      .map((rid) => {
        const gained = Object.entries(tx.adds ?? {})
          .filter(([, ownerRid]) => ownerRid === rid)
          .map(([pid]) => playerName(pid))
        return gained.length > 0 ? `${rosterNames.get(rid) ?? `Team ${rid}`} gets ${gained.join(", ")}` : null
      })
      .filter((s): s is string => Boolean(s))
      .join(" · ")
    return { type: "trade", description: summary || `Trade between ${teamsInvolved.join(" and ")}` }
  }

  const added = Object.keys(tx.adds ?? {}).map(playerName)
  const dropped = Object.keys(tx.drops ?? {}).map(playerName)
  const team = teamsInvolved[0] ?? "A team"
  const parts: string[] = []
  if (added.length > 0) parts.push(`added ${added.join(", ")}`)
  if (dropped.length > 0) parts.push(`dropped ${dropped.join(", ")}`)
  const verb = tx.type === "waiver" ? "Waiver claim" : "Free agent move"
  return { type: "waiver", description: `${verb}: ${team} ${parts.join(", ") || "made a roster move"}` }
}

/**
 * Source 1 — live Sleeper transactions (trades, waiver claims, free-agent moves) for the
 * viewer's connected Sleeper leagues, via Sleeper's real /league/{id}/transactions/{week}
 * endpoint. Sleeper-imported leagues only ever stored point-in-time season snapshots
 * (LegacyLeague/LegacyRoster), not a transaction log, so there was nothing to aggregate from
 * the DB — this fetches live instead, bounded by MAX_LEAGUES_TO_CHECK / WEEKS_TO_CHECK. Returns
 * [] (never throws) on any failure so one bad source can't sink the merged feed.
 */
async function collectSleeperActivity(ctx: ActivitySourceContext): Promise<ActivityFeedItem[]> {
  try {
    let sleeperLeagues = ctx.leagues.filter(
      (l) => l.platform === "sleeper" && typeof l.platformLeagueId === "string" && l.platformLeagueId
    )
    if (ctx.leagueIdFilter) {
      sleeperLeagues = sleeperLeagues.filter(
        (l) => l.id === ctx.leagueIdFilter || l.platformLeagueId === ctx.leagueIdFilter
      )
    }
    // Prefer leagues that are actually in season — most likely to have real recent activity.
    sleeperLeagues.sort((a, b) => (b.status === "in_season" ? 1 : 0) - (a.status === "in_season" ? 1 : 0))
    sleeperLeagues = sleeperLeagues.slice(0, MAX_LEAGUES_TO_CHECK)

    if (sleeperLeagues.length === 0) return []

    const nflState = await getNflState()
    const currentWeek = Math.max(1, Number(nflState?.week) || 1)
    const weeksToFetch = Array.from({ length: WEEKS_TO_CHECK }, (_, i) => currentWeek - i).filter((w) => w >= 1)

    const players = await getAllPlayers()
    const items: ActivityFeedItem[] = []

    await Promise.all(
      sleeperLeagues.map(async (league) => {
        const leagueId = league.platformLeagueId as string
        const [users, rosters] = await Promise.all([getLeagueUsers(leagueId), getLeagueRosters(leagueId)])
        const userById = new Map(users.map((u) => [u.user_id, u.display_name || u.username]))
        const rosterNames = new Map<number, string>()
        for (const r of rosters) {
          if (r.owner_id) rosterNames.set(r.roster_id, userById.get(r.owner_id) ?? `Team ${r.roster_id}`)
        }

        const perWeek = await Promise.all(weeksToFetch.map((w) => getLeagueTransactions(leagueId, w)))
        const txs = perWeek.flat().filter((t) => t.status === "complete")

        for (const tx of txs) {
          const { type, description } = describeTransaction(tx, rosterNames, players)
          items.push({
            id: `sleeper:${tx.transaction_id}`,
            type,
            userId: "",
            userName: rosterNames.get(tx.roster_ids[0]) ?? "League",
            avatarUrl: null,
            description,
            timestamp: new Date(tx.status_updated || tx.created).toISOString(),
            leagueId: league.id ?? leagueId,
            leagueName: league.name ?? null,
            source: "sleeper",
          })
        }
      })
    )

    return items
  } catch (err) {
    console.error("[api/shared/activity] Sleeper source failed:", err)
    return []
  }
}

/**
 * GET /api/shared/activity
 * League Buzz — a real, cross-source activity feed. Resolves the viewer's leagues once, then
 * fans out to independent sources (live Sleeper transactions + native AF league DB events +
 * injuries on the viewer's rosters). Each source is isolated (Promise.allSettled) and returns
 * only real events; a source with no real feed contributes nothing — nothing is ever fabricated.
 * Falls back to an honest empty response when the viewer has no session or no activity.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "50"), 100)
  const leagueIdFilter = req.nextUrl.searchParams.get("leagueId") || undefined

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ status: "ok", items: [] })
  }

  // 1) Coalesce: an identical poll that's already been computed this window is served from memory,
  //    never re-opening a Postgres connection. Keyed on the full response signature so a cached
  //    feed is only ever returned for the exact params it was computed for.
  const cacheKey = buildActivityCacheKey(userId, leagueIdFilter, limit)
  const cached = getCachedActivityFeed(cacheKey)
  if (cached) {
    return NextResponse.json({ status: "ok", items: cached }, { headers: { "X-Cache": "HIT" } })
  }

  // 2) Throttle: only genuine cache misses reach Postgres, so the rate limit is what bounds a
  //    single session's DB load. Keyed on userId alone (see ACTIVITY_RATE_LIMIT_* above).
  const rl = consumeRateLimit({
    scope: "shared",
    action: "activity",
    sleeperUsername: userId,
    maxRequests: ACTIVITY_RATE_LIMIT_MAX,
    windowMs: ACTIVITY_RATE_LIMIT_WINDOW_MS,
  })
  if (!rl.success) {
    // Honest-empty under back-pressure: we decline to compute rather than fabricate. The client
    // (useActivityFeed) reads `items` and keeps rendering; the next poll retries once the window
    // clears, by which point a warmed cache entry usually serves it.
    return NextResponse.json(
      { status: "rate_limited", items: [], retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(Math.max(1, rl.retryAfterSec)) } }
    )
  }

  try {
    // Lean resolver: only the native + real Sleeper leagues the activity sources can produce events
    // for — NOT the full dashboard list. Skips the AF Legacy board + season-max groupBy that made
    // this ~90s-polled endpoint a primary contributor to the 53200 OOM. See getActivityLeaguesForUser.
    const leagues = await getActivityLeaguesForUser(userId)
    const ctx: ActivitySourceContext = {
      userId,
      leagues,
      leagueIdFilter,
      limit,
    }

    // Each source is independent: one failing (or empty) must never sink the others.
    const results = await Promise.allSettled([
      collectSleeperActivity(ctx),
      collectNativeLeagueActivity(ctx),
      collectRosterInjuryActivity(ctx),
    ])

    const perSource = results.map((r) => (r.status === "fulfilled" ? r.value : []))
    const items = mergeActivityItems(perSource, limit)

    // Cache the successful aggregation (an honest-empty feed included) so the next identical poll
    // skips Postgres entirely. The error path below is intentionally never cached.
    setCachedActivityFeed(cacheKey, items)

    return NextResponse.json({ status: "ok", items }, { headers: { "X-Cache": "MISS" } })
  } catch (err) {
    console.error("[api/shared/activity] aggregation failed:", err)
    return NextResponse.json({ status: "ok", items: [] })
  }
}
