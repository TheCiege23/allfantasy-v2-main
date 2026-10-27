import { prisma } from '@/lib/prisma'

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
    if (z.whispererRecord) totalWhisperers++
    totalWhisperers += z.coWhisperers.length
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

export async function executePromotionRelegation(universeId: string, season: number): Promise<void> {
  const u = await prisma.zombieUniverse.findUnique({ where: { id: universeId } })
  if (!u) throw new Error('Universe not found')

  const stats = await prisma.zombieUniverseStat.findMany({
    where: { universeId, season },
    orderBy: [{ currentSeasonWinPct: 'desc' }, { currentSeasonPPW: 'desc' }],
  })

  const promoteN = u.promotionCount ?? 2
  const relegateN = u.relegationCount ?? 2

  const top = stats.slice(0, promoteN)
  const bottom = stats.slice(-relegateN)

  if (u.promotionMode === 'auto') {
    for (const s of top) {
      await prisma.zombieMovementRecord.create({
        data: {
          universeId,
          userId: s.userId,
          displayName: s.displayName,
          season,
          fromTierLabel: s.tierLabel ?? 'unknown',
          toTierLabel: 'promoted',
          movementType: 'promoted',
          reason: 'record_performance',
        },
      })
    }
    for (const s of bottom) {
      await prisma.zombieMovementRecord.create({
        data: {
          universeId,
          userId: s.userId,
          displayName: s.displayName,
          season,
          fromTierLabel: s.tierLabel ?? 'unknown',
          toTierLabel: 'relegated',
          movementType: 'relegated',
          reason: 'record_performance',
        },
      })
    }
  }
}
