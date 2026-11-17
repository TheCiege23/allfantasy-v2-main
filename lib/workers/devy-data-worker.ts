import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { seedCollegePlayers } from '@/lib/devy/CollegePlayerSeedService'
import { enqueueNotification } from '@/lib/jobs/enqueue'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { getDevyConfig } from '@/lib/devy/DevyLeagueConfig'
import { apiChain } from '@/lib/workers/api-chain'

type CollegeSport = 'NCAAF' | 'NCAAB'

type DevyWorkerResult = {
  ok: boolean
  sport?: CollegeSport
  leagueId?: string
  created?: number
  updated?: number
  processed?: number
  logsWritten?: number
  errors: string[]
}

function resolveCollegeSport(sport?: string | null): CollegeSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  if (normalized === 'NBA' || normalized === 'NCAAB') return 'NCAAB'
  return 'NCAAF'
}

function toClassYearLabel(classYear: number | null | undefined): string | null {
  if (classYear == null) return null
  if (classYear <= 1) return 'FR'
  if (classYear === 2) return 'SO'
  if (classYear === 3) return 'JR'
  if (classYear === 4) return 'SR'
  return 'GR'
}

function toDraftGrade(projectedRound: number | null | undefined, projectionScore: number | null | undefined): string {
  if (projectedRound != null) {
    if (projectedRound <= 1) return 'A'
    if (projectedRound <= 2) return 'B'
    if (projectedRound <= 4) return 'C'
    if (projectedRound <= 6) return 'D'
    return 'F'
  }
  const score = Number(projectionScore ?? 0)
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

function computeC2CPointsFromPlayer(
  player: {
    sport?: string | null
    passingYards?: number | null
    passingTDs?: number | null
    rushingYards?: number | null
    rushingTDs?: number | null
    receivingYards?: number | null
    receivingTDs?: number | null
    receptions?: number | null
    statsPayload?: unknown
  },
  scoringSystem: string
): { seasonPoints: number; weekPoints: number; breakdown: Record<string, number> } {
  const statsPayload =
    player.statsPayload && typeof player.statsPayload === 'object' && !Array.isArray(player.statsPayload)
      ? (player.statsPayload as Record<string, unknown>)
      : {}

  if (resolveCollegeSport(player.sport) === 'NCAAB') {
    const points = Number(statsPayload.points ?? statsPayload.ppg ?? 0)
    const rebounds = Number(statsPayload.rebounds ?? statsPayload.rpg ?? 0)
    const assists = Number(statsPayload.assists ?? statsPayload.apg ?? 0)
    const steals = Number(statsPayload.steals ?? 0)
    const blocks = Number(statsPayload.blocks ?? 0)
    const turnovers = Number(statsPayload.turnovers ?? 0)
    const multiplier = scoringSystem === 'points' ? 1.25 : 1
    const total =
      points * multiplier +
      rebounds * 1.2 +
      assists * 1.5 +
      steals * 3 +
      blocks * 3 -
      turnovers
    return {
      seasonPoints: Number(total.toFixed(2)),
      weekPoints: Number(total.toFixed(2)),
      breakdown: { points, rebounds, assists, steals, blocks, turnovers },
    }
  }

  const ppr = scoringSystem === 'standard' ? 0 : 1
  const passingYards = Number(player.passingYards ?? statsPayload.passingYards ?? 0)
  const passingTDs = Number(player.passingTDs ?? statsPayload.passingTDs ?? 0)
  const rushingYards = Number(player.rushingYards ?? statsPayload.rushingYards ?? 0)
  const rushingTDs = Number(player.rushingTDs ?? statsPayload.rushingTDs ?? 0)
  const receivingYards = Number(player.receivingYards ?? statsPayload.receivingYards ?? 0)
  const receivingTDs = Number(player.receivingTDs ?? statsPayload.receivingTDs ?? 0)
  const receptions = Number(player.receptions ?? statsPayload.receptions ?? 0)
  const passingInts = Number(statsPayload.interceptions ?? 0)

  const total =
    passingYards / 25 +
    passingTDs * 4 +
    rushingYards / 10 +
    rushingTDs * 6 +
    receivingYards / 10 +
    receivingTDs * 6 +
    receptions * ppr -
    passingInts * 2

  return {
    seasonPoints: Number(total.toFixed(2)),
    weekPoints: Number(total.toFixed(2)),
    breakdown: {
      passingYards,
      passingTDs,
      rushingYards,
      rushingTDs,
      receivingYards,
      receivingTDs,
      receptions,
      passingInts,
    },
  }
}

async function hydrateCollegeMetadata(sport: CollegeSport): Promise<{ processed: number; updated: number }> {
  const players = await prisma.devyPlayer.findMany({
    where: { sport },
    select: {
      id: true,
      classYear: true,
      projectedDraftRound: true,
      draftProjectionScore: true,
      transferStatus: true,
      transferToSchool: true,
      transferFromSchool: true,
      c2cPointsSeason: true,
      c2cPointsWeek: true,
      projectedC2CPoints: true,
      statsPayload: true,
      passingYards: true,
      passingTDs: true,
      rushingYards: true,
      rushingTDs: true,
      receivingYards: true,
      receivingTDs: true,
      receptions: true,
    },
  })

  let updated = 0
  for (const player of players) {
    const points = computeC2CPointsFromPlayer(player, sport === 'NCAAB' ? 'points' : 'ppr')
    await prisma.devyPlayer.update({
      where: { id: player.id },
      data: {
        classYearLabel: toClassYearLabel(player.classYear),
        draftGrade: toDraftGrade(player.projectedDraftRound, player.draftProjectionScore),
        portalStatus: player.transferStatus
          ? player.transferToSchool
            ? 'IN_PORTAL'
            : 'PORTAL_WATCH'
          : null,
        projectedC2CPoints: points.seasonPoints,
        c2cPointsSeason: player.c2cPointsSeason ?? points.seasonPoints,
        c2cPointsWeek: player.c2cPointsWeek ?? points.weekPoints,
      },
    })
    updated += 1
  }

  return { processed: players.length, updated }
}

async function backfillNcaabStatsPayload(): Promise<number> {
  const response = await apiChain.fetch<Array<Record<string, unknown>>>({
    sport: 'NCAAB',
    dataType: 'players',
  })
  const rows = Array.isArray(response.data) ? response.data : []
  let updated = 0
  for (const row of rows.slice(0, 600)) {
    const name = String(row.name ?? row.fullName ?? row.displayName ?? '').trim()
    const school = String(row.team ?? row.school ?? row.college ?? '').trim()
    if (!name || !school) continue
    const normalizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    const player = await prisma.devyPlayer.findFirst({
      where: { normalizedName, school, sport: 'NCAAB' },
      select: { id: true },
    })
    if (!player) continue
    await prisma.devyPlayer.update({
      where: { id: player.id },
      data: {
        statsPayload: {
          points: Number(row.points ?? row.ppg ?? 0),
          rebounds: Number(row.rebounds ?? row.rpg ?? 0),
          assists: Number(row.assists ?? row.apg ?? 0),
          steals: Number(row.steals ?? 0),
          blocks: Number(row.blocks ?? 0),
          turnovers: Number(row.turnovers ?? 0),
        },
      },
    })
    updated += 1
  }
  return updated
}

async function resolveCollegeSportsForLeague(leagueId: string): Promise<string[]> {
  const [devyConfig, c2cConfig, league] = await Promise.all([
    getDevyConfig(leagueId).catch(() => null),
    getC2CConfig(leagueId).catch(() => null),
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }),
  ])

  const configSports =
    devyConfig?.collegeSports?.length
      ? devyConfig.collegeSports
      : c2cConfig?.collegeSports?.length
        ? c2cConfig.collegeSports
        : [resolveCollegeSport(league?.sport)]

  return Array.from(new Set(configSports.map((entry) => resolveCollegeSport(entry))))
}

async function getLeagueIdsHoldingCollegeSportAssets(sport: string): Promise<string[]> {
  const players = await prisma.devyPlayer.findMany({
    where: { sport: resolveCollegeSport(sport), graduatedToNFL: false },
    select: { id: true },
  })
  if (!players.length) return []

  const playerIds = new Set(players.map((player) => player.id))
  const rights = await prisma.devyRights.findMany({
    select: { leagueId: true, devyPlayerId: true },
  })

  return Array.from(
    new Set(
      rights
        .filter((right) => playerIds.has(right.devyPlayerId))
        .map((right) => right.leagueId)
        .filter(Boolean)
    )
  )
}

async function getLeagueIdsHoldingPlayer(playerId: string): Promise<string[]> {
  const rights = await prisma.devyRights.findMany({
    where: { devyPlayerId: playerId },
    select: { leagueId: true },
  })
  return Array.from(new Set(rights.map((right) => right.leagueId).filter(Boolean)))
}

async function notifyLeagueManagers(input: {
  leagueId: string
  title: string
  body: string
  type: string
  meta?: Record<string, unknown>
}) {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { userId: true, rosters: { select: { platformUserId: true } } },
  })
  if (!league) return
  const userIds = Array.from(
    new Set([league.userId, ...league.rosters.map((roster) => roster.platformUserId)].filter(Boolean))
  )
  if (!userIds.length) return
  await enqueueNotification({
    userIds,
    category: 'devy_c2c',
    productType: 'app',
    type: input.type,
    title: input.title,
    body: input.body,
    actionHref: `/league/${input.leagueId}`,
    actionLabel: 'Open league',
    meta: input.meta,
    severity: 'medium',
  }).catch(() => undefined)
}

export async function importCollegePlayers(sport: string): Promise<DevyWorkerResult> {
  const resolvedSport = resolveCollegeSport(sport)
  const seeded = await seedCollegePlayers({ sport: resolvedSport })
  if (resolvedSport === 'NCAAB') {
    await backfillNcaabStatsPayload().catch(() => 0)
  }
  const hydrated = await hydrateCollegeMetadata(resolvedSport)
  return {
    ok: seeded.errors.length === 0,
    sport: resolvedSport,
    created: seeded.seeded,
    updated: seeded.updated + hydrated.updated,
    processed: hydrated.processed,
    errors: seeded.errors,
  }
}

export async function refreshDraftProjections(sport: string): Promise<DevyWorkerResult> {
  const resolvedSport = resolveCollegeSport(sport)
  const players = await prisma.devyPlayer.findMany({
    where: { sport: resolvedSport },
    select: {
      id: true,
      name: true,
      draftGrade: true,
      projectedDraftRound: true,
      draftProjectionScore: true,
      c2cPointsSeason: true,
    },
  })
  let updated = 0
  const movers: Array<{ playerId: string; name: string; nextGrade: string | null; round: number | null }> = []
  for (const player of players) {
    const nextGrade = toDraftGrade(player.projectedDraftRound, player.draftProjectionScore)
    await prisma.devyPlayer.update({
      where: { id: player.id },
      data: {
        draftGrade: nextGrade,
        stockTrendDelta:
          player.draftProjectionScore != null && player.c2cPointsSeason != null
            ? Number(((player.draftProjectionScore / 100) * 10 + player.c2cPointsSeason / 10).toFixed(2))
            : null,
      },
    })
    if (nextGrade && nextGrade !== player.draftGrade) {
      movers.push({
        playerId: player.id,
        name: player.name,
        nextGrade,
        round: player.projectedDraftRound ?? null,
      })
    }
    updated += 1
  }
  if (updated > 0) {
    const leagueIds = await getLeagueIdsHoldingCollegeSportAssets(resolvedSport)
    await Promise.all(
      leagueIds.map((leagueId) =>
        notifyLeagueManagers({
          leagueId,
          type: 'devy_stock_refresh',
          title: 'Devy stock refreshed',
          body: `${resolvedSport} draft grades and stock movement were refreshed for your college pipeline.`,
          meta: { sport: resolvedSport, updated },
        })
      )
    )
  }
  await Promise.all(
    movers.slice(0, 12).map(async (mover) => {
      const leagueIds = await getLeagueIdsHoldingPlayer(mover.playerId)
      await Promise.all(
        leagueIds.map((leagueId) =>
          notifyLeagueManagers({
            leagueId,
            type: 'devy_stock_rising',
            title: `Draft stock rising: ${mover.name}`,
            body: `${mover.name} is now tracking toward ${mover.round != null ? `Round ${mover.round}` : 'a higher board slot'} with a ${mover.nextGrade} grade.`,
            meta: { sport: resolvedSport, playerId: mover.playerId, draftGrade: mover.nextGrade, projectedRound: mover.round },
          })
        )
      )
    })
  )
  return { ok: true, sport: resolvedSport, processed: players.length, updated, errors: [] }
}

export async function refreshTransferPortal(sport: string): Promise<DevyWorkerResult> {
  const resolvedSport = resolveCollegeSport(sport)
  const players = await prisma.devyPlayer.findMany({
    where: { sport: resolvedSport },
    select: {
      id: true,
      name: true,
      portalStatus: true,
      transferStatus: true,
      transferToSchool: true,
      transferFromSchool: true,
      school: true,
    },
  })
  let updated = 0
  const portalAlerts: Array<{ playerId: string; name: string; school: string | null; status: string }> = []
  for (const player of players) {
    const portalStatus =
      player.transferStatus
        ? player.transferToSchool
          ? 'IN_PORTAL'
          : 'PORTAL_WATCH'
        : null
    await prisma.devyPlayer.update({
      where: { id: player.id },
      data: {
        portalStatus,
        nextGameLabel: portalStatus ? `${player.school} transfer update` : null,
      },
    })
    if (portalStatus && portalStatus !== player.portalStatus) {
      portalAlerts.push({
        playerId: player.id,
        name: player.name,
        school: player.school ?? null,
        status: portalStatus,
      })
    }
    updated += 1
  }
  if (updated > 0) {
    const leagueIds = await getLeagueIdsHoldingCollegeSportAssets(resolvedSport)
    await Promise.all(
      leagueIds.map((leagueId) =>
        notifyLeagueManagers({
          leagueId,
          type: 'devy_portal_refresh',
          title: 'Portal watch refreshed',
          body: `${resolvedSport} portal status and college asset movement were refreshed for your league.`,
          meta: { sport: resolvedSport, updated },
        })
      )
    )
  }
  await Promise.all(
    portalAlerts.slice(0, 12).map(async (alert) => {
      const leagueIds = await getLeagueIdsHoldingPlayer(alert.playerId)
      await Promise.all(
        leagueIds.map((leagueId) =>
          notifyLeagueManagers({
            leagueId,
            type: 'devy_transfer_portal',
            title: `${alert.name} entered the transfer portal`,
            body: `${alert.name}${alert.school ? ` from ${alert.school}` : ''} now carries ${alert.status.toLowerCase()} risk for devy and C2C formats.`,
            meta: { sport: resolvedSport, playerId: alert.playerId, portalStatus: alert.status },
          })
        )
      )
    })
  )
  return { ok: true, sport: resolvedSport, processed: players.length, updated, errors: [] }
}

export async function calculateC2CPointsForLeague(input: {
  leagueId: string
  week?: number
  season?: number
}): Promise<DevyWorkerResult> {
  const season = input.season ?? new Date().getFullYear()
  const week = input.week ?? 1
  const [c2cConfig, sports] = await Promise.all([
    getC2CConfig(input.leagueId),
    resolveCollegeSportsForLeague(input.leagueId),
  ])
  if (!c2cConfig) {
    return { ok: true, leagueId: input.leagueId, processed: 0, updated: 0, logsWritten: 0, errors: [] }
  }

  const rights = await prisma.devyRights.findMany({
    where: { leagueId: input.leagueId },
    select: {
      rosterId: true,
      devyPlayerId: true,
      slotCategory: true,
      c2cLineupRole: true,
    },
  })
  const playerIds = rights.map((entry) => entry.devyPlayerId)
  const players = await prisma.devyPlayer.findMany({
    where: {
      id: { in: playerIds },
      sport: { in: sports.map((entry) => resolveCollegeSport(entry)) },
    },
  })
  const playerById = new Map(players.map((player) => [player.id, player]))
  let logsWritten = 0

  for (const right of rights) {
    const player = playerById.get(right.devyPlayerId)
    if (!player) continue
    const points = computeC2CPointsFromPlayer(player, c2cConfig.collegeScoringSystem)
    await prisma.c2CScoringLog.upsert({
      where: {
        leagueId_rosterId_devyPlayerId_season_week_gameId: {
          leagueId: input.leagueId,
          rosterId: right.rosterId,
          devyPlayerId: right.devyPlayerId,
          season,
          week,
          gameId: `week_${week}`,
        },
      },
      create: {
        id: randomUUID(),
        leagueId: input.leagueId,
        rosterId: right.rosterId,
        devyPlayerId: right.devyPlayerId,
        season,
        week,
        gameId: `week_${week}`,
        points: points.weekPoints,
        scoringSystem: c2cConfig.collegeScoringSystem,
        breakdown: {
          ...points.breakdown,
          slotCategory: right.slotCategory,
          lineupRole: right.c2cLineupRole,
        },
      },
      update: {
        points: points.weekPoints,
        scoringSystem: c2cConfig.collegeScoringSystem,
        breakdown: {
          ...points.breakdown,
          slotCategory: right.slotCategory,
          lineupRole: right.c2cLineupRole,
        },
      },
    })
    await prisma.devyPlayer.update({
      where: { id: player.id },
      data: {
        c2cPointsSeason: points.seasonPoints,
        c2cPointsWeek: points.weekPoints,
        projectedC2CPoints: points.seasonPoints,
      },
    })
    logsWritten += 1
  }

  if (logsWritten > 0) {
    await notifyLeagueManagers({
      leagueId: input.leagueId,
      type: 'c2c_live_scoring',
      title: 'College scoring updated',
      body: `Week ${week} college scoring refreshed for your C2C roster.`,
      meta: { season, week, logsWritten },
    })
  }
  const nextGames = players
    .filter((player) => player.nextGameLabel)
    .slice(0, 3)
    .map((player) => `${player.name}: ${player.nextGameLabel}`)
  if (nextGames.length > 0) {
    await notifyLeagueManagers({
      leagueId: input.leagueId,
      type: 'c2c_game_reminder',
      title: 'Upcoming college games',
      body: nextGames.join(' | '),
      meta: { season, week, reminders: nextGames.length },
    })
  }

  return {
    ok: true,
    leagueId: input.leagueId,
    processed: rights.length,
    updated: logsWritten,
    logsWritten,
    errors: [],
  }
}

export async function promoteEligiblePlayers(input: {
  leagueId: string
  season?: number
}): Promise<DevyWorkerResult> {
  const season = input.season ?? new Date().getFullYear()
  const promotable = await prisma.devyRights.findMany({
    where: {
      leagueId: input.leagueId,
      state: { in: ['PROMOTION_ELIGIBLE', 'DRAFTED_RIGHTS_HELD'] },
    },
    select: {
      id: true,
      devyPlayerId: true,
      rosterId: true,
    },
  })
  const players = await prisma.devyPlayer.findMany({
    where: { id: { in: promotable.map((right) => right.devyPlayerId) } },
    select: { id: true, name: true, nflTeam: true, projectedDraftRound: true },
  })
  const playerById = new Map(players.map((player) => [player.id, player]))
  let updated = 0
  for (const right of promotable) {
    await prisma.devyRights.update({
      where: { id: right.id },
      data: {
        state: 'PROMOTED_TO_PRO',
        slotCategory: 'PRO',
        promotedAt: new Date(),
        seasonYear: season,
      },
    })
    const player = playerById.get(right.devyPlayerId)
    if (player) {
      await notifyLeagueManagers({
        leagueId: input.leagueId,
        type: 'devy_player_promoted_detail',
        title: `${player.name} went pro`,
        body: `${player.name} is ready to move into your pro pipeline${player.nflTeam ? ` with ${player.nflTeam}` : ''}.`,
        meta: {
          season,
          playerId: player.id,
          projectedRound: player.projectedDraftRound ?? null,
          nflTeam: player.nflTeam ?? null,
        },
      })
    }
    updated += 1
  }
  if (updated > 0) {
    await notifyLeagueManagers({
      leagueId: input.leagueId,
      type: 'devy_player_promoted',
      title: 'Devy promotion window advanced',
      body: `${updated} college assets were promoted into the pro pipeline.`,
      meta: { season, updated },
    })
  }
  return { ok: true, leagueId: input.leagueId, processed: promotable.length, updated, errors: [] }
}

