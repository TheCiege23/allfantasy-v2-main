/**
 * Platform Leaderboards — best draft grades, most championships, highest win %, most active managers.
 */

import { prisma } from '@/lib/prisma'
import { SYSTEM_LEAGUE_OWNER_ID } from '@/lib/league-import/systemLeagueOwner'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const DEFAULT_ACTIVITY_LOOKBACK_DAYS = 120

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
}

interface LeaderboardEntry {
  rank: number
  managerId: string
  displayName: string | null
  value: number
  extra?: { count?: number; grade?: string }
}

interface LeaderboardResult {
  entries: LeaderboardEntry[]
  total: number
  generatedAt: string
}

/** Resolve display names for manager IDs (sleeper user id or app user id). */
async function getDisplayNames(managerIds: string[]): Promise<Map<string, string | null>> {
  if (managerIds.length === 0) return new Map()
  const unique = [...new Set(managerIds)]
  const [profiles, appUsers] = await Promise.all([
    prisma.userProfile.findMany({
      where: {
        OR: [
          { userId: { in: unique } },
          { sleeperUserId: { in: unique } },
        ],
      },
      select: { userId: true, sleeperUserId: true, displayName: true },
    }),
    prisma.appUser.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true, username: true },
    }),
  ])
  const map = new Map<string, string | null>()
  for (const id of unique) {
    const byProfile = profiles.find((p) => p.userId === id || p.sleeperUserId === id)
    const byApp = appUsers.find((u) => u.id === id)
    const name =
      byProfile?.displayName ??
      (byApp ? (byApp.displayName ?? byApp.username) : null)
    map.set(id, name ?? null)
  }
  return map
}

/**
 * Batch-resolve (leagueId, rosterId) -> managerId to avoid N+1.
 * Uses 2–4 batched queries instead of one per grade.
 */
async function batchResolveDraftGradeManagers(
  keys: Array<{ leagueId: string; rosterId: string }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (keys.length === 0) return result
  const keySet = new Map(keys.map((k) => [`${k.leagueId}:${k.rosterId}`, k]))
  const leagueIds = [...new Set(keys.map((k) => k.leagueId))]

  const leagues = await prisma.league.findMany({
    where: { id: { in: leagueIds } },
    select: { id: true, legacyLeagueId: true },
  })
  const leagueMap = new Map(leagues.map((l) => [l.id, l]))
  const appLeagueIds = new Set(leagues.map((l) => l.id))

  const rosterPairs = keys.filter((k) => appLeagueIds.has(k.leagueId)).map((k) => ({ leagueId: k.leagueId, id: k.rosterId }))
  if (rosterPairs.length > 0) {
    const rosters = await prisma.roster.findMany({
      where: { OR: rosterPairs.map((p) => ({ leagueId: p.leagueId, id: p.id })) },
      select: { leagueId: true, id: true, platformUserId: true },
    })
    for (const r of rosters) {
      if (r.platformUserId) result.set(`${r.leagueId}:${r.id}`, r.platformUserId)
    }
  }

  const unresolvedByApp = rosterPairs.filter((p) => !result.has(`${p.leagueId}:${p.id}`))
  if (unresolvedByApp.length > 0) {
    const teams = await prisma.leagueTeam.findMany({
      where: { OR: unresolvedByApp.map((p) => ({ leagueId: p.leagueId, id: p.id })) },
      select: { leagueId: true, id: true, legacyRosterId: true },
    })
    const lrIds = teams.map((t) => t.legacyRosterId).filter((id): id is string => id != null)
    if (lrIds.length > 0) {
      const legacyRosters = await prisma.legacyRoster.findMany({
        where: { id: { in: lrIds } },
        select: { id: true, ownerId: true },
      })
      const lrMap = new Map(legacyRosters.map((lr) => [lr.id, lr.ownerId]))
      for (const t of teams) {
        if (t.legacyRosterId) {
          const ownerId = lrMap.get(t.legacyRosterId)
          if (ownerId) result.set(`${t.leagueId}:${t.id}`, ownerId)
        }
      }
    }
  }

  const legacyLeagueIds = leagueIds.filter((id) => !appLeagueIds.has(id))
  if (legacyLeagueIds.length > 0) {
    const legacyLeagues = await prisma.legacyLeague.findMany({
      where: { sleeperLeagueId: { in: legacyLeagueIds } },
      select: { id: true, sleeperLeagueId: true },
    })
    const sleeperToLegacy = new Map(legacyLeagues.map((l) => [l.sleeperLeagueId, l.id]))
    const legacyKeys = keys.filter((k) => sleeperToLegacy.has(k.leagueId) && !result.has(`${k.leagueId}:${k.rosterId}`))
    const rosterIdNums = legacyKeys.map((k) => ({ k, num: parseInt(k.rosterId, 10) })).filter(({ num }) => !Number.isNaN(num))
    if (rosterIdNums.length > 0) {
      const legacyRosterPairs = await prisma.legacyRoster.findMany({
        where: {
          OR: rosterIdNums.map(({ k, num }) => ({
            leagueId: sleeperToLegacy.get(k.leagueId)!,
            rosterId: num,
          })),
        },
        select: { leagueId: true, rosterId: true, ownerId: true },
      })
      const legacyBySleeper = new Map(legacyLeagues.map((l) => [l.id, l.sleeperLeagueId]))
      for (const lr of legacyRosterPairs) {
        if (lr.ownerId) {
          const sleeperId = legacyBySleeper.get(lr.leagueId)
          if (sleeperId) result.set(`${sleeperId}:${lr.rosterId}`, lr.ownerId)
        }
      }
    }
  }

  return result
}

/**
 * Best drafters — average draft grade score by manager.
 * Supports app League (uuid) + Roster/LeagueTeam and legacy Sleeper leagues.
 */
export async function getBestDraftGradesLeaderboard(options: {
  limit?: number
}): Promise<LeaderboardResult> {
  const limit = clampLimit(options.limit)

  const grades = await prisma.draftGrade.findMany({
    select: { leagueId: true, rosterId: true, score: true, grade: true },
  })

  const uniqueKeys = Array.from(
    new Map(grades.map((g) => [`${g.leagueId}:${g.rosterId}`, { leagueId: g.leagueId, rosterId: g.rosterId }])).values()
  )
  const resolveMap = await batchResolveDraftGradeManagers(uniqueKeys)

  const byManager = new Map<string, { sum: number; count: number; grades: string[] }>()
  for (const g of grades) {
    const key = `${g.leagueId}:${g.rosterId}`
    const managerId = resolveMap.get(key) ?? null
    if (!managerId) continue
    const score = Number(g.score)
    if (Number.isNaN(score)) continue
    const cur = byManager.get(managerId) ?? { sum: 0, count: 0, grades: [] }
    cur.sum += score
    cur.count += 1
    if (g.grade) cur.grades.push(g.grade)
    byManager.set(managerId, cur)
  }

  const rows: { managerId: string; avgScore: number; count: number; latestGrade: string }[] = []
  byManager.forEach((v, managerId) => {
    if (v.count > 0) {
      rows.push({
        managerId,
        avgScore: v.sum / v.count,
        count: v.count,
        latestGrade: v.grades[v.grades.length - 1] ?? '',
      })
    }
  })
  rows.sort((a, b) => b.avgScore - a.avgScore)

  const managerIds = rows.slice(0, limit).map((r) => r.managerId)
  const displayNames = await getDisplayNames(managerIds)

  const entries: LeaderboardEntry[] = rows.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    managerId: r.managerId,
    displayName: displayNames.get(r.managerId) ?? null,
    value: Math.round(r.avgScore * 100) / 100,
    extra: { count: r.count, grade: r.latestGrade || undefined },
  }))

  return {
    entries,
    total: rows.length,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Most championships — from ManagerFranchiseProfile, ordered by championshipCount desc.
 */
export async function getMostChampionshipsLeaderboard(options: {
  limit?: number
}): Promise<LeaderboardResult> {
  const limit = clampLimit(options.limit)

  const profiles = await prisma.managerFranchiseProfile.findMany({
    where: { championshipCount: { gt: 0 } },
    orderBy: { championshipCount: 'desc' },
    take: limit,
    select: { managerId: true, championshipCount: true },
  })

  const displayNames = await getDisplayNames(profiles.map((p) => p.managerId))

  const entries: LeaderboardEntry[] = profiles.map((p, i) => ({
    rank: i + 1,
    managerId: p.managerId,
    displayName: displayNames.get(p.managerId) ?? null,
    value: p.championshipCount,
    extra: { count: p.championshipCount },
  }))

  return {
    entries,
    total: await prisma.managerFranchiseProfile.count({ where: { championshipCount: { gt: 0 } } }),
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Highest win % — from ManagerFranchiseProfile, ordered by careerWinPercentage desc.
 */
export async function getHighestWinPctLeaderboard(options: {
  limit?: number
  minGames?: number
}): Promise<LeaderboardResult> {
  const limit = clampLimit(options.limit)
  const minLeagues = options.minGames ?? 5

  const profiles = await prisma.managerFranchiseProfile.findMany({
    where: {
      ...(minLeagues > 0 ? { totalLeaguesPlayed: { gte: minLeagues } } : {}),
    },
    orderBy: { careerWinPercentage: 'desc' },
    take: limit * 2,
    select: { managerId: true, careerWinPercentage: true, totalLeaguesPlayed: true },
  })

  const rows = profiles
    .filter((p) => p.careerWinPercentage != null && Number(p.careerWinPercentage) >= 0)
    .slice(0, limit)

  const displayNames = await getDisplayNames(rows.map((p) => p.managerId))

  const entries: LeaderboardEntry[] = rows.map((p, i) => ({
    rank: i + 1,
    managerId: p.managerId,
    displayName: displayNames.get(p.managerId) ?? null,
    value: Math.round(Number(p.careerWinPercentage) * 10000) / 100,
    extra: { count: p.totalLeaguesPlayed ?? 0 },
  }))

  const total = await prisma.managerFranchiseProfile.count()

  return {
    entries,
    total,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Most active managers — deterministic event activity score.
 * Sources:
 * - LeagueChatMessage.userId
 * - TradeOfferEvent.senderUserId / opponentUserId
 * - WaiverTransaction.rosterId -> Roster.platformUserId
 */
export async function getMostActiveLeaderboard(options: {
  limit?: number
  lookbackDays?: number
}): Promise<LeaderboardResult> {
  const limit = clampLimit(options.limit)
  const lookbackDays = Math.max(7, Math.min(options.lookbackDays ?? DEFAULT_ACTIVITY_LOOKBACK_DAYS, 365))
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  const [chatCounts, sentTradeCounts, opponentTradeCounts, waiverCounts] = await Promise.all([
    prisma.leagueChatMessage.groupBy({
      by: ['userId'],
      // Not the system account that owns joined-by-pick ESPN leagues: its automated posts are not a person's activity.
      where: { createdAt: { gte: since }, userId: { not: SYSTEM_LEAGUE_OWNER_ID } },
      _count: { _all: true },
    }),
    prisma.tradeOfferEvent.groupBy({
      by: ['senderUserId'],
      where: { createdAt: { gte: since }, senderUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.tradeOfferEvent.groupBy({
      by: ['opponentUserId'],
      where: { createdAt: { gte: since }, opponentUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.waiverTransaction.groupBy({
      by: ['rosterId'],
      where: { processedAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const waiverRosterIds = [...new Set(waiverCounts.map((row) => row.rosterId).filter(Boolean))]
  const waiverRosters =
    waiverRosterIds.length > 0
      ? await prisma.roster.findMany({
          where: { id: { in: waiverRosterIds } },
          select: { id: true, platformUserId: true },
        })
      : []
  const rosterToManager = new Map(
    waiverRosters
      .filter((row) => !!row.platformUserId)
      .map((row) => [row.id, row.platformUserId as string])
  )

  const byManager = new Map<
    string,
    { chatCount: number; tradeCount: number; waiverCount: number; totalActions: number; activityScore: number }
  >()
  const touchManager = (managerId: string) => {
    const normalized = String(managerId ?? '').trim()
    if (!normalized) return null
    const current =
      byManager.get(normalized) ??
      { chatCount: 0, tradeCount: 0, waiverCount: 0, totalActions: 0, activityScore: 0 }
    byManager.set(normalized, current)
    return current
  }

  for (const row of chatCounts) {
    const current = touchManager(String(row.userId))
    if (!current) continue
    current.chatCount += row._count._all
  }
  for (const row of sentTradeCounts) {
    const current = touchManager(String(row.senderUserId ?? ''))
    if (!current) continue
    current.tradeCount += row._count._all
  }
  for (const row of opponentTradeCounts) {
    const current = touchManager(String(row.opponentUserId ?? ''))
    if (!current) continue
    current.tradeCount += row._count._all
  }
  for (const row of waiverCounts) {
    const managerId = rosterToManager.get(row.rosterId)
    if (!managerId) continue
    const current = touchManager(managerId)
    if (!current) continue
    current.waiverCount += row._count._all
  }

  const rows: Array<{
    managerId: string
    chatCount: number
    tradeCount: number
    waiverCount: number
    totalActions: number
    activityScore: number
  }> = []
  byManager.forEach((value, managerId) => {
    const totalActions = value.chatCount + value.tradeCount + value.waiverCount
    if (totalActions <= 0) return
    // Weight trades/waivers slightly higher than chat to reward cross-surface engagement.
    const activityScore = value.chatCount + value.tradeCount * 3 + value.waiverCount * 2
    rows.push({
      managerId,
      chatCount: value.chatCount,
      tradeCount: value.tradeCount,
      waiverCount: value.waiverCount,
      totalActions,
      activityScore,
    })
  })

  rows.sort((a, b) => {
    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore
    if (b.totalActions !== a.totalActions) return b.totalActions - a.totalActions
    return a.managerId.localeCompare(b.managerId)
  })

  const displayNames = await getDisplayNames(rows.slice(0, limit).map((row) => row.managerId))
  const entries: LeaderboardEntry[] = rows.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    managerId: row.managerId,
    displayName: displayNames.get(row.managerId) ?? null,
    value: row.activityScore,
    extra: {
      count: row.totalActions,
      grade: `${row.chatCount} chat · ${row.tradeCount} trade · ${row.waiverCount} waiver`,
    },
  }))

  return {
    entries,
    total: rows.length,
    generatedAt: new Date().toISOString(),
  }
}

