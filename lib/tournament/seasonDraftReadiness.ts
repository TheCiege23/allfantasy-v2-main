import 'server-only'
import { refreshSeasonDraftPool } from './seasonDraftRefresh'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { loadSeasonNativeSetup } from './seasonNativeProvisioning'
import { loadSeasonDraftContext } from './seasonDraftRuntime'

/** Catalog I/O precedes the short audit write. This check never unlocks a draft or changes rosters. */
export async function checkSeasonDraftReadiness(userId: string, tournamentId: string, freezeId: string, key?: string) {
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId) throw new BlueprintOperationError('Reload the current frozen opening setup.', 409)
  if (key && !setup.leagues.some(l => l.key === key)) throw new BlueprintOperationError('Unknown opening league.', 404)
  const reports = []
  for (const league of setup.leagues.filter(l => !key || l.key === key)) {
    if (!league.leagueId) { reports.push({ key: league.key, poolReady: false, players: 0, blockers: ['Create this opening league first.'] }); continue }
    const context = await loadSeasonDraftContext(league.leagueId)
    if (!context || context.tournamentId !== tournamentId) throw new BlueprintOperationError('The native draft binding is inconsistent.', 409)
    const report = await refreshSeasonDraftPool(league.leagueId, userId)
    if (!report) throw new BlueprintOperationError('The native draft binding is inconsistent.', 409)
    reports.push({ key: league.key, poolReady: report.ready, players: report.players, blockers: report.blockers, expiresAt: report.expiresAt, retryAt: report.retryAt, refreshed: report.refreshed })
  }
  return { launchReady: false, reports, remaining: ['Review opening draft completion and saved assignments.', 'Finish live scoring, lineup/cap/IR/trade enforcement and provider readiness.', 'Verify native mutation boundaries and real Postgres staging behavior.'] }
}
