import { prisma } from '@/lib/prisma'
import { readCutover } from '@/lib/league-import/fantrax/cutoverPolicy'
import { installCutover } from '@/lib/league-import/fantrax/installCutover'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Safe to retry: roster finalization and redraft season sync are idempotent. */
export async function finalizeImportedCarryover(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true, season: true, lifecycleState: true } })
  const carryover = asRecord(asRecord(league?.settings).importCarryover)
  const expectedPlayers = carryover.playerCount
  if (!league || typeof expectedPlayers !== 'number' || !Number.isSafeInteger(expectedPlayers) || expectedPlayers < 0) {
    throw new Error('This league has no imported roster carryover to finalize.')
  }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true, draftModeLabel: true },
  })
  if (!session || session.status !== 'completed' || session.draftModeLabel !== 'imported_rosters') throw new Error('The imported roster draft snapshot is missing or a new draft is now active.')

  const { runPostDraftFinalizationArtifacts } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
  const cutover = readCutover(league.settings, league.season ?? -1)
  if (!cutover?.installedSeasonId) await runPostDraftFinalizationArtifacts(leagueId)

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId, ...(league.season != null ? { season: league.season } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, currentWeek: true, _count: { select: { rosters: true } } },
  })
  const materializedPlayers = season
    ? await prisma.redraftRosterPlayer.count({ where: { roster: { seasonId: season.id }, droppedAt: null } })
    : 0
  const complete = Boolean(season) && materializedPlayers === expectedPlayers &&
    (carryover.teamCount == null || season?._count.rosters === carryover.teamCount)
  const installed = complete && cutover && season ? await installCutover(leagueId, season.id) : undefined
  if (installed && season) await updateStandings(season.id, cutover?.installedSeasonId ? Math.max(season.currentWeek, installed.period) : installed.period)
  if (complete && (!league.lifecycleState || league.lifecycleState === 'setup' || league.lifecycleState === 'post_draft')) {
    const opener = resolveDailySportSeasonStart(league.sport, league.season)
    const awaitingSeason = league.sport === 'MLB' && (!opener || Date.now() < Date.parse(opener))
    if (awaitingSeason) await prisma.redraftSeason.updateMany({ where: { id: season!.id }, data: { status: 'setup', currentWeek: 0 } })
    await prisma.league.update({ where: { id: leagueId }, data: { status: 'active', lifecycleState: awaitingSeason ? 'post_draft' : 'in_season' } })
  }
  return { complete, expectedPlayers, materializedPlayers, ...(installed ? { cutover: { policy: installed.policy, period: installed.period, reason: installed.reason, nativeFrom: installed.nativeFrom ?? null } } : {}) }
}
