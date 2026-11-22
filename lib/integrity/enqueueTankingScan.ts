import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runIntegrityJob } from '@/lib/integrity/runIntegrityJob'

/** Long enough to outlive any season; the row is a "this week was scanned" marker, not a lock. */
const SCANNED_MARKER_MS = 400 * 24 * 60 * 60 * 1000

export function tankingScanMarkerKey(leagueId: string, seasonId: string, weekNumber: number): string {
  return `integrity-tanking-scan:${leagueId}:${seasonId}:${weekNumber}`
}

/**
 * Scan a finalized native week for tanking, once.
 *
 * The name is kept for its caller; it no longer queues. The BullMQ integrity queue it used to feed
 * has no worker in production, so no week was ever scanned (lib/integrity/runIntegrityJob.ts).
 *
 * ⚠ ONCE PER WEEK, AND THAT IS WHY THE MARKER EXISTS. The week finalizer re-runs closed weeks on
 * its schedule, and the queue's fixed jobId was what stopped each re-run from scanning again. Each
 * scan can ask Chimmy about every suspicious lineup, so the dedupe is now an `AutomationLock` row
 * claimed before the scan (the same once-marker `guillotine-elimination:*` uses). A scan that fails
 * releases its marker so the next run retries; a league without AF Commissioner keeps it, because
 * that week has already passed.
 */
export async function enqueueTankingScan(leagueId: string, weekNumber: number, seasonId: string): Promise<void> {
  const lockKey = tankingScanMarkerKey(leagueId, seasonId, weekNumber)
  try {
    await prisma.automationLock.create({
      data: { lockKey, owner: 'integrity-tanking-scan', expiresAt: new Date(Date.now() + SCANNED_MARKER_MS) },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return
    throw e
  }

  const outcome = await runIntegrityJob({ type: 'tanking_scan_week', leagueId, weekNumber, seasonId })
  if (!outcome.ok) {
    await prisma.automationLock.delete({ where: { lockKey } }).catch(() => undefined)
    throw new Error(outcome.error ?? 'tanking scan failed')
  }
}
