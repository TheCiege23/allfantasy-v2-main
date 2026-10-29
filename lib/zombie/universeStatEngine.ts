import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUniverseStandings } from './ZombieUniverseStandingsService'
import { planUniverseMovement } from './universeMovementPlan'

/**
 * Aggregate stats across all leagues in a universe after weekly resolutions.
 */
export async function syncUniverseStats(universeId: string, week: number): Promise<void> {
  const leagues = await prisma.zombieLeague.findMany({
    where: { universeId },
    include: {
      teams: true,
      level: true,
    },
  })

  const season = new Date().getFullYear()
  const leagueIds = leagues.map((l) => l.leagueId)

  // Fetch infection counts in bulk
  const infectionsByInflictor = await prisma.zombieInfectionEvent.groupBy({
    by: ['infectorUserId'],
    where: { zombieLeagueId: { in: leagueIds } },
    _count: { id: true },
  }).catch(() => [])
  const infMap = new Map<string, number>()
  for (const r of infectionsByInflictor) {
    if (r.infectorUserId) infMap.set(r.infectorUserId, r._count.id)
  }

  // Fetch bashings won in bulk
  const bashingsByWinner = await prisma.zombieBashingEvent.groupBy({
    by: ['winnerUserId'],
    where: { leagueId: { in: leagueIds } },
    _count: { id: true },
  }).catch(() => [])
  const bashMap = new Map<string, number>()
  for (const r of bashingsByWinner) bashMap.set(r.winnerUserId, r._count.id)

  // Fetch maulings won in bulk
  const maulingsByMauler = await prisma.zombieMaulingEvent.groupBy({
    by: ['maulerUserId'],
    where: { leagueId: { in: leagueIds } },
    _count: { id: true },
  }).catch(() => [])
  const maulMap = new Map<string, number>()
  for (const r of maulingsByMauler) maulMap.set(r.maulerUserId, r._count.id)

  for (const z of leagues) {
    for (const t of z.teams) {
      const roster = await prisma.roster.findUnique({
        where: { id: t.rosterId },
        select: { platformUserId: true },
      })
      const userKey = roster?.platformUserId ?? t.rosterId
      const played = (t.wins ?? 0) + (t.losses ?? 0)
      const ppw = played > 0 ? (t.pointsFor ?? 0) / played : 0
      const winPct = played > 0 ? (t.wins ?? 0) / played : 0

      await prisma.zombieUniverseStat.upsert({
        where: {
          universeId_userId_season: {
            universeId,
            userId: userKey,
            season,
          },
        },
        create: {
          universeId,
          userId: userKey,
          displayName: t.displayName ?? roster?.platformUserId ?? userKey,
          leagueId: z.leagueId,
          leagueName: z.name ?? z.leagueId,
          tierLabel: z.level?.tierLabel ?? z.level?.name ?? null,
          currentStatus: (t.status ?? 'Survivor').toLowerCase(),
          isWhisperer: t.isWhisperer,
          careerWins: t.wins ?? 0,
          careerLosses: t.losses ?? 0,
          careerPointsFor: t.pointsFor ?? 0,
          currentSeasonPPW: ppw,
          currentSeasonWinPct: winPct,
          season,
          lastUpdatedWeek: week,
        },
        update: {
          displayName: t.displayName ?? roster?.platformUserId ?? userKey,
          leagueName: z.name ?? z.leagueId,
          tierLabel: z.level?.tierLabel ?? z.level?.name ?? null,
          careerWins: t.wins ?? 0,
          careerLosses: t.losses ?? 0,
          careerPointsFor: t.pointsFor ?? 0,
          currentSeasonPPW: ppw,
          currentSeasonWinPct: winPct,
          currentStatus: (t.status ?? 'Survivor').toLowerCase(),
          isWhisperer: t.isWhisperer,
          lastUpdatedWeek: week,
        },
      })
    }
  }

  // Rank by PPW
  const all = await prisma.zombieUniverseStat.findMany({
    where: { universeId, season },
    orderBy: { currentSeasonPPW: 'desc' },
  })
  let rank = 1
  for (const row of all) {
    await prisma.zombieUniverseStat.update({
      where: { id: row.id },
      data: { universeRank: rank++ },
    })
  }
}

/**
 * Build a universe-wide weekly digest summarizing all leagues.
 */
export async function buildUniverseWeeklyDigest(universeId: string, week: number): Promise<string> {
  const u = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    include: {
      leagues: {
        include: { teams: true, whispererRecord: true, coWhisperers: true, level: true },
      },
    },
  })
  if (!u) return ''

  const season = new Date().getFullYear()
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
    if (!u.leagues.length || u.leagues.some(l => l.season !== season || l.status !== 'complete')) throw new Error('MOVEMENT_SEASONS_INCOMPLETE')
    const native = await tx.redraftSeason.findMany({ where: { leagueId: { in: u.leagues.map(l => l.leagueId) }, season } })
    if (native.length !== u.leagues.length || native.some(s => s.status !== 'complete')) throw new Error('MOVEMENT_SEASONS_INCOMPLETE')
    const unsettled = await tx.zombieWeeklyResolution.count({
      where: { zombieLeagueId: { in: u.leagues.map(l => l.id) },
        OR: [{ status: { not: 'complete' } }, { requiresStatCorrection: true }] },
    })
    if (unsettled) throw new Error('MOVEMENT_RECONCILIATION_REQUIRED')
    if (await tx.zombieMovementRecord.count({ where: { universeId, season } })) throw new Error('MOVEMENT_LEGACY_REVIEW_REQUIRED')
    const standings = await getUniverseStandings(universeId, season, tx)
    const owners = await tx.roster.findMany({ where: { leagueId: { in: u.leagues.map(l => l.leagueId) } }, select: { id: true, platformUserId: true } })
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
      where: { leagueId: { in: u.leagues.map(l => l.leagueId) } },
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
      universeId, leagueId: u.leagues[0].leagueId, eventType: 'UNIVERSE_MOVEMENT_RECORDED',
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
