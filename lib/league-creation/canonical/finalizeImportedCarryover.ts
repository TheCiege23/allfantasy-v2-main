import { prisma } from '@/lib/prisma'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Safe to retry: roster finalization and redraft season sync are idempotent. */
export async function finalizeImportedCarryover(leagueId: string): Promise<{ complete: boolean; expectedPlayers: number; materializedPlayers: number }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const carryover = asRecord(asRecord(league?.settings).importCarryover)
  const expectedPlayers = carryover.playerCount
  if (!league || typeof expectedPlayers !== 'number' || !Number.isSafeInteger(expectedPlayers) || expectedPlayers < 0) {
    throw new Error('This league has no imported roster carryover to finalize.')
  }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, draftModeLabel: 'imported_rosters', status: 'completed' },
    select: { id: true },
  })
  if (!session) throw new Error('The imported roster draft snapshot is missing.')

  const { runPostDraftFinalizationArtifacts } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
  await runPostDraftFinalizationArtifacts(leagueId)

  const [season, materializedPlayers] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { leagueId }, select: { id: true } }),
    prisma.redraftRosterPlayer.count({ where: { roster: { leagueId }, droppedAt: null } }),
  ])
  const complete = Boolean(season) && materializedPlayers >= expectedPlayers
  if (complete) {
    await prisma.league.update({ where: { id: leagueId }, data: { status: 'active', lifecycleState: 'in_season' } })
  }
  return { complete, expectedPlayers, materializedPlayers }
}
