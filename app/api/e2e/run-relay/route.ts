/**
 * E2E-ONLY: drain the outbox once through the audit-feed + intelligence consumers, so a
 * browser spec can populate the read models after self-seeding a league.
 *
 * Hard-gated: `(NODE_ENV !== 'production' || ALLOW_E2E_SEED === '1') && x-allfantasy-e2e:1`
 * (same model as the seed/register routes). Real production never sets ALLOW_E2E_SEED.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PrismaOutboxStore, OutboxRelay, createPrismaAuditFeedConsumer, type PrismaLike, type AuditFeedPrisma } from '@/lib/events'
import { createIntelligenceSnapshotConsumer } from '@/lib/intelligence/projections/snapshotProjection'

export const dynamic = 'force-dynamic'

function e2eAllowed(request: Request): boolean {
  const envAllows = process.env.NODE_ENV !== 'production' || process.env.ALLOW_E2E_SEED === '1'
  return envAllows && request.headers.get('x-allfantasy-e2e') === '1'
}

export async function POST(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const relay = new OutboxRelay(store, {
    consumers: [createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma), createIntelligenceSnapshotConsumer(prisma)],
    workerId: 'e2e-relay',
  })
  const summary = await relay.run()
  return NextResponse.json({ ok: true, summary })
}
