import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import type { LiveEvent } from '@/lib/live/eventDetector'
import { headlineFor } from '@/lib/live/playFeedPresentation'

/**
 * Turn live play events into notifications — but only for the managers who
 * actually START the player.
 *
 * ⚠ THE ROSTER SCOPE IS THE WHOLE FEATURE. An alert for every 20-yard run in
 * the league is a notification every few seconds on a Sunday, which trains
 * people to mute the app. Sleeper feels good because it tells you about YOUR
 * players. Everything below exists to keep that true.
 *
 * User decision, 2026-09-13: every score and every play of 20+ yards, to the
 * managers STARTING the player (a benched player's touchdown scores nothing for
 * you), by push + the in-app bell — never email or SMS.
 *
 * ⚠ NEVER ALERT ON A NEGATIVE DELTA. A cumulative stat going DOWN is a stat
 * correction, not a play — the vendor reprocesses for ~12h after a game and
 * ships no correction flag, so a revision is indistinguishable from a new event
 * except by its sign. Without this guard a correction fires a phantom
 * "20-yard run" for a run that was taken away.
 */

/**
 * What we will interrupt someone's Sunday for.
 *
 * FIELD_GOAL was deliberately excluded until 2026-09-13 ("the kicker's owner
 * cares, nobody else does"). The recipients are now exactly the managers
 * starting that kicker, which is the one audience that argument granted, and the
 * user asked for every score.
 */
const ALERTABLE: ReadonlySet<LiveEvent['type']> = new Set([
  'TOUCHDOWN',
  'BIG_PLAY',
  'FIELD_GOAL',
  'DEFENSIVE_SCORE',
  'SPECIAL_TEAMS_SCORE',
  'TURNOVER',
])

/**
 * Slots that do not score. Redraft rows spell them in both cases ('bench' and
 * 'BENCH' are both written by different engines), so every spelling seen in the
 * code is listed rather than trusting one.
 */
const NON_STARTER_SLOTS = [
  'bench', 'BENCH', 'Bench',
  'ir', 'IR',
  'taxi', 'TAXI',
  'devy', 'DEVY',
  'free_agent',
  'pro_bench', 'pro_ir', 'college',
]

export type NotifyResult = {
  eventsConsidered: number
  eventsAlertable: number
  notificationsSent: number
  skipped: 'no-events' | 'no-rosters' | null
}

/**
 * Map players to the users who roster them — or, with `startersOnly`, who have
 * them in a starting lineup — for active seasons only.
 *
 * A dropped player keeps his row until `droppedAt` is set, so filtering on it
 * is what stops a manager being told about someone they cut last week.
 *
 * Exported for reuse by the injury importer — same recipients question, same
 * id-space rules (Rolling Insights ids in, AF user ids out; no identity row,
 * no guess). The importer wants the whole roster, so `startersOnly` defaults off.
 */
export async function ownersByPlayerId(
  playerIds: string[],
  opts: { startersOnly?: boolean } = {},
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (playerIds.length === 0) return out

  /*
   * ⚠ THE FEED AND THE ROSTERS SPEAK DIFFERENT ID LANGUAGES. Play events carry
   * Rolling Insights ids; redraft roster rows carry the draft pick's SLEEPER
   * id. Both are numeric strings, so joining them directly does not fail — it
   * silently matches the wrong player, or nobody. Cross through
   * PlayerIdentityMap once here and share the translation with both branches.
   * A player with no identity row is skipped, not guessed at.
   */
  const identities = await prisma.playerIdentityMap
    .findMany({
      where: { rollingInsightsId: { in: playerIds }, sleeperId: { not: null } },
      select: { rollingInsightsId: true, sleeperId: true },
    })
    .catch(() => [])

  const riIdBySleeperId = new Map<string, string>()
  for (const identity of identities) {
    if (identity.rollingInsightsId && identity.sleeperId) {
      riIdBySleeperId.set(identity.sleeperId, identity.rollingInsightsId)
    }
  }
  if (riIdBySleeperId.size === 0) return out

  const rows = await prisma.redraftRosterPlayer
    .findMany({
      where: {
        playerId: { in: [...riIdBySleeperId.keys()] },
        droppedAt: null,
        roster: { season: { status: 'active' } },
        ...(opts.startersOnly ? { NOT: { slotType: { in: NON_STARTER_SLOTS } } } : {}),
      },
      select: { playerId: true, roster: { select: { ownerId: true } } },
    })
    .catch(() => [])

  for (const row of rows) {
    const owner = row.roster?.ownerId
    if (!owner) continue
    const riId = riIdBySleeperId.get(row.playerId)
    if (!riId) continue
    const list = out.get(riId) ?? []
    // One manager can hold the same player in several leagues; one alert is
    // enough, so the owner list is deduped per player.
    if (!list.includes(owner)) list.push(owner)
    out.set(riId, list)
  }

  /*
   * ⚠ IMPORTED LEAGUES ARE THE MAJORITY AND LIVE IN A DIFFERENT SHAPE. Redraft
   * rosters are relational rows; imported (Sleeper) rosters are a JSON blob on
   * `Roster.playerData`, holding SLEEPER player ids under `.players` (the whole
   * roster) and `.starters` (the lineup). Measured: 205 redraft roster rows
   * against 914 imported ones. Querying only the first means the feature fires
   * for a fifth of the league and looks broken to everyone else.
   *
   * The ids do not match either — the play feed speaks Rolling Insights ids —
   * so this crosses through PlayerIdentityMap, which carries both spellings on
   * the same row. A player with no identity row is skipped, not guessed at.
   */
  await addImportedLeagueOwners(identities, out, opts.startersOnly === true)
  return out
}

/*
 * Two fixed statements rather than one with an interpolated key: the JSON key is
 * never built from a string at runtime, so there is nothing to inject into.
 */
const ROSTERED_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         WHERE r."playerData"->'players' @> $1::jsonb`
const STARTING_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         WHERE r."playerData"->'starters' @> $1::jsonb`

/**
 * Resolve imported-league owners for the same players.
 *
 * Uses a JSONB containment test rather than loading every roster: `@>` asks
 * whether the array contains that id, which Postgres can answer without us
 * pulling 914 blobs into memory every poll.
 */
async function addImportedLeagueOwners(
  identities: Array<{ rollingInsightsId: string | null; sleeperId: string | null }>,
  out: Map<string, string[]>,
  startersOnly: boolean,
): Promise<void> {
  try {
    if (identities.length === 0) return

    // riId → the Sleeper user ids rostering that player on imported leagues.
    const sleeperOwnersByRiId = new Map<string, string[]>()
    for (const identity of identities) {
      const riId = identity.rollingInsightsId
      const sleeperId = identity.sleeperId
      if (!riId || !sleeperId) continue

      const rosters = await prisma.$queryRawUnsafe<Array<{ platformUserId: string }>>(
        startersOnly ? STARTING_SQL : ROSTERED_SQL,
        JSON.stringify([sleeperId]),
      )

      const list = sleeperOwnersByRiId.get(riId) ?? []
      for (const row of rosters) {
        if (row.platformUserId && !list.includes(row.platformUserId)) {
          list.push(row.platformUserId)
        }
      }
      if (list.length > 0) sleeperOwnersByRiId.set(riId, list)
    }
    if (sleeperOwnersByRiId.size === 0) return

    /*
     * ⚠ platformUserId, NOT our user id. On an imported league this is the
     * SLEEPER user id, and NOTHING downstream resolves it — the dispatcher
     * looks profiles up by our user id and silently skips ids it does not
     * know. Translate here through UserProfile.sleeperUserId. A Sleeper
     * manager who never linked an AF account has nowhere to receive the
     * alert and is skipped.
     */
    const sleeperUserIds = [...new Set([...sleeperOwnersByRiId.values()].flat())]
    const profiles = await prisma.userProfile.findMany({
      where: { sleeperUserId: { in: sleeperUserIds } },
      select: { userId: true, sleeperUserId: true },
    })
    const userIdBySleeperId = new Map<string, string>()
    for (const profile of profiles) {
      if (profile.sleeperUserId) userIdBySleeperId.set(profile.sleeperUserId, profile.userId)
    }

    for (const [riId, sleeperOwners] of sleeperOwnersByRiId) {
      const list = out.get(riId) ?? []
      for (const sleeperUserId of sleeperOwners) {
        const userId = userIdBySleeperId.get(sleeperUserId)
        if (userId && !list.includes(userId)) list.push(userId)
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
    case 'FIELD_GOAL':
      return 'Field goal'
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
  if (event.type === 'TURNOVER' || event.type === 'FIELD_GOAL') return 'medium'
  return 'low'
}

/**
 * The same play told from the passer's side: "Kirk Cousins 34-yard TD pass to
 * Drake London". A passing touchdown scores for the QB's managers too, and the
 * play event is keyed on the receiver, so without this they heard nothing.
 */
function passerSide(event: LiveEvent): LiveEvent | null {
  if (!event.passerId || !event.passerName) return null
  if (event.type !== 'TOUCHDOWN' && event.type !== 'BIG_PLAY') return null
  return {
    ...event,
    playerId: event.passerId,
    playerName: event.passerName,
    role: 'passer',
    passerId: null,
    passerName: null,
    receiverName: event.playerName,
  }
}

function notificationFor(event: LiveEvent, userIds: string[], side: 'subject' | 'passer'): NotificationEvent {
  return {
    type: 'live_score_swing',
    title: notificationTitleFor(event),
    body: headlineFor(event, null),
    userIds,
    severity: severityFor(event),
    source: 'live-plays',
    actionHref: '/core/live?sport=NFL',
    actionLabel: 'Live scores',
    /*
     * ⚠ NEVER EMAIL A BIG PLAY. The category default is in-app + email, and
     * an email per play on a Sunday is an inbox flood that burns the sending
     * domain. In-app + push (matchup_results is a push category) is the
     * whole interrupt.
     */
    skipChannels: { email: true, sms: true },
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
       *
       * It is also what makes each play its OWN notification in the engine's
       * cooldown key — see `buildSourceKey`.
       */
      idempotencyKey: event.idempotencyKey,
      /*
       * One device notification per play. The dispatcher's default tag is one
       * per category, so a second touchdown would silently replace the first on
       * the phone before anyone read it.
       */
      pushTag: `live-play:${event.idempotencyKey}:${side}`,
    },
  }
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

  const ids = new Set<string>()
  for (const e of alertable) {
    ids.add(e.playerId)
    if (e.passerId) ids.add(e.passerId)
  }
  const owners = await ownersByPlayerId([...ids], { startersOnly: true })
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
    const subjectUsers = owners.get(event.playerId) ?? []
    if (subjectUsers.length > 0) batch.push(notificationFor(event, subjectUsers, 'subject'))

    const thrown = passerSide(event)
    if (thrown) {
      // A manager starting both ends of the play hears it once, from the scorer's side.
      const passerUsers = (owners.get(thrown.playerId) ?? []).filter((u) => !subjectUsers.includes(u))
      if (passerUsers.length > 0) batch.push(notificationFor(thrown, passerUsers, 'passer'))
    }
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
