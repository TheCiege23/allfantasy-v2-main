import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUniverseStandings } from './ZombieUniverseStandingsService'
import { planUniverseMovement } from './universeMovementPlan'

/**
 * Aggregate stats across all leagues in a universe after weekly resolutions.
 */
export async function syncUniverseStats(universeId: string, week: number, requestedSeason?: number): Promise<void> {
  const season = requestedSeason ?? (await prisma.zombieLeague.aggregate({ where: { universeId }, _max: { season: true } }))._max.season
  if (season == null) return
  const leagues = await prisma.zombieLeague.findMany({
    where: { universeId, season }, include: { teams: true, level: true },
  })
  const historyLeagues = await prisma.zombieLeague.findMany({ where: { universeId, season: { lte: season } }, select: { leagueId: true } })
  const [standings, rosters, career] = await Promise.all([
    getUniverseStandings(universeId, season),
    prisma.roster.findMany({ where: { leagueId: { in: leagues.map(l=>l.leagueId) } }, select: { id: true, platformUserId: true } }),
    prisma.redraftRoster.groupBy({ by: ['ownerId'],
      where: { leagueId: { in: historyLeagues.map(l=>l.leagueId) }, season: { season: { lte: season } } },
      _sum: { wins: true, losses: true, pointsFor: true },
    }),
  ])
  const ownerByRoster = new Map(rosters.map(r=>[r.id,r.platformUserId]))
  const userRows = new Map<string, typeof standings>()
  for (const row of standings) {
    const userId = ownerByRoster.get(row.rosterId)
    if (!userId) continue
    userRows.set(userId,[...(userRows.get(userId) ?? []),row])
  }
  for (const [userId, rows] of userRows) {
    rows.sort((a,b)=>a.leagueId.localeCompare(b.leagueId))
    const row=rows[0], z=leagues.find(l=>l.leagueId===row.leagueId)!, team=z.teams.find(t=>t.rosterId===row.rosterId)!
    const totals=rows.reduce((a,r)=>({ wins:a.wins+r.wins, losses:a.losses+r.losses, ties:a.ties+r.ties, points:a.points+r.totalPoints }),{wins:0,losses:0,ties:0,points:0})
    const played=totals.wins+totals.losses+totals.ties, allTime=career.find(c=>c.ownerId===userId)?._sum
    const state={
      displayName: team.displayName || userId, leagueId: z.leagueId,
      leagueName: rows.length>1 ? rows.length+' leagues' : z.name || z.leagueId,
      tierLabel: z.level?.tierLabel ?? z.level?.name ?? null,
      currentStatus: rows.length>1 ? 'multiple_leagues' : row.status.toLowerCase(),
      isWhisperer: rows.some(r=>r.status.toLowerCase()==='whisperer'),
      careerWins: allTime?.wins ?? 0, careerLosses: allTime?.losses ?? 0, careerPointsFor: allTime?.pointsFor ?? 0,
      currentSeasonPPW: played>0 ? totals.points/played : 0,
      currentSeasonWinPct: played>0 ? (totals.wins+totals.ties/2)/played : 0,
      weekKilled: rows.length===1 ? row.weekKilled : null,
      killedByUserId: rows.length===1 && row.killedByRosterId ? ownerByRoster.get(row.killedByRosterId) ?? null : null,
      lastUpdatedWeek: week,
    }
    await prisma.zombieUniverseStat.upsert({ where: { universeId_userId_season: { universeId,userId,season } },
      create: { universeId,userId,season,...state }, update: state })
  }
  const all=await prisma.zombieUniverseStat.findMany({ where: { universeId,season }, orderBy: [{currentSeasonPPW:'desc'},{userId:'asc'}] })
  for (let i=0;i<all.length;i++) await prisma.zombieUniverseStat.update({ where: {id:all[i].id},data:{universeRank:i+1} })
}

/**
 * Build a universe-wide weekly digest summarizing all leagues.
 */
export async function buildUniverseWeeklyDigest(universeId: string, week: number, requestedSeason?: number): Promise<string> {
  const season = requestedSeason ?? (await prisma.zombieLeague.aggregate({ where: { universeId }, _max: { season: true } }))._max.season
  if (season == null) return ''
  const u = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    include: {
      leagues: {
        where: { season },
        include: { teams: true, whispererRecord: true, coWhisperers: true, level: true },
      },
    },
  })
  if (!u) return ''

  let totalSurvivors = 0
  let totalZombies = 0
  let totalWhisperers = 0
  const leagueSummaries: string[] = []

  for (const z of u.leagues) {
    let surv = 0
    let zomb = 0
    for (const t of z.teams) {
      const s = (t.status ?? '').toLowerCase()
      if (s.includes('zombie')) { zomb++; totalZombies++ }
      else if (s.includes('survivor') || s.includes('revived')) { surv++; totalSurvivors++ }
    }
    totalWhisperers += z.teams.filter((team) => team.status === 'Whisperer').length
    const tier = z.level?.tierLabel ?? z.level?.name ?? ''
    leagueSummaries.push(
      `${z.name ?? z.leagueId}${tier ? ` (${tier})` : ''}: ${surv} survivors, ${zomb} zombies`,
    )
  }

  const total = totalSurvivors + totalZombies
  const hordePct = total > 0 ? Math.round((totalZombies / total) * 100) : 0

  const digest = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌍 ${u.name} — WEEK ${week} UNIVERSE DIGEST`,
    `${u.sport?.toUpperCase()} | Season ${season}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `📊 UNIVERSE STATUS`,
    `🧍 Survivors: ${totalSurvivors}`,
    `🧟 Zombies: ${totalZombies} (${hordePct}% Horde)`,
    `🎭 Whisperers: ${totalWhisperers}`,
    `📋 Leagues: ${u.leagues.length}`,
    '',
    `📋 LEAGUE BREAKDOWN`,
    ...leagueSummaries,
    '',
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n')

  return digest
}

/** Record approved next-level allocations. This does not renew drafts or move current-season seats. */
export async function executePromotionRelegation(universeId: string, season: number, actorUserId: string) {
  if (!Number.isInteger(season) || season < 2000 || season > 2200) throw new Error('MOVEMENT_SEASON_INVALID')
  const record = () => prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM zombie_universes WHERE id = ${universeId} FOR UPDATE`)
    const u = await tx.zombieUniverse.findUnique({ where: { id: universeId }, include: { levels: true, leagues: true } })
    if (!u) throw new Error('MOVEMENT_UNIVERSE_NOT_FOUND')
    if ((u.commissionedByUserId ?? u.createdByUserId) !== actorUserId) throw new Error('MOVEMENT_OWNER_REQUIRED')
    const prior = await tx.zombieAuditLog.findFirst({
      where: { universeId, eventType: 'UNIVERSE_MOVEMENT_RECORDED', metadata: { path: ['season'], equals: season } },
    })
    if (prior) return { recorded: 0, alreadyRecorded: true, scope: 'movement_record_only' as const }
    if (u.promotionMode !== 'auto') throw new Error('MOVEMENT_MANUAL_REVIEW_REQUIRED')
    const seasonLeagues = u.leagues.filter(l => l.season === season)
    if (!seasonLeagues.length || seasonLeagues.some(l => l.status !== 'complete')) throw new Error('MOVEMENT_SEASONS_INCOMPLETE')
    const native = await tx.redraftSeason.findMany({ where: { leagueId: { in: seasonLeagues.map(l => l.leagueId) }, season } })
    if (native.length !== seasonLeagues.length || native.some(s => s.status !== 'complete')) throw new Error('MOVEMENT_SEASONS_INCOMPLETE')
    const unsettled = await tx.zombieWeeklyResolution.count({
      where: { zombieLeagueId: { in: seasonLeagues.map(l => l.id) },
        OR: [{ status: { not: 'complete' } }, { requiresStatCorrection: true }] },
    })
    if (unsettled) throw new Error('MOVEMENT_RECONCILIATION_REQUIRED')
    if (await tx.zombieMovementRecord.count({ where: { universeId, season } })) throw new Error('MOVEMENT_LEGACY_REVIEW_REQUIRED')
    const standings = await getUniverseStandings(universeId, season, tx)
    const owners = await tx.roster.findMany({ where: { leagueId: { in: seasonLeagues.map(l => l.leagueId) } }, select: { id: true, platformUserId: true } })
    const ownerByRoster = new Map(owners.map(r => [r.id, r.platformUserId]))
    const used = new Set<string>()
    for (const row of standings) {
      const owner = ownerByRoster.get(row.rosterId)
      if (!owner || used.has(owner)) throw new Error('MOVEMENT_MEMBERSHIP_AMBIGUOUS')
      used.add(owner)
      if (row.wins + row.losses + row.ties === 0) throw new Error('MOVEMENT_STANDINGS_INCOMPLETE')
    }
    if (standings.length !== owners.length) throw new Error('MOVEMENT_STANDINGS_INCOMPLETE')
    const names = await tx.zombieLeagueTeam.findMany({
      where: { leagueId: { in: seasonLeagues.map(l => l.leagueId) } },
      select: { rosterId: true, displayName: true, fantasyTeamName: true },
    })
    const nameByRoster = new Map(names.map(t => [t.rosterId, t.displayName || t.fantasyTeamName]))
    const plan = planUniverseMovement(standings, u.levels, u).filter(row => row.reason !== 'watch')
    for (const row of plan) await tx.zombieMovementRecord.create({ data: {
      universeId, season, userId: ownerByRoster.get(row.rosterId)!,
      displayName: nameByRoster.get(row.rosterId) || ownerByRoster.get(row.rosterId)!,
      fromTierLabel: row.fromTierLabel, toTierLabel: row.toTierLabel,
      movementType: row.reason === 'promotion' ? 'promoted' : 'relegated',
      reason: 'record_performance', finalRecord: row.wins + '-' + row.losses + '-' + row.ties,
      finalPPW: row.pointsPerWeek, finalTierRank: row.finalTierRank, approvedBy: actorUserId,
    } })
    await tx.zombieAuditLog.create({ data: {
      universeId, leagueId: seasonLeagues[0].leagueId, eventType: 'UNIVERSE_MOVEMENT_RECORDED',
      metadata: { version: 1, season, recorded: plan.length, actorUserId, scope: 'movement_record_only' },
    } })
    return { recorded: plan.length, alreadyRecorded: false, scope: 'movement_record_only' as const }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 })
  for (let attempt = 0; ; attempt++) {
    try { return await record() } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error
    }
  }
}
