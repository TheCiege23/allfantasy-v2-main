import { createTeamInjuryNewsBatch } from './teamInjuryNewsBatch'
import type { DispatchNotificationParams } from './NotificationDispatcher'
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
  currentTeamForBinding,
  resolveNewsPlayerBinding,
  rosterRowIsBoundPlayer,
  teamNewsSubject,
  type NewsPlayerBinding,
} from '@/lib/notifications/newsPlayerBinding'
import type { RunBudget } from '@/lib/cron/runBudget'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import type { NewsCategory } from '@/lib/workers/x-news-ingestion'
import { dispatchNotification, type DispatchNotificationResult } from '@/lib/notifications/NotificationDispatcher'
import { classifyPlayerNewsCategory } from '@/lib/news/player-news-category'
import { decidePlayerNewsEligibility } from '@/lib/notifications/playerNewsEligibility'
import {
  playerNewsContentHash,
  recordAttempt,
  shouldStampTerminally,
  type DispatchOutcome,
} from '@/lib/notifications/playerNewsAttemptLedger'
import { listFollowerIdsForPlayerIdentity } from '@/lib/follows/playerFollows'
import { listFollowerIdsForTeam } from '@/lib/follows/teamFollows'
import { resolveNewsTeam, withinTeamFollowDailyCap } from '@/lib/follows/teamFollowAlerts'
import { alreadyToldAbout, recordToldAbout, type PlayerNewsIdentity } from '@/lib/notifications/playerNewsRepeatGuard'
import { getTeamInfo } from '@/lib/team-abbrev'

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
): Promise<Array<{ roster: { ownerId: string; leagueId: string } | null }> | null> {
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
    // null, not []: a FAILED lookup is an incomplete audience, not an empty one. The pending sweep
    // retries it (`recipients-unavailable`); reporting it as "nobody rosters him" stamped it forever.
    .catch(() => null)
  return rows ? rows.filter((r) => rosterRowIsBoundPlayer(binding, r, sk)) : null
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
  const rosterPlayers = (await rosterRowsForBinding(binding, playerName, sport)) ?? []

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
 * One headline told to one team's fans, however many rows carry it. "Commanders WR Terry McLaurin
 * won't play London game" is stored once for McLaurin and once for "Washington Commanders"; the
 * player-scoped story key differs between them, so without this a Commanders fan heard it twice.
 * Checked and written with `storyOnly` — see playerNewsRepeatGuard's `ToldOptions`.
 */
function teamHeadlineIdentity(sport: string, teamAbbr: string, headline: string, category: string): PlayerNewsIdentity {
  return { sport, playerName: `team:${teamAbbr}`, headline, category }
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
  /** Rows about ONE team rather than a player (see `teamNewsSubject`), routed to that team's followers. */
  teamNews: number
  /**
   * Of the rows worth sending, those whose name did not bind to ONE registry player — a namesake the
   * row's tag could not settle, or a name that is not a player at all. Nobody is told about these.
   */
  unboundPlayer: number
  /** Rows fetched but never considered because the budget ran out. Zero means the run completed. */
  deferred: number
  /** People not alerted because they were already told this story, or this status, recently. */
  repeatsSuppressed: number
  /**
   * Considered rows left UNSTAMPED so a later sweep retries them: an identity the registry cannot
   * bind yet, a roster lookup that failed, a dispatch that threw. Bounded per row by
   * MAX_DISPATCH_ATTEMPTS (lib/notifications/playerNewsAttemptLedger).
   */
  retryScheduled: number
  /** Rows whose attempt count could not be written. Non-zero means the retry bound is not being enforced. */
  ledgerUnpersisted: number
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
  let teamNews = 0
  let deferred = 0
  let repeatsSuppressed = 0
  let considered = 0
  let retryScheduled = 0
  let ledgerUnpersisted = 0
  const stamped: string[] = []
  const injuryBatch = createTeamInjuryNewsBatch(input?.budget)

  /*
   * 🛑 "CONSIDERED" AND "DELIVERED" WERE ONE STAMP. Every row looked at was stamped
   * `notificationDispatchedAt`, so a story held because the registry could not bind the athlete yet,
   * a roster lookup that timed out and a dispatch that threw were never reconsidered — the same
   * column that marks a real delivery. Each exit now names its outcome; a TERMINAL one (delivered,
   * policy skip, nobody to tell, everyone already told) is stamped as before, and a RETRYABLE one is
   * left unstamped until it succeeds or hits MAX_DISPATCH_ATTEMPTS. The backlog bound the old comment
   * below defends is kept: retries are capped per row, and the look-back window ages them out anyway.
   */
  const settle = async (row: (typeof rows)[number], outcome: DispatchOutcome): Promise<void> => {
    const { attempts, persisted } = await recordAttempt(row.id, playerNewsContentHash(row.headline, row.body), outcome)
    if (!persisted) ledgerUnpersisted++
    if (shouldStampTerminally(outcome, attempts)) stamped.push(row.id)
    else retryScheduled++
  }

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
     * ⚠ A ROW THAT REACHES NOBODY IS STILL STAMPED, and that is deliberate. `player_news` holds
     * 11,765 rows and gains ~3,400 a week; if unmatched rows stayed unstamped the scan would
     * re-examine the same backlog on every run forever and the cost would grow without bound.
     * Only RETRYABLE outcomes stay unstamped, and only up to MAX_DISPATCH_ATTEMPTS (see `settle`).
     */
    considered++

    const category = classifyPlayerNewsCategory(row.headline, row.body)
    const isInjury = category === 'injury'
    /*
     * Eligibility by EVENT CATEGORY (lib/notifications/playerNewsEligibility). The rule this replaces,
     * `impact !== 'high' && !isInjury`, dropped every signing and extension, because ingestion scores
     * those MEDIUM. Injuries still always qualify; a trade now needs confirming wording, and a
     * negated transaction ("will not be traded", "release rescinded") never goes out.
     */
    const eligibility = decidePlayerNewsEligibility({
      category,
      impact: row.impact,
      headline: row.headline,
      body: row.body,
    })
    if (!eligibility.eligible) {
      await settle(row, 'policy-skipped')
      continue
    }

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
     * ⚠ A ROW WHOSE "PLAYER" IS A TEAM ("Dallas Cowboys") is not player news: it reaches no roster
     * (it once reached D/ST managers by name — 277 high-impact rows in 30 days) and no player
     * follower. Owner's decision 2026-10-13: it goes to THAT TEAM's followers, but only when
     * `teamNewsSubject` finds the slot, the tag and the headline all naming the same one club.
     */
    const binding = await resolveNewsPlayerBinding(row.sport, row.playerName, row.team)
    if (binding.kind !== 'resolved') {
      const club = binding.kind === 'unresolved' ? teamNewsSubject(row.sport, row.playerName, row.team, row.headline) : null
      // The resolver turns the canonical code into the key follows are stored under (or null).
      const clubAbbr = club ? await resolveNewsTeam(row.sport, club, null).catch(() => null) : null
      if (!club || !clubAbbr) {
        unboundPlayer++
        noRoster++
        // Retryable: an identity sync adding the athlete, or merging a duplicate group, changes the answer.
        await settle(row, binding.kind === 'ambiguous' ? 'ambiguous-identity' : 'no-identity-row')
        continue
      }
      teamNews++
      const fans = (await listFollowerIdsForTeam(row.sport, clubAbbr).catch(() => null)) ?? []
      if (fans.length === 0) {
        noRoster++
        await settle(row, 'no-roster')
        continue
      }
      const story = teamHeadlineIdentity(row.sport, clubAbbr, row.headline, category)
      const toldFans = await alreadyToldAbout(fans, story, undefined, { storyOnly: true })
      repeatsSuppressed += toldFans.size
      const freshFans = fans.filter((id) => !toldFans.has(id))
      if (freshFans.length === 0) {
        await settle(row, 'all-suppressed')
        continue
      }
      const cappedFans = await withinTeamFollowDailyCap(freshFans)
      teamFollowCapped += freshFans.length - cappedFans.length
      if (cappedFans.length === 0) {
        await settle(row, 'all-suppressed')
        continue
      }
      const teamName = getTeamInfo(club)?.fullName ?? row.playerName
      if(isInjury){
        injuryBatch.add([{userIds:cappedFans,category:'followed_teams',type:'player_injury_update',
          title:teamName,body:row.headline,leagueId:null,severity:'high',dedupePrefix:'player-news:'+row.id,
          meta:{team:clubAbbr,sport:row.sport,newsCategory:category}}],async(users,failed)=>{
          recipients+=users.size;teamFollowerRecipients+=users.size
          if(users.size){await recordToldAbout([...users],story,undefined,{storyOnly:true});notified++}
          await settle(row,failed?'dispatch-failed':users.size?'delivered':'all-suppressed')
        })
        continue
      }
      const teamSent = await dispatchNotification({
        userIds: cappedFans,
        category: 'followed_teams',
        type: isInjury ? 'player_injury_update' : 'player_news_update',
        title: `${CATEGORY_ICONS[category] ?? '📰'} ${CATEGORY_LABELS[category] ?? 'News'}: ${teamName}`.slice(0, 256),
        body: row.headline.slice(0, 500),
        leagueId: null,
        severity: isInjury ? 'high' : 'medium',
        dedupePrefix: `player-news:${row.id}`,
        meta: { teamName, team: clubAbbr, sport: row.sport, newsCategory: category, followedTeam: clubAbbr, teamNews: true },
      }).then(result => result.failed === 0, () => false)
      if (!teamSent) {
        // Threw before any handoff: nobody is recorded as told, so the retry reaches the same people.
        await settle(row, 'dispatch-failed')
        continue
      }
      recipients += cappedFans.length
      teamFollowerRecipients += cappedFans.length
      await recordToldAbout(cappedFans, story, undefined, { storyOnly: true })
      notified++
      await settle(row, 'delivered')
      continue
    }
    // His club NOW: the Sleeper row's team, the registry's only as a fallback (currentTeamForBinding).
    const playerTeam = await currentTeamForBinding(binding, row.sport)
    const rosterLookup = await rosterRowsForBinding(binding, row.playerName, row.sport)
    if (rosterLookup === null) {
      // The roster query FAILED. An incomplete audience, not an empty one — retry rather than stamp.
      await settle(row, 'recipients-unavailable')
      continue
    }
    const rosterPlayers = rosterLookup

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

    if (byLeague.size === 0 && allFollowersOnly.length === 0 && allTeamFollowersOnly.length === 0) {
      noRoster++
      await settle(row, 'no-roster')
      continue
    }

    /*
     * ONE ALERT PER PERSON PER STORY. Everyone already told this story (or this player's same status
     * inside a day) is dropped — see playerNewsRepeatGuard.ts for the seven-emails-in-two-days case
     * that made this necessary. And a manager who rosters the player in three leagues is told once,
     * under the first league, not three times: `dedupePrefix` only ever collapsed the bell row.
     */
    const news = { sport: row.sport, playerName: row.playerName, headline: row.headline, category }
    const everyone = [...rostered, ...allFollowersOnly, ...allTeamFollowersOnly]
    const told = await alreadyToldAbout(everyone, news)
    // …and anyone already told this HEADLINE through his team: by this row's team-news twin, or by a
    // teammate's row carrying the same headline (teamHeadlineIdentity).
    const teamHeadline = teamAbbr ? teamHeadlineIdentity(row.sport, teamAbbr, row.headline, category) : null
    if (teamHeadline) {
      for (const id of await alreadyToldAbout(everyone, teamHeadline, undefined, { storyOnly: true })) told.add(id)
    }
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
    if (byLeague.size === 0 && followersOnly.length === 0 && uncappedTeamFollowers.length === 0) {
      await settle(row, 'all-suppressed')
      continue
    }
    // The daily cap is consumed only for people who would otherwise be told THIS story.
    const teamFollowersOnly = await withinTeamFollowDailyCap(uncappedTeamFollowers)
    teamFollowCapped += uncappedTeamFollowers.length - teamFollowersOnly.length

    if (isInjury) {
      const requests: DispatchNotificationParams[] = []
      const base = {type:'player_injury_update', title:row.playerName, body:row.playerName+': '+row.headline,
        severity:'high' as const, dedupePrefix:'player-news:'+row.id,
        meta:{team:playerTeam,sport:row.sport,newsCategory:category}}
      for(const [leagueId,userIds] of byLeague) requests.push({...base,userIds:[...userIds],leagueId,category:'injury_alerts'})
      if(followersOnly.length)requests.push({...base,userIds:followersOnly,leagueId:null,category:'followed_players',meta:{...base.meta,followed:true}})
      if(teamFollowersOnly.length)requests.push({...base,userIds:teamFollowersOnly,leagueId:null,category:'followed_teams',meta:{...base.meta,followedTeam:teamAbbr}})
      injuryBatch.add(requests,async (users,failed)=>{
        const toldNow=[...users]
        recipients+=users.size
        followerRecipients+=followersOnly.filter(id=>users.has(id)).length
        teamFollowerRecipients+=teamFollowersOnly.filter(id=>users.has(id)).length
        if(toldNow.length){
          await recordToldAbout(toldNow,news)
          if(teamHeadline)await recordToldAbout(toldNow,teamHeadline,undefined,{storyOnly:true})
          notified++
        }
        await settle(row,failed?'dispatch-failed':toldNow.length?'delivered':'all-suppressed')
      })
      continue
    }

    const icon = CATEGORY_ICONS[category] ?? '📰'
    const label = CATEGORY_LABELS[category] ?? 'News'
    const title = `${icon} ${label}: ${row.playerName}`.slice(0, 256)

    /*
     * Told = only the groups whose dispatch did not throw. A group that threw is left untold and the
     * row is retried; on the retry `alreadyToldAbout` above drops everyone a successful group reached,
     * so the retry reaches exactly the people the failure missed and nobody twice.
     */
    const toldNow: string[] = []
    let anyDispatchFailed = false
    const sent = (p: Promise<DispatchNotificationResult>) => p.then(result => result.failed === 0, () => false)

    for (const [leagueId, userIds] of byLeague) {
      const ok = await sent(dispatchNotification({
        userIds: [...userIds],
        category: isInjury ? 'injury_alerts' : 'league_announcements',
        type: isInjury ? 'player_injury_update' : 'player_news_update',
        title,
        body: row.headline.slice(0, 500),
        leagueId,
        severity: isInjury ? 'high' : 'medium',
        dedupePrefix: `player-news:${row.id}`,
        meta: { playerName: row.playerName, team: playerTeam, sport: row.sport, newsCategory: category },
      }))
      if (!ok) { anyDispatchFailed = true; continue }
      recipients += userIds.size
      toldNow.push(...userIds)
    }

    if (followersOnly.length > 0) {
      const ok = await sent(dispatchNotification({
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
      }))
      if (ok) {
        recipients += followersOnly.length
        followerRecipients += followersOnly.length
        toldNow.push(...followersOnly)
      } else anyDispatchFailed = true
    }
    if (teamFollowersOnly.length > 0) {
      const ok = await sent(dispatchNotification({
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
      }))
      if (ok) {
        recipients += teamFollowersOnly.length
        teamFollowerRecipients += teamFollowersOnly.length
        toldNow.push(...teamFollowersOnly)
      } else anyDispatchFailed = true
    }
    if (toldNow.length > 0) {
      await recordToldAbout(toldNow, news)
      if (teamHeadline) await recordToldAbout(toldNow, teamHeadline, undefined, { storyOnly: true })
      notified++
    }
    // Every remaining team follower can be capped out, so "nobody sent and nothing failed" is possible.
    await settle(row, anyDispatchFailed ? 'dispatch-failed' : toldNow.length > 0 ? 'delivered' : 'all-suppressed')
  }

  await injuryBatch.flush()

  if (stamped.length > 0) {
    await prisma.playerNewsRecord
      .updateMany({ where: { id: { in: stamped } }, data: { notificationDispatchedAt: new Date() } })
      .catch(() => {})
  }

  // `scanned` counts rows actually considered, not rows fetched — otherwise a truncated run
  // reports the same number as a complete one and the deferral is invisible in the response.
  return {
    scanned: considered,
    notified,
    recipients,
    followerRecipients,
    teamFollowerRecipients,
    teamFollowCapped,
    noRoster,
    unboundPlayer,
    teamNews,
    deferred,
    repeatsSuppressed,
    retryScheduled,
    ledgerUnpersisted,
  }
}
