import { prisma } from '@/lib/prisma'
import { getOrCreateDraftSession } from '@/lib/live-draft-engine/DraftSessionService'

export async function scheduleRoundDraft(
  tournamentId: string,
  roundNumber: number,
  draftDateTime: Date,
): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new Error('Tournament not found')

  const round = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber },
  })
  if (!round) throw new Error('Round not found')

  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: round.id },
    orderBy: { leagueNumber: 'asc' },
  })

  let offset = 0
  for (const tl of leagues) {
    if (!tl.leagueId) continue
    const when = shell.simultaneousDrafts
      ? draftDateTime
      : new Date(draftDateTime.getTime() + offset * 30 * 60 * 1000)
    offset++

    await prisma.tournamentLeague.update({
      where: { id: tl.id },
      data: { draftScheduledAt: when, status: 'draft_scheduled' },
    })

    const { session: draftSession } = await getOrCreateDraftSession(tl.leagueId)
    const dt =
      shell.draftType === 'auction' ? 'auction' : shell.draftType === 'linear' ? 'linear' : 'snake'
    await prisma.draftSession.update({
      where: { id: draftSession.id },
      data: {
        timerSeconds: shell.draftClockSeconds,
        draftType: dt,
      },
    })
  }

  await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId,
      roundNumber,
      type: 'draft_scheduled',
      title: `Round ${roundNumber} draft scheduled`,
      content: `Draft windows are set for ${leagues.length} leagues.`,
      targetAudience: 'all',
    },
  })

  await prisma.tournamentAuditLog.create({
    data: {
      tournamentId,
      roundNumber,
      action: 'draft_scheduled',
      actorType: 'system',
      data: { at: draftDateTime.toISOString() },
    },
  })
}
