import 'server-only'

import { prisma } from '@/lib/prisma'

const TRADE_EVENT_TYPES = [
  'transaction.trade.proposed', 'transaction.trade.countered', 'transaction.trade.accepted',
  'transaction.trade.declined', 'transaction.trade.rejected', 'transaction.trade.canceled',
  'transaction.trade.vetoed', 'transaction.trade.processed', 'transaction.trade.expired',
]

export type TradeOsHealthStatus = 'healthy' | 'degraded' | 'critical'

export async function getTradeOsHealth() {
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000)
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60_000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000)

  const [leagues, syncStates, events, activeNative, deadOutbox] = await Promise.all([
    prisma.league.findMany({
      where: { platform: { in: ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] } },
      select: { platform: true, lastSyncedAt: true, syncStatus: true, syncError: true },
    }),
    prisma.leagueSyncState.findMany({
      select: { provider: true, lastAttemptedSyncAt: true, lastSuccessfulSyncAt: true, syncStatus: true, consecutiveFailures: true, incompleteScopes: true },
    }),
    prisma.domainEvent.findMany({
      where: { type: { in: TRADE_EVENT_TYPES }, occurredAt: { gte: sevenDaysAgo } },
      select: { type: true, source: true, metadata: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
      take: 5000,
    }),
    prisma.afLeagueTrade.count({ where: { status: { in: ['pending', 'awaiting_commissioner', 'accepted', 'scheduled'] } } }),
    prisma.eventOutbox.count({ where: { status: 'dead' } }),
  ])

  const providerNames = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']
  const providers = providerNames.map((provider) => {
    const providerLeagues = leagues.filter((league) => league.platform.toLowerCase() === provider)
    const states = syncStates.filter((state) => state.provider.toLowerCase() === provider)
    const freshest = states
      .map((state) => state.lastSuccessfulSyncAt)
      .filter((date): date is Date => date instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    const failures = states.filter((state) => state.consecutiveFailures > 0 || state.syncStatus?.toLowerCase() === 'failed').length
    const staleLeagues = providerLeagues.filter((league) => !league.lastSyncedAt || league.lastSyncedAt < sixHoursAgo).length
    const staleConnections = states.filter((state) => !state.lastSuccessfulSyncAt || state.lastSuccessfulSyncAt < sixHoursAgo).length
    return {
      provider,
      leagues: providerLeagues.length,
      connections: states.length,
      freshLeaguesWithinOneHour: providerLeagues.filter((league) => league.lastSyncedAt && league.lastSyncedAt >= oneHourAgo).length,
      staleLeaguesOverSixHours: staleLeagues,
      freshConnectionsWithinOneHour: states.filter((state) => state.lastSuccessfulSyncAt && state.lastSuccessfulSyncAt >= oneHourAgo).length,
      staleConnectionsOverSixHours: staleConnections,
      staleOverSixHours: staleLeagues + staleConnections,
      failingConnections: failures,
      latestSuccessfulSyncAt: freshest?.toISOString() ?? null,
    }
  })

  let complete = 0
  let partial = 0
  let blocked = 0
  for (const event of events) {
    const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata as Record<string, unknown> : {}
    const decision = metadata.decision && typeof metadata.decision === 'object' ? metadata.decision as Record<string, unknown> : {}
    const coverage = String(decision.coverageStatus ?? '')
    if (coverage === 'complete') complete++
    if (coverage === 'partial') partial++
    if (coverage === 'blocked') blocked++
  }

  const failing = providers.reduce((sum, provider) => sum + provider.failingConnections, 0)
  const stale = providers.reduce((sum, provider) => sum + provider.staleOverSixHours, 0)
  const status: TradeOsHealthStatus = deadOutbox > 0 || failing > 5
    ? 'critical'
    : failing > 0 || stale > 0 || blocked > 0
      ? 'degraded'
      : 'healthy'

  return {
    ok: status !== 'critical',
    status,
    generatedAt: now.toISOString(),
    thresholds: { freshMinutes: 60, staleHours: 6, eventWindowDays: 7 },
    providers,
    trades: {
      activeNative,
      lifecycleEventsLastSevenDays: events.length,
      providerProposalsLastSevenDays: events.filter((event) => event.type === 'transaction.trade.proposed' && event.source.startsWith('ingestion:')).length,
      coverage: { complete, partial, blocked, unknown: Math.max(0, events.length - complete - partial - blocked) },
    },
    delivery: { deadOutbox },
    alerts: [
      ...(deadOutbox > 0 ? [`${deadOutbox} trade event(s) are dead in the outbox.`] : []),
      ...(failing > 0 ? [`${failing} provider connection(s) are failing.`] : []),
      ...(stale > 0 ? [`${stale} provider connection(s) have no successful sync in six hours.`] : []),
      ...(blocked > 0 ? [`${blocked} recent trade evaluation(s) were blocked by missing asset coverage.`] : []),
    ],
  }
}
