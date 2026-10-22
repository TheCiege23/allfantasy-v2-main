/**
 * Which week a guillotine league is in, and which roster is the viewer's — one rule for every
 * surface that needs them.
 *
 * Before this the summary route defaulted to WEEK 1 whenever no `?week=` was passed, so the
 * Guillotine tab (`GuillotineHome`, whose week state was never advanced) and the since-deleted `GuillotineFormatTab`
 * both showed week 1's danger tiers all season. The war room already resolved the week properly;
 * that rule now lives here and both use it.
 */
import { prisma } from '@/lib/prisma'

/**
 * Latest scored period, else the configured first chop week, else 1 — plus when that latest score
 * was written (the war room shows it as "scores as of").
 */
export async function resolveGuillotineWeekState(
  leagueId: string,
  config?: { eliminationStartWeek?: number | null } | null,
): Promise<{ week: number; latestScoredAt: Date | null }> {
  const latest = await prisma.guillotinePeriodScore
    .findFirst({ where: { leagueId }, orderBy: { weekOrPeriod: 'desc' }, select: { weekOrPeriod: true, createdAt: true } })
    .catch(() => null)
  return { week: latest?.weekOrPeriod ?? config?.eliminationStartWeek ?? 1, latestScoredAt: latest?.createdAt ?? null }
}

export async function resolveGuillotineCurrentWeek(
  leagueId: string,
  config?: { eliminationStartWeek?: number | null } | null,
): Promise<number> {
  return (await resolveGuillotineWeekState(leagueId, config)).week
}

/** The viewer's roster in a hosted league: the roster their user id owns (same rule as the war room). */
export async function findViewerRosterId(leagueId: string, userId: string): Promise<string | null> {
  const row = await prisma.roster
    .findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
    .catch(() => null)
  return row?.id ?? null
}
