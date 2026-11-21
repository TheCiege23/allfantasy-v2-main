import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { oneWorldPerBatch } from '@/lib/decision-os/trade/sharedWorld'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

const HOUR = 60 * 60 * 1000
const CLAIM_TTL_MS = 45 * 24 * HOUR

/**
 * PENDING-OFFER REMINDERS, RE-GRADED ON A SCHEDULE (Trade OS, 2026-11-21).
 *
 * A native offer is graded once, when it is sent (`createAfLeagueTrade` freezes the receipt), and the receiver's
 * notice carries that letter. Then nothing graded it again: a day later, or six hours before it expired, the
 * reminder said only "an offer is still waiting" — while an injury, a role change or a week of games could have
 * moved the grade a full letter. Sleeper offers were the only ones a schedule graded (the five-minute offer sweep).
 *
 * Each reminder now re-grades the offer for the receiver through the one trade engine (`evaluateStoredTrade`, the
 * Trade Center's path, so the reminder and the screen agree) and says what it grades NOW, and whether that moved
 * since it was sent. 🛑 The letter is the engine's; AllFantasy never answers the offer.
 *
 * ⚠ BOUNDED. At most REGRADE_BUDGET_MS of grading per tick, the league's world loaded once per league; past it, a
 * reminder goes out as before, without a grade. A refusal or a failure is the same: never a guessed grade. A player
 * who has left the sending roster is said in words — the offer can no longer be made as written.
 */
export const REGRADE_BUDGET_MS = 45_000

type PendingOffer = {
  id: string
  leagueId: string
  proposedByUserId: string
  receiverRosterId: string
  createdAt: Date
  expiresAt: Date | null
  league: { name: string | null }
  receiverRoster: { platformUserId: string | null }
}

/** The receiver's grade now, or why there is none. */
export type ReminderRegrade =
  | { kind: 'graded'; letter: string; valueGiven: number | null; valueReceived: number | null }
  | { kind: 'moved'; players: string[] }
  | null

export type ReminderDeps = {
  /** Re-grade the offer for its receiver through the one trade engine. Null on any failure. */
  regrade: (offer: { leagueId: string; tradeId: string }, receiverUserId: string, resolveWorld: WorldReader) => Promise<ReminderRegrade>
  /** The receiver's letter on the offer's FROZEN receipt — the grade it was sent at. */
  sentLetter: (tradeId: string, receiverRosterId: string) => Promise<string | null>
  /** The league world, shared by every offer in a league for one tick. */
  resolveWorld: WorldReader
  clock: () => number
}

type WorldReader = (leagueId: string) => Promise<CanonicalWorld | null>

const LETTERS = ['A', 'B', 'C', 'D', 'F']
const letterOf = (g: unknown) => {
  const l = typeof g === 'string' ? g.trim().charAt(0).toUpperCase() : ''
  return LETTERS.includes(l) ? l : null
}

/**
 * The reminder's grade line. PURE. Null — the reminder reads exactly as before — when there is no grade to state.
 */
export function reminderGradeLine(
  regrade: ReminderRegrade,
  sent: string | null,
): { titleSuffix: string; bodyLine: string } | null {
  if (!regrade) return null
  if (regrade.kind === 'moved') {
    const who = regrade.players.slice(0, 3).join(', ')
    return {
      titleSuffix: '',
      bodyLine: `${who ? `${who} ${regrade.players.length === 1 ? 'is' : 'are'}` : 'A player in it is'} no longer on the roster sending ${regrade.players.length === 1 ? 'him' : 'them'}, so it cannot go through as written.`,
    }
  }
  const now = letterOf(regrade.letter)
  if (!now) return null
  const values =
    regrade.valueGiven != null && regrade.valueReceived != null
      ? ` — you get ${Math.round(regrade.valueReceived).toLocaleString('en-US')} for ${Math.round(regrade.valueGiven).toLocaleString('en-US')}`
      : ''
  const was = letterOf(sent)
  return {
    titleSuffix: ` — ${now} for you`,
    bodyLine:
      was && was !== now
        ? `It was graded ${was} for you when it was sent; on today’s values AllFantasy grades it ${now}${values}.`
        : `On today’s values AllFantasy still grades it ${now} for you${values}.`,
  }
}

const defaultReminderDeps: ReminderDeps = {
  regrade: async ({ leagueId, tradeId }, userId, resolveWorld) => {
    try {
      const { evaluateStoredTrade } = await import('@/lib/decision-os/trade/evaluateStoredTrade')
      const r = await evaluateStoredTrade(
        { leagueId, ref: { kind: 'af', tradeId }, userId, surface: 'offer-reminder', persist: false },
        { resolveWorld },
      )
      if (!r.ok) return r.refusal.code === 'asset_moved' ? { kind: 'moved', players: r.refusal.missingAssets } : null
      const g = r.receipt.grade
      return g.graded ? { kind: 'graded', letter: g.letter, valueGiven: g.giveValue ?? null, valueReceived: g.getValue ?? null } : null
    } catch {
      return null
    }
  },
  sentLetter: async (tradeId, receiverRosterId) => {
    try {
      const { PUBLIC_RECEIPT_SELECT, publicTradeDecisionReceipt } = await import('@/lib/league-trade-engine/tradeDecisionReceipt')
      const snapshot = await prisma.tradeDecisionSnapshot.findFirst({ where: { tradeId }, select: PUBLIC_RECEIPT_SELECT })
      if (!snapshot) return null
      return publicTradeDecisionReceipt(snapshot).participantDecisions.find((p) => p.rosterId === receiverRosterId)?.grade ?? null
    } catch {
      return null
    }
  },
  resolveWorld: async (leagueId) => {
    const { resolveCanonicalWorld } = await import('@/lib/decision-os/world')
    return resolveCanonicalWorld(leagueId).catch(() => null)
  },
  clock: () => Date.now(),
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
export async function remindPendingTrades(
  now = new Date(),
  deps: Partial<ReminderDeps> = {},
): Promise<{ checked: number; sent: number; regraded: number; moved: number }> {
  const d: ReminderDeps = { ...defaultReminderDeps, ...deps }
  const startedAt = d.clock()
  // One league world per league for the tick (`sharedWorld.ts`): every offer graded on the same rosters.
  const resolveWorld = oneWorldPerBatch(d.resolveWorld)
  const rows = await prisma.afLeagueTrade.findMany({
    where: {
      status: 'pending',
      OR: [
        { createdAt: { gte: new Date(now.getTime() - 36 * HOUR), lte: new Date(now.getTime() - 24 * HOUR) } },
        { expiresAt: { gt: now, lte: new Date(now.getTime() + 6 * HOUR) } },
      ],
    },
    select: {
      id: true, leagueId: true, proposedByUserId: true, receiverRosterId: true, createdAt: true, expiresAt: true,
      league: { select: { name: true } },
      receiverRoster: { select: { platformUserId: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  let sent = 0
  let regraded = 0
  let moved = 0
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
    // Re-graded for the receiver while the tick is inside its grading budget; past it, the reminder is as before.
    let line: { titleSuffix: string; bodyLine: string } | null = null
    if (d.clock() - startedAt < REGRADE_BUDGET_MS) {
      const [regrade, sentAt] = await Promise.all([
        d.regrade({ leagueId: offer.leagueId, tradeId: offer.id }, userId, resolveWorld).catch(() => null),
        d.sentLetter(offer.id, offer.receiverRosterId).catch(() => null),
      ])
      line = reminderGradeLine(regrade, sentAt)
      if (regrade?.kind === 'graded' && line) regraded += 1
      if (regrade?.kind === 'moved') moved += 1
    }
    const baseTitle = kind === 'expiring' ? `Trade offer expiring in ${name}` : `Trade offer waiting in ${name}`
    const baseBody =
      kind === 'expiring' ? 'An offer sent to you expires within six hours. Review it before it closes.' : 'An offer sent to you is still waiting for a response.'
    await dispatchNotification({
      userIds: [userId],
      category: 'trade_proposals',
      type: kind === 'expiring' ? 'trade_offer_expiring' : 'trade_offer_reminder',
      title: line ? `${baseTitle}${line.titleSuffix}` : baseTitle,
      body: line ? `${baseBody} ${line.bodyLine}` : baseBody,
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
  return { checked: rows.length, sent, regraded, moved }
}
