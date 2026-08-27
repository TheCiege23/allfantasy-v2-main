import type { LiveEvent } from '@/lib/live/eventDetector'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'

/**
 * WHO LEADS A STAT RIGHT NOW, DERIVED FROM THE PLAY-BY-PLAY FEED.
 *
 * ⚠ THE INGESTION WAS NEVER THE MISSING PIECE. `refreshPlayByPlayFeed` has been
 * polling live games on the score cron and writing `LiveEvent` rows carrying
 * `playerId`, `playerName`, `stat` and — critically — `value`, the player's
 * CUMULATIVE total after that play. Production holds real parsed drives. What
 * was missing was anything that read them to answer a question, so "who has the
 * most TDs today?" was refused as unanswerable while the answer sat in cache.
 *
 * ⚠ TAKE THE MAXIMUM CUMULATIVE VALUE, NEVER THE SUM OF DELTAS. Polling plus
 * retries re-emit the same change — the feed's own `idempotencyKey` exists
 * because of it — so adding deltas double-counts a touchdown every time a poll
 * overlaps. `value` is already the running total; the newest one per player and
 * stat is the truth.
 *
 * ⚠ IT IS A SIX-HOUR ROLLING WINDOW OF AT MOST 200 EVENTS. That is a real limit,
 * not a detail: this can answer "today" and "right now" while games are on, and
 * it CANNOT answer "this week" or anything historical. Callers must say which
 * they are looking at rather than presenting a partial window as a full day.
 */

export type StatLeader = {
  playerId: string
  playerName: string
  team: string | null
  total: number
  /** Which stat keys made up the total, e.g. rushing + receiving touchdowns. */
  stats: string[]
}

export type StatFamily = 'touchdowns' | 'passing_yards' | 'rushing_yards' | 'receiving_yards'

const FAMILY_MATCHERS: Record<StatFamily, RegExp> = {
  touchdowns: /touchdown/i,
  passing_yards: /passing_yards/i,
  rushing_yards: /rushing_yards/i,
  receiving_yards: /receiving_yards/i,
}

/** Human label for an answer, so the reader knows exactly what was counted. */
export const FAMILY_LABEL: Record<StatFamily, string> = {
  touchdowns: 'touchdowns',
  passing_yards: 'passing yards',
  rushing_yards: 'rushing yards',
  receiving_yards: 'receiving yards',
}

/**
 * Aggregate a feed into per-player totals for one stat family.
 *
 * Exported separately from the read so it can be tested without a database and
 * so the aggregation rule above is verifiable on its own.
 */
export function leadersFromEvents(events: LiveEvent[], family: StatFamily): StatLeader[] {
  const matcher = FAMILY_MATCHERS[family]

  /* player -> stat -> highest cumulative value seen for that stat. */
  const byPlayer = new Map<string, { name: string; team: string | null; stats: Map<string, number> }>()

  for (const event of events) {
    if (!event?.stat || !matcher.test(event.stat)) continue

    /*
     * A negative cumulative value is a correction or a defensive stat sharing a
     * name; it is never a touchdown count. Dropping it beats reporting it.
     */
    if (typeof event.value !== 'number' || !Number.isFinite(event.value) || event.value <= 0) continue

    const key = event.playerId || event.playerName
    if (!key) continue

    const held = byPlayer.get(key) ?? {
      name: event.playerName || 'Unknown player',
      team: event.team ?? null,
      stats: new Map<string, number>(),
    }

    /* Newest cumulative wins; polls re-emit, so max is the safe reducer. */
    const previous = held.stats.get(event.stat) ?? 0
    if (event.value > previous) held.stats.set(event.stat, event.value)

    /* Team is often null early in a feed; keep the first real one seen. */
    if (!held.team && event.team) held.team = event.team

    byPlayer.set(key, held)
  }

  const leaders: StatLeader[] = []
  for (const [playerId, held] of byPlayer) {
    let total = 0
    for (const value of held.stats.values()) total += value
    if (total <= 0) continue
    leaders.push({
      playerId,
      playerName: held.name,
      team: held.team,
      total,
      stats: [...held.stats.keys()].sort(),
    })
  }

  /* Highest first; name breaks ties so repeated calls agree with each other. */
  leaders.sort((a, b) => b.total - a.total || a.playerName.localeCompare(b.playerName))
  return leaders
}

/** Which stat family a question is asking about, or null if it is not one. */
export function detectStatFamily(message: string): StatFamily | null {
  if (/\b(td|tds|touchdown|touchdowns)\b/i.test(message)) return 'touchdowns'
  if (/\bpassing yards?\b/i.test(message)) return 'passing_yards'
  if (/\brushing yards?\b/i.test(message)) return 'rushing_yards'
  if (/\breceiving yards?\b/i.test(message)) return 'receiving_yards'
  return null
}

export type StatLeaderResult = {
  family: StatFamily
  leaders: StatLeader[]
  /** How many events the window held, so an empty answer can explain itself. */
  eventsScanned: number
}

/**
 * Read the current leaders for a stat family.
 *
 * An empty `leaders` list with `eventsScanned: 0` means the feed is empty or has
 * aged out — no live games, or none in the last six hours. That is a different
 * statement from "nobody has scored", and callers must not collapse the two.
 */
export async function readStatLeaders(
  family: StatFamily,
  limit = 5,
): Promise<StatLeaderResult> {
  /* The whole retained window, not the default 20 — a leaderboard needs all of it. */
  const events = await readPlayByPlayFeed(200).catch(() => [] as LiveEvent[])
  const leaders = leadersFromEvents(events, family).slice(0, Math.max(1, limit))
  return { family, leaders, eventsScanned: events.length }
}
