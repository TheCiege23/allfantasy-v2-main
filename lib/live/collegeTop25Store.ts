import 'server-only'

import { prisma } from '@/lib/prisma'
import { listTeamFollows } from '@/lib/follows/teamFollows'
import {
  isTop25Sport,
  mergeRankBook,
  type FollowedTeam,
  type RankBook,
  type RankObservation,
} from '@/lib/live/collegeTop25'

/**
 * Where the college Top 25 lives between scoreboard fetches (see collegeTop25.ts for the rule).
 *
 * ⚠ NO NEW PROVIDER CALL. The rank book is written from the ESPN scoreboard the live service already
 * fetches (`getLiveScoresForSport`), whose competitors carry `curatedRank`; readers — the live page's
 * cached path and the home's fixture strip — read Postgres only. One `SportsDataCache` row per sport.
 */
const KEY = (sport: string) => `college-top25:v1:${sport.toUpperCase()}`
const ROW_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export async function readRankBook(sport: string): Promise<RankBook | null> {
  if (!isTop25Sport(sport)) return null
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: KEY(sport) } }).catch(() => null)
  const data = row?.data as RankBook | null | undefined
  return data && typeof data === 'object' && data.teams && typeof data.teams === 'object' ? data : null
}

/** Fold one scoreboard's ranks in. Never throws — a rank write must not fail a scores refresh. */
export async function recordCollegeRanks(
  sport: string,
  rows: Array<{
    homeTeam: string
    homeTeamId?: string | null
    homeTeamFull?: string | null
    homeRank?: number | null
    awayTeam: string
    awayTeamId?: string | null
    awayTeamFull?: string | null
    awayRank?: number | null
  }>,
  now = new Date(),
): Promise<void> {
  if (!isTop25Sport(sport)) return
  try {
    const observations: RankObservation[] = rows.flatMap((r) => [
      { teamId: r.homeTeamId ?? null, abbrev: r.homeTeam, name: r.homeTeamFull ?? null, rank: r.homeRank },
      { teamId: r.awayTeamId ?? null, abbrev: r.awayTeam, name: r.awayTeamFull ?? null, rank: r.awayRank },
    ])
    const next = mergeRankBook(await readRankBook(sport), observations, now)
    if (!next) return
    const expiresAt = new Date(now.getTime() + ROW_LIFETIME_MS)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: KEY(sport) },
      update: { data: next as never, expiresAt },
      create: { cacheKey: KEY(sport), data: next as never, expiresAt },
    })
  } catch (err) {
    console.warn('[college-top25] rank write skipped:', err instanceof Error ? err.message : err)
  }
}

/** The teams this user follows in one sport. Empty for a guest or when follows are unavailable. */
export async function readFollowedTeams(userId: string | null, sport: string): Promise<FollowedTeam[]> {
  if (!userId) return []
  const all = await listTeamFollows(userId).catch(() => null)
  return (all ?? [])
    .filter((f) => f.sport.toUpperCase() === sport.toUpperCase())
    .map((f) => ({ teamAbbr: f.teamAbbr, teamName: f.teamName }))
}
