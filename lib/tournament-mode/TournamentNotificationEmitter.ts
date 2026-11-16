/**
 * [NEW] lib/tournament-mode/TournamentNotificationEmitter.ts
 * Push notification events for tournament lifecycle: advancement, elimination, redraft, championship.
 * Integrates with the existing NotificationDispatcher.
 */

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

type TournamentEvent =
  | 'ROUND_ADVANCED'
  | 'ELIMINATED'
  | 'REDRAFT_SCHEDULED'
  | 'CHAMPIONSHIP_FORMED'
  | 'CHAMPION_CROWNED'
  | 'BUBBLE_RESOLVED'
  | 'FAAB_RESET'

interface EmitOptions {
  tournamentId: string
  event: TournamentEvent
  meta?: Record<string, unknown>
  /** Override recipient list. If omitted, all active participants are notified. */
  userIds?: string[]
}

async function getActiveParticipantUserIds(tournamentId: string): Promise<string[]> {
  const participants = await prisma.legacyTournamentParticipant.findMany({
    where: { tournamentId, status: { in: ['active', 'champion'] } },
    select: { userId: true },
  })
  return participants.map((p) => p.userId).filter(Boolean)
}

async function getAllParticipantUserIds(tournamentId: string): Promise<string[]> {
  const participants = await prisma.legacyTournamentParticipant.findMany({
    where: { tournamentId },
    select: { userId: true },
  })
  return participants.map((p) => p.userId).filter(Boolean)
}

async function getTournamentName(tournamentId: string): Promise<string> {
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { name: true },
  })
  return t?.name ?? 'Tournament'
}

const EVENT_CONFIG: Record<TournamentEvent, {
  title: (name: string, meta?: Record<string, unknown>) => string
  body: (name: string, meta?: Record<string, unknown>) => string
  severity: 'low' | 'medium' | 'high'
  allParticipants?: boolean
}> = {
  ROUND_ADVANCED: {
    title: (name, meta) => `${name}: Round ${meta?.newRoundIndex ?? ''} begins!`,
    body: (_, meta) => `${meta?.advanced ?? 0} players advance. ${meta?.eliminated ?? 0} eliminated. A new redraft is coming.`,
    severity: 'high',
  },
  ELIMINATED: {
    title: (name) => `${name}: Eliminated`,
    body: () => 'Your tournament run has ended. Check the bracket for final standings.',
    severity: 'medium',
  },
  REDRAFT_SCHEDULED: {
    title: (name) => `${name}: Redraft scheduled`,
    body: (_, meta) => `Your new league is ready. Draft begins soon for Round ${meta?.roundIndex ?? ''}.`,
    severity: 'high',
  },
  CHAMPIONSHIP_FORMED: {
    title: (name) => `${name}: Championship league formed!`,
    body: (_, meta) => `${meta?.playerCount ?? 0} players compete for the title. Final redraft incoming.`,
    severity: 'high',
    allParticipants: true,
  },
  CHAMPION_CROWNED: {
    title: (name, meta) => `${name}: ${meta?.championName ?? 'Champion'} wins it all!`,
    body: (_, meta) => `Congratulations to ${meta?.championName ?? 'the champion'}! The tournament is complete.`,
    severity: 'high',
    allParticipants: true,
  },
  BUBBLE_RESOLVED: {
    title: (name) => `${name}: Bubble resolved`,
    body: (_, meta) => `${meta?.bubblesAdvanced ?? 0} bubble teams advance. Check standings for results.`,
    severity: 'medium',
  },
  FAAB_RESET: {
    title: (name) => `${name}: FAAB budgets reset`,
    body: (_, meta) => `Your FAAB budget has been reset to $${meta?.budget ?? 100} for the new round.`,
    severity: 'low',
  },
}

/**
 * Emit a tournament lifecycle notification to participants.
 * Uses the existing NotificationDispatcher for in-app + email + SMS delivery.
 */
export async function emitTournamentNotification(options: EmitOptions): Promise<void> {
  const { tournamentId, event, meta, userIds: overrideUserIds } = options
  const config = EVENT_CONFIG[event]
  if (!config) return

  const name = await getTournamentName(tournamentId)
  const userIds = overrideUserIds
    ?? (config.allParticipants
      ? await getAllParticipantUserIds(tournamentId)
      : await getActiveParticipantUserIds(tournamentId))

  if (userIds.length === 0) return

  await dispatchNotification({
    userIds,
    category: 'league_announcements',
    productType: 'app',
    type: `tournament_${event.toLowerCase()}`,
    title: config.title(name, meta),
    body: config.body(name, meta),
    actionHref: `/tournament/${tournamentId}`,
    actionLabel: 'View tournament',
    meta: { tournamentId, event, ...meta },
    severity: config.severity,
  })
}

