import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

const HOUR = 60 * 60 * 1000
const CLAIM_TTL_MS = 45 * 24 * HOUR

type PendingOffer = {
  id: string
  leagueId: string
  proposedByUserId: string
  createdAt: Date
  expiresAt: Date | null
  league: { name: string | null }
  receiverRoster: { platformUserId: string | null }
}

/** One follow-up after a day, plus one near an explicit expiry. Never remind for an expired offer. */
export function pendingOfferReminderKind(offer: Pick<PendingOffer, 'createdAt' | 'expiresAt'>, now: Date): 'followup' | 'expiring' | null {
  const age = now.getTime() - offer.createdAt.getTime()
  const remaining = offer.expiresAt ? offer.expiresAt.getTime() - now.getTime() : null
  if (age < 0 || (remaining !== null && remaining <= 0)) return null
  if (remaining !== null && remaining <= 6 * HOUR) return 'expiring'
  if (age >= 24 * HOUR && age < 36 * HOUR) return 'followup'
  return null
}

async function claimReminder(key: string, now: Date): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({ data: {
      cacheKey: key,
      data: { claimedAt: now.toISOString() },
      expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
    } })
    return true
  } catch {
    // Unique key means another sweep sent it. A database failure fails closed, avoiding duplicate pushes.
    return false
  }
}

/** Bounded passenger on the existing trade cron; notifications honor trade proposal and league mutes. */
export async function remindPendingTrades(now = new Date()): Promise<{ checked: number; sent: number }> {
  const rows = await prisma.afLeagueTrade.findMany({
    where: {
      status: 'pending',
      OR: [
        { createdAt: { gte: new Date(now.getTime() - 36 * HOUR), lte: new Date(now.getTime() - 24 * HOUR) } },
        { expiresAt: { gt: now, lte: new Date(now.getTime() + 6 * HOUR) } },
      ],
    },
    select: {
      id: true, leagueId: true, proposedByUserId: true, createdAt: true, expiresAt: true,
      league: { select: { name: true } },
      receiverRoster: { select: { platformUserId: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  let sent = 0
  for (const offer of rows) {
    const kind = pendingOfferReminderKind(offer, now)
    const platformUserId = offer.receiverRoster.platformUserId
    if (!kind || !platformUserId) continue
    // Imported roster IDs can be provider IDs. Resolve the claimed AF manager before addressing a notice.
    const claimed = await prisma.leagueTeam.findFirst({
      where: { leagueId: offer.leagueId, platformUserId, claimedByUserId: { not: null } },
      select: { claimedByUserId: true },
    })
    const userId = claimed?.claimedByUserId
      ?? (await prisma.appUser.findUnique({ where: { id: platformUserId }, select: { id: true } }))?.id
      ?? null
    if (!userId || userId === offer.proposedByUserId) continue
    if (!(await claimReminder(`trade-reminder:v1:${offer.id}:${kind}:${userId}`, now))) continue
    const name = offer.league.name?.trim() || 'your league'
    await dispatchNotification({
      userIds: [userId],
      category: 'trade_proposals',
      type: kind === 'expiring' ? 'trade_offer_expiring' : 'trade_offer_reminder',
      title: kind === 'expiring' ? `Trade offer expiring in ${name}` : `Trade offer waiting in ${name}`,
      body: kind === 'expiring' ? 'An offer sent to you expires within six hours. Review it before it closes.' : 'An offer sent to you is still waiting for a response.',
      actionHref: `/league/${encodeURIComponent(offer.leagueId)}?view=trades`,
      actionLabel: 'Review offer',
      leagueId: offer.leagueId,
      severity: 'medium',
      dedupePrefix: `trade-reminder:v1:${offer.id}:${kind}`,
      meta: { leagueId: offer.leagueId, tradeId: offer.id, reminderKind: kind },
      skipChannels: { email: true, sms: true },
    })
    sent += 1
  }
  return { checked: rows.length, sent }
}
