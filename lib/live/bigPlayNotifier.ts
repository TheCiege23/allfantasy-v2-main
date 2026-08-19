import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import type { LiveEvent } from '@/lib/live/eventDetector'
import { headlineFor } from '@/lib/live/playFeedPresentation'

/**
 * Turn live play events into notifications — but only for the managers who
 * actually roster the player.
 *
 * ⚠ THE ROSTER SCOPE IS THE WHOLE FEATURE. An alert for every 20-yard run in
 * the league is a notification every few seconds on a Sunday, which trains
 * people to mute the app. Sleeper feels good because it tells you about YOUR
 * players. Everything below exists to keep that true.
 *
 * ⚠ NEVER ALERT ON A NEGATIVE DELTA. A cumulative stat going DOWN is a stat
 * correction, not a play — the vendor reprocesses for ~12h after a game and
 * ships no correction flag, so a revision is indistinguishable from a new event
 * except by its sign. Without this guard a correction fires a phantom
 * "20-yard run" for a run that was taken away.
 */

/** What we will interrupt someone's Sunday for. */
const ALERTABLE: ReadonlySet<LiveEvent['type']> = new Set([
  'TOUCHDOWN',
  'BIG_PLAY',
  'DEFENSIVE_SCORE',
  'SPECIAL_TEAMS_SCORE',
  'TURNOVER',
])

/**
 * A field goal is a real event and a bad notification: the kicker's owner cares,
 * nobody else does, and it fires several times a game. Deliberately excluded
 * rather than forgotten.
 */

export type NotifyResult = {
  eventsConsidered: number
  eventsAlertable: number
  notificationsSent: number
  skipped: 'no-events' | 'no-rosters' | null
}

/**
 * Map players to the users who roster them, for active seasons only.
 *
 * A dropped player keeps his row until `droppedAt` is set, so filtering on it
 * is what stops a manager being told about someone they cut last week.
 */
async function ownersByPlayerId(playerIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (playerIds.length === 0) return out

  const rows = await prisma.redraftRosterPlayer
    .findMany({
      where: {
        playerId: { in: playerIds },
        droppedAt: null,
        roster: { season: { status: 'active' } },
      },
      select: { playerId: true, roster: { select: { ownerId: true } } },
    })
    .catch(() => [])

  for (const row of rows) {
    const owner = row.roster?.ownerId
    if (!owner) continue
    const list = out.get(row.playerId) ?? []
    // One manager can hold the same player in several leagues; one alert is
    // enough, so the owner list is deduped per player.
    if (!list.includes(owner)) list.push(owner)
    out.set(row.playerId, list)
  }

  /*
   * ⚠ IMPORTED LEAGUES ARE THE MAJORITY AND LIVE IN A DIFFERENT SHAPE. Redraft
   * rosters are relational rows; imported (Sleeper) rosters are a JSON blob on
   * `Roster.playerData`, holding SLEEPER player ids under `.players`. Measured:
   * 205 redraft roster rows against 914 imported ones. Querying only the first
   * means the feature fires for a fifth of the league and looks broken to
   * everyone else.
   *
   * The ids do not match either — the play feed speaks Rolling Insights ids —
   * so this crosses through PlayerIdentityMap, which carries both spellings on
   * the same row. A player with no identity row is skipped, not guessed at.
   */
  await addImportedLeagueOwners(playerIds, out)
  return out
}

/**
 * Resolve imported-league owners for the same players.
 *
 * Uses a JSONB containment test rather than loading every roster: `?` asks
 * whether the players array contains that id, which Postgres can answer
 * without us pulling 914 blobs into memory every poll.
 */
async function addImportedLeagueOwners(
  riPlayerIds: string[],
  out: Map<string, string[]>,
): Promise<void> {
  try {
    const identities = await prisma.playerIdentityMap.findMany({
      where: { rollingInsightsId: { in: riPlayerIds }, sleeperId: { not: null } },
      select: { rollingInsightsId: true, sleeperId: true },
    })
    if (identities.length === 0) return

    for (const identity of identities) {
      const riId = identity.rollingInsightsId
      const sleeperId = identity.sleeperId
      if (!riId || !sleeperId) continue

      const rosters = await prisma.$queryRawUnsafe<Array<{ platformUserId: string }>>(
        `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         WHERE r."playerData"->'players' @> $1::jsonb`,
        JSON.stringify([sleeperId]),
      )

      const list = out.get(riId) ?? []
      for (const row of rosters) {
        /*
         * ⚠ platformUserId, NOT our user id. On an imported league this is the
         * SLEEPER user id — the notification layer resolves it. Treating it as
         * our own uuid would silently address nobody.
         */
        if (row.platformUserId && !list.includes(row.platformUserId)) {
          list.push(row.platformUserId)
        }
      }
      if (list.length > 0) out.set(riId, list)
    }
  } catch {
    // Imported-league resolution is additive. If it fails, redraft managers
    // still get their alerts rather than nobody getting any.
  }
}

/** The line a manager actually reads on their phone. */
export function notificationTitleFor(event: LiveEvent): string {
  switch (event.type) {
    case 'TOUCHDOWN':
      return 'Touchdown'
    case 'BIG_PLAY':
      return 'Big play'
    case 'DEFENSIVE_SCORE':
      return 'Defensive touchdown'
    case 'SPECIAL_TEAMS_SCORE':
      return 'Special teams touchdown'
    case 'TURNOVER':
      return 'Turnover'
    default:
      return 'Live update'
  }
}

/**
 * A touchdown is worth waking someone up for. A 21-yard catch is not, quite.
 */
function severityFor(event: LiveEvent): NotificationEvent['severity'] {
  if (event.type === 'TOUCHDOWN' || event.type === 'DEFENSIVE_SCORE' || event.type === 'SPECIAL_TEAMS_SCORE') {
    return 'high'
  }
  if (event.type === 'TURNOVER') return 'medium'
  return 'low'
}

/**
 * Send notifications for a batch of live events.
 *
 * Returns counts rather than throwing: this runs on the game-day path behind
 * scoring, and a missed alert must never cost a score update.
 */
export async function notifyBigPlays(events: LiveEvent[]): Promise<NotifyResult> {
  if (events.length === 0) {
    return { eventsConsidered: 0, eventsAlertable: 0, notificationsSent: 0, skipped: 'no-events' }
  }

  const alertable = events.filter((e) => {
    if (!ALERTABLE.has(e.type)) return false
    // The correction guard. A stat that went down is a revision, not a play.
    if (typeof e.delta === 'number' && e.delta < 0) return false
    return true
  })

  if (alertable.length === 0) {
    return { eventsConsidered: events.length, eventsAlertable: 0, notificationsSent: 0, skipped: null }
  }

  const owners = await ownersByPlayerId([...new Set(alertable.map((e) => e.playerId))])
  if (owners.size === 0) {
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: 'no-rosters',
    }
  }

  const batch: NotificationEvent[] = []
  for (const event of alertable) {
    const userIds = owners.get(event.playerId)
    if (!userIds || userIds.length === 0) continue

    batch.push({
      type: 'live_score_swing',
      title: notificationTitleFor(event),
      body: headlineFor(event, null),
      userIds,
      severity: severityFor(event),
      source: 'live-plays',
      meta: {
        gameId: event.gameId,
        playerId: event.playerId,
        playerName: event.playerName,
        team: event.team,
        eventType: event.type,
        stat: event.stat,
        yards: Number.isFinite(event.delta) ? Math.round(event.delta) : null,
        /*
         * ⚠ CARRIED SO AN ALERT CAN BE RETRACTED. Officiating reversals happen
         * and the vendor ships no correction flag. Storing the key that
         * produced this notification is what lets a later reversal find it and
         * send a correction instead of leaving a manager believing a
         * touchdown that was overturned.
         */
        idempotencyKey: event.idempotencyKey,
      },
    })
  }

  if (batch.length === 0) {
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: 'no-rosters',
    }
  }

  try {
    await ingestBatch(batch)
  } catch {
    // A failed send must not take down the tick that produced the score.
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: null,
    }
  }

  return {
    eventsConsidered: events.length,
    eventsAlertable: alertable.length,
    notificationsSent: batch.length,
    skipped: null,
  }
}
