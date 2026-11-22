import type { PrismaClient } from '@prisma/client'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow, scheduleKeyPrefix } from '@/lib/sports-data/riScheduleCache'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { rotateForFairness } from '@/lib/cron/runBudget'
import { isBasketballC2CLeague } from './campusLineup'
import { buildNbaCampusWeekSnapshot } from './nbaCampusWeekSnapshot'
import { nbaCampusWeekCacheKey, persistNbaCampusWeekSnapshot } from './storeNbaCampusWeekSnapshot'
import { canCaptureNbaCampusCarryover, canRecoverNbaCampusCarryover } from './nbaCampusCarryover'

/** Seed an untouched week's campus assignments before any college game can start. */
export async function seedNbaCampusCarryover(db: PrismaClient, input: { now: Date; deadlineAt: number; maxRosters: number }) {
  const seasons = await db.redraftSeason.findMany({ where: { sport: 'NBA', status: { in: ['active', 'regular_season_complete', 'playoffs'] }, currentWeek: { gt: 0 } }, select: { leagueId: true, season: true, currentWeek: true, league: { select: { platform: true, sport: true, leagueVariant: true } } } })
  const eligible = seasons.filter(s => isNativePlatform(s.league.platform) && isBasketballC2CLeague(s.league) && dailySportWeekForInstant('NBA', s.season, input.now) === s.currentWeek)
  if (!eligible.length || Date.now() >= input.deadlineAt) return { considered: 0, seeded: 0, held: 0 }
  const evidence = await currentNcaabRosterEvidence(db, input.now)
  let considered = 0, seeded = 0, held = 0
  for (const season of rotateForFairness(eligible, 3600000)) {
    if (Date.now() >= input.deadlineAt || considered >= input.maxRosters) break
    const window = resolveDailySportWeekWindow('NBA', season.season, season.currentWeek)
    if (!window) continue
    const [meta, schedule, rosters] = await Promise.all([
      db.sportsDataCache.findUnique({ where: { cacheKey: `${scheduleKeyPrefix('NCAAB', season.season)}meta` } }),
      readRiScheduleWindow(db as never, { sport: 'NCAAB', season: season.season, window }),
      db.roster.findMany({ where: { leagueId: season.leagueId, redraftRosterId: { not: null } }, select: { id: true, leagueId: true, playerData: true, updatedAt: true } }),
    ])
    if (!meta || meta.expiresAt <= input.now) { held += rosters.length; continue }
    for (const roster of rotateForFairness(rosters, 3600000)) {
      if (Date.now() >= input.deadlineAt || considered >= input.maxRosters) break
      const key = nbaCampusWeekCacheKey(roster.leagueId, roster.id, season.season, season.currentWeek)
      if (await db.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { cacheKey: true } })) continue
      considered++
      const currentSnapshot = buildNbaCampusWeekSnapshot({ playerData: roster.playerData, season: season.season, week: season.currentWeek, now: input.now, evidence: evidence.athletes }).snapshot
      if (!currentSnapshot) { held++; continue }
      const observedAt = currentSnapshot.players.map(p => new Date(p.observedAt))
      const early = canCaptureNbaCampusCarryover({ now: input.now, window, schedule, meta: meta.data })
      const recovered = !early && canRecoverNbaCampusCarryover({ now: input.now, window, schedule, meta: meta.data, rosterUpdatedAt: roster.updatedAt, observedAt })
      if (!early && !recovered) { held++; continue }
      const snapshot = recovered ? { ...currentSnapshot, players: currentSnapshot.players.map(p => ({ ...p, selectedAt: window.start.toISOString() })) } : currentSnapshot
      const result = await db.$transaction(async tx => {
        // Lock and compare without touching updatedAt; a rejected carryover must not alter the roster.
        const before = JSON.stringify(roster.playerData)
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rosters WHERE id = ${roster.id} AND "updatedAt" = ${roster.updatedAt} AND "playerData" = ${before}::jsonb FOR UPDATE`
        const checkedAt = new Date()
        const stillSafe = recovered ? canRecoverNbaCampusCarryover({ now: checkedAt, window, schedule, meta: meta.data, rosterUpdatedAt: roster.updatedAt, observedAt }) : canCaptureNbaCampusCarryover({ now: checkedAt, window, schedule, meta: meta.data })
        if (locked.length !== 1 || !stillSafe) return false
        const existing = await tx.sportsDataCache.findUnique({ where: { cacheKey: key } })
        if (existing) return false
        const assignment = await tx.afRosterLineupAssignment.count({ where: { rosterId: roster.id, season: season.season, week: season.currentWeek } })
        if (assignment) return false
        if (snapshot.players.length) await tx.afRosterLineupAssignment.createMany({ data: snapshot.players.map((player, slotIndex) => ({ leagueId: roster.leagueId, rosterId: roster.id, season: season.season, week: season.currentWeek, section: 'campus', slotIndex, playerId: player.id })) })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: roster.leagueId, rosterId: roster.id, snapshot, now: input.now })
        return true
      })
      if (result) seeded++; else held++
    }
  }
  return { considered, seeded, held }
}
