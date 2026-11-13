/**
 * ReputationEvidenceAggregator — collects evidence from DB and other sources, outputs per-dimension values for scoring.
 */

import { prisma } from '@/lib/prisma'
import type { AggregatedEvidence } from './ReputationScoreCalculator'
import type { ReputationEvidenceType } from './types'

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function seasonValue(value: number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return new Date().getUTCFullYear()
}

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function parseSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function managerInList(value: unknown, managerKeys: string[]): boolean {
  if (!Array.isArray(value)) return false
  const normalized = new Set(
    value
      .map((row) => normalizeKey(String(row ?? '')))
      .filter(Boolean)
  )
  return managerKeys.some((key) => normalized.has(key))
}

function daysSince(date: Date): number {
  return Math.max(0, Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)))
}

export async function refreshDerivedEvidenceForManager(input: {
  leagueId: string
  managerId: string
  sport: string
  season?: number | null
}): Promise<void> {
  const season = seasonValue(input.season)
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      sport: true,
      season: true,
      platformLeagueId: true,
      settings: true,
      teams: {
        select: {
          id: true,
          externalId: true,
          ownerName: true,
          lastUpdatedAt: true,
        },
      },
    },
  })
  if (!league) return

  const managerKey = normalizeKey(input.managerId)
  const team =
    league.teams.find((row) => normalizeKey(row.externalId) === managerKey) ??
    league.teams.find((row) => normalizeKey(row.id) === managerKey) ??
    league.teams.find((row) => normalizeKey(row.ownerName) === managerKey) ??
    null

  const managerKeys = [
    managerKey,
    normalizeKey(team?.externalId),
    normalizeKey(team?.id),
    normalizeKey(team?.ownerName),
  ].filter(Boolean)

  const [roster, recentTrades, commissionerAlerts] = await Promise.all([
    prisma.roster
      .findFirst({
        where: {
          leagueId: input.leagueId,
          OR: managerKeys.map((key) => ({ platformUserId: key })),
        },
        select: { id: true },
      })
      .catch(() => null),
    prisma.leagueTrade
      .findMany({
        where: {
          ...(season ? { season } : {}),
          OR: [
            ...(team?.ownerName ? [{ history: { sleeperUsername: team.ownerName } }] : []),
            ...(team?.ownerName ? [{ partnerName: team.ownerName }] : []),
            ...(team?.externalId && !Number.isNaN(Number(team.externalId))
              ? [{ partnerRosterId: Number(team.externalId) }]
              : []),
            { history: { sleeperUsername: input.managerId } },
          ],
          history: {
            ...(league.platformLeagueId
              ? { sleeperLeagueId: league.platformLeagueId }
              : {}),
          },
        },
        select: {
          valueGiven: true,
          valueReceived: true,
        },
        take: 100,
      })
      .catch(() => []),
    prisma.aiCommissionerAlert
      .findMany({
        where: {
          leagueId: input.leagueId,
          sport: input.sport as any,
        },
        orderBy: { createdAt: 'desc' },
        take: 150,
        select: {
          alertType: true,
          severity: true,
          status: true,
          relatedManagerIds: true,
        },
      })
      .catch(() => []),
  ])
  const waiverActivityCount = await prisma.waiverClaim
    .count({
      where: {
        leagueId: input.leagueId,
        ...(roster ? { rosterId: roster.id } : {}),
        ...(input.sport ? { sportType: input.sport } : {}),
      },
    })
    .catch(() => 0)

  const managerAlerts = commissionerAlerts.filter((alert) => {
    if (!Array.isArray(alert.relatedManagerIds)) return false
    const values = alert.relatedManagerIds.map((row) => normalizeKey(String(row ?? '')))
    return values.some((row) => managerKeys.includes(row))
  })

  const activityScore = (() => {
    const baseDays = team ? daysSince(team.lastUpdatedAt) : 21
    if (baseDays <= 2) return 95
    if (baseDays <= 5) return 85
    if (baseDays <= 10) return 72
    if (baseDays <= 20) return 58
    return 35
  })()
  const responsivenessScore = clamp0to100(activityScore * 0.9 + (waiverActivityCount > 0 ? 8 : 0))
  const abandonmentFlag = activityScore < 45 ? clamp0to100(100 - activityScore) : 0
  const lineupConsistency = clamp0to100(activityScore * 0.75 + (waiverActivityCount > 2 ? 10 : 0))

  const tradeAcceptRate = clamp0to100(Math.min(100, 35 + recentTrades.length * 7))
  const tradeFairOffers = (() => {
    if (recentTrades.length === 0) return 50
    const ratios = recentTrades
      .map((trade) => {
        if (trade.valueGiven == null || trade.valueReceived == null) return null
        const baseline = Math.max(Math.abs(trade.valueGiven), Math.abs(trade.valueReceived), 1)
        const delta = Math.abs(trade.valueGiven - trade.valueReceived)
        return clamp0to100(100 - (delta / baseline) * 100)
      })
      .filter((row): row is number => typeof row === 'number')
    if (ratios.length === 0) return 50
    return clamp0to100(ratios.reduce((sum, value) => sum + value, 0) / ratios.length)
  })()

  const toxicSignals = managerAlerts.filter(
    (alert) =>
      alert.alertType === 'COLLUSION_SIGNAL' &&
      (alert.severity === 'high' || alert.severity === 'critical') &&
      alert.status !== 'resolved' &&
      alert.status !== 'dismissed'
  ).length
  const disputeSignals = managerAlerts.filter(
    (alert) => alert.alertType === 'DISPUTE_CONTEXT' || alert.alertType === 'TRADE_REVIEW_FLAG'
  ).length
  const positiveSignals = managerAlerts.filter(
    (alert) =>
      alert.status === 'approved' ||
      (alert.status === 'resolved' &&
        (alert.alertType === 'VOTE_RECOMMENDATION' || alert.alertType === 'LINEUP_REMINDER'))
  ).length

  const toxicFlag = clamp0to100(toxicSignals * 28 + disputeSignals * 10)
  const fairPlay = clamp0to100(90 - toxicSignals * 18 - disputeSignals * 7 + positiveSignals * 8)
  const commissionerActionPositive = clamp0to100(55 + positiveSignals * 12 - toxicSignals * 6)
  const disputeInvolved = clamp0to100(disputeSignals * 22)

  const settings = parseSettingsRecord(league.settings)
  const paymentComplete = managerInList(settings.duesCompletedManagerIds, managerKeys)
    ? 100
    : managerInList(settings.duesDelinquentManagerIds, managerKeys)
      ? 10
      : 50

  await prisma.reputationEvidenceRecord.deleteMany({
    where: {
      leagueId: input.leagueId,
      managerId: input.managerId,
      sport: input.sport,
      season,
      sourceReference: { startsWith: 'derived:' },
    },
  })

  await prisma.reputationEvidenceRecord.createMany({
    data: [
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'payment_complete',
        value: paymentComplete,
        sourceReference: 'derived:league_settings',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'lineup_consistency',
        value: lineupConsistency,
        sourceReference: 'derived:activity_lineup',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'activity_frequency',
        value: activityScore,
        sourceReference: 'derived:team_activity',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'trade_accept_rate',
        value: tradeAcceptRate,
        sourceReference: 'derived:trade_volume',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'trade_fair_offers',
        value: tradeFairOffers,
        sourceReference: 'derived:trade_fairness',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'commissioner_action_positive',
        value: commissionerActionPositive,
        sourceReference: 'derived:commissioner_alerts',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'dispute_involved',
        value: disputeInvolved,
        sourceReference: 'derived:commissioner_alerts',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'toxic_flag',
        value: toxicFlag,
        sourceReference: 'derived:commissioner_alerts',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'abandonment_flag',
        value: abandonmentFlag,
        sourceReference: 'derived:activity_lineup',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'fair_play',
        value: fairPlay,
        sourceReference: 'derived:commissioner_alerts',
      },
      {
        managerId: input.managerId,
        leagueId: input.leagueId,
        sport: input.sport,
        season,
        evidenceType: 'responsiveness',
        value: responsivenessScore,
        sourceReference: 'derived:team_activity',
      },
    ],
  })
}

/**
 * Aggregate reputation evidence for a manager in a league into dimension buckets (0–100 scale inputs).
 * Uses ReputationEvidenceRecord; can be extended to pull from payments, matchups, trades, disputes.
 */
export async function aggregateReputationEvidence(
  leagueId: string,
  managerId: string,
  sport: string,
  options?: { season?: number | null }
): Promise<AggregatedEvidence> {
  const season = seasonValue(options?.season)
  const evidence = await prisma.reputationEvidenceRecord.findMany({
    where: {
      leagueId,
      managerId,
      sport,
      OR: [{ season }, { season: 0 }],
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const sums: Record<string, number> = {}
  const counts: Record<string, number> = {}
  for (const e of evidence) {
    const t = e.evidenceType
    sums[t] = (sums[t] ?? 0) + e.value
    counts[t] = (counts[t] ?? 0) + 1
  }

  const get = (type: ReputationEvidenceType, defaultVal: number) => {
    const v = sums[type]
    if (v == null) return defaultVal
    const c = counts[type] ?? 0
    return c > 0 ? Math.max(0, Math.min(100, v / c)) : defaultVal
  }

  return {
    reliability:
      get('payment_complete', 50) * 0.4 +
      get('lineup_consistency', 50) * 0.4 +
      (100 - get('abandonment_flag', 0)) * 0.2,
    activity: get('activity_frequency', 50),
    tradeFairness: (get('trade_accept_rate', 50) + get('trade_fair_offers', 50)) / 2,
    sportsmanship:
      get('fair_play', 50) * 0.55 +
      (100 - get('toxic_flag', 0)) * 0.25 +
      (100 - get('dispute_involved', 0)) * 0.2,
    commissionerTrust:
      get('commissioner_action_positive', 50) * 0.7 +
      (100 - get('dispute_involved', 0)) * 0.3,
    toxicityRisk: clamp0to100(get('toxic_flag', 0) * 0.7 + get('dispute_involved', 0) * 0.3),
    participationQuality:
      get('lineup_consistency', 50) * 0.45 +
      get('activity_frequency', 50) * 0.35 +
      get('responsiveness', 50) * 0.2,
    responsiveness: get('responsiveness', 50),
  }
}

/**
 * Seed default evidence when none exists (so new managers get Neutral tier).
 */
export async function seedDefaultEvidenceIfEmpty(
  leagueId: string,
  managerId: string,
  sport: string,
  options?: { season?: number | null }
): Promise<void> {
  const season = seasonValue(options?.season)
  const count = await prisma.reputationEvidenceRecord.count({
    where: { leagueId, managerId, sport, season },
  })
  if (count > 0) return
  await prisma.reputationEvidenceRecord.createMany({
    data: [
      {
        leagueId,
        managerId,
        sport,
        season,
        evidenceType: 'activity_frequency',
        value: 50,
        sourceReference: 'default',
      },
      {
        leagueId,
        managerId,
        sport,
        season,
        evidenceType: 'trade_fair_offers',
        value: 50,
        sourceReference: 'default',
      },
      {
        leagueId,
        managerId,
        sport,
        season,
        evidenceType: 'fair_play',
        value: 50,
        sourceReference: 'default',
      },
    ],
  })
}
