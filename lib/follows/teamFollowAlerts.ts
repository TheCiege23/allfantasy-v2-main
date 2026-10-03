import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { getTeamIndex, isTeamFollowSport } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'

/**
 * Which followed team a news story belongs to, and how many team alerts one person may get a day.
 * Used by lib/notifications/PlayerNewsNotificationService for the `followed_teams` category.
 */

/**
 * The canonical team for a news row: its own `team` text through the resolver; when the row has NO
 * team text at all, the player's current team from `sports_players`.
 *
 * ⚠ A team string that does not resolve (e.g. "Multiple (Ravens, Falcons)", "Free Agent", a former
 * team) does NOT fall back to the player. The provider said something specific and it named no
 * single current team; looking the player up would overrule that with a guess.
 *
 * ⚠ The player fallback needs ONE answer. Two players sharing a name on different teams (common in
 * college) resolve to null rather than whichever row came first.
 */
export async function resolveNewsTeam(
  sport: string,
  team: string | null | undefined,
  playerName: string | null | undefined,
): Promise<string | null> {
  const S = String(sport ?? '').toUpperCase()
  if (!isTeamFollowSport(S)) return null
  const index = await getTeamIndex(S)
  if (!index) return null
  if (team && team.trim()) return resolveTeam(index, team)
  if (!playerName || !playerName.trim()) return null
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sport: S, name: { equals: playerName.trim(), mode: 'insensitive' }, team: { not: null } },
      select: { team: true },
      take: 10,
    })
    .catch(() => [] as Array<{ team: string | null }>)
  const teams = new Set(rows.map((r) => resolveTeam(index, r.team)).filter((t): t is string => !!t))
  return teams.size === 1 ? [...teams][0] : null
}

/**
 * Team alerts per person per day. A followed NFL team generates ~18 news rows a day (measured
 * 2026-10-03, ~594 NFL rows/day across 32 teams), and the sender already keeps only high-impact and
 * injury stories — this is the backstop for a busy news day, so a follow never becomes the reason
 * someone turns alerts off.
 */
export const TEAM_FOLLOW_ALERTS_PER_DAY = 8

/** The subset of `userIds` still under today's team-alert cap; each one kept is counted. */
export async function withinTeamFollowDailyCap(userIds: readonly string[]): Promise<string[]> {
  const kept: string[] = []
  for (const id of userIds) {
    try {
      const r = await consumeDailyLimit({
        provider: 'team_follow_alerts',
        endpoint: `tf:${createHash('sha256').update(id).digest('hex').slice(0, 24)}`,
        callsLimit: TEAM_FOLLOW_ALERTS_PER_DAY,
      })
      if (r.success) kept.push(id)
    } catch {
      // Counter unavailable: send. Dropping a follower's alert on a counter outage would make the
      // feature silently fail; the sender's high-impact filter still bounds volume.
      kept.push(id)
    }
  }
  return kept
}
