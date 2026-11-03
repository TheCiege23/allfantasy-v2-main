import 'server-only'

/** Reads what `welcomeBackSummary` (./welcomeBack.ts) needs, and the owner's latest return. */
import { prisma } from '@/lib/prisma'
import { welcomeBackSummary, type WelcomeBackSummary } from './welcomeBack'

export const WELCOME_BACK_DAYS = 7
const ENDED = 'inactive_manager_mode.ended'
const CLAIM = 'chimmy_autopilot.claim'
const MAX_ROWS = 200

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** What was done to one team between two moments. */
export async function buildWelcomeBack(args: { leagueId: string; rosterId: string; since: Date; endedAt: Date; autopilot: boolean }): Promise<WelcomeBackSummary> {
  const window = { gte: args.since, lte: args.endedAt }
  const [changes, claims] = await Promise.all([
    prisma.automationAuditLog.findMany({
      where: { leagueId: args.leagueId, entityType: 'roster', entityId: args.rosterId, createdAt: window },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: { createdAt: true, message: true },
    }),
    prisma.leagueAuditLog.findMany({
      where: { leagueId: args.leagueId, entityType: 'roster', entityId: args.rosterId, actionType: CLAIM, createdAt: window },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: { createdAt: true, metadata: true },
    }),
  ])
  return welcomeBackSummary({
    since: args.since,
    endedAt: args.endedAt,
    autopilot: args.autopilot,
    lineupChanges: changes.map((c) => ({ at: c.createdAt, message: c.message })),
    claims: claims.map((c) => {
      const m = asRecord(c.metadata)
      return { at: c.createdAt, add: str(m.addPlayerName), drop: str(m.dropPlayerName) }
    }),
  })
}

export type WelcomeBackView = { id: string; endedAt: string; summary: WelcomeBackSummary }

/** The signed-in owner's latest return in this league, within the last week; null when there is none. */
export async function readWelcomeBack(leagueId: string, userId: string, now = new Date()): Promise<WelcomeBackView | null> {
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  if (!roster) return null
  const ended = await prisma.leagueAuditLog.findFirst({
    where: { leagueId, entityType: 'roster', entityId: roster.id, actionType: ENDED, createdAt: { gte: new Date(now.getTime() - WELCOME_BACK_DAYS * 86_400_000) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, metadata: true },
  })
  if (!ended) return null
  const m = asRecord(ended.metadata)
  // Written by the end-of-mode log since phase 13; an older row has no start, so there is nothing to sum.
  const since = typeof m.since === 'string' ? new Date(m.since) : null
  if (!since || Number.isNaN(since.getTime())) return null
  const summary = await buildWelcomeBack({ leagueId, rosterId: roster.id, since, endedAt: ended.createdAt, autopilot: m.autopilot === true })
  return { id: ended.id, endedAt: ended.createdAt.toISOString(), summary }
}
