import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { analyzeLeagueGovernance } from './LeagueGovernanceAnalyzer'
import {
  appendAICommissionerActionLog,
  ensureAICommissionerConfig,
  runAICommissionerCycle,
  toConfigView,
} from './AICommissionerService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

type SpecialtyModeKey =
  | 'guillotine'
  | 'survivor'
  | 'best_ball'
  | 'devy'
  | 'c2c'
  | 'dynasty'

type UnifiedActionKey =
  | 'enable_ai_alerts'
  | 'enable_collusion_monitoring'
  | 'tighten_trade_review_window'
  | 'set_playoff_defaults'
  | 'promote_commissioner_notifications'
  | 'run_commissioner_cycle'

interface UnifiedActionProposal {
  key: UnifiedActionKey
  title: string
  summary: string
  requiresSubscription: boolean
  requiresConfirmation: true
  suggestedPayload?: Record<string, unknown>
}

interface UnifiedAssessment {
  leagueId: string
  sport: LeagueSport
  season: number
  entitlement: {
    afCommissionerSub: boolean
    lockedFeatures: string[]
  }
  setupAssistant: {
    score: number
    checks: Array<{ key: string; label: string; status: 'ok' | 'warn' | 'needs_action'; detail: string }>
  }
  healthMonitor: {
    score: number
    band: 'excellent' | 'good' | 'watch' | 'critical'
    factors: {
      pendingWaiverClaims: number
      inactiveManagers: number
      openAlerts: number
      unresolvedIntegrityFlags: number
      hasDraftSession: boolean
    }
  }
  integrityReview: {
    riskBand: 'low' | 'medium' | 'high'
    collusionSignalCount: number
    tradeDisputeCount: number
    unresolvedFlagCount: number
    summary: string
  }
  contentToolkit: {
    announcements: Array<{ type: 'lineup' | 'trade' | 'playoff'; title: string; body: string }>
  }
  conflictResolution: {
    openDisputeAlerts: number
    recommendation: string
    workflow: {
      stage: 'monitor' | 'collect_evidence' | 'manager_response' | 'decision' | 'closed'
      suggestedSlaHours: number
      checklist: string[]
      recentOpenDisputes: Array<{ alertId: string; headline: string; createdAt: string }>
    }
  }
  memoryProfile: {
    recentActionCount: number
    automationActionsLast30d: number
    disputeActionsLast30d: number
    dominantMode: 'balanced' | 'automation_first' | 'manual_first'
    confidence: 'low' | 'medium' | 'high'
    notes: string[]
  }
  automationCenter: {
    remindersEnabled: boolean
    collusionMonitoringEnabled: boolean
    inactivityMonitoringEnabled: boolean
    draftAiManagersConfigured: boolean
    recommendedNextRunHours: number
  }
  scheduleAndPlayoffs: {
    playoffStartWeek: number | null
    playoffTeams: number | null
    playoffWeeksPerRound: number | null
    periodsUntilPlayoffs: number | null
    recommendation: string
  }
  payoutAssistant: {
    suggestedModel: string
    suggestedSplit: number[]
    rationale: string
  }
  specialtyModes: Array<{ key: SpecialtyModeKey; enabled: boolean; note: string }>
  proposedActions: UnifiedActionProposal[]
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function healthBand(score: number): 'excellent' | 'good' | 'watch' | 'critical' {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'watch'
  return 'critical'
}

function payoutSplitForLeagueSize(leagueSize: number | null | undefined): number[] {
  if (!leagueSize || leagueSize <= 8) return [60, 40]
  if (leagueSize <= 12) return [50, 30, 20]
  return [45, 25, 15, 15]
}

function payoutModelLabel(split: number[]): string {
  return `${split.length}-place split (${split.join('/')})`
}

function asLeagueSport(value: unknown): LeagueSport {
  return String(value ?? 'NFL').toUpperCase() as LeagueSport
}

export async function getUnifiedCommissionerAssessment(input: {
  leagueId: string
}): Promise<UnifiedAssessment> {
  const [
    league,
    config,
    analysis,
    openAlertsCount,
    disputeAlertsCount,
    unresolvedIntegrityFlags,
    draftSession,
    recentActionLogs,
    recentOpenDisputes,
  ] =
    await Promise.all([
      prisma.league.findUnique({
        where: { id: input.leagueId },
        select: {
          id: true,
          userId: true,
          sport: true,
          season: true,
          leagueSize: true,
          tradeReviewHours: true,
          playoffStartWeek: true,
          playoffTeams: true,
          playoffWeeksPerRound: true,
          timezone: true,
          waiverType: true,
          leagueAiCommissionerAlerts: true,
          guillotineMode: true,
          survivorMode: true,
          bestBallMode: true,
          isDynasty: true,
          leagueType: true,
          integritySettings: {
            select: {
              collusionMonitoringEnabled: true,
              tankingMonitorEnabled: true,
            },
          },
        },
      }),
      ensureAICommissionerConfig({ leagueId: input.leagueId }),
      analyzeLeagueGovernance({ leagueId: input.leagueId }),
      prisma.aiCommissionerAlert.count({
        where: { leagueId: input.leagueId, status: { in: ['open', 'snoozed'] } },
      }),
      prisma.aiCommissionerAlert.count({
        where: {
          leagueId: input.leagueId,
          alertType: { in: ['DISPUTE_CONTEXT', 'TRADE_REVIEW_FLAG'] },
          status: { in: ['open', 'snoozed'] },
        },
      }),
      prisma.integrityFlag.count({
        where: { leagueId: input.leagueId, status: { in: ['open', 'investigating'] } },
      }),
      prisma.draftSession.findFirst({
        where: { leagueId: input.leagueId },
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { id: true, commissionerAiManagers: true, status: true },
      }),
      prisma.aiCommissionerActionLog.findMany({
        where: { leagueId: input.leagueId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          actionType: true,
          createdAt: true,
        },
      }),
      prisma.aiCommissionerAlert.findMany({
        where: {
          leagueId: input.leagueId,
          alertType: { in: ['DISPUTE_CONTEXT', 'TRADE_REVIEW_FLAG'] },
          status: { in: ['open', 'snoozed'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          alertId: true,
          headline: true,
          createdAt: true,
        },
      }),
    ])

  if (!league) throw new Error('League not found')

  const entitlementResolver = new EntitlementResolver()
  const commissionerEntitlement = await entitlementResolver.resolveForUser(
    league.userId,
    'commissioner_automation'
  )
  const afCommissionerSub = commissionerEntitlement.hasAccess
  const lockedFeatures = afCommissionerSub
    ? []
    : ['automated commissioner cycle', 'advanced conflict playbooks', 'ai notification fanout']

  const setupChecks: UnifiedAssessment['setupAssistant']['checks'] = [
    {
      key: 'timezone',
      label: 'League timezone configured',
      status: league.timezone ? 'ok' : 'warn',
      detail: league.timezone ? `Using ${league.timezone}.` : 'Timezone missing; deadlines may drift for managers.',
    },
    {
      key: 'trade_review_window',
      label: 'Trade review window defined',
      status: typeof league.tradeReviewHours === 'number' ? 'ok' : 'needs_action',
      detail:
        typeof league.tradeReviewHours === 'number'
          ? `Current review window: ${league.tradeReviewHours}h.`
          : 'Trade review window missing.',
    },
    {
      key: 'playoff_settings',
      label: 'Playoff settings configured',
      status: league.playoffStartWeek && league.playoffTeams ? 'ok' : 'needs_action',
      detail:
        league.playoffStartWeek && league.playoffTeams
          ? `Playoffs start week ${league.playoffStartWeek}, teams ${league.playoffTeams}.`
          : 'Playoff start week or team count is not fully configured.',
    },
    {
      key: 'commissioner_alerts',
      label: 'AI commissioner alerts enabled',
      status: league.leagueAiCommissionerAlerts ? 'ok' : 'warn',
      detail: league.leagueAiCommissionerAlerts
        ? 'League alerts are enabled.'
        : 'Enable alerts to surface integrity and dispute risks quickly.',
    },
    {
      key: 'integrity_monitoring',
      label: 'Integrity monitoring enabled',
      status: league.integritySettings?.collusionMonitoringEnabled ? 'ok' : 'needs_action',
      detail: league.integritySettings?.collusionMonitoringEnabled
        ? 'Collusion monitoring is active.'
        : 'Collusion monitoring is disabled.',
    },
  ]

  const setupScore = clampScore(
    (setupChecks.filter((row) => row.status === 'ok').length / Math.max(1, setupChecks.length)) * 100
  )

  const hasDraftSession = Boolean(draftSession)
  const draftBlob = draftSession?.commissionerAiManagers
  const draftAiManagersConfigured =
    !!draftBlob &&
    typeof draftBlob === 'object' &&
    Array.isArray((draftBlob as Record<string, unknown>).assignedAiTeams) &&
    ((draftBlob as Record<string, unknown>).assignedAiTeams as unknown[]).length > 0

  const healthScore = clampScore(
    100 -
      analysis.pendingWaiverClaims * 0.8 -
      analysis.inactiveManagers.length * 4 -
      openAlertsCount * 3 -
      unresolvedIntegrityFlags * 5 +
      (setupScore >= 80 ? 5 : 0)
  )

  const integritySignalCount = analysis.collusionSignals.length + analysis.tradeDisputes.length
  const integrityRiskBand: UnifiedAssessment['integrityReview']['riskBand'] =
    unresolvedIntegrityFlags >= 2 || integritySignalCount >= 5
      ? 'high'
      : unresolvedIntegrityFlags >= 1 || integritySignalCount >= 2
        ? 'medium'
        : 'low'

  const split = payoutSplitForLeagueSize(league.leagueSize)
  const periodsUntilPlayoffs = analysis.scheduleContext.periodsUntilPlayoffs
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const logs30d = recentActionLogs.filter((row) => row.createdAt.getTime() >= cutoff)
  const automationActionsLast30d = logs30d.filter(
    (row) => row.actionType === 'RUN_CYCLE' || row.actionType.startsWith('UNIFIED_RUN_COMMISSIONER_CYCLE')
  ).length
  const disputeActionsLast30d = logs30d.filter(
    (row) => row.actionType.includes('DISPUTE') || row.actionType.startsWith('ALERT_')
  ).length
  const dominantMode: UnifiedAssessment['memoryProfile']['dominantMode'] =
    automationActionsLast30d >= disputeActionsLast30d + 2
      ? 'automation_first'
      : disputeActionsLast30d >= automationActionsLast30d + 2
        ? 'manual_first'
        : 'balanced'
  const confidence: UnifiedAssessment['memoryProfile']['confidence'] =
    logs30d.length >= 12 ? 'high' : logs30d.length >= 5 ? 'medium' : 'low'

  const disputeWorkflowStage: UnifiedAssessment['conflictResolution']['workflow']['stage'] =
    disputeAlertsCount >= 3
      ? 'decision'
      : disputeAlertsCount >= 2
        ? 'manager_response'
        : disputeAlertsCount >= 1
          ? 'collect_evidence'
          : 'monitor'

  const proposedActions: UnifiedActionProposal[] = [
    {
      key: 'enable_ai_alerts',
      title: 'Enable league AI alerts',
      summary: 'Turn on AI commissioner alerting for this league.',
      requiresSubscription: false,
      requiresConfirmation: true,
    },
    {
      key: 'enable_collusion_monitoring',
      title: 'Enable collusion monitoring',
      summary: 'Activate integrity monitoring and baseline settings.',
      requiresSubscription: false,
      requiresConfirmation: true,
    },
    {
      key: 'tighten_trade_review_window',
      title: 'Tighten trade review window',
      summary: 'Set trade review window to 24h if currently larger.',
      requiresSubscription: false,
      requiresConfirmation: true,
      suggestedPayload: { tradeReviewHours: 24 },
    },
    {
      key: 'set_playoff_defaults',
      title: 'Apply playoff defaults',
      summary: 'Set a sane playoff schedule from league size and current settings.',
      requiresSubscription: false,
      requiresConfirmation: true,
      suggestedPayload: {
        playoffTeams: league.playoffTeams ?? (league.leagueSize && league.leagueSize >= 12 ? 6 : 4),
        playoffWeeksPerRound: league.playoffWeeksPerRound ?? 1,
      },
    },
    {
      key: 'promote_commissioner_notifications',
      title: 'Enable AI notification fanout',
      summary: 'Promote notification mode to both in-app and chat.',
      requiresSubscription: true,
      requiresConfirmation: true,
    },
    {
      key: 'run_commissioner_cycle',
      title: 'Run full commissioner cycle',
      summary: 'Run governance analysis and alert generation now.',
      requiresSubscription: true,
      requiresConfirmation: true,
    },
  ]

  return {
    leagueId: league.id,
    sport: asLeagueSport(league.sport),
    season: league.season ?? new Date().getUTCFullYear(),
    entitlement: {
      afCommissionerSub,
      lockedFeatures,
    },
    setupAssistant: {
      score: setupScore,
      checks: setupChecks,
    },
    healthMonitor: {
      score: healthScore,
      band: healthBand(healthScore),
      factors: {
        pendingWaiverClaims: analysis.pendingWaiverClaims,
        inactiveManagers: analysis.inactiveManagers.length,
        openAlerts: openAlertsCount,
        unresolvedIntegrityFlags,
        hasDraftSession,
      },
    },
    integrityReview: {
      riskBand: integrityRiskBand,
      collusionSignalCount: analysis.collusionSignals.length,
      tradeDisputeCount: analysis.tradeDisputes.length,
      unresolvedFlagCount: unresolvedIntegrityFlags,
      summary:
        integrityRiskBand === 'high'
          ? 'High risk signals detected. Require manual commissioner review before punitive actions.'
          : integrityRiskBand === 'medium'
            ? 'Moderate integrity risk. Queue targeted checks and context review.'
            : 'No major integrity risk signals currently detected.',
    },
    contentToolkit: {
      announcements: [
        {
          type: 'lineup',
          title: 'Lineup lock reminder',
          body: `Lineups lock in ~${analysis.scheduleContext.lockReminderHours} hours. Please set your starters and confirm inactive players are benched.`,
        },
        {
          type: 'trade',
          title: 'Trade review policy reminder',
          body: `Trades are subject to a ${league.tradeReviewHours ?? 48}-hour review window. Keep offers fair and include rationale when needed.`,
        },
        {
          type: 'playoff',
          title: 'Playoff horizon update',
          body:
            periodsUntilPlayoffs == null
              ? 'Playoff timeline will be posted once current period data syncs.'
              : `${periodsUntilPlayoffs} scoring period(s) until playoffs. Tiebreakers and seeding rules remain in effect as configured.`,
        },
      ],
    },
    conflictResolution: {
      openDisputeAlerts: disputeAlertsCount,
      recommendation:
        disputeAlertsCount > 0
          ? 'Use explain-first review: summarize facts, request manager responses, then resolve with logged rationale.'
          : 'No active dispute alerts. Keep a prebuilt escalation template ready for trade/waiver conflicts.',
      workflow: {
        stage: disputeWorkflowStage,
        suggestedSlaHours: disputeAlertsCount >= 3 ? 12 : disputeAlertsCount > 0 ? 24 : 48,
        checklist: [
          'Capture objective facts from trade, waiver, and lineup records.',
          'Request both managers provide intent/context before ruling.',
          'Log final decision and rationale in commissioner notes/action log.',
        ],
        recentOpenDisputes: recentOpenDisputes.map((row) => ({
          alertId: row.alertId,
          headline: row.headline,
          createdAt: row.createdAt.toISOString(),
        })),
      },
    },
    memoryProfile: {
      recentActionCount: logs30d.length,
      automationActionsLast30d,
      disputeActionsLast30d,
      dominantMode,
      confidence,
      notes: [
        dominantMode === 'automation_first'
          ? 'Recent history favors automation runs; validate league sentiment before strict enforcement changes.'
          : dominantMode === 'manual_first'
            ? 'Recent history favors manual dispute handling; schedule automation runs to reduce commissioner load.'
            : 'Recent history is balanced between automation and manual interventions.',
        confidence === 'low'
          ? 'Limited recent action history; treat recommendations as provisional until more cycles run.'
          : 'Historical action volume is sufficient for stable commissioner preference hints.',
      ],
    },
    automationCenter: {
      remindersEnabled: config.remindersEnabled,
      collusionMonitoringEnabled: config.collusionMonitoringEnabled,
      inactivityMonitoringEnabled: config.inactivityMonitoringEnabled,
      draftAiManagersConfigured,
      recommendedNextRunHours: periodsUntilPlayoffs != null && periodsUntilPlayoffs <= 2 ? 6 : 24,
    },
    scheduleAndPlayoffs: {
      playoffStartWeek: league.playoffStartWeek ?? null,
      playoffTeams: league.playoffTeams ?? null,
      playoffWeeksPerRound: league.playoffWeeksPerRound ?? null,
      periodsUntilPlayoffs,
      recommendation:
        periodsUntilPlayoffs != null && periodsUntilPlayoffs <= 1
          ? 'Freeze major rule changes and switch to reminder-heavy enforcement.'
          : 'Maintain weekly governance cycle and publish playoff policy reminders.',
    },
    payoutAssistant: {
      suggestedModel: payoutModelLabel(split),
      suggestedSplit: split,
      rationale: 'Top-heavy but still rewards finalists. Adjust for league culture and buy-in size.',
    },
    specialtyModes: [
      {
        key: 'guillotine',
        enabled: Boolean(league.guillotineMode),
        note: 'Weekly elimination audits should run before waiver release.',
      },
      {
        key: 'survivor',
        enabled: Boolean(league.survivorMode),
        note: 'Phase transitions and vote integrity should be reviewed each period.',
      },
      {
        key: 'best_ball',
        enabled: Boolean(league.bestBallMode),
        note: 'Prioritize scoring integrity and optimizer transparency.',
      },
      {
        key: 'devy',
        enabled: String(league.leagueType ?? '').toLowerCase() === 'devy',
        note: 'Track rights windows and rookie pipeline deadlines.',
      },
      {
        key: 'c2c',
        enabled: String(league.leagueType ?? '').toLowerCase() === 'c2c',
        note: 'Coordinate college/pro transitions and eligibility windows.',
      },
      {
        key: 'dynasty',
        enabled: Boolean(league.isDynasty),
        note: 'Maintain long-horizon governance and keeper/trade consistency.',
      },
    ],
    proposedActions,
  }
}

export async function applyUnifiedCommissionerAction(input: {
  leagueId: string
  userId: string
  actionKey: UnifiedActionKey
  confirmed: boolean
  payload?: Record<string, unknown>
}): Promise<{ ok: boolean; message: string; applied: boolean; meta?: Record<string, unknown> }> {
  if (!input.confirmed) {
    return {
      ok: false,
      applied: false,
      message: 'Action requires explicit confirmation.',
    }
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      sport: true,
      userId: true,
      tradeReviewHours: true,
      playoffTeams: true,
    },
  })
  if (!league) throw new Error('League not found')

  const entitlementResolver = new EntitlementResolver()
  const commissionerEntitlement = await entitlementResolver.resolveForUser(
    league.userId,
    'commissioner_automation'
  )

  const requiresSub = input.actionKey === 'promote_commissioner_notifications' || input.actionKey === 'run_commissioner_cycle'
  if (requiresSub && !commissionerEntitlement.hasAccess) {
    return {
      ok: false,
      applied: false,
      message: 'AF Commissioner subscription required for this action.',
    }
  }

  let message = 'No-op action.'
  let meta: Record<string, unknown> | undefined

  if (input.actionKey === 'enable_ai_alerts') {
    await prisma.league.update({
      where: { id: input.leagueId },
      data: { leagueAiCommissionerAlerts: true },
    })
    message = 'League AI commissioner alerts enabled.'
  } else if (input.actionKey === 'enable_collusion_monitoring') {
    await prisma.leagueIntegritySettings.upsert({
      where: { leagueId: input.leagueId },
      create: {
        leagueId: input.leagueId,
        collusionMonitoringEnabled: true,
        collusionSensitivity: 'medium',
        tankingMonitorEnabled: true,
      },
      update: {
        collusionMonitoringEnabled: true,
      },
    })
    message = 'Collusion monitoring enabled.'
  } else if (input.actionKey === 'tighten_trade_review_window') {
    const requested = Number(input.payload?.tradeReviewHours ?? 24)
    const tradeReviewHours = Number.isFinite(requested) ? Math.max(12, Math.min(72, requested)) : 24
    await prisma.league.update({
      where: { id: input.leagueId },
      data: { tradeReviewHours },
    })
    message = `Trade review window set to ${tradeReviewHours}h.`
  } else if (input.actionKey === 'set_playoff_defaults') {
    const teamsRaw = Number(input.payload?.playoffTeams ?? league.playoffTeams ?? 4)
    const weeksRaw = Number(input.payload?.playoffWeeksPerRound ?? 1)
    const teams = Number.isFinite(teamsRaw) ? Math.max(2, Math.min(16, teamsRaw)) : 4
    const weeks = Number.isFinite(weeksRaw) ? Math.max(1, Math.min(2, weeksRaw)) : 1
    await prisma.league.update({
      where: { id: input.leagueId },
      data: {
        playoffTeams: teams,
        playoffWeeksPerRound: weeks,
      },
    })
    message = `Playoff defaults applied (${teams} teams, ${weeks} week/round).`
  } else if (input.actionKey === 'promote_commissioner_notifications') {
    await ensureAICommissionerConfig({ leagueId: input.leagueId })
    await prisma.aiCommissionerConfig.update({
      where: { leagueId: input.leagueId },
      data: { commissionerNotificationMode: 'both' },
    })
    message = 'AI commissioner notifications promoted to both chat and in-app.'
  } else if (input.actionKey === 'run_commissioner_cycle') {
    const sport = typeof input.payload?.sport === 'string' ? String(input.payload.sport) : null
    const seasonRaw = Number(input.payload?.season)
    const season = Number.isFinite(seasonRaw) ? seasonRaw : null
    const result = await runAICommissionerCycle({
      leagueId: input.leagueId,
      sport,
      season,
      source: 'unified_commissioner_api',
    })
    message = `AI Commissioner cycle completed (${result.createdAlerts.length} new alerts).`
    meta = {
      createdAlerts: result.createdAlerts.length,
      touchedAlerts: result.touchedAlerts,
    }
  }

  await appendAICommissionerActionLog({
    leagueId: input.leagueId,
    sport: asLeagueSport(league.sport),
    actionType: `UNIFIED_${input.actionKey.toUpperCase()}`,
    source: 'unified_commissioner_api',
    summary: message,
  })

  await prisma.engagementEvent
    .create({
      data: {
        userId: input.userId,
        eventType: 'commissioner_unified_action',
        meta: {
          leagueId: input.leagueId,
          actionKey: input.actionKey,
          requiresSubscription: requiresSub,
        },
      },
    })
    .catch(() => null)

  await createPlatformNotification({
    userId: league.userId,
    productType: 'app',
    type: 'commissioner_action_applied',
    title: 'Commissioner action applied',
    body: message,
    severity: 'medium',
    meta: {
      leagueId: input.leagueId,
      actionKey: input.actionKey,
    },
  }).catch(() => null)

  return {
    ok: true,
    applied: true,
    message,
    meta,
  }
}
