/**
 * G15.11 — live relay + Commissioner Intelligence grounding proof (staging).
 *
 * Seeds a real commissioner league (canonical pipeline → emits events), runs the relay (audit +
 * intelligence consumers, run-once, small batch), and verifies the full loop end-to-end against a
 * NON-prod DB: outbox drains, no dead-letters, audit feed + league snapshot populate, the
 * Intelligence Query Service returns real data, and the commissioner grounding text is produced
 * (privacy-safe). Cleans up afterward.
 *
 *   DATABASE_URL=<staging> node --import tsx scripts/g15-11-live-proof.ts
 */
import { PrismaClient } from '@prisma/client'
import { seedNflRedraftLeague, cleanupSeededLeague } from '../tests/helpers/redraftSeasonHarness'
import { seedG8CommissionerLeague, cleanupG8League } from '../lib/e2e/seedG8League'
import { PrismaOutboxStore, OutboxRelay, createPrismaAuditFeedConsumer, type PrismaLike, type AuditFeedPrisma } from '../lib/events'
import { createIntelligenceSnapshotConsumer } from '../lib/intelligence/projections/snapshotProjection'
import { IntelligenceQueryService } from '../lib/intelligence/IntelligenceQueryService'
import { buildCommissionerGrounding, detectCommissionerIntelligenceIntent } from '../lib/intelligence/chimmy/commissionerGrounding'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

;(async () => {
  const prisma = new PrismaClient()
  const host = (() => { try { return new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:\/\//, 'http://')).host } catch { return '?' } })()
  console.log(`G15.11 live proof — DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) { console.error('REFUSING to run the seeding proof against the production host.'); process.exit(2) }

  // before
  console.log(JSON.stringify({
    before: {
      domainEvents: await prisma.domainEvent.count(),
      outbox: await prisma.eventOutbox.count(),
      auditFeed: await prisma.auditFeedEntry.count(),
      leagueSnapshots: await prisma.intelligenceLeagueSnapshot.count(),
    },
  }))

  let seeded: Awaited<ReturnType<typeof seedNflRedraftLeague>> | null = null
  let g8: Awaited<ReturnType<typeof seedG8CommissionerLeague>> | null = null
  try {
    seeded = await seedNflRedraftLeague(prisma, { season: 2025 })
    g8 = await seedG8CommissionerLeague(prisma, seeded.userId, { team: 'KC' })
    const leagueId = g8.leagueId
    const ownerId = seeded.userId
    check('seed: commissioner league created', Boolean(leagueId))

    const pendingBefore = await prisma.eventOutbox.count({ where: { status: { in: ['pending', 'retry'] } } })
    check('seed emitted events to the outbox', pendingBefore > 0, `pending=${pendingBefore}`)

    // run relay (conservative: one worker, small batch, retries+claim-timeout set)
    const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
    const relay = new OutboxRelay(store, {
      consumers: [createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma), createIntelligenceSnapshotConsumer(prisma)],
      workerId: 'g15-11-proof',
      batchSize: 25,
      maxRetries: 5,
      claimTimeoutMs: 60_000,
      logger: (lvl, msg, meta) => { if (lvl !== 'info' || msg.includes('complete')) console.log(`[relay:${lvl}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`) },
    })
    const summary = await relay.run()
    check('relay drained the outbox', summary.dispatched > 0 && summary.deadLettered === 0, `dispatched=${summary.dispatched} dead=${summary.deadLettered}`)

    const byStatus = await prisma.eventOutbox.groupBy({ by: ['status'], _count: { _all: true } })
    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]))
    check('no dead-letter rows', (statusMap.dead ?? 0) === 0, JSON.stringify(statusMap))
    check('no pending left', (statusMap.pending ?? 0) === 0 && (statusMap.retry ?? 0) === 0, JSON.stringify(statusMap))

    const auditCount = await prisma.auditFeedEntry.count({ where: { leagueId } })
    check('audit feed populated for the league', auditCount > 0, `rows=${auditCount}`)
    const snap = await prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    check('league snapshot populated', Boolean(snap) && (snap?.totalEvents ?? 0) > 0, `totalEvents=${snap?.totalEvents}`)

    // Intelligence Query Service returns real data
    const svc = new IntelligenceQueryService(prisma)
    const activity = await svc.getLeagueActivitySummary(leagueId, { userId: ownerId })
    check('query service: activity summary has real data', activity.totalEvents > 0, `totalEvents=${activity.totalEvents}`)

    // Commissioner grounding produced from real relay-populated data
    const grounding = await buildCommissionerGrounding({ service: svc, leagueId, principal: { userId: ownerId } })
    check('commissioner grounding status ok', grounding.status === 'ok', `status=${grounding.status}`)
    check('grounding text present', Boolean(grounding.text && grounding.text.length > 50))
    const blob = JSON.stringify(grounding)
    check('privacy: no owner/user id in grounding', !blob.includes(ownerId))
    check('privacy: no payload/secret tokens in grounding', !/payload|passwordHash|sk_live|whsec_/i.test(blob))
    check('grounding text carries cautious/non-accusatory directive', /non-accusatory/i.test(grounding.text))

    // Intent gating (drives the live resolver in the chat route)
    check('intent: commissioner questions match', ['Why is my league inactive?', 'What happened recently in my league?', 'Give me a commissioner summary.', 'What should I do to improve league health?'].every((q) => detectCommissionerIntelligenceIntent(q)))
    check('intent: ordinary questions do NOT match (no grounding attached)', ['Should I start Josh or Patrick?', "What's my matchup projection?"].every((q) => !detectCommissionerIntelligenceIntent(q)))

    console.log('--- GROUNDING TEXT SAMPLE ---')
    console.log(grounding.text.split('\n').slice(0, 14).join('\n'))
  } finally {
    // cleanup (non-destructive to anything but this proof's rows)
    if (g8) await cleanupG8League(prisma, { leagueId: g8.leagueId, season: g8.season, seededScoreIds: g8.seededScoreIds }).catch(() => undefined)
    if (seeded) await cleanupSeededLeague(prisma, seeded).catch(() => undefined)
    await prisma.intelligenceManagerSnapshot.deleteMany({}).catch(() => undefined)
    await prisma.intelligenceLeagueSnapshot.deleteMany({}).catch(() => undefined)
    await prisma.intelligenceProcessedEvent.deleteMany({}).catch(() => undefined)
    await prisma.auditFeedEntry.deleteMany({}).catch(() => undefined)
    await prisma.eventOutbox.deleteMany({}).catch(() => undefined)
    await prisma.domainEvent.deleteMany({}).catch(() => undefined)
    console.log(JSON.stringify({
      after_cleanup: {
        domainEvents: await prisma.domainEvent.count(),
        outbox: await prisma.eventOutbox.count(),
        auditFeed: await prisma.auditFeedEntry.count(),
        leagueSnapshots: await prisma.intelligenceLeagueSnapshot.count(),
      },
    }))
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? 'G15_11_LIVE_PROOF_OK' : `G15_11_LIVE_PROOF_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e instanceof Error ? e.stack : e); process.exit(1) })
