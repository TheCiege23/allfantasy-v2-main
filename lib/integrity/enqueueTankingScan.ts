import 'server-only'

import { Queue } from 'bullmq'
import { QUEUE_NAMES, type IntegrityJobPayload } from '@/lib/jobs/types'
import { getRedisConnection, isRedisConfigured } from '@/lib/queues/bullmq'

/** Queue the finalized native week once; worker checks entitlement and settings. */
export async function enqueueTankingScan(leagueId: string, weekNumber: number, seasonId: string): Promise<void> {
  if (!isRedisConfigured()) return
  const connection = getRedisConnection()
  if (!connection) return

  const queue = new Queue<IntegrityJobPayload>(QUEUE_NAMES.INTEGRITY, { connection })
  try {
    await queue.add('tanking_scan_week', { type: 'tanking_scan_week', leagueId, weekNumber, seasonId }, {
      jobId: `tanking-${leagueId}-${seasonId}-${weekNumber}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    })
  } finally {
    await queue.close()
  }
}
