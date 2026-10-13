import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hydrateRedraftLineupLocksForRosters } from '@/lib/redraft/lineupLock'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { movePlayerBoundIdolsInTransaction } from './playerBoundIdolTransfer'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { transferNbaSurvivorRosterPlayer } from './transferNbaSurvivorRosterPlayer'

type Power = 'triple_steal' | 'island_raid'
type Result<T> = { ok: true; value: T } | { ok: false; status: 403 | 404 | 409 | 422; code: string; error: string }
type Player = { id: string; rosterId: string; playerId: string; playerName: string; position: string; team: string | null; sport: string; slotType: string; isLocked: boolean; injuryStatus: string | null }

function failure(status: 403 | 404 | 409 | 422, code: string, error: string): Result<never> { return { ok: false, status, code, error } }
function isBench(player: Player): boolean { return ['BN', 'BENCH'].includes(player.slotType.toUpperCase()) }
function isIr(player: Player): boolean { return ['IR', 'RESERVE'].includes(player.slotType.toUpperCase()) }

async function loadPreview(leagueId: string, userId: string, idolId: string): Promise<Result<{
  idol: { id: string; powerType: Power }
  seasonId: string; season: number; week: number; settings: Prisma.JsonValue; myRosterId: string
  teams: Array<{ rosterId: string; teamName: string; players: Player[] }>
  myBench: Player[]; benchSlots: number; requiredDrops: number; lockWarnings: string[]
}>> {
  const idol = await prisma.survivorIdol.findFirst({ where: { id: idolId, leagueId, currentOwnerUserId: userId, isUsed: false, status: 'hidden', powerType: { in: ['triple_steal', 'island_raid'] } }, select: { id: true, powerType: true } })
  if (!idol) return failure(404, 'idol_unavailable', 'You do not hold an unused Steal 3 idol.')
  const state = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, activePlayerCount: true } })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = normalizeSurvivorFoundationSettings(league?.settings as Record<string, unknown> | null)
  if (!state || state.currentWeek < 1 || state.activePlayerCount <= settings.idolInvalidRemainingPlayers) return failure(409, 'idol_expired', 'Steal 3 cannot be played in this phase.')
  const owner = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { playerState: true, redraftRosterId: true } })
  const rosterLink = owner?.redraftRosterId ? await prisma.roster.findUnique({ where: { id: owner.redraftRosterId }, select: { redraftRosterId: true } }) : null
  if (owner?.playerState !== 'active' || !rosterLink?.redraftRosterId) return failure(403, 'not_active_manager', 'Only an active main-island manager can play Steal 3.')
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, sport: 'NBA' }, orderBy: { season: 'desc' }, select: { id: true, season: true, rosters: { select: { id: true, ownerId: true, teamName: true, players: { where: { droppedAt: null }, select: { id: true, rosterId: true, playerId: true, playerName: true, position: true, team: true, sport: true, slotType: true, isLocked: true, injuryStatus: true } } } } } })
  if (!season || !season.rosters.some(roster => roster.id === rosterLink.redraftRosterId)) return failure(409, 'season_roster_missing', 'The NBA season roster is not ready.')
  const activeManagers = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { redraftRosterId: true } })
  const activeLinks = await prisma.roster.findMany({ where: { id: { in: activeManagers.map(manager => manager.redraftRosterId).filter((id): id is string => Boolean(id)) } }, select: { redraftRosterId: true } })
  const activeSeasonRosterIds = new Set(activeLinks.map(link => link.redraftRosterId))
  const allPlayers = season.rosters.flatMap(roster => roster.players)
  const derived = await hydrateRedraftLineupLocksForRosters(prisma, { sport: 'NBA', season: season.season, week: state.currentWeek, leagueSettings: league?.settings, players: allPlayers, now: new Date() })
  const byRoster = new Map<string, Player[]>()
  for (const player of derived.players) byRoster.set(player.rosterId, [...(byRoster.get(player.rosterId) ?? []), player])
  const config = resolveRedraftRosterConfig('NBA', league?.settings)
  const mine = byRoster.get(rosterLink.redraftRosterId) ?? []
  const bench = mine.filter(player => isBench(player) && !player.isLocked && !isIr(player))
  const occupiedBench = mine.filter(isBench).length
  const requiredDrops = Math.max(0, occupiedBench + 3 - config.benchSlots, mine.length + 3 - config.maxRosterSize)
  return { ok: true, value: {
    idol: { id: idol.id, powerType: idol.powerType as Power }, seasonId: season.id, season: season.season, week: state.currentWeek,
    settings: league?.settings ?? {}, myRosterId: rosterLink.redraftRosterId,
    teams: season.rosters.filter(roster => roster.id !== rosterLink.redraftRosterId && activeSeasonRosterIds.has(roster.id)).map(roster => ({ rosterId: roster.id, teamName: roster.teamName ?? 'Opponent', players: byRoster.get(roster.id) ?? [] })),
    myBench: bench, benchSlots: config.benchSlots, requiredDrops, lockWarnings: derived.warnings,
  } }
}

export async function getStealThreePreview(leagueId: string, userId: string, idolId: string): Promise<Result<{
  powerType: Power; teams: Array<{ rosterId: string; teamName: string; players: Array<{ id: string; playerName: string; position: string; team: string | null; disabled: boolean }> }>
  myBench: Array<{ id: string; playerName: string; position: string }> ; requiredDrops: number; lockWarnings: string[]
}>> {
  const preview = await loadPreview(leagueId, userId, idolId)
  if (!preview.ok) return preview
  const data = preview.value
  return { ok: true, value: { powerType: data.idol.powerType,
    teams: data.teams.map(team => ({ rosterId: team.rosterId, teamName: team.teamName, players: team.players.map(player => ({ id: player.id, playerName: player.playerName, position: player.position, team: player.team, disabled: player.isLocked || isIr(player) || data.lockWarnings.length > 0 })) })),
    myBench: data.myBench.map(player => ({ id: player.id, playerName: player.playerName, position: player.position })),
    requiredDrops: data.requiredDrops, lockWarnings: data.lockWarnings,
  } }
}

export async function playStealThree(leagueId: string, userId: string, input: { idolId: string; playerRowIds: string[]; dropRowIds: string[] }): Promise<Result<{ raidedUserIds: string[]; playerNames: string[]; week: number }>> {
  if (input.playerRowIds.length !== 3 || new Set(input.playerRowIds).size !== 3 || new Set(input.dropRowIds).size !== input.dropRowIds.length) return failure(422, 'exactly_three', 'Choose exactly three distinct players and distinct bench drops.')
  const preview = await loadPreview(leagueId, userId, input.idolId)
  if (!preview.ok) return preview
  const initial = preview.value
  if (initial.lockWarnings.length) return failure(409, 'schedule_unavailable', 'NBA lock data is unavailable. Steal 3 is paused until the game schedule can be verified.')
  if (input.dropRowIds.length !== initial.requiredDrops) return failure(422, 'incorrect_drops', `Choose exactly ${initial.requiredDrops} unlocked bench player${initial.requiredDrops === 1 ? '' : 's'} to drop.`)
  const selected = initial.teams.flatMap(team => team.players).filter(player => input.playerRowIds.includes(player.id))
  if (selected.length !== 3 || selected.some(player => player.isLocked || isIr(player))) return failure(409, 'player_locked', 'A selected player is unavailable. Return to player selection.')
  if (initial.idol.powerType === 'triple_steal' && new Set(selected.map(player => player.rosterId)).size !== 1) return failure(422, 'one_team_required', 'Triple Raid must take all three players from one team.')
  if (initial.myBench.filter(player => input.dropRowIds.includes(player.id)).length !== input.dropRowIds.length) return failure(409, 'drop_unavailable', 'A bench drop changed. Return to roster selection.')

  type Commit = { ok: true; raidedUserIds: string[]; playerNames: string[]; week: number } | { ok: false; code: string; error: string }
  const commit = await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<Commit> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-steal-three:${leagueId}`}, 0))::text`
    const idol = await tx.survivorIdol.findFirst({ where: { id: input.idolId, leagueId, currentOwnerUserId: userId, powerType: initial.idol.powerType, status: 'hidden', isUsed: false }, select: { id: true, rosterId: true } })
    const state = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } })
    if (!idol || state?.currentWeek !== initial.week) return { ok: false, code: 'state_changed', error: 'The idol or week changed. Refresh and try again.' }
    const rows = await tx.redraftRosterPlayer.findMany({ where: { id: { in: [...input.playerRowIds, ...input.dropRowIds] }, droppedAt: null } })
    if (rows.length !== 3 + input.dropRowIds.length) return { ok: false, code: 'player_changed', error: 'A player changed teams. Return to player selection.' }
    const chosen = rows.filter(row => input.playerRowIds.includes(row.id))
    const drops = rows.filter(row => input.dropRowIds.includes(row.id))
    if (chosen.some(row => !initial.teams.some(team => team.rosterId === row.rosterId) || isIr(row)) || drops.some(row => row.rosterId !== initial.myRosterId || !isBench(row))) return { ok: false, code: 'roster_changed', error: 'A roster changed. Return to player selection.' }
    if (initial.idol.powerType === 'triple_steal' && new Set(chosen.map(row => row.rosterId)).size !== 1) return { ok: false, code: 'one_team_required', error: 'All three players must come from one team.' }
    const freshAll = await tx.redraftRosterPlayer.findMany({ where: { rosterId: { in: [initial.myRosterId, ...initial.teams.map(team => team.rosterId)] }, droppedAt: null } })
    const currentMine = freshAll.filter(row => row.rosterId === initial.myRosterId)
    const config = resolveRedraftRosterConfig('NBA', initial.settings)
    const dropsNeededNow = Math.max(0, currentMine.filter(isBench).length + 3 - config.benchSlots, currentMine.length + 3 - config.maxRosterSize)
    if (dropsNeededNow !== input.dropRowIds.length) return { ok: false, code: 'roster_changed', error: 'Your roster capacity changed. Return to bench selection.' }
    const locks = await hydrateRedraftLineupLocksForRosters(prisma, { sport: 'NBA', season: initial.season, week: initial.week, leagueSettings: initial.settings, players: freshAll, now: new Date() })
    if (locks.warnings.length || locks.players.filter(row => [...input.playerRowIds, ...input.dropRowIds].includes(row.id)).some(row => row.isLocked)) return { ok: false, code: 'player_locked', error: 'A player locked while you were choosing. Return to player selection.' }
    const consumed = await tx.survivorIdol.updateMany({ where: { id: idol.id, isUsed: false, status: 'hidden', currentOwnerUserId: userId }, data: { isUsed: true, status: 'played', usedAt: new Date() } })
    if (consumed.count !== 1) return { ok: false, code: 'idol_changed', error: 'The idol changed. Refresh and try again.' }
    for (const row of drops) {
      const updated = await tx.redraftRosterPlayer.updateMany({ where: { id: row.id, rosterId: initial.myRosterId, droppedAt: null }, data: { droppedAt: new Date() } })
      if (updated.count !== 1) throw new Error('Steal 3 bench drop changed during settlement')
      await movePlayerBoundIdolsInTransaction(tx, { leagueId, playerId: row.playerId, fromRedraftRosterId: initial.myRosterId, reason: 'waiver_drop' })
    }
    for (const row of chosen) {
      const moved = await transferNbaSurvivorRosterPlayer(tx, { rowId: row.id, playerId: row.playerId, fromRosterId: row.rosterId, toRosterId: initial.myRosterId, slotType: 'BN', acquisitionType: 'survivor_steal_three' })
      if (moved !== 1) throw new Error('Steal 3 target changed during settlement')
      await movePlayerBoundIdolsInTransaction(tx, { leagueId, playerId: row.playerId, fromRedraftRosterId: row.rosterId, toRedraftRosterId: initial.myRosterId, reason: 'stolen_player' })
    }
    const sourceIds = [...new Set(chosen.map(row => row.rosterId))]
    const sources = await tx.redraftRoster.findMany({ where: { id: { in: sourceIds } }, select: { id: true, ownerId: true, waiverPriority: true } })
    const firstPriority = await tx.redraftRoster.findFirst({ where: { seasonId: initial.seasonId }, orderBy: { waiverPriority: 'asc' }, select: { waiverPriority: true } })
    const boostedPriority = (firstPriority?.waiverPriority ?? 0) - 1
    for (const source of sources) {
      const prior = source.waiverPriority
      await tx.redraftRoster.update({ where: { id: source.id }, data: { waiverPriority: boostedPriority } })
      await tx.survivorAuditEntry.create({ data: { leagueId, week: initial.week, category: 'idol', action: 'steal_three_waiver_boost', actorUserId: userId, targetUserId: source.ownerId, relatedEntityId: source.id, relatedEntityType: 'redraft_roster', data: { previousPriority: prior, boostedPriority, week: initial.week }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
      await tx.platformNotification.create({ data: { userId: source.ownerId, type: 'survivor:steal_three', title: 'Your roster was raided', body: 'Three-player raid results are in your league. You have top waiver priority for this week.', severity: 'high', productType: 'sports', meta: { leagueId, deepLinkPath: `/league/${leagueId}` } } })
      await tx.leagueChatMessage.create({ data: { leagueId, userId, message: `@Chimmy: Your team was raided. ${chosen.filter(row => row.rosterId === source.id).map(row => row.playerName).join(', ')} moved to another roster. You have top waiver priority for week ${initial.week}.`, type: 'system', isPrivate: true, visibleToUserId: source.ownerId, messageSubtype: 'chimmy_private' } })
    }
    const channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (channel) await tx.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'AF Host', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement', content: `Steal 3 was played in week ${initial.week}. ${chosen.map(row => row.playerName).join(', ')} moved to a new team. The raided teams have top waiver priority this week.` } })
    await tx.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'played', fromRosterId: idol.rosterId, metadata: { powerType: initial.idol.powerType, week: initial.week, playerIds: chosen.map(row => row.playerId) } } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: initial.week, category: 'idol', action: 'steal_three_played', actorUserId: userId, relatedEntityId: idol.id, relatedEntityType: 'idol', data: { powerType: initial.idol.powerType, sourceRosterIds: sourceIds, playerIds: chosen.map(row => row.playerId), dropPlayerIds: drops.map(row => row.playerId) }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    return { ok: true, raidedUserIds: sources.map(source => source.ownerId), playerNames: chosen.map(row => row.playerName), week: initial.week }
  }, { timeout: 30_000, maxWait: 10_000 })
  if (!commit.ok) return failure(409, commit.code, commit.error)
  return { ok: true, value: { raidedUserIds: commit.raidedUserIds, playerNames: commit.playerNames, week: commit.week } }
}
