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
import {
  resolveNewsPlayerBinding,
  rosterRowIsBoundPlayer,
  type NewsPlayerBinding,
} from '@/lib/notifications/newsPlayerBinding'
import type { RunBudget } from '@/lib/cron/runBudget'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import type { NewsCategory } from '@/lib/workers/x-news-ingestion'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { classifyPlayerNewsCategory } from '@/lib/news/player-news-category'
import { listFollowerIdsForPlayerIdentity } from '@/lib/follows/playerFollows'
import { listFollowerIdsForTeam } from '@/lib/follows/teamFollows'
import { resolveNewsTeam, withinTeamFollowDailyCap } from '@/lib/follows/teamFollowAlerts'
import { alreadyToldAbout, recordToldAbout } from '@/lib/notifications/playerNewsRepeatGuard'

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
 * Rostered copies of the ONE player a news row was bound to (lib/notifications/newsPlayerBinding).
 *
 * 🛑 THIS WAS `playerName CONTAINS …` WITH NO SPORT OR CLUB (2026-10-11). A story about the Browns'
 * LB Justin Jefferson pushed "🏥 Injury Update: Justin Jefferson" to every manager of the Vikings WR.
 *
 * 🛑 AND THE FIRST REPAIR GATED ON THE NEWS ROW'S `team` TAG (same day), WHICH IS OFTEN THE OPPONENT.
 * "Burrow throws 4 TDs… Bengals beat Dolphins" is stored as Ja'Marr Chase / MIA, so the gate dropped
 * that story for every manager rostering Chase. The player's team now comes from the registry; the
 * tag only ever chooses between namesakes. A row bound to no single player tells no roster at all.
 */
async function rosterRowsForBinding(
  binding: NewsPlayerBinding,
  newsName: string,
  sport: string | null | undefined,
): Promise<Array<{ roster: { ownerId: string; leagueId: string } | null }>> {
  if (binding.kind !== 'resolved') return []
  const sk = String(sport ?? '').trim().toUpperCase()
  const spellings = [...new Set([newsName.trim(), binding.identity.name.trim()].filter(Boolean))]
  if (spellings.length === 0) return []
  const rows = await prisma.redraftRosterPlayer
    .findMany({
      where: {
        OR: spellings.map((s) => ({ playerName: { contains: s, mode: 'insensitive' as const } })),
        droppedAt: null,
      },
      select: {
        playerId: true, playerName: true, team: true, sport: true,
        roster: { select: { ownerId: true, leagueId: true } },
      },
      take: 500,
    })
    .catch(() => [])
  return rows.filter((r) => rosterRowIsBoundPlayer(binding, r, sk))
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
  const playerNewsNotification = getPlayerNewsNotificationModel()
  if (!playerNewsNotification) return 0

  // Skip low-impact notifications unless injury
  if (impact === 'low' && category !== 'injury') return 0

  // Find all rosters containing this player across all leagues
  const binding = await resolveNewsPlayerBinding(sport, playerName, team)
  const rosterPlayers = await rosterRowsForBinding(binding, playerName, sport)

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
   * ⚠ THE COST PER ROW IS NOT A CONSTANT AND IT GREW UNDER US. A notified row costs one roster
   * scan plus one `dispatchNotification` PER LEAGUE that rosters the player, and league count
   * only goes up. Measured across scheduled runs: a quiet run reported 330 recipients and
   * finished in ~50s; once the season started the same limit of 40 rows produced 1,265 and the
   * handler ran to the ceiling. Nothing about the code changed.
   */
  budget?: RunBudget
}): Promise<{
  scanned: number
  notified: number
  recipients: number
  /** Of `recipients`, users told because they FOLLOW the player and roster him nowhere. */
  followerRecipients: number
  /** Of `recipients`, users told because they follow the player's TEAM (and not him, nor roster him). */
  teamFollowerRecipients: number
  /** Team followers not told because they hit today's team-alert cap. */
  teamFollowCapped: number
  /** Rows with no rostering manager AND no follower — nobody to tell. Includes `unboundPlayer`. */
  noRoster: number
  /**
   * Of the rows worth sending, those whose name did not bind to ONE registry player — a namesake the
   * row's tag could not settle, or a name that is not a player at all. Nobody is told about these.
   */
  unboundPlayer: number
  /** Rows fetched but never considered because the budget ran out. Zero means the run completed. */
  deferred: number
  /** People not alerted because they were already told this story, or this status, recently. */
  repeatsSuppressed: number
}> {
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
        id: true, sport: true, playerName: true, team: true,
        headline: true, body: true, impact: true,
      },
    })
    .catch(() => [])

  let notified = 0
  let recipients = 0
  let followerRecipients = 0
  let teamFollowerRecipients = 0
  let teamFollowCapped = 0
  let noRoster = 0
  let unboundPlayer = 0
  let deferred = 0
  let repeatsSuppressed = 0
  const stamped: string[] = []

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    /*
     * ⚠ CHECKED BEFORE THE STAMP, NOT AFTER. `stamped` means "considered", and the updateMany at
     * the end writes `notificationDispatchedAt` for everything in it — so a check placed even one
     * line lower would mark a row considered that this run never looked at, and no later run
     * would ever pick it up. The deferred rows stay unstamped and the next fire finds them.
     */
    if (input?.budget?.exhausted()) {
      deferred = rows.length - i
      break
    }

    /*
     * ⚠ STAMPED WHETHER OR NOT ANYONE IS NOTIFIED, and that is deliberate. `player_news`
     * holds 11,765 rows and gains ~3,400 a week; if unmatched rows stayed unstamped the
     * scan would re-examine the same backlog on every run forever and the cost would grow
     * without bound. The stamp means "considered", not "delivered".
     */
    stamped.push(row.id)

    const category = classifyPlayerNewsCategory(row.headline, row.body)
    const isInjury = category === 'injury'
    if (row.impact !== 'high' && !isInjury) continue

    /*
     * ONE player, and HIS team, from the registry — never the row's `team` tag, which names whatever
     * club the article mentions (often the opponent). See lib/notifications/newsPlayerBinding.
     *
     * 🛑 A ROW THAT DOES NOT BIND TO ONE PLAYER TELLS NOBODY: no roster, no player follower, and no
     * team follower. "Josh Allen" with no tag, or tagged the opponent, could be the Bills QB or the
     * Jaguars DL; guessing puts one man's injury on the other's managers, and routing it to "the
     * player's team" would need a team we do not have. A missed alert is a gap; a wrong one is a
     * false statement someone acts on.
     *
     * ⚠ THIS INCLUDES ROWS WHOSE "PLAYER" IS A TEAM ("Dallas Cowboys"). Measured over 30 days of
     * high-impact NFL news: 277 such rows had been reaching managers who roster that team's D/ST by
     * name, and could reach that team's followers through the tag. They are not player news and now
     * tell nobody; routing them by the team they name would be a separate, deliberate feature.
     */
    const binding = await resolveNewsPlayerBinding(row.sport, row.playerName, row.team)
    if (binding.kind !== 'resolved') {
      unboundPlayer++
      noRoster++
      continue
    }
    const playerTeam = binding.identity.currentTeam
    const rosterPlayers = await rosterRowsForBinding(binding, row.playerName, row.sport)

    // dispatchNotification takes ONE leagueId, so group recipients by league rather than
    // calling it per user — one call per league instead of one per manager.
    const byLeague = new Map<string, Set<string>>()
    for (const rp of rosterPlayers) {
      const userId = rp.roster?.ownerId
      const leagueId = rp.roster?.leagueId
      if (!userId || !leagueId) continue
      if (!byLeague.has(leagueId)) byLeague.set(leagueId, new Set())
      byLeague.get(leagueId)!.add(userId)
    }

    /*
     * Followers (user decisions, 2026-09-14): anyone who followed this player from a card,
     * rostered or not, under their own `followed_players` switch.
     *
     * ⚠ MINUS EVERYONE ALREADY TOLD THROUGH A ROSTER. The dedupe prefix collapses the in-app
     * ROW, not the push — a manager who both rosters and follows him would otherwise get two
     * buzzes for one story. The roster path wins because it carries the league.
     *
     * `null` is "follows unavailable" (the migration not applied): skipped, not an error.
     */
    const rostered = new Set<string>()
    for (const ids of byLeague.values()) for (const id of ids) rostered.add(id)
    const followers = await listFollowerIdsForPlayerIdentity(row.sport, {
      identity: binding.identity,
      candidates: binding.candidates,
      newsName: row.playerName,
    }).catch(() => null)
    const allFollowersOnly = (followers ?? []).filter((id) => !rostered.has(id))

    /*
     * Team followers (owner's call, 2026-10-03): anyone following this player's TEAM, under their own
     * `followed_teams` switch. Same rule as above, one level wider — minus everyone already told via a
     * roster or a player follow, so one story is one buzz.
     *
     * 🛑 THE TEAM IS THE BOUND PLAYER'S REGISTRY TEAM, NOT THE ROW'S TAG (2026-10-11). Feeding the tag
     * sent "Bengals beat Dolphins" (tagged Chase / MIA) to DOLPHINS followers. `resolveNewsTeam` is
     * unchanged and maps the registry's team text onto a followable team; it is simply fed the right
     * thing now. Only a binding that did not rest on the tag is team-routed (`teamRoutable`): a
     * namesake chosen by the tag (`team_verified`) rests on the very tag measured as wrong, and an
     * unbound row never gets here.
     * Passing no player name keeps resolveNewsTeam from falling back to a name lookup of its own.
     */
    const teamAbbr =
      binding.teamRoutable && playerTeam
        ? await resolveNewsTeam(row.sport, playerTeam, null).catch(() => null)
        : null
    const teamFollowers = teamAbbr ? await listFollowerIdsForTeam(row.sport, teamAbbr).catch(() => null) : null
    const playerFollowerSet = new Set(allFollowersOnly)
    const allTeamFollowersOnly = (teamFollowers ?? []).filter((id) => !rostered.has(id) && !playerFollowerSet.has(id))

    if (byLeague.size === 0 && allFollowersOnly.length === 0 && allTeamFollowersOnly.length === 0) { noRoster++; continue }

    /*
     * ONE ALERT PER PERSON PER STORY. Everyone already told this story (or this player's same status
     * inside a day) is dropped — see playerNewsRepeatGuard.ts for the seven-emails-in-two-days case
     * that made this necessary. And a manager who rosters the player in three leagues is told once,
     * under the first league, not three times: `dedupePrefix` only ever collapsed the bell row.
     */
    const news = { sport: row.sport, playerName: row.playerName, headline: row.headline, category }
    const told = await alreadyToldAbout([...rostered, ...allFollowersOnly, ...allTeamFollowersOnly], news)
    const assigned = new Set<string>(told)
    for (const [leagueId, ids] of byLeague) {
      const fresh = new Set([...ids].filter((id) => !assigned.has(id)))
      for (const id of fresh) assigned.add(id)
      if (fresh.size > 0) byLeague.set(leagueId, fresh)
      else byLeague.delete(leagueId)
    }
    const followersOnly = allFollowersOnly.filter((id) => !told.has(id))
    const uncappedTeamFollowers = allTeamFollowersOnly.filter((id) => !told.has(id))
    repeatsSuppressed += told.size
    if (byLeague.size === 0 && followersOnly.length === 0 && uncappedTeamFollowers.length === 0) continue
    // The daily cap is consumed only for people who would otherwise be told THIS story.
    const teamFollowersOnly = await withinTeamFollowDailyCap(uncappedTeamFollowers)
    teamFollowCapped += uncappedTeamFollowers.length - teamFollowersOnly.length

    const icon = CATEGORY_ICONS[category] ?? '📰'
    const label = CATEGORY_LABELS[category] ?? 'News'
    const title = `${icon} ${label}: ${row.playerName}`.slice(0, 256)

    for (const [leagueId, userIds] of byLeague) {
      await dispatchNotification({
        userIds: [...userIds],
        category: isInjury ? 'injury_alerts' : 'league_announcements',
        type: isInjury ? 'player_injury_update' : 'player_news_update',
        title,
        body: row.headline.slice(0, 500),
        leagueId,
        severity: isInjury ? 'high' : 'medium',
        dedupePrefix: `player-news:${row.id}`,
        meta: { playerName: row.playerName, team: playerTeam, sport: row.sport, newsCategory: category },
      }).catch(() => {})
      recipients += userIds.size
    }

    if (followersOnly.length > 0) {
      await dispatchNotification({
        userIds: followersOnly,
        category: 'followed_players',
        type: isInjury ? 'player_injury_update' : 'player_news_update',
        title,
        body: row.headline.slice(0, 500),
        // No league: a follow belongs to none, so no league mute applies either.
        leagueId: null,
        severity: isInjury ? 'high' : 'medium',
        dedupePrefix: `player-news:${row.id}`,
        meta: { playerName: row.playerName, team: playerTeam, sport: row.sport, newsCategory: category, followed: true },
      }).catch(() => {})
      recipients += followersOnly.length
      followerRecipients += followersOnly.length
    }
    if (teamFollowersOnly.length > 0) {
      await dispatchNotification({
        userIds: teamFollowersOnly,
        category: 'followed_teams',
        type: isInjury ? 'player_injury_update' : 'player_news_update',
        title,
        body: row.headline.slice(0, 500),
        // No league: a team follow belongs to none, so no league mute applies either.
        leagueId: null,
        severity: isInjury ? 'high' : 'medium',
        dedupePrefix: `player-news:${row.id}`,
        meta: { playerName: row.playerName, team: teamAbbr, sport: row.sport, newsCategory: category, followedTeam: teamAbbr },
      }).catch(() => {})
      recipients += teamFollowersOnly.length
      teamFollowerRecipients += teamFollowersOnly.length
    }
    const toldNow: string[] = [...followersOnly, ...teamFollowersOnly]
    for (const ids of byLeague.values()) toldNow.push(...ids)
    await recordToldAbout(toldNow, news)
    notified++
  }

  if (stamped.length > 0) {
    await prisma.playerNewsRecord
      .updateMany({ where: { id: { in: stamped } }, data: { notificationDispatchedAt: new Date() } })
      .catch(() => {})
  }

  // `scanned` counts rows actually considered, not rows fetched — otherwise a truncated run
  // reports the same number as a complete one and the deferral is invisible in the response.
  return {
    scanned: stamped.length,
    notified,
    recipients,
    followerRecipients,
    teamFollowerRecipients,
    teamFollowCapped,
    noRoster,
    unboundPlayer,
    deferred,
    repeatsSuppressed,
  }
}
