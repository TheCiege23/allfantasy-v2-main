import 'server-only'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { assessSeasonDraftCompletion } from './seasonDraftReview'
import { loadSeasonNativeSetup } from './seasonNativeProvisioning'
import { assignSeasonDraftSlots, type SeasonDraftPlayer } from './seasonDraftPolicy'
import { seasonContractHash } from './seasonCalendarVerification'
import { BlueprintOperationError } from './seasonBlueprintStore'
import type { SeasonBlueprint } from './seasonBlueprint'

export function buildSeasonPreparedRoster(config: SeasonBlueprint, sessionId: string, players: SeasonDraftPlayer[]) {
  const assignment = assignSeasonDraftSlots(config, players)
  if (players.length !== config.rosterSize || assignment.length !== config.rosterSize || new Set(players.map(p => p.playerId)).size !== players.length || players.some(p => !p.playerId) || assignment.some(index => index < 0)) throw new Error('A legal complete tournament roster is required.')
  const labels = config.rules!.starters.flatMap(s => Array.from({ length: s.count }, () => s.position))
  const entries = assignment.map((index, slot) => { const p = players[index]!; return { id: p.playerId, playerId: p.playerId, name: p.playerName, playerName: p.playerName, position: p.position, team: p.team ?? null, slot: labels[slot] ?? 'BN' } })
  const sections = { starters: entries.slice(0, labels.length), bench: entries.slice(labels.length), ir: [], taxi: [], devy: [] }
  return { players: entries.map(p => p.id), starters: sections.starters.map(p => p.id), reserve: [], taxi: [], devy: [], lineup_sections: sections, lineup_draft_session_id: sessionId }
}
const preparedFields = ['players', 'starters', 'reserve', 'taxi', 'devy', 'lineup_sections', 'lineup_draft_session_id'] as const
function projection(data: Record<string, unknown>) { return Object.fromEntries(preparedFields.map(key => [key, data[key]])) }

/** Materializes opening rosters only; no RedraftSeason, scoring, waiver or lifecycle activation. */
export async function prepareSeasonOpeningRosters(userId: string, tournamentId: string, freezeId: string, key: string) {
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId) throw new BlueprintOperationError('Reload the current frozen opening setup.', 409)
  const league = setup.leagues.find(l => l.key === key)
  if (!league?.leagueId) throw new BlueprintOperationError('Create this opening league first.', 409)
  const locked = await withControlLock(league.leagueId, () => prisma.$transaction(async tx => {
    // Ownership is rechecked inside the mutation transaction.
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.commissionerId !== userId || shell.status !== 'rules_published') throw new BlueprintOperationError('Tournament roster preparation is unavailable.', 409)
    const review = await assessSeasonDraftCompletion(league.leagueId!, tx)
    if (!review || review.state !== 'completed' || review.context.tournamentId !== tournamentId || review.context.freezeId !== freezeId || review.context.pool.key !== key || !review.session || !review.boardHash) throw new BlueprintOperationError('Verify the completed tournament draft before preparing rosters.', 409)
    const { context, session, boardHash } = review
    const picks = await tx.draftPick.findMany({ where: { sessionId: session.id }, orderBy: { overall: 'asc' } })
    const rosters = await tx.roster.findMany({ where: { leagueId: league.leagueId! } })
    const prepared = context.rosterIds.map(id => {
      const row = rosters.find(r => r.id === id)!
      const players = picks.filter(p => p.rosterId === id).map(p => ({ playerId: p.playerId!, playerName: p.playerName, position: p.position, team: p.team }))
      return { row, payload: buildSeasonPreparedRoster(context.config, session.id, players) }
    })
    const rosterHash = seasonContractHash(prepared.map(p => ({ rosterId: p.row.id, ...p.payload })))
    const prior = await tx.tournamentAuditLog.findFirst({ where: { tournamentId, targetId: league.leagueId!, action: 'season_rosters_prepared' } })
    if (prior) {
      const receipt = prior.data as Record<string, unknown>
      const currentHash = seasonContractHash(prepared.map(p => ({ rosterId: p.row.id, ...projection(p.row.playerData as Record<string, unknown>) })))
      if (receipt.version !== 1 || receipt.sessionId !== session.id || receipt.manifestHash !== context.manifestHash || receipt.boardHash !== boardHash || receipt.rosterHash !== rosterHash || currentHash !== rosterHash) throw new BlueprintOperationError('Prepared rosters differ from their audit checkpoint. Review is required.', 409)
      return { key, prepared: true, repeated: true, teams: rosters.length, launchReady: false }
    }
    for (const { row } of prepared) {
      const data = row.playerData as Record<string, unknown> | null
      if (!data || Array.isArray(data) || [data.players, data.starters, data.reserve, data.taxi, data.devy].some(v => v != null && (!Array.isArray(v) || v.length > 0)) || (data.lineup_sections != null && Object.values(data.lineup_sections as object).some(v => !Array.isArray(v) || v.length > 0))) throw new BlueprintOperationError('Existing roster assignments require review before preparation.', 409)
    }
    const claim = await tx.draftSession.updateMany({ where: { id: session.id, version: session.version, status: 'completed' }, data: { version: { increment: 1 } } })
    if (claim.count !== 1) throw new BlueprintOperationError('The draft changed. Refresh and retry.', 409)
    for (const { row, payload } of prepared) {
      const saved = await tx.roster.updateMany({ where: { id: row.id, leagueId: league.leagueId!, platformUserId: row.platformUserId, playerData: { equals: row.playerData! } }, data: { playerData: { ...(row.playerData as object), ...payload } as any } })
      if (saved.count !== 1) throw new BlueprintOperationError('A roster changed. Refresh and retry.', 409)
    }
    await tx.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action: 'season_rosters_prepared', targetType: 'league', targetId: league.leagueId!, data: { version: 1, manifestHash: context.manifestHash, sessionId: session.id, boardHash, rosterHash, rosterIds: context.rosterIds, teams: rosters.length, launchReady: false } } })
    return { key, prepared: true, repeated: false, teams: rosters.length, launchReady: false }
  }))
  if (!locked.acquired) throw new BlueprintOperationError('Roster preparation is busy. Retry shortly.', 409)
  return locked.value
}

export async function readPreparedSeasonRosterState(leagueId: string, manifestHash: string, boardHash: string, sessionId: string, db: Pick<typeof prisma, 'roster' | 'tournamentAuditLog'> = prisma) {
  const receipt = await db.tournamentAuditLog.findFirst({ where: { targetId: leagueId, action: 'season_rosters_prepared' } })
  if (!receipt) return 'not_prepared' as const
  const rosters = await db.roster.findMany({ where: { leagueId } })
  const data = receipt.data as Record<string, unknown>
  // Hash ordering follows the immutable draft order, recorded by the preparation payload.
  const rosterIds = (data.rosterIds as string[] | undefined)
  if (!Array.isArray(rosterIds) || rosterIds.length !== rosters.length || new Set(rosterIds).size !== rosters.length) return 'review_required' as const
  const actual = rosterIds.map(id => { const row = rosters.find(r => r.id === id); return row ? { rosterId: id, ...projection(row.playerData as Record<string, unknown>) } : null })
  return data.version === 1 && data.manifestHash === manifestHash && data.boardHash === boardHash && data.sessionId === sessionId && seasonContractHash(actual) === data.rosterHash ? 'prepared' as const : 'review_required' as const
}
