/**
 * G15.4 — Intelligence read models DB integration.
 *
 * OPT-IN: RUN_EVENT_DB_IT=1 + DATABASE_URL → NON-prod DB with the migrations applied.
 * Proves the snapshot projection (incremental + idempotent), rebuild, and the
 * IntelligenceQueryService against a real database. Run serially (rebuild clears tables).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaOutboxStore, EventPublisher, EventNormalizer, InMemoryEventSchemaRegistry, type PrismaLike, type DomainEvent } from '@/lib/events'
import { applyIntelligenceEvent, rebuildIntelligenceSnapshots, IntelligenceQueryService } from '@/lib/intelligence'

const RUN = process.env.RUN_EVENT_DB_IT === '1'
const d = RUN ? describe : describe.skip

d('intelligence read models (real database)', () => {
  const prisma = new PrismaClient()
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
  const svc = new IntelligenceQueryService(prisma)
  const mark = `INTELIT-${Date.now()}`
  const leagueId = `${mark}-L`
  const events: DomainEvent[] = []

  async function pub(type: string, actorId: string | null, extra: Record<string, unknown> = {}) {
    const e = await publisher.publish({
      type,
      leagueId,
      sport: 'NFL',
      leagueConcept: 'redraft',
      actor: actorId ? { type: 'user', id: actorId } : { type: 'system' },
      metadata: { source: 'test' },
      payload: {},
      ...extra,
    } as never)
    events.push(e)
    return e
  }

  beforeAll(async () => {
    await prisma.$connect()
    await prisma.intelligenceManagerSnapshot.deleteMany({})
    await prisma.intelligenceLeagueSnapshot.deleteMany({})
    await prisma.intelligenceProcessedEvent.deleteMany({})
    await prisma.domainEvent.deleteMany({})
    await prisma.eventOutbox.deleteMany({})
  })
  afterAll(async () => {
    await prisma.intelligenceManagerSnapshot.deleteMany({ where: { leagueId } })
    await prisma.intelligenceLeagueSnapshot.deleteMany({ where: { leagueId } })
    await prisma.intelligenceProcessedEvent.deleteMany({})
    await prisma.eventOutbox.deleteMany({ where: { eventId: { in: events.map((e) => e.eventId) } } })
    await prisma.domainEvent.deleteMany({ where: { eventId: { in: events.map((e) => e.eventId) } } })
    await prisma.$disconnect()
  })

  it('builds league + manager snapshots incrementally and idempotently', async () => {
    await pub('transaction.trade.proposed', 'u1')
    await pub('transaction.trade.accepted', 'u1')
    await pub('transaction.waiver.processed', 'u2')
    await pub('roster.lineup.set', 'u1')
    for (const e of events) await applyIntelligenceEvent(prisma, e)

    const league = await prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    expect(league?.totalEvents).toBe(4)
    expect(league?.tradeCount).toBe(2)
    expect(league?.waiverCount).toBe(1)
    expect(league?.lineupCount).toBe(1)
    expect(league?.openTradeProposals).toBe(0) // +1 proposed, -1 accepted

    // Idempotent: re-applying the same events does not double-count.
    for (const e of events) {
      const applied = await applyIntelligenceEvent(prisma, e)
      expect(applied).toBe(false)
    }
    const league2 = await prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    expect(league2?.totalEvents).toBe(4)

    const u1 = await prisma.intelligenceManagerSnapshot.findUnique({ where: { leagueId_managerKey: { leagueId, managerKey: 'u1' } } })
    expect(u1?.totalActions).toBe(3)
    expect(u1?.tradeActions).toBe(2)
    expect(u1?.lineupActions).toBe(1)
  })

  it('serves the query service DTOs', async () => {
    const summary = await svc.getLeagueActivitySummary(leagueId)
    expect(summary.totalEvents).toBe(4)
    expect(summary.counts.trade).toBe(2)
    expect(summary.openTradeProposals).toBe(0)

    const health = await svc.getLeagueHealthSnapshot(leagueId)
    expect(health.totalManagers).toBe(2)
    expect(health.status).toBe('healthy') // fresh activity

    const mgr = await svc.getManagerActivitySnapshot(leagueId, 'u1')
    expect(mgr.totalActions).toBe(3)

    const items = await svc.getCommissionerActionItems(leagueId)
    expect(items.find((i) => i.kind === 'pending_trades')).toBeUndefined() // open=0
  })

  it('rebuilds snapshots from the event log', async () => {
    const res = await rebuildIntelligenceSnapshots(prisma, { batchSize: 100 })
    expect(res.rebuilt).toBeGreaterThanOrEqual(4)
    const league = await prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    expect(league?.totalEvents).toBe(4)
  })
})
