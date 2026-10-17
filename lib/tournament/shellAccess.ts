import { prisma } from '@/lib/prisma'

export async function assertTournamentCommissioner(
  tournamentId: string,
  userId: string,
  allowPlanning = false,
): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    select: { commissionerId: true, status: true },
  })
  if (!shell || shell.commissionerId !== userId || (!allowPlanning && ['blueprint', 'rules_published'].includes(shell.status))) {
    throw new Error('FORBIDDEN')
  }
}

export async function canViewStandings(
  tournamentId: string,
  userId: string | null,
  visibility: string,
): Promise<boolean> {
  if (visibility === 'all') return true
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    select: { commissionerId: true },
  })
  if (!shell) return false
  if (visibility === 'commissioner_only') return userId === shell.commissionerId
  if (visibility === 'league_only') return Boolean(userId)
  return Boolean(userId)
}
