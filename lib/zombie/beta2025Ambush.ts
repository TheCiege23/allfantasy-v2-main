import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { lockItemLeague, refreshItemScores } from './beta2025ItemService'
import { combatTransaction } from './beta2025CombatTransaction'
import { planBetaAmbush, type AmbushPair } from './beta2025CombatPolicy'

type Tx = Prisma.TransactionClient
const fingerprint = (week: number, matches: Array<{ id: string; homeRosterId: string; awayRosterId: string | null }>) =>
  createHash('sha256').update(JSON.stringify({ week, matches: matches.map(m => [m.id, m.homeRosterId, m.awayRosterId]).sort((a, b) => a[0]!.localeCompare(b[0]!)) })).digest('hex')

function includeScoredLocks(matches: Array<{ homeRosterId: string; awayRosterId: string | null; status: string; homeScore: number; awayScore: number; lineupSnapshots: unknown }>, locked: Set<string>) {
  for (const match of matches) {
    const receipt = (match.lineupSnapshots as { zombieItems?: { homeBaseScore?: number; awayBaseScore?: number } } | null)?.zombieItems
    const hasPlayerScore = receipt ? receipt.homeBaseScore !== 0 || receipt.awayBaseScore !== 0 : match.homeScore !== 0 || match.awayScore !== 0
    if (!['scheduled', 'active'].includes(match.status) || hasPlayerScore) { locked.add(match.homeRosterId); locked.add(match.awayRosterId!) }
  }
}

async function lockedRosters(tx: Tx, rosterIds: string[], season: number, week: number) {
  const players = await tx.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null } })
  const lineups = await loadWeekLineups(tx as never, { redraftRosterIds: rosterIds, season, week })
  const starters = players.filter(p => !['BN', 'BENCH', 'IR', 'TAXI', 'DEVY', 'RESERVE'].includes(weekSlotType(p, lineups).toUpperCase()))
  const games = await buildWeekKickoffMap(tx as never, { sport: 'NFL', season, week })
  const teams = await resolveCurrentLockTeams(tx as never, { sport: 'NFL', platform: 'allfantasy', playerIds: starters.map(p => p.playerId) })
  const locked = new Set<string>()
  for (const player of starters) {
    if (player.byeWeek === week) continue
    const club = teams.has(player.playerId) ? teams.get(player.playerId) : player.team
    const kickoff = lockTeamLookupKeys('NFL', club).map(key => games.byTeam.get(key)).find(Boolean)
    // Unknown times cannot grant permission to move a potentially started team.
    if (!kickoff || kickoff.getTime() <= Date.now()) locked.add(player.rosterId)
  }
  return locked
}

async function context(tx: Tx, leagueId: string, userId: string) {
  const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
  if (z.correctionHoldFromWeek != null) throw new Error('A stat correction is awaiting commissioner recovery. Ambushes are held.')
  if (z.sport !== 'NFL' || z.experienceMode === 'simple' || !['active', 'in_progress'].includes(z.status)) throw new Error('Ambush remaps require an active Enhanced 2025 NFL league.')
  const record = await tx.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })
  const roster = await tx.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  const team = roster && await tx.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } } })
  if (!record || record.userId !== userId || record.wasDefeated || team?.status !== 'Whisperer' || !team.isWhisperer) throw new Error('Only the current Whisperer can remap matchups.')
  if (record.ambushesRemaining <= 0) throw new Error('No seasonal ambushes remain.')
  const config = await tx.zombieLeagueConfig.findUnique({ where: { leagueId } })
  if (config?.ambushRemapMatchup === false) throw new Error('Ambush remaps are disabled in this league.')
  const resolution = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: z.currentWeek } } })
  if (resolution && resolution.status !== 'pending') throw new Error('This week is resolving, complete or awaiting review.')
  const season = await tx.redraftSeason.findFirst({ where: { leagueId, season: z.season } })
  if (!season) throw new Error('Native season is unavailable.')
  const matches = await tx.redraftMatchup.findMany({ where: { seasonId: season.id, week: z.currentWeek, isMedianMatchup: false }, orderBy: { id: 'asc' } })
  if (!matches.length || matches.some(m => !m.awayRosterId)) throw new Error('Every current team needs a head-to-head matchup.')
  return { z, record, matches }
}

export async function previewBetaAmbush(leagueId: string, userId: string) {
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const { z, record, matches } = await context(tx, leagueId, userId)
    const locked = await lockedRosters(tx, matches.flatMap(m => [m.homeRosterId, m.awayRosterId!]), z.season, z.currentWeek)
    includeScoredLocks(matches, locked)
    const rosters = await tx.redraftRoster.findMany({ where: { id: { in: matches.flatMap(m => [m.homeRosterId, m.awayRosterId!]) } }, select: { id: true, teamName: true } })
    return { week: z.currentWeek, previewHash: fingerprint(z.currentWeek, matches), remaining: record.ambushesRemaining,
      matches: matches.map(m => ({ id: m.id, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId!,
        homeName: rosters.find(r => r.id === m.homeRosterId)?.teamName || 'Team', awayName: rosters.find(r => r.id === m.awayRosterId)?.teamName || 'Team',
        locked: locked.has(m.homeRosterId) || locked.has(m.awayRosterId!) })) }
  })
}

export async function executeBetaAmbush(input: { leagueId: string; userId: string; week: number; requestId: string; previewHash: string; pairs: AmbushPair[] }) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.previewHash)) throw new Error('A valid request ID and fresh matchup preview are required.')
  if (!Array.isArray(input.pairs) || input.pairs.length > 20 || input.pairs.some(p => !p || typeof p.homeRosterId !== 'string' || typeof p.awayRosterId !== 'string')) throw new Error('Submit a valid matchup list.')
  const payloadHash = createHash('sha256').update(JSON.stringify({ week: input.week, previewHash: input.previewHash, pairs: input.pairs })).digest('hex')
  const result = await combatTransaction(async tx => {
    await lockItemLeague(tx, input.leagueId)
    const actionId = `ambush2025:${input.leagueId}:${input.userId}:${input.requestId}`
    const existing = await tx.zombieAmbushAction.findUnique({ where: { id: actionId } })
    if (existing) {
      if (existing.validationResult !== payloadHash || existing.status !== 'executed') throw new Error('This request ID belongs to a different ambush.')
      return { actionId, week: existing.week, repeated: true }
    }
    const { z, record, matches } = await context(tx, input.leagueId, input.userId)
    if (z.currentWeek !== input.week || fingerprint(z.currentWeek, matches) !== input.previewHash) throw new Error('The week or matchups changed. Review a fresh preview before confirming.')
    const locked = await lockedRosters(tx, matches.flatMap(m => [m.homeRosterId, m.awayRosterId!]), z.season, z.currentWeek)
    // A finalized/scored row is immutable even if provider kickoff data disappears later.
    includeScoredLocks(matches, locked)
    const plan = planBetaAmbush(matches.map(m => ({ id: m.id, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId! })), input.pairs, locked)
    const debited = await tx.whispererRecord.updateMany({ where: { id: record.id, userId: input.userId, wasDefeated: false, ambushesRemaining: { gt: 0 } },
      data: { ambushesRemaining: { decrement: 1 }, ambushesUsed: { increment: 1 } } })
    if (debited.count !== 1) throw new Error('The ambush balance changed; nothing was spent.')
    const teamUpdated = await tx.zombieLeagueTeam.updateMany({ where: { leagueId: z.leagueId, status: 'Whisperer', isWhisperer: true },
      data: { ambushesRemaining: record.ambushesRemaining - 1, ambushesUsed: record.ambushesUsed + 1 } })
    if (teamUpdated.count !== 1) throw new Error('Whisperer team state requires review.')
    for (const row of plan.filter(m => m.changed)) {
      await tx.redraftMatchup.update({ where: { id: row.id }, data: { homeRosterId: row.homeRosterId, awayRosterId: row.awayRosterId,
        homeScore: 0, awayScore: 0, homeProjected: null, awayProjected: null, homeWinPct: null, awayWinPct: null, status: 'scheduled', lineupSnapshots: Prisma.DbNull } })
    }
    const finalLocks = await lockedRosters(tx, plan.filter(m => m.changed).flatMap(m => [m.homeRosterId, m.awayRosterId]), z.season, z.currentWeek)
    if (finalLocks.size) throw new Error('A starter locked while the remap was being confirmed. Nothing was spent.')
    await tx.zombieAmbushAction.create({ data: { id: actionId, zombieLeagueId: z.id, week: z.currentWeek, whispererUserId: input.userId,
      ambushType: 'full_remap_2025', status: 'executed', submittedViaChimmy: false, validationResult: payloadHash,
      validationNotes: JSON.stringify({ before: matches.map(m => ({ id: m.id, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId })), after: plan }), executedAt: new Date() } })
    await tx.zombieAuditLog.create({ data: { leagueId: z.leagueId, zombieLeagueId: z.id, eventType: 'ambush_use',
      metadata: toPrismaJsonInput({ policy: 'beta_2025', actionId, week: z.currentWeek, plan, remaining: record.ambushesRemaining - 1 }) } })
    const owner = await tx.league.findUniqueOrThrow({ where: { id: z.leagueId }, select: { userId: true } })
    await tx.leagueChatMessage.create({ data: { id: `${actionId}:notice`, leagueId: z.leagueId, userId: owner.userId,
      type: 'host_announcement', message: `Week ${z.currentWeek} matchups changed after an ambush. Review your current opponent.`,
      metadata: { senderIsHost: true, contentType: 'host_announcement', zombieAmbush: true, week: z.currentWeek } } })
    return { actionId, week: z.currentWeek, repeated: false }
  })
  // Item consumption stays with its team. The normal scorer rebuilds bonuses once for the new pairs.
  let scoreRefreshPending = false
  try { await refreshItemScores(input.leagueId, result.week) } catch { scoreRefreshPending = true }
  return { ...result, scoreRefreshPending }
}
