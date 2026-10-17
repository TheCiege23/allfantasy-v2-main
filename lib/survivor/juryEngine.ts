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

export async function openFinale(leagueId: string, finalistUserIds: string[]): Promise<void> {
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
}

export async function openJuryVoting(leagueId: string, deadline: Date): Promise<void> {
  await prisma.jurySession.update({
    where: { leagueId },
    data: { status: 'voting_open', votingDeadline: deadline },
  })
}

