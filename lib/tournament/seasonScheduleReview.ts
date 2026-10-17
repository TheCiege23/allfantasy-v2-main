import 'server-only'
import { prisma } from '@/lib/prisma'
import { readOpeningManifest } from './seasonNativeContract'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { fetchSeasonCalendarGames, seasonContractHash, type VerifiedSeasonCalendar } from './seasonCalendarVerification'
import { assessSeasonCalendar } from './seasonCalendarCoverage'
import { compareSeasonScheduleDrift } from './seasonScheduleDrift'
import { previewSeasonScheduleReconciliation } from './seasonScheduleReconciliation'

/** Fresh provider-schedule review only. Never changes frozen assignments or claims actual tipoff. */
export async function loadPublishedScheduleContract(userId: string, tournamentId: string, freezeId: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new BlueprintOperationError('Tournament not found.', 404)
  if (shell.commissionerId !== userId) throw new BlueprintOperationError('Only the tournament owner can review the published schedule.', 403)
  if (shell.status !== 'rules_published') throw new BlueprintOperationError('This tournament is unavailable for schedule review.', 409)
  const frozen = await prisma.tournamentAuditLog.findFirst({ where: { id: freezeId, tournamentId, action: 'season_opening_field_frozen' } })
  if (!frozen) throw new BlueprintOperationError('Frozen opening field not found.', 409)
  const raw = frozen.data as Record<string, unknown>
  const { manifestHash, ...payload } = raw
  if (seasonContractHash(payload) !== manifestHash) throw new BlueprintOperationError('The frozen assignment checksum does not match.', 409)
  const manifest = readOpeningManifest(raw)
  const publication = await prisma.tournamentAuditLog.findFirst({ where: { id: manifest.publicationId, tournamentId, action: 'season_rules_published' } })
  const pub = publication?.data as { hash?: string; config?: unknown; calendar?: VerifiedSeasonCalendar; acceptExcludedGames?: boolean; acceptPendingGames?: boolean } | undefined
  if (!pub?.calendar || pub.hash !== manifest.rulesHash || seasonContractHash(pub.config) !== seasonContractHash(manifest.config)) throw new BlueprintOperationError('The frozen field does not match its published contract.', 409)
  if (seasonContractHash({ config: pub.config, calendarDigest: pub.calendar.digest, acceptExcludedGames: pub.acceptExcludedGames, acceptPendingGames: pub.acceptPendingGames }) !== pub.hash) throw new BlueprintOperationError('The published rules checksum does not match.', 409)
  const { digest, checkedAt: _checkedAt, ...evidence } = pub.calendar
  if (seasonContractHash({ config: pub.config, evidence }) !== digest || !Array.isArray(pub.calendar.assignments)) throw new BlueprintOperationError('The published calendar evidence does not match its checksum.', 409)
  return { manifest, calendar: pub.calendar }
}

export async function reviewSeasonPublishedSchedule(userId: string, tournamentId: string, freezeId: string) {
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  let games
  try { ({ games } = await fetchSeasonCalendarGames(manifest.config)) }
  catch (e) { throw new BlueprintOperationError(e instanceof Error ? e.message : 'Current schedule unavailable.', 409) }
  const currentCoverage = assessSeasonCalendar(manifest.config, games)
  const drift = compareSeasonScheduleDrift(manifest.config.rules!, calendar.assignments, games)
  return {
    ...drift, reconciliation: drift.changes.map(previewSeasonScheduleReconciliation),
    checkedAt: new Date().toISOString(), provider: 'rolling_insights' as const,
    currentCoverageReady: currentCoverage.ready,
    coverageBlockers: currentCoverage.blockers,
    pendingGames: currentCoverage.pendingGames,
    launchReady: false,
  }
}
