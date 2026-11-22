import type { Prisma } from '@prisma/client'
import { verifiedSGNativePlayer } from '@/lib/survivor-guillotine/playerCatalog'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { resolveRedraftRosterConfig } from './rosterConfigResolver'
import { normalizeToken } from './lineupValidation'

/** Settle a Survivor waiver against the authoritative scoring roster inside the caller's transaction. */
export async function applyLegacyWaiverToCanonical(tx: Prisma.TransactionClient, args: {
  leagueId: string; rosterId: string; addPlayerId: string; dropPlayerId: string | null;
  faabSpent?: number | null; claimId?: string; originRedraftClaimId?: string; priorityAfter?: number
}) {
  await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${args.leagueId} FOR UPDATE`
  const league = await tx.league.findUniqueOrThrow({ where: { id: args.leagueId }, select: { leagueVariant: true, sport: true, settings: true } })
  if (league.leagueVariant !== 'survivor_guillotine') throw new Error('This settlement is only for Survivor Guilly leagues.')
  const generic = await tx.roster.findFirst({ where: { id: args.rosterId, leagueId: args.leagueId }, select: { redraftRosterId: true } })
  if (!generic?.redraftRosterId) throw new Error('This native team needs a linked scoring roster before claiming players.')
  const roster = await tx.redraftRoster.findFirst({ where: { id: generic.redraftRosterId, leagueId: args.leagueId }, include: { season: true } })
  if (!roster) throw new Error('The scoring roster is unavailable.')
  await tx.$queryRaw`SELECT id FROM redraft_seasons WHERE id = ${roster.seasonId} FOR UPDATE`
  const season = await tx.redraftSeason.findUnique({ where: { id: roster.seasonId } })
  if (!season || season.status === 'complete' || roster.isEliminated) throw new Error('This scoring roster cannot acquire players.')
  if (await tx.redraftRosterPlayer.findFirst({ where: { playerId: args.addPlayerId, droppedAt: null, roster: { seasonId: roster.seasonId } } })) {
    throw new Error('This player is already on a scoring roster in this league.')
  }
  const meta = await verifiedSGNativePlayer(tx, roster.season.sport, args.addPlayerId)
  if (!meta?.position) throw new Error('Verified native player identity is required for this claim.')
  if (args.dropPlayerId) {
    const dropped = await tx.redraftRosterPlayer.updateMany({ where: { rosterId: roster.id, playerId: args.dropPlayerId, droppedAt: null }, data: { droppedAt: new Date() } })
    if (dropped.count !== 1) throw new Error('Drop player is no longer on your scoring roster.')
  }
  const config = resolveRedraftRosterConfig(roster.season.sport, league.settings)
  const active = await tx.redraftRosterPlayer.findMany({ where: { rosterId: roster.id, droppedAt: null }, select: { slotType: true } })
  if (active.length >= config.maxRosterSize || active.filter(player => normalizeToken(player.slotType) === 'BENCH').length >= config.benchSlots) {
    throw new Error('The scoring roster has no available bench space for this acquisition.')
  }
  await tx.redraftRosterPlayer.create({ data: { rosterId: roster.id, playerId: args.addPlayerId, playerName: meta.name,
    position: meta.position, team: meta.team, sport: roster.season.sport, slotType: 'BENCH', acquisitionType: 'waiver' } })
  if (args.faabSpent) {
    const paid = await tx.redraftRoster.updateMany({ where: { id: roster.id, faabBalance: { gte: args.faabSpent } }, data: { faabBalance: { decrement: args.faabSpent } } })
    if (paid.count !== 1) throw new Error('Insufficient FAAB on the scoring roster.')
  }
  return { playerName: meta.name, position: meta.position }
}

/** Refuse to commit if generic and scoring roster ownership or budgets diverge. */
export async function mirrorCanonicalRosters(tx: Prisma.TransactionClient, rosterIds: string[]) {
  for (const id of new Set(rosterIds)) {
    const generic = await tx.roster.findFirst({ where: { redraftRosterId: id }, select: { playerData: true, faabRemaining: true } })
    const native = await tx.redraftRoster.findUnique({ where: { id }, select: { faabBalance: true } })
    if (!generic || !native) throw new Error('Linked scoring roster disappeared during settlement.')
    const rows = await tx.redraftRosterPlayer.findMany({ where: { rosterId: id, droppedAt: null }, select: { playerId: true } })
    const genericIds = new Set(getRosterPlayerIds(generic.playerData))
    const nativeIds = new Set(rows.map(row => row.playerId))
    if (genericIds.size !== nativeIds.size || [...genericIds].some(playerId => !nativeIds.has(playerId)) ||
      (generic.faabRemaining != null && native.faabBalance != null && generic.faabRemaining !== native.faabBalance)) {
      throw new Error('Generic and scoring rosters disagree; waiver settlement was rolled back.')
    }
  }
}
