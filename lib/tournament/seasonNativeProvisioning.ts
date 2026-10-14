import { identityArt } from './seasonArtwork'
import 'server-only'
import { prisma } from '@/lib/prisma'
import { withTenant } from '@/lib/domain/db'
import { resolveDeploymentTenantId } from '@/lib/domain/deploymentTenant'
import { createActorContext } from '@/lib/domain/actorContext'
import { createSeasonTournamentLeague } from '@/lib/domain/seasonTournamentLeague'
import { readOpeningManifest, nativeSeasonSettings, nativeSeasonScoring, nativeSeasonWaivers } from './seasonNativeContract'
import { seasonContractHash } from './seasonCalendarVerification'
import { assessSeasonScoringSourceReadiness } from './seasonScoringSourceReadiness'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { hasSeasonDraftRelease } from './seasonDraftReleaseGate'
class RetrySetup extends Error {}

/** One native league is an atomic unit; no network/provider calls occur while holding the lock. */
export async function provisionNextSeasonLeague(userId: string, tournamentId: string, freezeId: string, requestedKey?: string) {
  const tenant = resolveDeploymentTenantId()
  if (!tenant.ok) throw new BlueprintOperationError('Native setup needs a configured server tenant. Contact the platform administrator.', 409)
  const actor = createActorContext({ userId, actorLabel: userId, tenantId: tenant.value, leagueRole: 'COMMISSIONER' })
  if (!actor.ok) throw new BlueprintOperationError('Could not resolve the setup actor.', 403)
  let attemptedKey: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTenant(actor.value.tenantId, async db => {
        const shell = await db.tournamentShell.findUnique({ where: { id: tournamentId } })
        if (!shell) throw new BlueprintOperationError('Tournament not found.', 404)
        if (shell.commissionerId !== userId) throw new BlueprintOperationError('Only the tournament owner can create opening leagues.', 403)
        if (shell.status !== 'rules_published') throw new BlueprintOperationError('This tournament is unavailable for season setup.', 409)
        const timestamp = new Date(Math.max(Date.now(), shell.updatedAt.getTime() + 1))
        const lock = await db.tournamentShell.updateMany({ where: { id: tournamentId, status: shell.status, updatedAt: shell.updatedAt }, data: { updatedAt: timestamp } })
        if (lock.count !== 1) throw new RetrySetup()
        const event = await db.tournamentAuditLog.findFirst({ where: { id: freezeId, tournamentId, action: 'season_opening_field_frozen' } })
        if (!event) throw new BlueprintOperationError('Freeze the full opening field before setup.', 409)
        const raw = event.data as Record<string, unknown>, { manifestHash, ...payload } = raw
        if (seasonContractHash(payload) !== manifestHash) throw new BlueprintOperationError('The frozen assignment checksum does not match. Setup is blocked for review.', 409)
        const manifest = readOpeningManifest(raw)
        const publication = await db.tournamentAuditLog.findFirst({ where: { id: manifest.publicationId, tournamentId, action: 'season_rules_published' } })
        const pub = publication?.data as { hash?: string; config?: unknown } | undefined
        if (pub?.hash !== manifest.rulesHash || seasonContractHash(pub.config) !== seasonContractHash(manifest.config)) throw new BlueprintOperationError('The frozen field does not match its published contract.', 409)
        const completed = await db.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_opening_league_provisioned' } })
        if (completed.some(row => {
          const binding = row.data as { freezeId?: string; tenantId?: string }
          return binding.freezeId !== freezeId || binding.tenantId !== actor.value.tenantId
        })) throw new BlueprintOperationError('Opening setup belongs to a different frozen field or server tenant. Setup is blocked for review.', 409)
        const done = new Map(completed.map(row => [row.targetId, row]))
        const pool = requestedKey ? manifest.leagues.find(l => l.key === requestedKey) : manifest.leagues.find(l => !done.has(l.key))
        if (requestedKey && !pool) throw new BlueprintOperationError('Unknown opening league.', 404)
        // Once all pools exist, a retry reconciles them instead of reporting readiness blindly.
        const pools = pool ? [pool] : manifest.leagues
        for (const item of pools) {
          const checkpoint = done.get(item.key)
          if (!checkpoint) continue
          const ids = checkpoint.data as { leagueId: string; draftId: string; tournamentLeagueId: string; manifestHash: string }
          const [league, draft, rosters, seats, teams, bindings, waiver, members, draftSettings, waiverSettings, scoring, tournamentLeague] = await Promise.all([
            db.league.findFirst({ where: { id: ids.leagueId, tenantId: actor.value.tenantId } }),
            db.draftSession.findUnique({ where: { id: ids.draftId } }),
            db.roster.findMany({ where: { leagueId: ids.leagueId }, orderBy: { waiverPriority: 'desc' } }),
            db.leagueEntrySlot.findMany({ where: { leagueId: ids.leagueId } }),
            db.leagueTeam.findMany({ where: { leagueId: ids.leagueId } }),
            db.tournamentLeagueParticipant.findMany({ where: { tournamentLeagueId: ids.tournamentLeagueId } }),
            db.leagueWaiverState.findUnique({ where: { leagueId: ids.leagueId } }),
            db.redraftLeagueMember.findMany({ where: { leagueId: ids.leagueId } }),
            db.leagueSettings.findUnique({ where: { leagueId: ids.leagueId } }),
            db.leagueWaiverSettings.findUnique({ where: { leagueId: ids.leagueId } }),
            db.leagueScoringOverride.findMany({ where: { leagueId: ids.leagueId } }),
            db.tournamentLeague.findUnique({ where: { id: ids.tournamentLeagueId } }),
          ])
          const expectedSettings = nativeSeasonSettings(manifest, tournamentId, freezeId, item.key)
          const order = draft?.slotOrder as Array<{ slot: number; rosterId: string }> | undefined
          const r = manifest.config.rules!, expectedWaivers = nativeSeasonWaivers(manifest)
          const scoringRows = scoring.map(w => ({ statKey: w.statKey, pointsValue: w.pointsValue, enabled: w.enabled })).sort((a, b) => a.statKey.localeCompare(b.statKey))
          const expectedScoring = nativeSeasonScoring(manifest).sort((a, b) => a.statKey.localeCompare(b.statKey))
          const expectedPriority = [...rosters].reverse().map(roster => ({ rosterId: roster.id, waiverPriority: roster.waiverPriority, faabRemaining: roster.faabRemaining }))
          const expectedBalances = Object.fromEntries(rosters.map(roster => [roster.id, r.waivers.mode === 'faab' ? r.waivers.budget : 0]))
          const released = league && await hasSeasonDraftRelease(ids.leagueId, league.settings, db)
          const draftStateConsistent = released
            ? tournamentLeague?.status === 'season_draft_ready' && ['pre_draft', 'drafting'].includes(league.lifecycleState) && ['pre_draft', 'in_progress', 'paused', 'completed'].includes(draft?.status ?? '')
            : tournamentLeague?.status === 'season_setup_blocked' && league?.lifecycleState === 'setup' && draft?.status === 'tournament_setup_blocked'
          const consistent = seasonContractHash(waiver?.currentPriorityOrder) === seasonContractHash(expectedPriority) && seasonContractHash(waiver?.faabState) === seasonContractHash(expectedBalances) && members.length === item.slots + (item.members.some(m => m.userId === userId) ? 0 : 1) && item.members.every(m => members.some(member => member.userId === m.userId && member.teamNumber === m.draftSlot && member.role === (m.userId === userId ? 'COMMISSIONER' : 'MEMBER'))) && draftSettings?.draftOrderLocked === true && draftSettings.autostart === false && draftSettings.rounds === manifest.config.rosterSize && draftSettings.draftType === manifest.config.draftType && draftSettings.pickTimerCustomValue === r.draftPolicy!.pickClockSeconds && seasonContractHash(draftSettings.draftOrderSlots) === seasonContractHash(draft?.slotOrder) && seasonContractHash(scoringRows) === seasonContractHash(expectedScoring) && seasonContractHash(Object.fromEntries(Object.keys(expectedWaivers).map(key => [key, Reflect.get(waiverSettings ?? {}, key)]))) === seasonContractHash(expectedWaivers) && tournamentLeague?.leagueId === ids.leagueId && draftStateConsistent && tournamentLeague.draftSessionId === ids.draftId && draft?.auctionBudgetPerTeam === (manifest.config.draftType === 'auction' ? r.draftPolicy!.auctionBudget : null) && league?.locked === true && ids.manifestHash === manifest.manifestHash && league?.userId === userId && seasonContractHash(league.settings) === seasonContractHash(expectedSettings) && draft?.leagueId === league.id && draft.rounds === manifest.config.rosterSize && draft.teamCount === item.slots && draft.draftType === manifest.config.draftType && draft.timerSeconds === manifest.config.rules!.draftPolicy!.pickClockSeconds && rosters.length === item.slots && seats.length === item.slots && teams.length === item.slots && bindings.length === item.slots && waiver?.processingLocked === true && members.some(m => m.userId === userId && m.role === 'COMMISSIONER') && order?.length === item.slots && item.members.every((m, i) => {
            const roster = rosters[i]
            return roster?.platformUserId === m.userId && roster.waiverPriority === m.waiverPriority && roster.faabRemaining === (r.waivers.mode === 'faab' ? r.waivers.budget : null) && order[i]?.rosterId === roster.id && order[i]?.slot === m.draftSlot && seats.some(s => s.rosterId === roster.id && s.slotNumber === m.draftSlot && s.status === 'FILLED') && teams.some(t => t.externalId === roster.id && t.claimedByUserId === m.userId) && bindings.some(b => b.participantId === m.id && b.userId === m.userId && b.draftSlot === m.draftSlot)
          })
          if (!consistent) throw new BlueprintOperationError('An existing opening league has drifted from the frozen assignment. Setup is blocked for review; records were not overwritten.', 409)
        }
        if (!pool || done.has(pool.key)) return { complete: done.size === manifest.leagues.length, created: false, completed: done.size, total: manifest.leagues.length, launchReady: false }
        attemptedKey = pool.key
        const draftAt = manifest.config.rules!.calendar.drafts.find(d => d.stage === 1)!.startsAt
        if (Date.parse(draftAt) <= Date.now()) throw new BlueprintOperationError('The opening draft window has started. New league setup is blocked for schedule review.', 409)
        const entrants = await db.tournamentParticipant.findMany({ where: { tournamentId, id: { in: pool.members.map(m => m.id) } } })
        if (entrants.length !== pool.slots || pool.members.some(m => !entrants.some(e => e.id === m.id && e.userId === m.userId && e.status === 'registered'))) throw new BlueprintOperationError('A frozen entrant has changed. Setup is blocked for review.', 409)
        const result = await createSeasonTournamentLeague(db, actor.value, tournamentId, freezeId, manifest, pool.key)
        await db.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action: 'season_opening_league_provisioned', targetType: 'opening_league', targetId: pool.key, data: { ...result, freezeId, tenantId: actor.value.tenantId }, createdAt: timestamp } })
        return { complete: done.size + 1 === manifest.leagues.length, created: true, completed: done.size + 1, total: manifest.leagues.length, launchReady: false }
      })
    } catch (e) {
      if (e instanceof RetrySetup || (e as { code?: string }).code === 'P2034') {
        if (attempt < 2) continue
        throw new BlueprintOperationError('Opening setup is busy. Retry to resume without duplicating leagues.', 409)
      }
      if (attemptedKey && !(e instanceof BlueprintOperationError)) {
        // Record only safe failure metadata, in a new transaction after the failed unit rolled back.
        try { await withTenant(actor.value.tenantId, db => db.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action: 'season_opening_league_failed', targetType: 'opening_league', targetId: attemptedKey, data: { freezeId, reason: 'native_setup_failed', retryable: true } } })) } catch { /* A retry still derives unfinished work from committed checkpoints. */ }
      }
      throw e
    }
  }
  throw new BlueprintOperationError('Opening setup is busy.', 409)
}

export async function loadSeasonNativeSetup(userId: string, tournamentId: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || shell.commissionerId !== userId) throw new BlueprintOperationError('Only the tournament owner can view opening setup.', 403)
  const frozen = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
  if (!frozen) return null
  const manifest = readOpeningManifest(frozen.data)
  const checkpoints = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: { in: ['season_opening_league_provisioned', 'season_opening_league_failed', 'season_opening_draft_released'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return { freezeId: frozen.id, launchReady: false, draftReleaseEnabled: process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED === 'true', scoringSource: assessSeasonScoringSourceReadiness(manifest.config.rules!), scoringPeriods: manifest.config.rules?.calendar.periods.filter(p => p.number >= manifest.config.startWeek && p.number <= manifest.config.firstCutWeek).map(p => p.number) ?? [], leagues: manifest.leagues.map((l, index) => {
    const success = checkpoints.find(e => e.targetId === l.key && e.action === 'season_opening_league_provisioned' && (e.data as { freezeId?: string }).freezeId === frozen.id)
    const failed = checkpoints.find(e => e.targetId === l.key && e.action === 'season_opening_league_failed')
    const leagueId = success ? (success.data as { leagueId: string }).leagueId : null
    const released = checkpoints.some(e => e.action === 'season_opening_draft_released' && e.targetType === 'league' && e.targetId === leagueId && (e.data as { freezeId?: string; manifestHash?: string; key?: string; seasonLaunchReady?: boolean }).freezeId === frozen.id && (e.data as { manifestHash?: string }).manifestHash === manifest.manifestHash && (e.data as { key?: string }).key === l.key && (e.data as { seasonLaunchReady?: boolean }).seasonLaunchReady === false)
    return { key: l.key, name: l.name, art: identityArt(manifest.config, index), division: l.division, slots: l.slots, state: success ? 'created' : failed ? 'retry_needed' : 'pending', leagueId, draftReleased: released }
  }) }
}
