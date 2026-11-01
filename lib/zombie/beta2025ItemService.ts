import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { betaItemBonus, itemRole, readyItem, serumQuantity, type ItemScoreReceipt } from './beta2025Items'

type Db = Prisma.TransactionClient
export const usesBeta2025Items = (league: { sport: string }) => league.sport.toUpperCase() === 'NFL'
export async function itemTransaction<T>(run: (tx: Db) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { isolationLevel: 'Serializable' }) }
    catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error
    }
  }
}
export async function lockItemLeague(tx: Db, leagueId: string) {
  await tx.$queryRaw`SELECT id FROM zombie_leagues WHERE "leagueId" = ${leagueId} FOR UPDATE`
}
/** Require an actual future starter kickoff. A bench player, bye or unknown schedule cannot extend the deadline. */
export async function assertLastStarterWindow(tx: Db, input: { leagueId: string; userId: string; week: number }) {
  const z = await tx.zombieLeague.findUnique({ where: { leagueId: input.leagueId } })
  if (!z || !usesBeta2025Items(z) || !['active', 'in_progress'].includes(z.status) || z.currentWeek !== input.week) throw new Error('This is not the active 2025 NFL Zombie week.')
  const resolution = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: input.week } } })
  if (resolution && resolution.status !== 'pending') throw new Error('This week is resolving, complete or awaiting review.')
  const season = await tx.redraftSeason.findFirst({ where: { leagueId: input.leagueId, season: z.season } })
  if (!season) throw new Error('Native season is unavailable.')
  const roster = await tx.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: input.userId } })
  if (!roster) throw new Error('Active manager roster not found.')
  const matchup = await tx.redraftMatchup.findFirst({ where: { seasonId: season.id, week: input.week, OR: [{ homeRosterId: roster.id }, { awayRosterId: roster.id }] } })
  if (!matchup?.awayRosterId || ['final', 'complete', 'completed'].includes(matchup.status)) throw new Error('An unfinished matchup is required.')
  const deadline = await lastStarterDeadline(tx, roster.id, z.season, input.week)
  if (!deadline || deadline.getTime() <= Date.now()) throw new Error('Your last starter has begun their game. Item use is locked.')
  return { z, roster, matchup }
}

export async function lastStarterDeadline(tx: Db, rosterId: string, season: number, week: number): Promise<Date | null> {
  const players = await tx.redraftRosterPlayer.findMany({ where: { rosterId: rosterId, droppedAt: null } })
  const lineups = await loadWeekLineups(tx as never, { redraftRosterIds: [rosterId], season: season, week: week })
  const starters = players.filter(p => !['BN', 'BENCH', 'IR', 'TAXI', 'DEVY', 'RESERVE'].includes(weekSlotType(p, lineups).toUpperCase()))
  if (!starters.length) return null
  const kickoffs = await buildWeekKickoffMap(tx as never, { sport: 'NFL', season: season, week: week })
  const currentTeams = await resolveCurrentLockTeams(tx as never, { sport: 'NFL', platform: 'allfantasy', playerIds: starters.map(p => p.playerId) })
  const starts: Date[] = []
  for (const p of starters) {
    if (p.byeWeek === week) continue
    const club = currentTeams.has(p.playerId) ? currentTeams.get(p.playerId) : p.team
    const start = lockTeamLookupKeys('NFL', club).map(k => kickoffs.byTeam.get(k)).find(Boolean)
    if (!start) throw new Error('A starter game time is unavailable. Item use is held until the schedule is verified.')
    starts.push(start)
  }
  return starts.length ? new Date(Math.max(...starts.map(start => start.getTime()))) : null
}

/** The native scorer calls this before writing totals. A sealed week reuses its original item receipt. */
export async function loadBetaItemScoreReceipt(input: {
  leagueId: string; week: number; season: number; homeRosterId: string; awayRosterId: string; previousSnapshots: unknown
}, db: Db = prisma): Promise<ItemScoreReceipt | null> {
  const z = await db.zombieLeague.findUnique({ where: { leagueId: input.leagueId } })
  if (!z || !usesBeta2025Items(z) || z.season !== input.season) return null
  const resolution = await db.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: input.week } } })
  const saved = input.previousSnapshots as { zombieItems?: ItemScoreReceipt } | null
  if (resolution?.settlementSnapshot || (resolution && resolution.status !== 'pending')) {
    const snapshot = resolution.settlementSnapshot as { itemsPolicy?: string } | null
    if (snapshot?.itemsPolicy !== 'beta_2025') return null // historical shield policy is never silently rewritten
    if (saved?.zombieItems?.policy !== 'beta_2025') throw new Error('ZOMBIE_ITEMS_MISSING_SCORE_RECEIPT')
    return saved.zombieItems
  }
  if (input.week < z.currentWeek) return null
  const rosters = await db.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, redraftRosterId: true, platformUserId: true } })
  const seasonRosters = await db.redraftRoster.findMany({ where: { id: { in: [input.homeRosterId, input.awayRosterId] } }, select: { id: true, ownerId: true } })
  const teams = await db.zombieLeagueTeam.findMany({ where: { leagueId: input.leagueId }, include: { items: true } })
  const side = async (id: string, savedSide: ItemScoreReceipt['home'] | undefined) => {
    const owner = seasonRosters.find(r => r.id === id)?.ownerId
    const roster = rosters.find(r => r.redraftRosterId === id) ?? rosters.find(r => owner?.startsWith('roster:') ? r.id === owner.slice(7) : r.platformUserId === owner)
    const team = teams.find(t => t.rosterId === roster?.id)
    if (!team) throw new Error('ZOMBIE_ITEMS_MISSING_TEAM')
    if (team.items.some(i => !i.isUsed && !i.isExpired && i.activationState === 'pending_activation')) throw new Error('ZOMBIE_ITEMS_LEGACY_SHIELD_REVIEW_REQUIRED')
    const deadline = await lastStarterDeadline(db, id, input.season, input.week)
    const frozen = !deadline || deadline.getTime() <= Date.now()
    if (savedSide?.frozen && frozen) return savedSide
    const bonus = betaItemBonus(team.rosterId, team.status, team.items, input.week, z.experienceMode !== 'simple')
    return { ...bonus, frozen }
  }
  return { policy: 'beta_2025', home: await side(input.homeRosterId, saved?.zombieItems?.home), away: await side(input.awayRosterId, saved?.zombieItems?.away) }
}

export async function processBetaItemUse(leagueId: string, userId: string, rawMessage: string, week: number, kind: 'serum' | 'bomb', requestId?: string) {
  const data = { leagueId, userId, week, rawMessage, actionType: kind === 'serum' ? 'serum_use' : 'bomb_use', isValid: false }
  if (requestId && !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new Error('Invalid item request id.')
  const log = requestId
    ? await prisma.zombieChimmyAction.upsert({ where: { id: `item:${leagueId}:${userId}:${requestId}` }, create: { ...data, id: `item:${leagueId}:${userId}:${requestId}` }, update: {} })
    : await prisma.zombieChimmyAction.create({ data })
  if (log.resolvedAt) {
    if (log.isValid) await refreshItemScores(leagueId, log.week).catch(() => {})
    return log
  }
  try {
    await itemTransaction(async tx => {
      await lockItemLeague(tx, leagueId)
      const action = await tx.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
      if (action.resolvedAt) return
      const { z, matchup, roster: seasonRoster } = await assertLastStarterWindow(tx, { leagueId, userId, week })
      if (kind === 'bomb' && z.experienceMode === 'simple') throw new Error('Weapons are off in Simple Zombie.')
      const roster = await tx.roster.findFirst({ where: { leagueId, platformUserId: userId } })
      if (!roster) throw new Error('Not in league.')
      const team = await tx.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } }, include: { items: true } })
      if (!team || itemRole(team.status) === 'Zombie') throw new Error('Only Survivors and Whisperers can use scoring items.')
      if (team.items.some(i => !i.isUsed && !i.isExpired && i.activationState === 'pending_activation')) throw new Error('Legacy shield items need commissioner review before 2025 scoring items can be used.')
      const opponentId = matchup.homeRosterId === seasonRoster.id ? matchup.awayRosterId! : matchup.homeRosterId
      if (kind === 'serum') {
        const opponent = await tx.redraftRoster.findUnique({ where: { id: opponentId } })
        const opponentRoster = await tx.roster.findFirst({ where: { leagueId, OR: [{ redraftRosterId: opponentId }, { platformUserId: opponent?.ownerId ?? '' }] } })
        const opponentTeam = opponentRoster ? await tx.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: opponentRoster.id } } }) : null
        if (opponentTeam?.status !== 'Zombie') throw new Error('Serums give +10 only against a Zombie opponent.')
      }
      const count = kind === 'serum' ? serumQuantity(rawMessage) : 1
      if (kind === 'bomb' && team.items.some(i => i.isUsed && i.usedAtWeek === week && i.usedEffect === 'beta2025_bomb_35')) throw new Error('Only one bomb may be used per week.')
      const available = team.items.filter(i => readyItem(i, week) && (kind === 'serum' ? i.itemType.includes('serum') : i.itemType === 'weapon_bomb')).sort((a, b) => a.id.localeCompare(b.id)).slice(0, count)
      if (available.length !== count) throw new Error(`You need ${count} available ${kind}(s). Nothing was spent.`)
      const spent = await tx.zombieTeamItem.updateMany({ where: { id: { in: available.map(i => i.id) }, teamStatusId: team.id, isUsed: false, isExpired: false, activationState: 'ready' }, data: { isUsed: true, usedAtWeek: week, usedEffect: kind === 'serum' ? 'beta2025_serum_10' : 'beta2025_bomb_35' } })
      if (spent.count !== count) throw new Error('Inventory changed. Nothing was spent; try again.')
      await tx.zombieChimmyAction.update({ where: { id: log.id }, data: { isValid: true, resolvedAt: new Date(), effect: toPrismaJsonInput({ policy: 'beta_2025', itemIds: available.map(i => i.id), bonus: kind === 'serum' ? count * 10 : 35 }), privateResponse: kind === 'serum' ? `${count} serum(s) used: +${count * 10} points this week. They are spent even if you lose.` : 'Bomb used: +35 points this week. Your other weapons give no bonus this week.' } })
    })
  } catch (error) {
    await prisma.zombieChimmyAction.update({ where: { id: log.id }, data: { isValid: false, resolvedAt: new Date(), validationError: 'item_use_rejected', privateResponse: error instanceof Error ? error.message : 'Item could not be used.' } })
  }
  // Score refresh is recoverable from the stored consumption record, never a second debit.
  const result = await prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  if (result.isValid) {
    try { await refreshItemScores(leagueId, week) }
    catch {
      return prisma.zombieChimmyAction.update({ where: { id: log.id }, data: { privateResponse: `${result.privateResponse} Saved successfully; the score refresh is pending. Do not submit it again.` } })
    }
  }
  return result
}
export async function refreshItemScores(leagueId: string, week: number) {
  const { updateMatchupScores } = await import('@/lib/redraft/scoringEngine')
  const matches = await prisma.redraftMatchup.findMany({ where: { leagueId, week, awayRosterId: { not: null } }, select: { id: true } })
  for (const m of matches) await updateMatchupScores(m.id)
}
