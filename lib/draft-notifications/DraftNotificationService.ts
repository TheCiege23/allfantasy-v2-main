/**
 * Draft notifications — deterministic, event-driven. No AI required for content.
 * Uses unified dispatcher for in-app + email + SMS per user preferences.
 */

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { buildDraftStartingEmail } from './draftEmails'
import { loadDraftQueueForUser } from '@/lib/draft-room/loadDraftQueueForUser'
import { getBaseUrl } from '@/lib/get-base-url'
import type { DraftNotificationEventType, DraftNotificationPayload } from './types'

const DRAFT_ROOM_PATH = (leagueId: string) => `/league/${leagueId}/draft`

async function getLeagueName(leagueId: string): Promise<string | undefined> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  return league?.name ?? undefined
}

/**
 * Resolve app user id for a roster owner. Orphan rosters (platformUserId starting with "orphan-") have no user.
 */
export async function getAppUserIdForRoster(rosterId: string): Promise<string | null> {
  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { platformUserId: true },
  })
  if (!roster?.platformUserId || String(roster.platformUserId).startsWith('orphan-')) return null
  return roster.platformUserId
}

/**
 * All league member app user ids (roster owners). Excludes orphans.
 */
export async function getLeagueMemberAppUserIds(leagueId: string): Promise<string[]> {
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { platformUserId: true },
  })
  const ids = new Set<string>()
  for (const r of rosters) {
    if (r.platformUserId && !String(r.platformUserId).startsWith('orphan-')) ids.add(r.platformUserId)
  }
  return Array.from(ids)
}

/**
 * Deterministic title/body for each event type.
 */
function getTitleAndBody(
  eventType: DraftNotificationEventType,
  payload: DraftNotificationPayload
): { title: string; body: string | null; severity: 'low' | 'medium' | 'high' } {
  const league = payload.leagueName ? ` — ${payload.leagueName}` : ''
  switch (eventType) {
    case 'draft_on_the_clock':
      return {
        title: `You're on the clock${league}`,
        body: payload.pickLabel ? `Pick ${payload.pickLabel}. Make your selection.` : 'Make your draft pick.',
        severity: 'high',
      }
    case 'draft_approaching_timeout':
      return {
        title: `Draft timer almost up${league}`,
        body: payload.pickLabel ? `Pick ${payload.pickLabel} — time running out.` : 'Your pick is due soon.',
        severity: 'high',
      }
    case 'draft_auto_pick_fired':
      return {
        title: `Auto-pick made${league}`,
        body: payload.playerName ? `${payload.playerName} was selected for you.` : 'An auto-pick was used for your slot.',
        severity: 'medium',
      }
    case 'draft_queue_player_unavailable':
      return {
        title: `Queue player taken${league}`,
        body: 'A player in your queue was drafted by another team. Choose a new pick.',
        severity: 'medium',
      }
    case 'draft_paused':
      return {
        title: `Draft paused${league}`,
        body: 'The commissioner has paused the draft.',
        severity: 'low',
      }
    case 'draft_resumed':
      return {
        title: `Draft resumed${league}`,
        body: 'The draft has resumed.',
        severity: 'low',
      }
    case 'draft_trade_offer_received':
      return {
        title: `Draft trade offer${league}`,
        body: 'You have a new draft pick trade proposal.',
        severity: 'medium',
      }
    case 'draft_ai_trade_review_available':
      return {
        title: `AI trade review ready${league}`,
        body: 'An AI review is available for a draft pick trade.',
        severity: 'low',
      }
    case 'draft_orphan_ai_assigned':
      return {
        title: `Orphan/AI manager updated${league}`,
        body: 'Commissioner has updated AI manager settings for empty teams.',
        severity: 'low',
      }
    case 'draft_auction_outbid':
      return {
        title: `You were outbid${league}`,
        body: payload.previousBid != null ? `Your bid of $${payload.previousBid} was outbid.` : 'Another manager placed a higher bid.',
        severity: 'medium',
      }
    case 'draft_slow_reminder':
      return {
        title: `Slow draft reminder${league}`,
        body: payload.minutesRemaining != null ? `Your pick is due in about ${payload.minutesRemaining} minutes.` : 'Your draft pick is due soon.',
        severity: 'medium',
      }
    case 'draft_starting_soon':
      return {
        title: `Draft starting soon${league}`,
        body: 'Your league draft is about to start.',
        severity: 'high',
      }
    case 'draft_intel_queue_ready':
      return {
        title: `AI queue ready${league}`,
        body: payload.playerName
          ? `${payload.playerName} leads your Chimmy queue.`
          : 'Chimmy built your 5-pick queue.',
        severity: 'medium',
      }
    case 'draft_intel_player_taken':
      return {
        title: `Queued player taken${league}`,
        body: payload.playerName
          ? `${payload.playerName} just left the board. Chimmy refreshed your queue.`
          : 'A queued player was taken. Chimmy refreshed your board.',
        severity: 'high',
      }
    case 'draft_intel_on_clock_urgent':
      return {
        title: `You're on the clock${league}`,
        body: payload.playerName
          ? `Chimmy says take ${payload.playerName} now.`
          : 'Chimmy pushed an urgent on-clock recommendation.',
        severity: 'high',
      }
    case 'draft_intel_pick_confirmation':
      return {
        title: `Pick confirmed${league}`,
        body: payload.playerName ? `${payload.playerName} is locked in.` : 'Your draft pick was confirmed.',
        severity: 'medium',
      }
    case 'draft_intel_tier_break':
      return {
        title: `Tier break alert${league}`,
        body: payload.playerNames?.length
          ? `Tier shifting around ${payload.playerNames.slice(0, 2).join(', ')}.`
          : 'A board tier is breaking faster than expected.',
        severity: 'high',
      }
    case 'draft_intel_orphan_team_pick':
      return {
        title: `Orphan team pick${league}`,
        body: payload.playerName
          ? `An orphan roster auto-selected ${payload.playerName}.`
          : 'An orphan roster made an automated pick.',
        severity: 'low',
      }
    case 'draft_intel_post_draft_recap':
      return {
        title: `Draft recap ready${league}`,
        body: payload.recap ?? 'Chimmy posted your post-draft recap.',
        severity: 'medium',
      }
    default:
      return {
        title: `Draft update${league}`,
        body: null,
        severity: 'low',
      }
  }
}

function resolveCategoryForEvent(eventType: DraftNotificationEventType) {
  return eventType.startsWith('draft_intel_') ? 'draft_intel_alerts' : 'draft_alerts'
}

/**
 * Create a single draft notification (in-app + email/SMS per preferences).
 * `emailOverride` swaps the plain email body for a designed template
 * (draftEmails renderer output) behind exactly the same category gates.
 */
export async function createDraftNotification(
  appUserId: string,
  eventType: DraftNotificationEventType,
  payload: DraftNotificationPayload,
  emailOverride?: { subject: string; html: string }
): Promise<boolean> {
  const { title, body, severity } = getTitleAndBody(eventType, payload)
  const href = DRAFT_ROOM_PATH(payload.leagueId)
  await dispatchNotification({
    userIds: [appUserId],
    category: resolveCategoryForEvent(eventType),
    productType: 'app',
    type: eventType,
    title,
    body: body ?? undefined,
    actionHref: href,
    actionLabel: 'Open draft',
    meta: { ...payload, leagueId: payload.leagueId },
    severity,
    emailOverride,
  })
  return true
}

/**
 * Notify multiple users (e.g. draft paused/resumed) via unified dispatcher.
 */
export async function createDraftNotificationForUsers(
  appUserIds: string[],
  eventType: DraftNotificationEventType,
  payload: DraftNotificationPayload
): Promise<number> {
  if (appUserIds.length === 0) return 0
  const { title, body, severity } = getTitleAndBody(eventType, payload)
  const href = DRAFT_ROOM_PATH(payload.leagueId)
  await dispatchNotification({
    userIds: appUserIds,
    category: resolveCategoryForEvent(eventType),
    productType: 'app',
    type: eventType,
    title,
    body: body ?? undefined,
    actionHref: href,
    actionLabel: 'Open draft',
    meta: { ...payload, leagueId: payload.leagueId },
    severity,
  })
  return appUserIds.length
}

/**
 * Event trigger: after a pick is submitted, notify the next manager they're on the clock.
 */
export async function notifyOnTheClockAfterPick(leagueId: string): Promise<void> {
  try {
    const session = await prisma.draftSession.findUnique({
      where: { leagueId },
      include: { picks: { orderBy: { overall: 'asc' } } },
    })
    if (!session || session.status !== 'in_progress') return
    const { resolveCurrentOnTheClock } = await import('@/lib/live-draft-engine/CurrentOnTheClockResolver')
    const slotOrder = (session.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
    const totalPicks = session.teamCount * session.rounds
    const progressPicks = session.picks.map((p) => ({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
    }))
    const current = resolveCurrentOnTheClock({
      totalPicks,
      picks: progressPicks,
      teamCount: session.teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    })
    if (!current) return
    const appUserId = await getAppUserIdForRoster(current.rosterId)
    if (!appUserId) return
    const leagueName = await getLeagueName(leagueId)
    await createDraftNotification(appUserId, 'draft_on_the_clock', {
      leagueId,
      leagueName,
      pickLabel: current.pickLabel,
      round: current.round,
      slot: current.slot,
      rosterId: current.rosterId,
      displayName: current.displayName,
    })
  } catch {
    // Fire-and-forget
  }
}

/**
 * Event trigger: draft paused — notify all league members.
 */
export async function notifyDraftPaused(leagueId: string): Promise<void> {
  const userIds = await getLeagueMemberAppUserIds(leagueId)
  if (userIds.length === 0) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotificationForUsers(userIds, 'draft_paused', {
    leagueId,
    leagueName,
  })
}

/**
 * Event trigger: draft resumed — notify all league members.
 */
export async function notifyDraftResumed(leagueId: string): Promise<void> {
  const userIds = await getLeagueMemberAppUserIds(leagueId)
  if (userIds.length === 0) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotificationForUsers(userIds, 'draft_resumed', {
    leagueId,
    leagueName,
  })
}

/**
 * Event trigger: auto-pick was used for this roster.
 */
export async function notifyAutoPickFired(
  leagueId: string,
  rosterId: string,
  playerName: string
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_auto_pick_fired', {
    leagueId,
    leagueName,
    rosterId,
    playerName,
  })
}

/**
 * Event trigger: queue player was unavailable (already drafted).
 */
export async function notifyQueuePlayerUnavailable(leagueId: string, rosterId: string): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_queue_player_unavailable', {
    leagueId,
    leagueName,
    rosterId,
  })
}

/**
 * Event trigger: on-clock manager is nearing timeout.
 */
export async function notifyApproachingTimeout(
  leagueId: string,
  rosterId: string,
  options?: { pickLabel?: string; round?: number; slot?: number }
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_approaching_timeout', {
    leagueId,
    leagueName,
    rosterId,
    pickLabel: options?.pickLabel,
    round: options?.round,
    slot: options?.slot,
  })
}

/**
 * Event trigger: draft start transition.
 *
 * Email goes out as the designed 22b "draft starting" template
 * (`buildDraftStartingEmail`) when it can be built from REAL data — the
 * member's round-1 slot from `slotOrder` and their actual queue count.
 * Availability is deliberately empty until a league-history loader exists;
 * the renderer prints the honest absence rather than a national-ADP guess.
 * Auction sessions have no pick slot, and a member without a slot entry, a
 * failed queue read, or an unnamed league keeps the plain dispatcher email.
 * In-app/SMS behaviour is unchanged; the `draft_alerts` category preference
 * still gates every channel.
 */
export async function notifyDraftStartingSoon(leagueId: string): Promise<void> {
  const userIds = await getLeagueMemberAppUserIds(leagueId)
  if (userIds.length === 0) return
  const leagueName = await getLeagueName(leagueId)
  const designed = leagueName
    ? await buildDraftStartingEmailsByUser(leagueId, leagueName).catch(
        () => new Map<string, { subject: string; html: string }>(),
      )
    : new Map<string, { subject: string; html: string }>()
  for (const userId of userIds) {
    await createDraftNotification(
      userId,
      'draft_starting_soon',
      { leagueId, leagueName },
      designed.get(userId),
    )
  }
}

/** Real-data inputs for the designed draft-starting email, keyed by app user id. */
async function buildDraftStartingEmailsByUser(
  leagueId: string,
  leagueName: string,
): Promise<Map<string, { subject: string; html: string }>> {
  const out = new Map<string, { subject: string; html: string }>()
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { draftType: true, slotOrder: true },
  })
  if (!session || session.draftType === 'auction') return out
  const slotOrder = (session.slotOrder as { slot: number; rosterId: string }[] | null) ?? []
  if (slotOrder.length === 0) return out
  const slotByRosterId = new Map(slotOrder.map((entry) => [entry.rosterId, entry.slot]))
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  const baseUrl = getBaseUrl()
  for (const roster of rosters) {
    const userId = roster.platformUserId
    if (!userId || String(userId).startsWith('orphan-')) continue
    const slot = slotByRosterId.get(roster.id)
    if (slot == null) continue
    // A failed queue read must not render the "your queue is empty" warning
    // for a queue we simply could not see — that member keeps the plain email.
    const loaded = await loadDraftQueueForUser(leagueId, userId).catch(() => null)
    if (!loaded) continue
    out.set(
      userId,
      buildDraftStartingEmail({
        leagueName,
        leagueId,
        pickSlot: `1.${String(slot).padStart(2, '0')}`,
        // The hook fires at the start transition itself; the renderer says
        // "starting now" for zero rather than claiming a countdown we lack.
        minutesUntilStart: 0,
        queueSize: loaded.queue.length,
        rosterHoles: [],
        availability: [],
        draftsSampled: 0,
        queueUrl: `${baseUrl}${DRAFT_ROOM_PATH(leagueId)}`,
        baseUrl,
      }),
    )
  }
  return out
}

/**
 * Event trigger: orphan AI manager mode/assignment changed.
 */
export async function notifyOrphanAiManagerAssigned(leagueId: string): Promise<void> {
  const userIds = await getLeagueMemberAppUserIds(leagueId)
  if (userIds.length === 0) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotificationForUsers(userIds, 'draft_orphan_ai_assigned', {
    leagueId,
    leagueName,
  })
}

export async function notifyDraftIntelQueueReady(
  leagueId: string,
  rosterId: string,
  options?: { playerName?: string; availabilityProbability?: number }
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_queue_ready', {
    leagueId,
    leagueName,
    rosterId,
    playerName: options?.playerName,
    availabilityProbability: options?.availabilityProbability,
  })
}

export async function notifyDraftIntelPlayerTaken(
  leagueId: string,
  rosterId: string,
  playerName: string
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_player_taken', {
    leagueId,
    leagueName,
    rosterId,
    playerName,
  })
}

export async function notifyDraftIntelOnClockUrgent(
  leagueId: string,
  rosterId: string,
  options?: { playerName?: string; pickLabel?: string }
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_on_clock_urgent', {
    leagueId,
    leagueName,
    rosterId,
    playerName: options?.playerName,
    pickLabel: options?.pickLabel,
  })
}

export async function notifyDraftIntelPickConfirmation(
  leagueId: string,
  rosterId: string,
  playerName: string
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_pick_confirmation', {
    leagueId,
    leagueName,
    rosterId,
    playerName,
  })
}

export async function notifyDraftIntelTierBreak(
  leagueId: string,
  rosterId: string,
  playerNames: string[]
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_tier_break', {
    leagueId,
    leagueName,
    rosterId,
    playerNames,
  })
}

export async function notifyDraftIntelOrphanTeamPick(
  leagueId: string,
  playerName?: string
): Promise<void> {
  const userIds = await getLeagueMemberAppUserIds(leagueId)
  if (userIds.length === 0) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotificationForUsers(userIds, 'draft_intel_orphan_team_pick', {
    leagueId,
    leagueName,
    playerName,
  })
}

export async function notifyDraftIntelPostDraftRecap(
  leagueId: string,
  rosterId: string,
  recap: string
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_intel_post_draft_recap', {
    leagueId,
    leagueName,
    rosterId,
    recap,
  })
}

/**
 * Event trigger: auction bid was outbid.
 */
export async function notifyAuctionOutbid(
  leagueId: string,
  rosterId: string,
  previousBid?: number
): Promise<void> {
  const appUserId = await getAppUserIdForRoster(rosterId)
  if (!appUserId) return
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_auction_outbid', {
    leagueId,
    leagueName,
    rosterId,
    previousBid,
  })
}

/**
 * Event trigger: private draft trade AI review has been prepared.
 */
export async function notifyDraftAiTradeReviewAvailable(
  leagueId: string,
  appUserId: string,
  tradeProposalId: string
): Promise<void> {
  const leagueName = await getLeagueName(leagueId)
  await createDraftNotification(appUserId, 'draft_ai_trade_review_available', {
    leagueId,
    leagueName,
    tradeProposalId,
  })
}
