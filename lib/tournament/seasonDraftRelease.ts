import 'server-only'
import { prisma } from '@/lib/prisma'
import { withTenant } from '@/lib/domain/db'
import { resolveDeploymentTenantId } from '@/lib/domain/deploymentTenant'
import { seasonContractHash } from './seasonCalendarVerification'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { loadSeasonNativeSetup } from './seasonNativeProvisioning'
import { loadPublishedScheduleContract, reviewSeasonPublishedSchedule } from './seasonScheduleReview'
import { refreshSeasonDraftPool } from './seasonDraftRefresh'
import { loadSeasonDraftContext, readSeasonDraftSnapshot } from './seasonDraftRuntime'
import { hasSeasonDraftRelease } from './seasonDraftReleaseGate'
import { seasonDraftSessionError } from './seasonDraftBoard'

/** One audited draft release. League season operations and waiver processing remain locked. */
export async function releaseSeasonOpeningDraft(userId: string, tournamentId: string, freezeId: string, key: string) {
  if (process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED !== 'true') throw new BlueprintOperationError('Opening draft release is not enabled on this deployment.', 409)
  const tenant = resolveDeploymentTenantId()
  if (!tenant.ok) throw new BlueprintOperationError('Opening draft release needs a configured server tenant.', 409)
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId || !setup.leagues.every(league => league.state === 'created')) throw new BlueprintOperationError('Finish and verify all eight opening leagues before releasing a draft.', 409)
  const selected = setup.leagues.find(league => league.key === key)
  if (!selected?.leagueId) throw new BlueprintOperationError('Select a frozen opening league.', 409)
  const leagueId = selected.leagueId
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  if (calendar.provider !== 'rolling_insights' || !calendar.ready || calendar.regularGames < 1200 || calendar.pendingGames > 30) throw new BlueprintOperationError('Publish a verified NBA calendar before releasing opening drafts.', 409)
  if (manifest.config.sport !== 'NBA' || manifest.config.draftType !== 'snake') throw new BlueprintOperationError('The first draft release supports only the verified NBA snake pilot.', 409)
  const draftWindow = manifest.config.rules!.calendar.drafts.find(draft => draft.stage === 1)!
  if (Date.parse(draftWindow.completeBy) <= Date.now()) throw new BlueprintOperationError('The opening draft completion deadline has passed. Review the calendar.', 409)
  const fresh = await reviewSeasonPublishedSchedule(userId, tournamentId, freezeId)
  if (!fresh.currentCoverageReady || fresh.changes.length > 0) throw new BlueprintOperationError('The provider schedule changed or lost coverage. Review it before releasing drafts.', 409)
  const pool = await refreshSeasonDraftPool(leagueId, userId)
  if (!pool?.ready || pool.blockers.length) throw new BlueprintOperationError('The NBA player pool is not ready: ' + (pool?.blockers.join(' ') || 'refresh required'), 409)
  const context = await loadSeasonDraftContext(leagueId)
  if (!context || context.freezeId !== freezeId || context.tournamentId !== tournamentId || context.pool.key !== key) throw new BlueprintOperationError('The opening draft binding is inconsistent.', 409)
  return withTenant(tenant.value, async db => {
    const shell = await db.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.commissionerId !== userId || shell.status !== 'rules_published') throw new BlueprintOperationError('Only the owner can release this published tournament draft.', 403)
    const lockedAt = new Date(Math.max(Date.now(), shell.updatedAt.getTime() + 1))
    const claim = await db.tournamentShell.updateMany({ where: { id: tournamentId, status: 'rules_published', updatedAt: shell.updatedAt }, data: { updatedAt: lockedAt } })
    if (claim.count !== 1) throw new BlueprintOperationError('Opening setup changed. Retry after reloading.', 409)
    const native = await db.league.findUnique({ where: { id: leagueId } })
    const assignment = await db.tournamentLeague.findFirst({ where: { tournamentId, leagueId } })
    const draft = assignment?.draftSessionId ? await db.draftSession.findUnique({ where: { id: assignment.draftSessionId } }) : null
    const waiver = await db.leagueWaiverState.findUnique({ where: { leagueId } })
    const snapshot = await readSeasonDraftSnapshot(leagueId, manifest.manifestHash, db)
    if (!native || native.tenantId !== tenant.value || !native.locked || !waiver?.processingLocked || !assignment || !draft || !snapshot || Date.parse(snapshot.expiresAt) <= Date.now()) throw new BlueprintOperationError('The frozen draft, season locks or checked player pool changed.', 409)
    if (await hasSeasonDraftRelease(leagueId, native.settings, db)) {
      if (!['pre_draft', 'in_progress', 'paused', 'completed'].includes(draft.status) || assignment.status !== 'season_draft_ready') throw new BlueprintOperationError('The released draft no longer matches its audit.', 409)
      return { key, leagueId, released: true, repeated: true, seasonLaunchReady: false }
    }
    if (native.lifecycleState !== 'setup' || draft.status !== 'tournament_setup_blocked' || assignment.status !== 'season_setup_blocked' || draft.teamCount !== selected.slots || draft.draftType !== 'snake' || seasonDraftSessionError(context, draft) || await db.draftPick.count({ where: { sessionId: draft.id } }) !== 0) throw new BlueprintOperationError('The draft state changed. Review it before release.', 409)
    const [rosters, bindings, seats] = await Promise.all([
      db.roster.count({ where: { leagueId } }), db.tournamentLeagueParticipant.count({ where: { tournamentLeagueId: assignment.id } }), db.leagueEntrySlot.count({ where: { leagueId, status: 'FILLED' } }),
    ])
    if (rosters !== selected.slots || bindings !== selected.slots || seats !== selected.slots) throw new BlueprintOperationError('The opening league no longer has every frozen manager.', 409)
    await db.draftSession.update({ where: { id: draft.id }, data: { status: 'pre_draft', version: { increment: 1 } } })
    await db.league.update({ where: { id: leagueId }, data: { lifecycleState: 'pre_draft' } })
    await db.tournamentLeague.update({ where: { id: assignment.id }, data: { status: 'season_draft_ready' } })
    await db.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action: 'season_opening_draft_released', targetType: 'league', targetId: leagueId, data: { version: 1, key, leagueId, freezeId, manifestHash: manifest.manifestHash, publicationId: manifest.publicationId, draftId: draft.id, poolHash: seasonContractHash(snapshot.players), poolExpiresAt: snapshot.expiresAt, scheduleCheckedAt: fresh.checkedAt, pendingGames: fresh.pendingGames, excludedGames: calendar.excludedGames.length, seasonLaunchReady: false }, createdAt: lockedAt } })
    return { key, leagueId, released: true, repeated: false, seasonLaunchReady: false }
  })
}
