/**
 * Fantasy OS — adapts the existing durable `AutomationLock` (Postgres, owner+TTL+expiry-steal, Redis
 * preferred) to the runner's `SyncLock` interface. This gives the collector distributed overlap
 * protection + stale-lease recovery for free, keyed on the per-league run key — so overlapping cron
 * executions can never process the same connected league concurrently. Reuses lib/automation/locks;
 * no second locking mechanism.
 */
import { randomUUID } from 'crypto'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import type { SyncLock } from '@/lib/fantasy-os/sync/runner'

export function createAutomationSyncLock(): SyncLock {
  return {
    async acquire(key: string, leaseMs: number, _now: Date) {
      // Unique owner per acquisition = the lock token. AutomationLock steals an EXPIRED lease
      // internally, so a crashed prior run never wedges the connection permanently.
      const owner = `fos-sync:${randomUUID()}`
      const res = await acquireAutomationLock(key, {
        owner,
        ttlMs: leaseMs,
        metadata: { kind: 'fantasy-os-sleeper-sync' },
      })
      return res.ok ? { acquired: true, token: owner } : { acquired: false }
    },
    async release(key: string, token: string) {
      await releaseAutomationLock(key, token)
    },
  }
}
