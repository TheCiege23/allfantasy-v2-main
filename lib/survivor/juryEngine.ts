import { prisma } from '@/lib/prisma'
import { postHostMessage } from './hostEngine'

export async function openJuryPhase(leagueId: string): Promise<void> {
  await prisma.league.update({
    where: { id: leagueId },
    data: { survivorPhase: 'jury' },
  })
  await prisma.jurySession.upsert({
    where: { leagueId },
    create: { leagueId, status: 'pending' },
    update: {},
  })
  await postHostMessage(leagueId, 'jury_instruction', {}, 'jury_chat').catch(() => {})
}

/**
 * survivor-core §5 "Jury vote is open": once per finale, to jurors only, on the first transition into
 * questions/voting. Lazy import so this engine does not load the dispatcher at import time.
 */
async function notifyJuryVoteOpenOnce(leagueId: string, previousStatus: string | null | undefined): Promise<void> {
  if (previousStatus === 'questions_open' || previousStatus === 'voting_open' || previousStatus === 'complete') return
  await import('./notificationEngine')
    .then(({ enqueueSurvivorCoreNotification }) => enqueueSurvivorCoreNotification(leagueId, { kind: 'jury_vote_open' }, { role: 'jury' }))
    .catch(() => {})
}

export async function openFinale(leagueId: string, finalistUserIds: string[]): Promise<void> {
  const previous = await prisma.jurySession.findUnique({ where: { leagueId }, select: { status: true } }).catch(() => null)
  await prisma.league.update({
    where: { id: leagueId },
    data: { survivorPhase: 'finale' },
  })
  await prisma.jurySession.upsert({
    where: { leagueId },
    create: { leagueId, finalistUserIds, status: 'questions_open' },
    update: { finalistUserIds, status: 'questions_open' },
  })
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId: { in: finalistUserIds } },
    data: { isFinalist: true, canAccessFinaleChat: true },
  })
  await notifyJuryVoteOpenOnce(leagueId, previous?.status)
}

export async function openJuryVoting(leagueId: string, deadline: Date): Promise<void> {
  const previous = await prisma.jurySession.findUnique({ where: { leagueId }, select: { status: true } }).catch(() => null)
  await prisma.jurySession.update({
    where: { leagueId },
    data: { status: 'voting_open', votingDeadline: deadline },
  })
  await notifyJuryVoteOpenOnce(leagueId, previous?.status)
}

