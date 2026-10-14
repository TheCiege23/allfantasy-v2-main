import type { Prisma } from '@prisma/client'
import type { ActorContext } from './actorContext'
import type { OpeningManifest } from '@/lib/tournament/seasonNativeContract'
import { nativeSeasonSettings, nativeSeasonScoring, nativeSeasonWaivers } from '@/lib/tournament/seasonNativeContract'
import { createHash } from 'node:crypto'

/** Stable UUID-shaped IDs keep recovery independent of process lifetime. */
export function seasonResourceId(freezeId: string, resource: string) {
  const h = createHash('sha256').update(JSON.stringify([freezeId, resource])).digest('hex')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32)
}
export async function createSeasonTournamentLeague(tx: Prisma.TransactionClient, actor: ActorContext, tournamentId: string, freezeId: string, manifest: OpeningManifest, key: string) {
  const pool = manifest.leagues.find(l => l.key === key)
  if (!pool) throw new Error('Unknown frozen league.')
  const c = manifest.config, r = c.rules!, draft = r.calendar.drafts.find(d => d.stage === 1)!
  const id = seasonResourceId(freezeId, key), tournamentLeagueId = seasonResourceId(freezeId, key + ':shell'), draftId = seasonResourceId(freezeId, key + ':draft')
  const roundId = seasonResourceId(freezeId, 'round:1')
  await tx.tournamentRound.upsert({ where: { tournamentId_roundNumber: { tournamentId, roundNumber: 1 } }, create: { id: roundId, tournamentId, roundNumber: 1, roundType: 'season_qualifier', roundLabel: 'Opening qualifier', weekStart: c.startWeek, weekEnd: c.firstCutWeek, status: 'setup_blocked', draftScheduledAt: new Date(draft.startsAt) }, update: {} })
  // Caller owns the shell lock; conflicts roll back rather than adopting unrelated rows.
  await tx.league.create({ data: { id, tenantId: actor.tenantId, userId: actor.userId, isCommissioner: true, platform: 'manual', platformLeagueId: id, name: pool.name, sport: c.sport, season: new Date(r.calendar.regularSeasonStartsAt).getUTCFullYear(), leagueSize: pool.slots, rosterSize: c.rosterSize, scoring: c.scoring, leagueType: 'redraft', leagueVariant: 'season_tournament', status: 'tournament_setup', lifecycleState: 'setup', locked: true, timezone: r.calendar.timezone, starters: r.starters.flatMap(s => Array.from({ length: s.count }, () => s.position)), settings: nativeSeasonSettings(manifest, tournamentId, freezeId, key) as Prisma.InputJsonValue, syncStatus: 'manual' } })
  await tx.tournamentLeague.create({ data: { id: tournamentLeagueId, tournamentId, roundId, leagueId: id, name: pool.name, slug: key, leagueNumber: manifest.leagues.indexOf(pool) + 1, teamSlots: pool.slots, currentTeamCount: pool.slots, status: 'season_setup_blocked', draftScheduledAt: new Date(draft.startsAt), draftSessionId: draftId } })
  const slotOrder = pool.members.map(m => ({ slot: m.draftSlot, rosterId: seasonResourceId(freezeId, key + ':roster:' + m.id), displayName: m.displayName, open: false }))
  await tx.leagueSettings.create({ data: { leagueId: id, draftDateUtc: new Date(draft.startsAt), timezone: r.calendar.timezone, autostart: false, draftType: c.draftType, rounds: c.rosterSize, cpuAutoPick: true, aiAutoPick: false, pickTimerPreset: 'custom', pickTimerCustomValue: r.draftPolicy!.pickClockSeconds, draftOrderMethod: 'manual', draftOrderLocked: true, draftOrderSlots: slotOrder } })
  await tx.leagueWaiverSettings.create({ data: { leagueId: id, ...nativeSeasonWaivers(manifest) } })
  await tx.leagueScoringOverride.createMany({ data: nativeSeasonScoring(manifest).map(w => ({ leagueId: id, ...w })) })
  for (const m of pool.members) {
    const rosterId = seasonResourceId(freezeId, key + ':roster:' + m.id)
    await tx.roster.create({ data: { id: rosterId, leagueId: id, platformUserId: m.userId, playerData: { players: [], draftPicks: [], foundation: { slotNumber: m.draftSlot, openTeam: false, createdBy: 'season_tournament' } }, faabRemaining: r.waivers.mode === 'faab' ? r.waivers.budget : null, waiverPriority: m.waiverPriority, settings: { openSlot: false, commissioner: m.userId === actor.userId } } })
    await tx.leagueTeam.create({ data: { leagueId: id, externalId: rosterId, platformUserId: m.userId, claimedByUserId: m.userId, ownerName: m.displayName, teamName: m.displayName, avatarUrl: m.avatarUrl, isCommissioner: m.userId === actor.userId, role: m.userId === actor.userId ? 'commissioner' : 'member' } })
    await tx.leagueEntrySlot.create({ data: { leagueId: id, slotNumber: m.draftSlot, status: 'FILLED', rosterId } })
    await tx.redraftLeagueMember.create({ data: { leagueId: id, userId: m.userId, teamNumber: m.draftSlot, role: m.userId === actor.userId ? 'COMMISSIONER' : 'MEMBER' } })
    await tx.tournamentLeagueParticipant.create({ data: { tournamentLeagueId, participantId: m.id, userId: m.userId, draftSlot: m.draftSlot, faabBalance: r.waivers.mode === 'faab' ? r.waivers.budget : 0, advancementStatus: 'competing' } })
    await tx.tournamentParticipant.update({ where: { id: m.id }, data: { currentLeagueId: tournamentLeagueId, currentRoundNumber: 1 } })
  }
  if (!pool.members.some(m => m.userId === actor.userId)) await tx.redraftLeagueMember.create({ data: { leagueId: id, userId: actor.userId, role: 'COMMISSIONER' } })
  await tx.leagueWaiverState.create({ data: { leagueId: id, currentPriorityOrder: [...pool.members].reverse().map(m => ({ rosterId: seasonResourceId(freezeId, key + ':roster:' + m.id), waiverPriority: m.waiverPriority, faabRemaining: r.waivers.mode === 'faab' ? r.waivers.budget : null })), faabState: Object.fromEntries(pool.members.map(m => [seasonResourceId(freezeId, key + ':roster:' + m.id), r.waivers.mode === 'faab' ? r.waivers.budget : 0])), processingLocked: true } })
  await tx.draftSession.create({ data: { id: draftId, leagueId: id, status: 'tournament_setup_blocked', draftType: c.draftType, rounds: c.rosterSize, teamCount: pool.slots, timerSeconds: r.draftPolicy!.pickClockSeconds, slotOrder, sportType: c.sport, sessionKind: 'live', cpuAutoPick: true, aiAutoPick: false, inDraftPlayerTradesEnabled: false, auctionBudgetPerTeam: c.draftType === 'auction' ? r.draftPolicy!.auctionBudget : null } })
  return { key, leagueId: id, tournamentLeagueId, draftId, rosterCount: pool.slots, manifestHash: manifest.manifestHash, launchReady: false }
}
