import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { appendZombieAudit } from '@/lib/zombie/ZombieAuditLog'
import { queueAnimation } from '@/lib/zombie/animationEngine'

/** Current serum timing remains independent; serum registration has its own weekly rules. */
export async function validateAmbushTiming(
  leagueId: string,
  week: number,
  sport: string,
): Promise<{ valid: boolean; reason?: string }> {
  const rules = await getZombieRulesForSport(sport)
  void leagueId
  void week
  return { valid: true, reason: rules.lineupLockDesc ?? undefined }
}

/** A remap or weapon may occur only while the native week is unscored and all games are scheduled. */
export async function validatePreScoringWindow(
  leagueId: string,
  week: number,
  seasonYear: number,
): Promise<{ valid: boolean; reason?: string }> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { status: true, currentWeek: true, id: true, sport: true } })
  if (!z || !['active', 'in_progress'].includes(z.status) || z.currentWeek !== week) {
    return { valid: false, reason: 'This is not the active league week.' }
  }
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: seasonYear }, select: { id: true } })
  if (!season) return { valid: false, reason: 'Native season is unavailable.' }
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, awayRosterId: { not: null } },
    select: { status: true, homeScore: true, awayScore: true },
  })
  if (!matchups.length || matchups.some((m) => m.status !== 'scheduled' || m.homeScore !== 0 || m.awayScore !== 0)) {
    return { valid: false, reason: 'Week scoring has started or the schedule is not ready.' }
  }
  // GameSchedule is populated by the provider schedule ingestion pipeline. If a period has no
  // dated games, we cannot establish a fair deadline and must keep pre-score powers closed.
  const games = await prisma.gameSchedule.findMany({
    where: { sportType: z.sport.toUpperCase(), season: seasonYear, weekOrRound: week },
    select: { startTime: true },
  })
  if (!games.length || games.some((game) => !game.startTime)) {
    return { valid: false, reason: 'Provider game times for this scoring week are unavailable.' }
  }
  const firstLock = Math.min(...games.map((game) => game.startTime!.getTime()))
  if (Date.now() >= firstLock) {
    return { valid: false, reason: 'The first game of this scoring week has locked.' }
  }
  const resolution = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
    select: { status: true },
  })
  if (resolution && resolution.status !== 'pending') {
    return { valid: false, reason: 'The week is resolving or complete.' }
  }
  return { valid: true }
}

function targetLabel(raw: string): string | null {
  const match = raw.match(/@chimmy\s+ambush\s+swap\s+(.+)$/i)
  return match?.[1]?.trim().replace(/^@/, '') || null
}

/** Swap the Whisperer's opponent with one named Survivor before week scoring starts. */
export async function processAmbushFromChimmy(
  leagueId: string,
  whispererUserId: string,
  rawMessage: string,
  week: number,
) {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')
  const label = targetLabel(rawMessage)
  const log = await prisma.zombieChimmyAction.create({
    data: { leagueId, userId: whispererUserId, week, actionType: 'ambush_invoke', rawMessage, isValid: false },
  })
  const reject = (message: string, code: string) => prisma.zombieChimmyAction.update({
    where: { id: log.id },
    data: { isValid: false, validationError: code, privateResponse: message },
  })
  if (z.experienceMode === 'simple') return reject('Ambushes are available in Enhanced Zombie only.', 'simple_mode')
  if (!label) return reject('Use @Chimmy ambush swap <exact Survivor team name>. Other ambush effects are not active.', 'unsupported_ambush')
  const primary = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })
  const isPrimary = primary?.userId === whispererUserId
  const rec = isPrimary ? primary : await prisma.zombieCoWhisperer.findUnique({
    where: { zombieLeagueId_userId: { zombieLeagueId: z.id, userId: whispererUserId } },
  })
  if (!rec) return reject('Only the Whisperer may invoke an ambush.', 'not_whisperer')
  if (rec.ambushesRemaining < 1) return reject('No ambushes remaining.', 'no_ambushes')
  const config = await getZombieLeagueConfig(leagueId)
  if (!config?.ambushRemapMatchup) return reject('Matchup remaps are disabled in this league.', 'ambush_disabled')
  const timing = await validatePreScoringWindow(leagueId, week, z.season)
  if (!timing.valid) return reject(timing.reason ?? 'The remap window is closed.', 'timing')

  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId },
    select: { rosterId: true, status: true, fantasyTeamName: true, displayName: true },
  })
  const rosters = await prisma.roster.findMany({
    where: { leagueId }, select: { id: true, platformUserId: true },
  })
  const lookup = label.toLowerCase()
  const candidates = teams.filter((team) => {
    const owner = rosters.find((r) => r.id === team.rosterId)
    return [team.fantasyTeamName, team.displayName, owner?.platformUserId].some((value) => value?.toLowerCase() === lookup)
  })
  if (candidates.length !== 1 || candidates[0].status !== 'Survivor') {
    return reject('Choose one exact Survivor team name in this league.', 'invalid_target')
  }
  const whispererRoster = rosters.find((r) => r.platformUserId === whispererUserId)
  if (!whispererRoster) return reject('Whisperer roster not found.', 'no_roster')
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: z.season }, select: { id: true } })
  if (!season) return reject('Native season not found.', 'no_season')
  const seasonRosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id }, select: { id: true, ownerId: true },
  })
  const whispererSeason = seasonRosters.find((r) => r.ownerId === whispererUserId)
  const targetUserId = rosters.find((r) => r.id === candidates[0].rosterId)?.platformUserId
  const targetSeason = seasonRosters.find((r) => r.ownerId === targetUserId)
  if (!whispererSeason || !targetSeason) return reject('Both teams need active season rosters.', 'no_season_roster')
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, awayRosterId: { not: null } },
  })
  const whispererMatchup = matchups.find((m) => m.homeRosterId === whispererSeason.id || m.awayRosterId === whispererSeason.id)
  const targetMatchup = matchups.find((m) => m.homeRosterId === targetSeason.id || m.awayRosterId === targetSeason.id)
  if (!whispererMatchup || !targetMatchup || whispererMatchup.id === targetMatchup.id) {
    return reject('Choose a Survivor from another matchup.', 'same_matchup')
  }
  const oldOpponentId = whispererMatchup.homeRosterId === whispererSeason.id
    ? whispererMatchup.awayRosterId! : whispererMatchup.homeRosterId
  const whispererField = whispererMatchup.homeRosterId === whispererSeason.id ? 'awayRosterId' : 'homeRosterId'
  const targetField = targetMatchup.homeRosterId === targetSeason.id ? 'homeRosterId' : 'awayRosterId'
  const used = await prisma.zombieAmbushAction.count({
    where: { zombieLeagueId: z.id, week, whispererUserId, status: 'executed' },
  })
  if (used >= config.ambushCountPerWeek) return reject('Weekly ambush limit reached.', 'weekly_limit')

  try {
    const action = await prisma.$transaction(async (tx) => {
      const usedInTransaction = await tx.zombieAmbushAction.count({
        where: { zombieLeagueId: z.id, week, whispererUserId, status: 'executed' },
      })
      if (usedInTransaction >= config.ambushCountPerWeek) throw new Error('Weekly ambush limit reached')
      const debit = isPrimary
        ? await tx.whispererRecord.updateMany({
            where: { id: rec.id, ambushesRemaining: { gte: 1 } },
            data: { ambushesRemaining: { decrement: 1 }, ambushesUsed: { increment: 1 } },
          })
        : await tx.zombieCoWhisperer.updateMany({
            where: { id: rec.id, ambushesRemaining: { gte: 1 } },
            data: { ambushesRemaining: { decrement: 1 }, ambushesUsed: { increment: 1 } },
          })
      if (debit.count !== 1) throw new Error('Ambush balance changed')
      const first = await tx.redraftMatchup.updateMany({
        where: { id: whispererMatchup.id, status: 'scheduled', homeScore: 0, awayScore: 0 },
        data: whispererField === 'awayRosterId'
          ? { awayRosterId: targetSeason.id }
          : { homeRosterId: targetSeason.id },
      })
      const second = await tx.redraftMatchup.updateMany({
        where: { id: targetMatchup.id, status: 'scheduled', homeScore: 0, awayScore: 0 },
        data: targetField === 'awayRosterId'
          ? { awayRosterId: oldOpponentId }
          : { homeRosterId: oldOpponentId },
      })
      if (first.count !== 1 || second.count !== 1) throw new Error('Matchup changed before ambush')
      const action = await tx.zombieAmbushAction.create({
        data: {
          zombieLeagueId: z.id, week, whispererUserId, ambushType: 'swap_matchup',
          targetUserId, targetMatchupId: targetMatchup.id, status: 'executed',
          validationResult: 'ok', submittedViaChimmy: true, executedAt: new Date(),
        },
      })
      await tx.zombieChimmyAction.update({
        where: { id: log.id },
        data: {
          isValid: true,
          publicResponse: '🔴 The Whisperer changed two matchups before scoring.',
          privateResponse: `Ambush complete. You now face ${label} in Week ${week}.`,
          effect: { ambushActionId: action.id, fromMatchupId: whispererMatchup.id, targetMatchupId: targetMatchup.id },
        },
      })
      return action
    }, { isolationLevel: 'Serializable' })
    await notifyCommissioner(leagueId, 'ambush_used', `Whisperer remap (Week ${week})`, `Two scheduled matchups were swapped.`, {
      urgency: 'high', week, relatedUserId: whispererUserId,
      relatedEventId: action.id, relatedEventType: 'ZombieAmbushAction',
    }).catch(() => {})
    await appendZombieAudit({
      leagueId, zombieLeagueId: z.id, universeId: z.universeId, eventType: 'ambush_use',
      metadata: { week, actionId: action.id, targetUserId, fromMatchupId: whispererMatchup.id, targetMatchupId: targetMatchup.id },
    }).catch(() => {})
    await queueAnimation(leagueId, week, 'ambush_triggered', whispererUserId, {
      ambushType: 'swap_matchup', ambushActionId: action.id,
    }).catch(() => {})
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'Ambush failed.', 'ambush_failed')
  }
}
