/**
 * G15.3 — Outbox Relay runner (operational driver).
 *
 * Drains pending `event_outbox` rows, delivering each event to durable consumers
 * (currently the event-audit-feed projection) with retry/backoff + dead-lettering,
 * and best-effort real-time fan-out via the in-process bus.
 *
 * Usage:
 *   node --import tsx scripts/run-outbox-relay.ts [flags]
 *
 * Flags:
 *   --once                 process a single batch then exit
 *   --dry-run              report what WOULD be dispatched; no delivery, no state change
 *   --batch-size=N         rows per batch (default 100)
 *   --max-retries=N        dead-letter after N failed attempts (default 5)
 *   --interval=MS          sleep between non-empty batches in continuous mode (default 1000)
 *   --max-batches=N        cap batches in continuous mode (default: drain fully)
 *
 * Requires DATABASE_URL (non-prod for testing). SINGLE-NODE: do not run two instances
 * against the same DB until claim-locking lands — see docs/g15-3-relay-and-projection.md.
 */
import { PrismaClient } from '@prisma/client'
import {
  PrismaOutboxStore,
  OutboxRelay,
  inProcessEventBus,
  createPrismaAuditFeedConsumer,
  type PrismaLike,
  type AuditFeedPrisma,
  type RelayLogger,
} from '../lib/events'
// Import the consumer DIRECTLY (not via the lib/intelligence barrel) — the barrel
// re-exports server-only-tainted modules that throw under tsx/Node (non-Server-Component).
import { createIntelligenceSnapshotConsumer } from '../lib/intelligence/projections/snapshotProjection'

const argv = process.argv.slice(2)
const has = (name: string) => argv.includes(name)
const val = (name: string, dflt: string) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : dflt
}

const logger: RelayLogger = (level, message, meta) =>
  console.log(`[relay:${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}`)

;(async () => {
  const prisma = new PrismaClient()
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const auditConsumer = createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma)
  const intelligenceConsumer = createIntelligenceSnapshotConsumer(prisma)

  const relay = new OutboxRelay(store, {
    consumers: [auditConsumer, intelligenceConsumer],
    bus: inProcessEventBus,
    batchSize: Number(val('--batch-size', '100')),
    maxRetries: Number(val('--max-retries', '5')),
    claimTimeoutMs: Number(val('--claim-timeout', '60000')),
    workerId: val('--worker-id', `relay-${process.pid}`),
    dryRun: has('--dry-run'),
    logger,
  })

  let dbHost = '(unparsable)'
  try {
    dbHost = new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    /* ignore */
  }

  console.log('[relay] starting', { dbHost, once: has('--once'), dryRun: has('--dry-run') })

  const summary =
    has('--once') || has('--dry-run')
      ? await relay.runOnce()
      : await relay.run({
          intervalMs: Number(val('--interval', '1000')),
          maxBatches: argv.some((a) => a.startsWith('--max-batches='))
            ? Number(val('--max-batches', '0'))
            : Number.POSITIVE_INFINITY,
        })

  console.log('[relay] done', summary)
  await prisma.$disconnect()
})().catch((err) => {
  console.error('[relay] fatal', err)
  process.exit(1)
})
