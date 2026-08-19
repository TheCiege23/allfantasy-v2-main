import { prisma } from '@/lib/prisma'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'
import type { LiveEvent } from '@/lib/live/eventDetector'

/**
 * Turn the raw play feed into something renderable.
 *
 * ⚠ THIS IS THE HALF THAT WAS MISSING. `refreshPlayByPlayFeed` has been polling
 * Rolling Insights, parsing plays and storing events since the live tick was
 * wired — but `readPlayByPlayFeed` had ZERO callers, so every play we paid to
 * fetch went straight into a cache nothing rendered. Ingestion without a reader
 * looks identical to a broken feed from the outside.
 *
 * Two things the raw `LiveEvent` cannot answer on its own:
 *   - a headshot: the event carries the Rolling Insights player id, not ours
 *   - a readable sentence: it carries `stat` + `delta`, not "ran for 17 yards"
 */

export type PlayFeedItem = {
  id: string
  gameId: string
  type: LiveEvent['type']
  playerName: string
  team: string | null
  /** Null for the ~85% of players with no headshot on file. Render initials. */
  imageUrl: string | null
  position: string | null
  /** Pre-composed for display, e.g. "Bijan Robinson ran for 17 yards". */
  headline: string
  yards: number | null
  detectedAt: string
}

/**
 * ⚠ THE FEED CARRIES ROLLING INSIGHTS IDS, NOT OURS. The join is
 * `PlayerIdentityMap.rollingInsightsId` — 1,933 rows, all populated — and never
 * on name. `player-and-roster-id-join-hazards` is explicit that a name is not a
 * safe key here: most same-name groups in this database are genuinely different
 * people, so a name join would confidently attach the wrong face to a highlight.
 *
 * When the id does not resolve we return the event WITHOUT an image rather than
 * guessing. A missing headshot is a cosmetic gap; the wrong headshot on a
 * touchdown alert is a visible, embarrassing error.
 */
async function resolveHeadshots(
  riPlayerIds: string[],
): Promise<Map<string, { imageUrl: string | null; position: string | null }>> {
  const out = new Map<string, { imageUrl: string | null; position: string | null }>()
  // `name:<x>` is the parser's fallback when a play carries no player id at all.
  const ids = [...new Set(riPlayerIds.filter((id) => id && !id.startsWith('name:')))]
  if (ids.length === 0) return out

  try {
    const identities = await prisma.playerIdentityMap.findMany({
      where: { rollingInsightsId: { in: ids } },
      select: { rollingInsightsId: true, canonicalName: true, position: true, sport: true },
    })
    if (identities.length === 0) return out

    /*
     * The identity map holds the crosswalk but not the image, so the headshot
     * comes from `Player`. Matched on normalised name WITHIN the sport, because
     * the identity map has no foreign key to Player — and scoped by sport
     * because `externalId` and names are only unique within one.
     */
    const names = identities.map((i) => i.canonicalName).filter(Boolean)
    const players = await prisma.player.findMany({
      where: { name: { in: names }, sport: 'NFL', imageUrl: { not: null } },
      select: { name: true, imageUrl: true, position: true },
    })
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]))

    for (const identity of identities) {
      if (!identity.rollingInsightsId) continue
      const hit = byName.get((identity.canonicalName ?? '').toLowerCase())
      out.set(identity.rollingInsightsId, {
        imageUrl: hit?.imageUrl ?? null,
        position: identity.position ?? hit?.position ?? null,
      })
    }
  } catch {
    // A headshot lookup must never break the feed. Plays without faces still
    // beat no plays.
    return out
  }
  return out
}

/**
 * The sentence a user actually reads.
 *
 * Built from `stat` + `delta` rather than a vendor description string, because
 * the play-by-play `description` is prose we do not control and often names the
 * team in a format that does not match ours.
 */
export function headlineFor(event: LiveEvent, position: string | null): string {
  const who = position ? `${event.playerName} (${position})` : event.playerName
  const yards = Math.round(event.delta)

  switch (event.type) {
    case 'TOUCHDOWN':
      if (event.stat.startsWith('passing')) return `${who} threw a touchdown`
      if (event.stat.startsWith('receiving')) return `${who} caught a touchdown`
      return `${who} scored a touchdown`
    case 'BIG_PLAY':
      if (event.stat.startsWith('receiving')) return `${who} caught a pass for ${yards} yards`
      if (event.stat.startsWith('passing')) return `${who} threw for ${yards} yards`
      return `${who} ran for ${yards} yards`
    case 'FIELD_GOAL':
      return `${who} hit a field goal`
    case 'TURNOVER':
      return `${who} turned it over`
    case 'DEFENSIVE_SCORE':
      return `${who} scored on defense`
    case 'SPECIAL_TEAMS_SCORE':
      return `${who} scored on special teams`
    default:
      return who
  }
}

/**
 * The renderable feed. Returns [] on a quiet day — an empty feed is the correct
 * answer on a Tuesday, not an error.
 */
export async function getPlayFeed(limit = 12): Promise<PlayFeedItem[]> {
  let events: LiveEvent[] = []
  try {
    events = await readPlayByPlayFeed(limit)
  } catch {
    return []
  }
  if (events.length === 0) return []

  const headshots = await resolveHeadshots(events.map((e) => e.playerId))

  return events.map((event) => {
    const extra = headshots.get(event.playerId)
    const position = extra?.position ?? null
    return {
      // The parser's idempotency key is already game+sequence+type, so it is a
      // stable React key and survives the same play being re-read each poll.
      id: event.idempotencyKey,
      gameId: event.gameId,
      type: event.type,
      playerName: event.playerName,
      team: event.team,
      imageUrl: extra?.imageUrl ?? null,
      position,
      headline: headlineFor(event, position),
      yards: Number.isFinite(event.delta) ? Math.round(event.delta) : null,
      detectedAt:
        event.detectedAt instanceof Date
          ? event.detectedAt.toISOString()
          : new Date(event.detectedAt).toISOString(),
    }
  })
}
