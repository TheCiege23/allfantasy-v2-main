import { prisma } from '@/lib/prisma'
import { normaliseStatus } from './rollingInsightsAdapter'

// Kickoff is stable; fetchedAt/updatedAt can move on every cron observation.
// Eight hours covers an ordinary game and several hours of final corrections.
export const POINTS_CORRECTION_WINDOW_MS = 8 * 3_600_000

export async function pointsRefreshGameIds(now = new Date()): Promise<string[]> {
  const rows = await prisma.sportsGame.findMany({
    where: { sport: 'NFL', startTime: { gte: new Date(now.getTime() - POINTS_CORRECTION_WINDOW_MS), lte: now } },
    select: { externalId: true, status: true },
    take: 100,
  }).catch(() => [])
  // The gate consumes no provider-specific IDs: either saved provider can
  // establish that this slate is active or within the bounded correction window.
  return rows.filter(row => ['in_progress', 'final'].includes(normaliseStatus(row.status ?? undefined)))
    .map(row => row.externalId).filter(Boolean)
}
