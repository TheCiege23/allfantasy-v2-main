/**
 * G15.4 — Intelligence snapshot projection (relay consumer).
 *
 * Maintains two DISPOSABLE read models from DomainEvents:
 *   - intelligence_league_snapshot  (per-league activity/health rollup)
 *   - intelligence_manager_snapshot (per league+manager rollup)
 *
 * Sport/concept-agnostic. INCREMENTAL + IDEMPOTENT: each event is recorded once in
 * intelligence_processed_event (INSERT ... skipDuplicates); a re-delivered event is a
 * no-op. Counters use atomic column increments (no read-modify-write races between
 * relay workers). Rebuildable from domain_events.
 */
import type { PrismaClient } from '@prisma/client'
import type { DomainEvent, EventConsumer } from '@/lib/events'
import { rowToDomainEvent } from '@/lib/events'

export const INTELLIGENCE_SNAPSHOT_PROJECTION = 'intelligence_snapshots'

export type LeagueCategory =
  | 'trade'
  | 'waiver'
  | 'lineup'
  | 'draft'
  | 'scoring'
  | 'governance'
  | 'lifecycle'
  | 'other'

/** Pure: map an event type to a coarse activity category. */
export function categorize(type: string): LeagueCategory {
  if (type.startsWith('transaction.trade')) return 'trade'
  if (type.startsWith('transaction.waiver')) return 'waiver'
  if (type.startsWith('roster.lineup')) return 'lineup'
  if (type.startsWith('draft.')) return 'draft'
  if (type.startsWith('competition.')) return 'scoring' // matchup/score/standings/playoff/champion
  if (type.startsWith('governance.')) return 'governance'
  if (type.startsWith('lifecycle.')) return 'lifecycle'
  return 'other'
}

/** Pure: net change to the league's open-trade-proposal count. */
export function tradeProposalDelta(type: string): number {
  if (type === 'transaction.trade.proposed') return 1
  if (
    type === 'transaction.trade.accepted' ||
    type === 'transaction.trade.rejected' ||
    type === 'transaction.trade.canceled' ||
    type === 'transaction.trade.vetoed'
  ) {
    return -1
  }
  return 0
}

const LEAGUE_COUNT_COL: Record<LeagueCategory, string> = {
  trade: 'tradeCount',
  waiver: 'waiverCount',
  lineup: 'lineupCount',
  draft: 'draftCount',
  scoring: 'scoringCount',
  governance: 'governanceCount',
  lifecycle: 'lifecycleCount',
  other: 'otherCount',
}
const LEAGUE_LAST_AT_COL: Partial<Record<LeagueCategory, string>> = {
  trade: 'lastTradeAt',
  waiver: 'lastWaiverAt',
  lineup: 'lastLineupAt',
  draft: 'lastDraftAt',
  scoring: 'lastScoringAt',
}
const MANAGER_ACTION_COL: Record<LeagueCategory, string> = {
  trade: 'tradeActions',
  waiver: 'waiverActions',
  lineup: 'lineupActions',
  draft: 'otherActions',
  scoring: 'otherActions',
  governance: 'otherActions',
  lifecycle: 'otherActions',
  other: 'otherActions',
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

async function applyLeagueSnapshot(tx: Tx, event: DomainEvent): Promise<void> {
  if (!event.leagueId) return
  const cat = categorize(event.type)
  const occurredAt = new Date(event.occurredAt)
  const countCol = LEAGUE_COUNT_COL[cat]
  const lastCol = LEAGUE_LAST_AT_COL[cat]
  const tradeDelta = tradeProposalDelta(event.type)

  const create: Record<string, unknown> = {
    leagueId: event.leagueId,
    tenantId: event.tenantId,
    sport: event.sport,
    leagueConcept: event.leagueConcept,
    firstEventAt: occurredAt,
    lastActivityAt: occurredAt,
    totalEvents: 1,
    [countCol]: 1,
    openTradeProposals: Math.max(0, tradeDelta),
    ...(lastCol ? { [lastCol]: occurredAt } : {}),
  }
  const update: Record<string, unknown> = {
    lastActivityAt: occurredAt,
    totalEvents: { increment: 1 },
    [countCol]: { increment: 1 },
    openTradeProposals: { increment: tradeDelta },
    ...(event.sport ? { sport: event.sport } : {}),
    ...(event.leagueConcept ? { leagueConcept: event.leagueConcept } : {}),
    ...(lastCol ? { [lastCol]: occurredAt } : {}),
  }
  await tx.intelligenceLeagueSnapshot.upsert({ where: { leagueId: event.leagueId }, create: create as never, update: update as never })
}

async function applyManagerSnapshot(tx: Tx, event: DomainEvent): Promise<void> {
  const isManager = (event.actor.type === 'user' || event.actor.type === 'commissioner') && event.actor.id
  if (!isManager || !event.leagueId) return
  const managerKey = event.actor.id as string
  const occurredAt = new Date(event.occurredAt)
  const actionCol = MANAGER_ACTION_COL[categorize(event.type)]
  const create: Record<string, unknown> = {
    leagueId: event.leagueId,
    managerKey,
    lastActiveAt: occurredAt,
    totalActions: 1,
    [actionCol]: 1,
  }
  const update: Record<string, unknown> = {
    lastActiveAt: occurredAt,
    totalActions: { increment: 1 },
    [actionCol]: { increment: 1 },
  }
  await tx.intelligenceManagerSnapshot.upsert({
    where: { leagueId_managerKey: { leagueId: event.leagueId, managerKey } },
    create: create as never,
    update: update as never,
  })
}

/** Idempotent apply of one event to the snapshots (records the event in the ledger first). */
export async function applyIntelligenceEvent(prisma: PrismaClient, event: DomainEvent): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const ins = await tx.intelligenceProcessedEvent.createMany({
      data: [{ projection: INTELLIGENCE_SNAPSHOT_PROJECTION, eventId: event.eventId }],
      skipDuplicates: true,
    })
    if (ins.count === 0) return false // already processed — idempotent no-op
    await applyLeagueSnapshot(tx, event)
    await applyManagerSnapshot(tx, event)
    return true
  })
}

/** The relay consumer. */
export function createIntelligenceSnapshotConsumer(prisma: PrismaClient): EventConsumer {
  return {
    name: INTELLIGENCE_SNAPSHOT_PROJECTION,
    handle: async (event: DomainEvent) => {
      await applyIntelligenceEvent(prisma, event)
    },
  }
}

/** Rebuild the snapshots from scratch by replaying every domain event (oldest first). */
export async function rebuildIntelligenceSnapshots(prisma: PrismaClient, opts: { batchSize?: number } = {}): Promise<{ rebuilt: number }> {
  const batchSize = opts.batchSize ?? 500
  await prisma.intelligenceManagerSnapshot.deleteMany({})
  await prisma.intelligenceLeagueSnapshot.deleteMany({})
  await prisma.intelligenceProcessedEvent.deleteMany({ where: { projection: INTELLIGENCE_SNAPSHOT_PROJECTION } })

  let cursor: string | undefined
  let total = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.domainEvent.findMany({
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break
    for (const row of rows) {
      // rows include the `id` PK plus the DomainEvent columns.
      await applyIntelligenceEvent(prisma, rowToDomainEvent(row as never))
      total += 1
    }
    cursor = (rows[rows.length - 1] as { id: string }).id
    if (rows.length < batchSize) break
  }
  return { rebuilt: total }
}
