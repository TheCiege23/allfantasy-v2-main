/**
 * Player News Notification Service
 *
 * When new player news arrives (injuries, trades, signings, suspensions),
 * this service finds all managers who roster that player across all leagues
 * and dispatches notifications to them.
 *
 * Notification channels:
 * - In-app notification (always)
 * - Push notification (if enabled)
 * - Email digest (if enabled, batched)
 *
 * Deduplication: same player + same category → max 1 notification per 2 hours
 */

import { prisma } from '@/lib/prisma'
import type { RunBudget } from '@/lib/cron/runBudget'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import type { NewsCategory } from '@/lib/workers/x-news-ingestion'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { classifyPlayerNewsCategory } from '@/lib/news/player-news-category'
import { listFollowerIdsForPlayer } from '@/lib/follows/playerFollows'
import { decidePlayerNewsEligibility } from '@/lib/notifications/playerNewsEligibility'
import {
  resolvePlayerNewsIdentity,
  resolvePlayerNewsRecipients,
} from '@/lib/notifications/playerNewsRecipients'
import {
  isRetryableOutcome,
  playerNewsContentHash,
  recordAttempt,
  shouldStampTerminally,
  type DispatchOutcome,
} from '@/lib/notifications/playerNewsAttemptLedger'
import {
  channelsToSkipFor,
  lookupAlreadyNotified,
  playerNewsDedupePrefix,
} from '@/lib/notifications/playerNewsDeliveryState'

type OptionalPlayerNewsNotificationModel = {
  findFirst?: (args: unknown) => Promise<unknown>
  create?: (args: unknown) => Promise<unknown>
  findMany?: (args: unknown) => Promise<unknown>
  updateMany?: (args: unknown) => Promise<unknown>
  count?: (args: unknown) => Promise<unknown>
}

function getPlayerNewsNotificationModel(): OptionalPlayerNewsNotificationModel | undefined {
  return (prisma as unknown as { playerNewsNotification?: OptionalPlayerNewsNotificationModel }).playerNewsNotification
}

export type PlayerNewsNotification = {
  userId: string
  leagueId: string
  playerName: string
  team: string | null
  headline: string
  category: NewsCategory
  impact: 'high' | 'medium' | 'low'
  sport: string
  createdAt: Date
}

const CATEGORY_ICONS: Record<string, string> = {
  injury: '🏥',
  suspension: '🚫',
  trade: '🔄',
  signing: '✍️',
  release: '📋',
  roster_move: '📋',
  team_news: '📢',
  player_news: '📰',
  game_update: '🏟️',
  coaching: '🏈',
}

const CATEGORY_LABELS: Record<string, string> = {
  injury: 'Injury Update',
  suspension: 'Suspension',
  trade: 'Trade Alert',
  signing: 'Signing',
  release: 'Released',
  roster_move: 'Roster Move',
  team_news: 'Team News',
  player_news: 'Player News',
  game_update: 'Game Update',
  coaching: 'Coaching News',
}

/**
 * Dispatch notifications for a new player news item.
 * Finds all managers who roster the player and notifies them.
 */
export async function dispatchPlayerNewsNotifications(
  playerName: string,
  team: string | null,
  headline: string,
  category: NewsCategory,
  impact: 'high' | 'medium' | 'low',
  sport: string,
): Promise<number> {
  /*
   * ⚠ THE SAME EMPTY-NAME BROADCAST LIVES HERE, DEFUSED RATHER THAN LEFT ARMED.
   *
   * This function is INERT today — `playerNewsNotification` is not in schema.prisma and not in
   * production, verified 2026-08-28, so it returns on the next line and has no callers. But its
   * roster query below is the same `contains: playerName` substring scan the live path was just
   * fixed for, and an empty name still means "every roster row". Whoever eventually adds that
   * model would arm a broadcast without touching this line.
   *
   * The guard costs nothing and changes no behaviour today. It is NOT a substitute for porting
   * this function onto `resolvePlayerNewsIdentity` before it is ever revived.
   */
  if (!String(playerName ?? '').trim()) return 0

  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification) return 0

  // Skip low-impact notifications unless injury
  if (impact === 'low' && category !== 'injury') return 0

  // Find all rosters containing this player across all leagues
  const rosterPlayers = await prisma.redraftRosterPlayer.findMany({
    where: {
      playerName: { contains: playerName, mode: 'insensitive' },
      droppedAt: null, // still on roster
    },
    select: {
      roster: {
        select: {
          ownerId: true,
          leagueId: true,
        },
      },
    },
    take: 500,
  }).catch(() => [])

  if (rosterPlayers.length === 0) return 0

  // Deduplicate: same player + category + user → max 1 per 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  let dispatched = 0

  const seen = new Set<string>()
  const icon = CATEGORY_ICONS[category] ?? '📰'
  const label = CATEGORY_LABELS[category] ?? 'News'
  const rowTitle = `${icon} ${label}: ${playerName}`
  const leaguesForFanout = new Set<string>()

  for (const rp of rosterPlayers) {
    const userId = rp.roster?.ownerId
    const leagueId = rp.roster?.leagueId
    if (!userId || !leagueId) continue

    const dedupeKey = `${userId}:${playerName}:${category}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    // Check for recent duplicate notification
    const existing = await playerNewsNotification.findFirst?.({
      where: {
        userId,
        playerName,
        category,
        createdAt: { gte: twoHoursAgo },
      },
    }).catch(() => null)

    if (existing) continue

    const body = headline.slice(0, 200)

    await playerNewsNotification.create?.({
      data: {
        userId,
        leagueId,
        playerName,
        team,
        headline: rowTitle,
        body,
        category,
        impact,
        sport,
        isRead: false,
      },
    }).catch(() => {})

    dispatched++
    leaguesForFanout.add(leagueId)
  }

  if (leaguesForFanout.size > 0) {
    const { emitPlayerInjuryOrNewsFanout } = await import('@/lib/realtime-events/realtimeEventService')
    const eventType = category === 'injury' ? 'player_injury_update' : 'player_news_update'
    const fanoutCategory: NotificationCategoryId =
      category === 'injury' ? 'injury_alerts' : 'league_announcements'
    for (const lid of leaguesForFanout) {
      void emitPlayerInjuryOrNewsFanout({
        leagueId: lid,
        eventType,
        title: rowTitle.slice(0, 256),
        message: headline.slice(0, 500),
        category: fanoutCategory,
        meta: { playerName, team, newsCategory: category, sport },
        dedupeKey: `player-news-fanout:${sport}:${playerName}:${category}:${lid}`,
        skipNotifications: true,
      }).catch(() => {})
    }
  }

  return dispatched
}

/**
 * Get unread news notifications for a user.
 */
export async function getUnreadNewsNotifications(
  userId: string,
  limit: number = 20,
): Promise<Array<{
  id: string
  playerName: string
  headline: string
  body: string
  category: string
  impact: string
  sport: string
  leagueId: string
  isRead: boolean
  createdAt: Date
}>> {
  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification?.findMany) return []

  return (await playerNewsNotification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      playerName: true,
      headline: true,
      body: true,
      category: true,
      impact: true,
      sport: true,
      leagueId: true,
      isRead: true,
      createdAt: true,
    },
  }) as Array<{
    id: string
    playerName: string
    headline: string
    body: string
    category: string
    impact: string
    sport: string
    leagueId: string
    isRead: boolean
    createdAt: Date
  }>)
}

/**
 * Mark notifications as read.
 */
export async function markNotificationsRead(
  userId: string,
  notificationIds: string[],
): Promise<void> {
  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification?.updateMany) return

  await playerNewsNotification.updateMany({
    where: { userId, id: { in: notificationIds } },
    data: { isRead: true, readAt: new Date() },
  })
}

/**
 * Mark all news notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification?.updateMany) return

  await playerNewsNotification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })
}

/**
 * Get notification count badge for a user.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification?.count) return 0

  const count = await playerNewsNotification.count({
    where: { userId, isRead: false },
  })
  return typeof count === 'number' ? count : 0
}

/* ------------------------------------------------------------------------- *
 * THE PATH THAT ACTUALLY DELIVERS
 *
 * ⚠ EVERYTHING ABOVE IS INERT. It reads `prisma.playerNewsNotification`, and that model
 * exists in NEITHER schema.prisma NOR the production database — verified against prod
 * 2026-08-28, where the notification tables are TradeNotification, notification_outbox,
 * platform_notifications, survivor_notifications and zombie_commissioner_notifications.
 * `getPlayerNewsNotificationModel()` therefore returns undefined and every function above
 * returns 0 on the first line, silently, forever.
 *
 * This one uses what is already deployed instead, which is why it needs no migration:
 *   - `PlayerNewsRecord.notificationDispatchedAt` — a column PURPOSE-BUILT for this, with
 *     the dedupe semantics spelled out in its own schema doc-comment, already present in
 *     production `player_news`.
 *   - `dispatchNotification` — the one wired entry point (live callers in league/chat,
 *     commissioner/broadcast, global-broadcast, cron/alert-sweep). It handles in-app +
 *     email + SMS against each user's category preferences and delivery availability,
 *     which the table-based path above never did.
 * ------------------------------------------------------------------------- */

/**
 * The stages of one pending-news sweep, counted separately.
 *
 * 🛑 "DISPATCHED" WAS ONE NUMBER DOING FIVE JOBS. The old return was
 * `{ scanned, notified, recipients, noRoster }`, where `notified` counted rows for which a
 * dispatch was ATTEMPTED — not rows anyone received. A row whose audience could not be
 * resolved, a row whose policy skipped it, and a row whose transport threw were all
 * indistinguishable in the cron's output, and every one of them was stamped
 * `notificationDispatchedAt` regardless.
 *
 * ⚠ WHAT THESE COUNTS DO AND DO NOT PROVE. `dispatchAttempted` means this process handed the
 * event to `dispatchNotification` with a resolved audience. It is NOT proof of provider
 * acceptance and certainly not proof that a phone displayed anything — the dispatcher returns
 * `void`, swallows transport errors and starts web push without awaiting it. Per-channel
 * delivery accounting is the next batch's work and is deliberately not claimed here.
 *
 * ⚠ EVERY CONSIDERED ROW IS STILL STAMPED, AND THAT IS ON PURPOSE. `player_news` holds ~11,765
 * rows and gains ~3,400 a week; leaving held rows unstamped would keep them at the front of a
 * `take: 40` window ordered by publish time and starve genuinely new items. The stamp means
 * "considered", and these counters are what stop that being read as "delivered". A later
 * confirmation of a held claim arrives as its OWN news row with its own id, so nothing is lost
 * by stamping the earlier one.
 */
export type PendingPlayerNewsDispatchResult = {
  /**
   * Rows actually considered, not rows fetched — otherwise a budget-truncated run reports the
   * same number as a complete one and the deferral is invisible in the response.
   */
  scanned: number
  /** Rows fetched but never considered because the budget ran out. Zero means the run completed. */
  deferred: number
  /** Rows an explicit policy declined to notify about (not material, or an unconfirmed trade). */
  policySkipped: number
  /** Rows whose subject could not be resolved to exactly one athlete, so they were HELD. */
  heldUnresolved: number
  /** Subset of `heldUnresolved` where more than one athlete matched. Never broadcast. */
  heldAmbiguous: number
  /** Eligible, identified rows with no rostering manager AND no follower — nobody to tell. */
  noRoster: number
  /**
   * RECIPIENT dispatches attempted — one per user per row, so it equals `recipients` by
   * construction. Use `notified` for the ROW count.
   *
   * ⚠ ITS DOC PREVIOUSLY SAID "rows", WHICH IT NEVER WAS. That is why
   * `policySkipped + heldUnresolved + noRoster + dispatchAttempted` does not partition
   * `scanned`, and why anyone sizing a per-row metric against it read a number an order of
   * magnitude too large.
   */
  dispatchAttempted: number
  /** Rows whose dispatch call threw. */
  dispatchFailed: number
  /** Distinct users a dispatch was attempted for, summed across rows. */
  recipients: number
  /** Of `recipients`, users told because they FOLLOW the player and roster him nowhere. */
  followerRecipients: number
  /** Imported rosters holding the athlete whose team has no linked AF account. */
  importedUnlinked: number
  /**
   * Rows left UNSTAMPED because their outcome can still be repaired — a missing identity row,
   * an ambiguous duplicate group, contradictory id/name evidence, or a dispatch that threw.
   * The next sweep will reconsider them.
   */
  retryScheduled: number
  /** Rows that used their whole retry budget without resolving and are now stamped. */
  retriesExhausted: number
  /**
   * Rows whose recipient lookup FAILED, so the empty audience was incomplete rather than empty.
   * Retryable. Previously reported as `noRoster` and stamped permanently.
   */
  recipientsUnavailable: number
  /**
   * Rows whose identity carried no id in any namespace we can search, so no roster store was
   * queried at all. Retryable — the identity sync back-filling an id changes the answer.
   * Previously reported as `noRoster` and stamped permanently.
   */
  recipientsUnsearchable: number
  /**
   * Rows where an audience WAS found and every member of it had the category, the league or
   * notifications globally muted. Nobody was reached — and this is deliberately not counted as
   * a delivery.
   */
  allSuppressed: number
  /** Recipients a preference gate skipped, summed across rows. */
  suppressedRecipients: number
  /**
   * Rows where the per-recipient delivery-state lookup failed, so email/SMS suppression could
   * not be decided from history and the sweep erred toward delivering. Bounded by the attempt
   * cap; reported so the choice is visible.
   */
  deliveryStateUnavailable: number
  /**
   * Imported platforms whose rosters were NOT searched, because this identity carries no id in
   * their namespace. Distinct from "searched and found nobody" — Yahoo, for instance, has no
   * player-id column in `PlayerIdentityMap` at all.
   */
  unsearchedPlatforms: string[]
  /** Ledger writes that failed. Informational — it no longer decides whether a row is stamped. */
  ledgerWriteFailures: number
  /**
   * ROWS for which a dispatch was attempted — the same unit the pre-existing `notified++` used.
   *
   * 🛑 THIS BRIEFLY BECAME A RECIPIENT COUNT AND THE DOC CLAIMED IT HAD NOT. Aliasing it to
   * `dispatchAttempted`, which increments once per USER, made one injury reaching 40 managers
   * report `notified: 40` where the old code reported `1` — a value that can exceed `scanned`
   * by an order of magnitude, serialized straight into the `/api/cron/import-news` response.
   * Use `dispatchAttempted` / `recipients` for the per-recipient figure.
   */
  notified: number
}

/**
 * Notify rostering managers about player news that has not been dispatched yet.
 *
 * Source-side dedupe is the `notificationDispatchedAt` stamp; recipient-side dedupe is
 * `dedupePrefix`, which collapses repeat in-app rows for the same story and user.
 */
export async function dispatchPendingPlayerNewsNotifications(input?: {
  limit?: number
  lookbackHours?: number
  sources?: string[]
  /**
   * Stop before the platform's 300s edge ceiling and leave the rest for the next fire.
   *
   * ⚠ THE COST PER ROW IS NOT A CONSTANT AND IT GREW UNDER US. A notified row costs an identity
   * lookup, a roster scan, a follower lookup and one `dispatchNotification` PER RECIPIENT, and
   * audience size only goes up. Measured across scheduled runs: a quiet run reported 330
   * recipients and finished in ~50s; once the season started the same limit of 40 rows produced
   * 1,265 and the handler ran to the ceiling. Nothing about the code changed.
   */
  budget?: RunBudget
}): Promise<PendingPlayerNewsDispatchResult> {
  const limit = input?.limit ?? 40
  const lookbackHours = input?.lookbackHours ?? 24
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)

  const rows = await prisma.playerNewsRecord
    .findMany({
      where: {
        notificationDispatchedAt: null,
        createdAt: { gte: since },
        // Only news worth interrupting someone for. Mirrors the rule the inert path
        // used: skip low impact unless it is an injury, which is classified below.
        ...(input?.sources?.length ? { source: { in: input.sources } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true, sport: true, playerId: true, playerName: true, team: true,
        headline: true, body: true, impact: true,
      },
    })
    .catch(() => [])

  let dispatchAttempted = 0
  let dispatchFailed = 0
  let recipients = 0
  let followerRecipients = 0
  let noRoster = 0
  let deferred = 0
  let considered = 0
  let policySkipped = 0
  let heldUnresolved = 0
  let heldAmbiguous = 0
  let importedUnlinked = 0
  let rowsDispatched = 0
  let ledgerWriteFailures = 0
  let retryScheduled = 0
  let retriesExhausted = 0
  let recipientsUnavailable = 0
  let allSuppressed = 0
  let suppressedRecipients = 0
  let deliveryStateUnavailable = 0
  let recipientsUnsearchable = 0
  const unsearchedPlatforms = new Set<string>()
  const stamped: string[] = []

  /**
   * Settle one row: record the attempt, then decide whether it is finished with.
   *
   * 🛑 THE STAMP NO LONGER MEANS "CONSIDERED". It means "do not look at this again", and only
   * a TERMINAL outcome — or a retryable one that has used its attempt budget — earns it. A
   * story held because the athlete had no identity row is left unstamped so the next sweep
   * reconsiders it after the identity sync has run; the same for an ambiguous group that gets
   * disambiguated, and for a dispatch that threw before any durable handoff.
   *
   * ⚠ AND THE STARVATION WORRY THAT ARGUED FOR STAMPING EVERYTHING WAS BACKWARDS. The candidate
   * query is `orderBy: publishedAt desc` with `take: limit`, so the NEWEST rows are selected
   * first — an unstamped backlog sits at the BACK of that ordering and is crowded out by new
   * work, not the reverse. The real cost of leaving rows unstamped is repeated re-examination,
   * and that is what `MAX_DISPATCH_ATTEMPTS` bounds.
   */
  const settle = async (
    row: { id: string; headline: string; body: string | null },
    outcome: DispatchOutcome,
  ): Promise<void> => {
    const hash = playerNewsContentHash(row.headline, row.body)
    const { attempts, persisted } = await recordAttempt(row.id, hash, outcome)
    if (!persisted) ledgerWriteFailures++
    if (shouldStampTerminally(outcome, attempts)) {
      stamped.push(row.id)
      if (isRetryableOutcome(outcome)) retriesExhausted++
    } else {
      retryScheduled++
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    /*
     * ⚠ CHECKED BEFORE ANYTHING IS RECORDED OR STAMPED, NOT AFTER. `settle` below writes an
     * attempt to the ledger and may stamp `notificationDispatchedAt` — so a check placed even
     * one step lower would record an attempt (or a terminal stamp) for a row this run never
     * looked at. The deferred rows stay untouched and the next fire finds them.
     */
    if (input?.budget?.exhausted()) {
      deferred = rows.length - i
      break
    }
    considered++

    const category = classifyPlayerNewsCategory(row.headline, row.body)
    const isInjury = category === 'injury'

    /*
     * Policy first, identity second, recipients third — in that order, because each stage is
     * more expensive than the one before it and because a policy skip and an unresolvable
     * subject are different outcomes that used to be the same `continue`.
     */
    const eligibility = decidePlayerNewsEligibility({
      category,
      impact: row.impact,
      headline: row.headline,
      body: row.body,
    })
    if (!eligibility.eligible) {
      policySkipped++
      await settle(row, 'policy-skipped')
      continue
    }

    const identity = await resolvePlayerNewsIdentity({
      sport: row.sport,
      playerId: row.playerId,
      playerName: row.playerName,
      team: row.team,
    })
    if (identity.status === 'held') {
      /*
       * 🛑 HELD MEANS NOBODY IS NOTIFIED. It does NOT mean "fall back to a name match" — the
       * empty-name broadcast this whole path was fixed for came from exactly that instinct.
       * An unattributable item stays in the general news feed, which is where a reader can
       * still find it, and out of everybody's notifications.
       *
       * ⚠ AND MOST HOLDS ARE TEMPORARY, WHICH IS WHY `settle` DECIDES THE STAMP. An athlete
       * with no identity row today has one after the next identity sync; an ambiguous duplicate
       * group gets disambiguated. Only `empty-identity` — no name AND no id — is settled, and
       * only because there is nothing there to resolve.
       */
      heldUnresolved++
      if (identity.reason === 'ambiguous-identity') heldAmbiguous++
      await settle(row, identity.reason)
      continue
    }

    const audience = await resolvePlayerNewsRecipients(identity.identity)
    importedUnlinked += audience.importedUnlinked
    for (const p of audience.unsearchedPlatforms) unsearchedPlatforms.add(p)

    /*
     * Followers (user decisions, 2026-09-14): anyone who followed this player from a card,
     * rostered or not, under their own `followed_players` switch.
     *
     * ⚠ MINUS EVERYONE ALREADY TOLD THROUGH A ROSTER. The dedupe prefix collapses the in-app
     * ROW, not the push — a manager who both rosters and follows him would otherwise get two
     * buzzes for one story. The roster path wins because it carries the league.
     *
     * ⚠ ONLY AFTER THE IDENTITY RESOLVED. A HELD row above notifies nobody, followers included:
     * the follower match is by name, and a name that could not be pinned to one athlete is
     * exactly the case where a name match must not decide who is told. The next sweep reaches
     * followers once the identity resolves.
     *
     * `null` is "follows unavailable" (the migration not applied): skipped, not an error.
     */
    const followers = await listFollowerIdsForPlayer(row.sport, row.playerName).catch(() => null)
    const followersOnly = (followers ?? []).filter((id) => !audience.byUser.has(id))

    if (audience.byUser.size === 0 && followersOnly.length === 0) {
      /*
       * 🛑 AN EMPTY AUDIENCE HAS THREE CAUSES AND ONLY ONE OF THEM IS TERMINAL.
       *
       * This used to record `no-roster` for all three, which is a TERMINAL outcome — so a
       * statement timeout permanently dropped a notification for a widely-rostered player, and
       * a story whose identity was missing its `sleeperId` could never be reconsidered once the
       * sync back-filled it twenty minutes later. The resolver now says which case it is.
       */
      if (audience.degraded) {
        recipientsUnavailable++
        await settle(row, 'recipients-unavailable')
      } else if (!audience.searchedAnything) {
        recipientsUnsearchable++
        await settle(row, 'no-searchable-identity')
      } else {
        noRoster++
        await settle(row, 'no-roster')
      }
      continue
    }

    /*
     * 🛑 PER-RECIPIENT DELIVERY STATE, READ FROM THE ROWS WE ACTUALLY WROTE.
     *
     * Two earlier designs asked the ROW whether this was a re-send — first an attempt count,
     * then `lastOutcome` — and both were wrong in both directions, because the audience changes
     * between sweeps and a single boolean cannot describe it. `PlatformNotification.sourceKey`
     * is unique and per user, so "has THIS manager already had THIS version of THIS story?" is
     * a fact in the database rather than an inference.
     *
     * The content hash is part of the prefix, so a corrected story is a new key set: everyone
     * is reached again, on every channel, with no separate reset to remember.
     */
    const dedupePrefix = playerNewsDedupePrefix(row.id, playerNewsContentHash(row.headline, row.body))
    const deliveryState = await lookupAlreadyNotified(dedupePrefix, [
      ...audience.byUser.keys(),
      ...followersOnly,
    ])
    if (deliveryState.degraded) deliveryStateUnavailable++

    const icon = CATEGORY_ICONS[category] ?? '📰'
    const label = CATEGORY_LABELS[category] ?? 'News'
    const title = `${icon} ${label}: ${identity.identity.canonicalName || row.playerName}`.slice(0, 256)

    /*
     * ONE LOGICAL NOTIFICATION PER USER PER EVENT, carrying every affected league.
     *
     * ⚠ THIS REPLACES A PER-LEAGUE FAN-OUT AND THE DIFFERENCE IS VISIBLE ON THE PHONE. Someone
     * rostering a player in twelve leagues previously received twelve notifications for one
     * injury. The blueprint settles this: one push, with the affected leagues in the detail
     * view, and league-specific actions kept contextual.
     *
     * ⚠ THE WHOLE LEAGUE SET IS HANDED TO THE DISPATCHER, NOT AN ANCHOR. Passing
     * `leagueId: leagueIds[0]` and letting the single-league mute check run against it was
     * wrong in both directions: a user who muted this category in the anchor league alone was
     * silenced for every other league, and a user who muted it everywhere EXCEPT the anchor was
     * notified with the muted leagues still listed in the detail view. `leagueIds` makes the
     * override a set operation — muted leagues are dropped, `meta.affectedLeagueIds` is
     * rewritten to the survivors, and the send is skipped only when none survive.
     */
    let anyDispatchFailed = false
    let anyDelivered = false
    for (const [userId, leagueIds] of audience.byUser) {
      dispatchAttempted++
      recipients++
      try {
        const outcome = await dispatchNotification({
          userIds: [userId],
          category: isInjury ? 'injury_alerts' : 'league_announcements',
          type: isInjury ? 'player_injury_update' : 'player_news_update',
          title,
          body: row.headline.slice(0, 500),
          leagueIds,
          severity: isInjury ? 'high' : 'medium',
          dedupePrefix,
          skipChannels: channelsToSkipFor(userId, deliveryState),
          meta: {
            playerName: identity.identity.canonicalName || row.playerName,
            team: row.team,
            sport: row.sport,
            newsCategory: category,
            eligibilityReason: eligibility.reason,
            playerIdentityId: identity.identity.identityId,
            /*
             * Every league this story touches for THIS user, for the detail view. The
             * dispatcher REWRITES this to the leagues that survive the user's mute overrides,
             * so what is stored is never a superset of what they agreed to hear about.
             */
            affectedLeagueIds: leagueIds,
          },
        })

        /*
         * 🛑 READ THE RESULT — THE `catch` BELOW CANNOT FIRE.
         *
         * `dispatchNotification` wraps its whole per-user body in try/catch and has no await
         * outside it, so it never rejects. This `catch` was the ONLY thing setting
         * `anyDispatchFailed`, which meant every row settled `'delivered'` no matter how
         * completely the send had failed — stamped terminally, nobody notified, and the
         * `'dispatch-failed'` retry path dead code. The catch is kept as a belt for a future
         * change that could throw; the counters below are what actually decide.
         */
        if (outcome.failed > 0) {
          dispatchFailed += outcome.failed
          anyDispatchFailed = true
        }
        if (outcome.delivered > 0) anyDelivered = true
        suppressedRecipients += outcome.suppressed
      } catch {
        // Unreachable today (see above), retained so a future throwing dispatcher is counted.
        dispatchFailed++
        anyDispatchFailed = true
      }
    }

    /*
     * Followers who roster him nowhere, one dispatch per user for the same reason as above: the
     * per-recipient result is what decides the row's outcome, and email/SMS suppression is
     * per recipient. Same dedupe prefix as the roster path, so a retry of this row cannot
     * re-bill a follower who already has it.
     */
    for (const userId of followersOnly) {
      dispatchAttempted++
      recipients++
      followerRecipients++
      try {
        const outcome = await dispatchNotification({
          userIds: [userId],
          category: 'followed_players',
          type: isInjury ? 'player_injury_update' : 'player_news_update',
          title,
          body: row.headline.slice(0, 500),
          // No league: a follow belongs to none, so no league mute applies either.
          leagueId: null,
          severity: isInjury ? 'high' : 'medium',
          dedupePrefix,
          skipChannels: channelsToSkipFor(userId, deliveryState),
          meta: {
            playerName: identity.identity.canonicalName || row.playerName,
            team: row.team,
            sport: row.sport,
            newsCategory: category,
            eligibilityReason: eligibility.reason,
            playerIdentityId: identity.identity.identityId,
            followed: true,
          },
        })
        if (outcome.failed > 0) {
          dispatchFailed += outcome.failed
          anyDispatchFailed = true
        }
        if (outcome.delivered > 0) anyDelivered = true
        suppressedRecipients += outcome.suppressed
      } catch {
        // Unreachable today (see above), retained so a future throwing dispatcher is counted.
        dispatchFailed++
        anyDispatchFailed = true
      }
    }

    /*
     * ⚠ ONE FAILED RECIPIENT MAKES THE WHOLE ROW RETRYABLE, AND THE DUPLICATE THAT CAUSES IS
     * HANDLED ELSEWHERE. There is no per-recipient durable state here, so the row is the only
     * unit available; retrying it re-attempts the recipients who already succeeded. That is
     * safe rather than merely tolerable, because `dedupePrefix` writes
     * `PlatformNotification.sourceKey = player-news:<id>:<userId>`, which collapses the repeat
     * in-app row for a user who already has one. It is NOT free for push, which has no such
     * key — per-endpoint delivery records are Batch B, and until they exist the trade is
     * "possibly notify one user twice" against "silently never notify the ones that failed".
     */
    rowsDispatched++
    /*
     * 🛑 THE OUTCOME IS DERIVED FROM WHAT HAPPENED, NOT ASSUMED FROM HAVING TRIED.
     *
     *  - a failed in-app write is now visible (`outcome.failed`), so `dispatch-failed` is
     *    reachable rather than dead;
     *  - a partially-degraded audience stays RETRYABLE even though some recipients were
     *    reached — the per-recipient state above is what makes that safe, because the retry
     *    cannot re-bill the ones who already have it;
     *  - an audience where every member had it muted is `all-suppressed`, not `delivered`.
     *    Nobody was reached; reporting that as a delivery is how `{delivered: 0,
     *    suppressed: 40}` read as success;
     *  - followers reached while NO roster store could be searched stay RETRYABLE as
     *    `no-searchable-identity`: stamping `delivered` there would permanently skip the
     *    rostering managers the identity sync is about to make findable.
     */
    const outcome: DispatchOutcome = anyDispatchFailed
      ? 'dispatch-failed'
      : audience.degraded
        ? 'recipients-unavailable'
        : !audience.searchedAnything
          ? 'no-searchable-identity'
          : anyDelivered
            ? 'delivered'
            : 'all-suppressed'
    if (outcome === 'recipients-unavailable') recipientsUnavailable++
    if (outcome === 'no-searchable-identity') recipientsUnsearchable++
    if (outcome === 'all-suppressed') allSuppressed++
    await settle(row, outcome)
  }

  /*
   * 🛑 LOGGED, BECAUSE A COUNTER NOBODY READS IS NOT A SIGNAL.
   *
   * `ledgerWriteFailures` and `deliveryStateUnavailable` were added to preserve visibility that
   * enforcement gave up — but both callers serialize this object into a cron JSON body nothing
   * parses, and `recordSyncJobRun` is fed the INGEST result, not this one. A `sportsDataCache`
   * outage is exactly the condition that removes the retry bound, and it was producing no
   * observable output anywhere.
   */
  if (ledgerWriteFailures > 0 || deliveryStateUnavailable > 0) {
    console.warn(
      '[player-news] degraded bookkeeping this sweep —',
      `ledger writes failed: ${ledgerWriteFailures},`,
      `delivery-state lookups failed: ${deliveryStateUnavailable}.`,
      'Retry bounds and email/SMS suppression are both weakened while this persists.',
    )
  }

  if (stamped.length > 0) {
    await prisma.playerNewsRecord
      .updateMany({ where: { id: { in: stamped } }, data: { notificationDispatchedAt: new Date() } })
      .catch(() => {})
  }

  return {
    // Rows actually considered, not rows fetched — otherwise a truncated run reports the same
    // number as a complete one and the deferral is invisible in the response. (`stamped` no
    // longer means "considered" — a retryable row is left unstamped — so it cannot stand in.)
    scanned: considered,
    deferred,
    policySkipped,
    heldUnresolved,
    heldAmbiguous,
    noRoster,
    dispatchAttempted,
    dispatchFailed,
    recipients,
    followerRecipients,
    importedUnlinked,
    retryScheduled,
    retriesExhausted,
    recipientsUnavailable,
    recipientsUnsearchable,
    allSuppressed,
    suppressedRecipients,
    deliveryStateUnavailable,
    unsearchedPlatforms: [...unsearchedPlatforms].sort(),
    ledgerWriteFailures,
    notified: rowsDispatched,
  }
}
