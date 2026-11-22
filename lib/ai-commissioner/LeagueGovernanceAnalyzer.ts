import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { detectCollusionSignals } from './CollusionSignalDetector'
import { getSportGovernanceCadence, toLeagueSport } from './SportCommissionerResolver'
import type { GovernanceAnalysis } from './types'
import { isBestBallLeagueRow } from '@/lib/core-app/leagueBestBall'

export interface LeagueGovernanceAnalyzerInput {
  leagueId: string
  sport?: string | null
  season?: number | null
}

function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toDaysSince(date: Date): number {
  return Math.max(0, Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)))
}

function resolveTradeDisputeSeverity(deltaRatio: number): 'medium' | 'high' | 'critical' {
  if (deltaRatio > 0.75) return 'critical'
  if (deltaRatio > 0.5) return 'high'
  return 'medium'
}

export async function analyzeLeagueGovernance(
  input: LeagueGovernanceAnalyzerInput
): Promise<GovernanceAnalysis> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      sport: true,
      season: true,
      platformLeagueId: true,
      settings: true,
      bestBallMode: true,
      leagueVariant: true,
      leagueType: true,
      teams: {
        select: {
          externalId: true,
          ownerName: true,
          lastUpdatedAt: true,
        },
      },
    },
  })
  if (!league) throw new Error('League not found')

  const sport = toLeagueSport(input.sport ?? league.sport ?? null)
  const season = input.season ?? league.season ?? new Date().getUTCFullYear()
  const settings = safeObject(league.settings)
  const cadence = getSportGovernanceCadence(sport)

  const [pendingWaiverClaims, latestMatchup, recentTrades] = await Promise.all([
    prisma.waiverClaim
      .count({
        where: {
          leagueId: input.leagueId,
          status: 'pending',
        },
      })
      .catch(() => 0),
    prisma.matchupFact
      .findFirst({
        where: {
          leagueId: input.leagueId,
          sport,
          ...(season ? { season } : {}),
        },
        orderBy: { weekOrPeriod: 'desc' },
        select: { weekOrPeriod: true },
      })
      .catch(() => null),
    prisma.leagueTrade
      .findMany({
        where: {
          history: {
            sleeperLeagueId: league.platformLeagueId,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: {
          id: true,
          valueGiven: true,
          valueReceived: true,
          partnerName: true,
          partnerRosterId: true,
          transactionId: true,
        },
      })
      .catch(() => []),
  ])

  const inactiveThresholdDays = Math.max(6, cadence.expectedPeriodCadenceDays * 2)
  const inactiveManagers = league.teams
    .map((team) => ({
      managerId: team.externalId,
      daysSinceActivity: toDaysSince(team.lastUpdatedAt),
      ownerName: team.ownerName,
    }))
    .filter((row) => row.daysSinceActivity >= inactiveThresholdDays)
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity)
    .slice(0, 10)
    .map((row) => ({
      managerId: row.managerId || row.ownerName,
      daysSinceActivity: row.daysSinceActivity,
    }))

  const tradeDisputes = recentTrades
    .map((trade) => {
      if (trade.valueGiven == null || trade.valueReceived == null) return null
      const baseline = Math.max(Math.abs(trade.valueGiven), Math.abs(trade.valueReceived), 1)
      const delta = Math.abs(trade.valueGiven - trade.valueReceived)
      const ratio = delta / baseline
      if (ratio < 0.42) return null
      return {
        tradeId: trade.id,
        severity: resolveTradeDisputeSeverity(ratio),
        summary: `Trade ${trade.transactionId} has a value delta near ${Math.round(
          ratio * 100
        )}% and should be reviewed for fairness.`,
        managerIds: [String(trade.partnerRosterId ?? trade.partnerName ?? '')].filter(Boolean),
      }
    })
    .filter(Boolean) as GovernanceAnalysis['tradeDisputes']

  const collusionSignals = detectCollusionSignals({
    trades: recentTrades.map((trade) => ({
      tradeId: trade.id,
      valueGiven: trade.valueGiven ?? null,
      valueReceived: trade.valueReceived ?? null,
      partnerKey: String(trade.partnerRosterId ?? trade.partnerName ?? '').trim() || null,
      createdAt: new Date(),
    })),
    rosterTurnoverFactor: cadence.rosterTurnoverFactor,
  })

  const ruleConflicts: GovernanceAnalysis['ruleConflicts'] = []
  if (
    String(settings.tradeReviewType ?? '').toLowerCase() === 'league_vote' &&
    (settings.vetoThreshold == null || Number.isNaN(Number(settings.vetoThreshold)))
  ) {
    ruleConflicts.push({
      key: 'missing-vote-threshold',
      severity: 'high',
      summary: 'Trade review mode is league vote, but veto threshold is missing.',
    })
  }
  if (!String(settings.lineupLockRule ?? '').trim()) {
    ruleConflicts.push({
      key: 'missing-lineup-lock-rule',
      severity: 'medium',
      summary: 'Lineup lock rule is not configured; reminder enforcement may be inconsistent.',
    })
  }
  if (
    settings.publicDashboard === true &&
    settings.rankedVisibility === false
  ) {
    ruleConflicts.push({
      key: 'dashboard-ranking-mismatch',
      severity: 'low',
      summary: 'Public dashboard is enabled while ranked visibility is disabled.',
    })
  }

  const currentPeriod = latestMatchup?.weekOrPeriod ?? null
  const periodsUntilPlayoffs =
    currentPeriod != null ? cadence.playoffStartPeriod - currentPeriod : null

  return {
    leagueId: input.leagueId,
    sport: sport as LeagueSport,
    season,
    bestBall: isBestBallLeagueRow(league),
    pendingWaiverClaims,
    inactiveManagers,
    tradeDisputes,
    collusionSignals,
    ruleConflicts,
    scheduleContext: {
      currentPeriod,
      playoffStartPeriod: cadence.playoffStartPeriod,
      periodsUntilPlayoffs,
      lockReminderHours: cadence.lineupLockReminderHours,
    },
  }
}
