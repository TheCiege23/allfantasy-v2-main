import { prisma } from '@/lib/prisma'
import { hasClassException } from '@/lib/class-rating/exceptions'
import { getLevelFromXp, RANK_LEVELS } from '@/lib/rank/levels'

export const CAREER_JOIN_DISTANCE = 3

export type CareerJoinDecision = {
  userLevel: number
  leagueLevel: number
  band: [number, number]
  canJoin: boolean
}

type LeagueRank = { userId: string; settings: unknown }
type RankReader = Pick<typeof prisma, 'userProfile' | 'league'>

function settingsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function savedLeagueCareerLevel(settings: unknown): number | null {
  const root = settingsOf(settings)
  const value = settingsOf(root.league_finder_rank_window).creatorRankLevel ?? root.creatorRankLevel
  const level = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return RANK_LEVELS.some((row) => row.level === level) ? level : null
}

export function decideCareerJoin(userLevel: number, leagueLevel: number, approved = false): CareerJoinDecision {
  const max = RANK_LEVELS[RANK_LEVELS.length - 1].level
  return {
    userLevel,
    leagueLevel,
    band: [Math.max(1, leagueLevel - CAREER_JOIN_DISTANCE), Math.min(max, leagueLevel + CAREER_JOIN_DISTANCE)],
    canJoin: approved || Math.abs(userLevel - leagueLevel) <= CAREER_JOIN_DISTANCE,
  }
}

export function careerXpLevel(profile?: { xpTotal?: bigint | number | null; xpLevel?: number | null } | null): number {
  if (profile?.xpTotal != null) return getLevelFromXp(Number(profile.xpTotal)).level
  return RANK_LEVELS.find((row) => row.level === profile?.xpLevel)?.level ?? 1
}

export async function loadCareerXpLevels(userIds: string[], db: RankReader = prisma): Promise<Map<string, number>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const profiles = await db.userProfile.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, xpLevel: true, xpTotal: true },
  })
  return new Map(profiles.map((p) => [p.userId, careerXpLevel(p)]))
}

export function leagueCareerLevel(league: LeagueRank, levels: ReadonlyMap<string, number>): number {
  return savedLeagueCareerLevel(league.settings) ?? levels.get(league.userId) ?? 1
}

export async function evaluateCareerJoinGate(
  userId: string,
  leagueId: string,
  league?: LeagueRank,
  db: RankReader = prisma,
): Promise<CareerJoinDecision | null> {
  const target = league ?? await db.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!target) return null
  const levels = await loadCareerXpLevels(savedLeagueCareerLevel(target.settings) == null ? [userId, target.userId] : [userId], db)
  return decideCareerJoin(levels.get(userId) ?? 1, leagueCareerLevel(target, levels),
    target.userId === userId || hasClassException(target.settings, userId))
}

export function careerJoinRefusal(gate: CareerJoinDecision, leagueId: string) {
  return {
    ...gate,
    code: 'CAREER_LEVEL_GATE_BLOCKED' as const,
    leagueId,
    canRequest: true as const,
    error: `You are Career Level ${gate.userLevel}. Direct joins for this league are open to levels ${gate.band[0]}–${gate.band[1]}. You can ask the commissioner to approve your request.`,
  }
}
