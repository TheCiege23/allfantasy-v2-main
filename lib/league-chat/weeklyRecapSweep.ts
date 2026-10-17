/**
 * Which Sleeper leagues the Tuesday recap sweep visits, and in what order. PURE — the cron reads the
 * inputs and walks the result.
 *
 * WHY. The sweep read `take: 100` leagues with no order, so Postgres handed back about the same hundred
 * every week. Measured on production 2026-10-12: 528 current-season Sleeper leagues, 421 of which had
 * NEVER received a recap. Lifting the cap is not enough on its own:
 *
 *   - A league already recapped this week must cost nothing on a later fire, so it is dropped up front
 *     (one indexed read in the cron) instead of after a head-to-head read and three Sleeper calls.
 *   - A league whose head-to-head history was never synced is EXPENSIVE: one call per week of every
 *     past season, up to twelve seasons. Four hundred of them at once runs into Sleeper's rate limit,
 *     and a rate-limited sync is cached with seasons missing. So at most `coldLimit` never-synced
 *     leagues are taken per fire; the rest wait for the next fire or the next week, when they are
 *     still first in line.
 *   - Leagues with more AllFantasy members go first: those are the ones where a recap in our chat can
 *     actually start a conversation, and they should not be the ones a time budget cuts off.
 */

export type SweepLeague = { id: string; platformLeagueId: string }

export type RecapSweepPlan<T extends SweepLeague> = {
  /** Visit in this order, until the time budget runs out. */
  order: T[]
  /** Already recapped this week — not visited at all. */
  alreadyDone: number
  /** Never synced, over this fire's cold limit — left for a later fire. */
  coldDeferred: number
}

export function planRecapSweep<T extends SweepLeague>(input: {
  leagues: readonly T[]
  /** AllFantasy league ids that already carry this week's recap. */
  recappedThisWeek: ReadonlySet<string>
  /** Sleeper league ids whose head-to-head history is already cached. */
  warmSleeperIds: ReadonlySet<string>
  /** AllFantasy league id → AllFantasy members (owner plus claimed teams). Missing counts as 1. */
  memberCounts: ReadonlyMap<string, number>
  coldLimit: number
}): RecapSweepPlan<T> {
  const todo = input.leagues.filter((l) => l.platformLeagueId && !input.recappedThisWeek.has(l.id))
  const alreadyDone = input.leagues.length - todo.length
  const members = (l: T) => input.memberCounts.get(l.id) ?? 1
  const sorted = [...todo].sort((a, b) => members(b) - members(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const order: T[] = []
  let cold = 0
  let coldDeferred = 0
  for (const l of sorted) {
    if (input.warmSleeperIds.has(l.platformLeagueId)) {
      order.push(l)
      continue
    }
    if (cold < Math.max(0, input.coldLimit)) {
      cold += 1
      order.push(l)
    } else {
      coldDeferred += 1
    }
  }
  return { order, alreadyDone, coldDeferred }
}

/**
 * The push that says a recap is ready — ONE per person per week, however many of their leagues got one.
 * Its job is to get the recap SHARED, so it says what is in it and where to send it.
 */
export function recapNotificationCopy(posted: ReadonlyArray<{ leagueId: string; leagueName: string; week: number }>): {
  title: string
  body: string
  actionHref: string
} | null {
  if (posted.length === 0) return null
  const first = posted[0]!
  if (posted.length === 1) {
    return {
      title: `Week ${first.week} recap: ${first.leagueName}`,
      body: 'Chimmy wrote up your league’s week. Share it in your group chat so everyone sees it.',
      actionHref: `/league/${first.leagueId}?openChat=league`,
    }
  }
  return {
    title: `Week ${first.week} recaps are in for ${posted.length} of your leagues`,
    body: `Starting with ${first.leagueName}. Share each one in that league’s group chat.`,
    actionHref: `/league/${first.leagueId}?openChat=league`,
  }
}
