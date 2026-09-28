import type {
  AiCommissionerActionLog,
  AiCommissionerAlert,
  AiCommissionerConfig,
  LeagueSport,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { postChimmyMoment } from '@/lib/league-chat/chimmyMoments'
import { commissionerAlertsText } from '@/lib/league-chat/chimmyCommissionerNotices'
import { openaiChatText } from '@/lib/openai-client'
import { buildAiCacheKey, readAiResultCache, writeAiResultCache } from '@/lib/ai-result-cache'
import { analyzeLeagueGovernance } from './LeagueGovernanceAnalyzer'
import { generateCommissionerAlerts } from './CommissionerAlertGenerator'
import { generateLeagueInsights } from './LeagueInsightGenerator'
import {
  normalizeSportForCommissioner,
  toLeagueSport,
} from './SportCommissionerResolver'
import type {
  AICommissionerActionLogView,
  AICommissionerAlertStatus,
  AICommissionerAlertView,
  AICommissionerConfigView,
  LeagueInsightReport,
  AICommissionerNotificationMode,
  GovernanceAnalysis,
} from './types'

type AlertAction = 'approve' | 'dismiss' | 'snooze' | 'resolve' | 'reopen'

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function asManagerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v ?? '').trim()).filter(Boolean)
}

function normalizeNotificationMode(value: string | null | undefined): AICommissionerNotificationMode {
  const next = String(value ?? '').trim().toLowerCase()
  if (next === 'off' || next === 'chat' || next === 'both' || next === 'in_app') return next
  return 'in_app'
}

export function toConfigView(config: AiCommissionerConfig): AICommissionerConfigView {
  return {
    configId: config.configId,
    leagueId: config.leagueId,
    sport: config.sport,
    remindersEnabled: config.remindersEnabled,
    disputeAnalysisEnabled: config.disputeAnalysisEnabled,
    collusionMonitoringEnabled: config.collusionMonitoringEnabled,
    voteSuggestionEnabled: config.voteSuggestionEnabled,
    inactivityMonitoringEnabled: config.inactivityMonitoringEnabled,
    commissionerNotificationMode: normalizeNotificationMode(config.commissionerNotificationMode),
    updatedAt: config.updatedAt.toISOString(),
  }
}

export function toAlertView(alert: AiCommissionerAlert): AICommissionerAlertView {
  return {
    alertId: alert.alertId,
    leagueId: alert.leagueId,
    sport: alert.sport,
    alertType: alert.alertType as AICommissionerAlertView['alertType'],
    severity: alert.severity as AICommissionerAlertView['severity'],
    headline: alert.headline,
    summary: alert.summary,
    relatedManagerIds: asManagerIds(alert.relatedManagerIds),
    relatedTradeId: alert.relatedTradeId ?? null,
    relatedMatchupId: alert.relatedMatchupId ?? null,
    status: alert.status as AICommissionerAlertView['status'],
    snoozedUntil: toIso(alert.snoozedUntil),
    createdAt: alert.createdAt.toISOString(),
    resolvedAt: toIso(alert.resolvedAt),
  }
}

export function toActionLogView(log: AiCommissionerActionLog): AICommissionerActionLogView {
  return {
    actionId: log.actionId,
    leagueId: log.leagueId,
    sport: log.sport,
    actionType: log.actionType,
    source: log.source,
    summary: log.summary,
    relatedAlertId: log.relatedAlertId ?? null,
    createdAt: log.createdAt.toISOString(),
  }
}

export async function ensureAICommissionerConfig(input: {
  leagueId: string
  sport?: string | null
}): Promise<AiCommissionerConfig> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, sport: true },
  })
  if (!league) throw new Error('League not found')
  const sport = toLeagueSport(input.sport ?? league.sport ?? null)

  const config = await prisma.aiCommissionerConfig.upsert({
    where: { leagueId: input.leagueId },
    create: {
      leagueId: input.leagueId,
      sport,
      remindersEnabled: true,
      disputeAnalysisEnabled: true,
      collusionMonitoringEnabled: true,
      voteSuggestionEnabled: true,
      inactivityMonitoringEnabled: true,
      commissionerNotificationMode: 'in_app',
    },
    update: {
      sport,
    },
  })
  return config
}

export async function updateAICommissionerConfig(
  leagueId: string,
  patch: Partial<{
    sport: string | null
    remindersEnabled: boolean
    disputeAnalysisEnabled: boolean
    collusionMonitoringEnabled: boolean
    voteSuggestionEnabled: boolean
    inactivityMonitoringEnabled: boolean
    commissionerNotificationMode: AICommissionerNotificationMode
  }>
): Promise<AiCommissionerConfig> {
  const current = await ensureAICommissionerConfig({ leagueId, sport: patch.sport ?? null })
  return prisma.aiCommissionerConfig.update({
    where: { configId: current.configId },
    data: {
      ...(patch.sport ? { sport: toLeagueSport(patch.sport) } : {}),
      ...(patch.remindersEnabled !== undefined ? { remindersEnabled: !!patch.remindersEnabled } : {}),
      ...(patch.disputeAnalysisEnabled !== undefined
        ? { disputeAnalysisEnabled: !!patch.disputeAnalysisEnabled }
        : {}),
      ...(patch.collusionMonitoringEnabled !== undefined
        ? { collusionMonitoringEnabled: !!patch.collusionMonitoringEnabled }
        : {}),
      ...(patch.voteSuggestionEnabled !== undefined
        ? { voteSuggestionEnabled: !!patch.voteSuggestionEnabled }
        : {}),
      ...(patch.inactivityMonitoringEnabled !== undefined
        ? { inactivityMonitoringEnabled: !!patch.inactivityMonitoringEnabled }
        : {}),
      ...(patch.commissionerNotificationMode
        ? { commissionerNotificationMode: normalizeNotificationMode(patch.commissionerNotificationMode) }
        : {}),
    },
  })
}

export async function appendAICommissionerActionLog(input: {
  leagueId: string
  sport: LeagueSport
  actionType: string
  source: string
  summary: string
  relatedAlertId?: string | null
}): Promise<void> {
  await prisma.aiCommissionerActionLog.create({
    data: {
      leagueId: input.leagueId,
      sport: input.sport,
      actionType: input.actionType,
      source: input.source,
      summary: input.summary,
      relatedAlertId: input.relatedAlertId ?? null,
    },
  })
}

async function fanOutCommissionerNotices(input: {
  leagueId: string
  sport: LeagueSport
  mode: AICommissionerNotificationMode
  commissionerUserId: string
  createdAlerts: AICommissionerAlertView[]
}) {
  if (input.createdAlerts.length === 0 || input.mode === 'off') return
  const top = input.createdAlerts.slice(0, 3)
  const title = `AI Commissioner: ${input.createdAlerts.length} new governance alert${
    input.createdAlerts.length === 1 ? '' : 's'
  }`
  const body = top.map((alert) => `[${alert.severity}] ${alert.headline}`).join(' | ')
  const href = `/league/${encodeURIComponent(input.leagueId)}?tab=Commissioner`

  if (input.mode === 'in_app' || input.mode === 'both') {
    await dispatchNotification({
      userIds: [input.commissionerUserId],
      category: 'commissioner_alerts',
      productType: 'app',
      type: 'ai_commissioner_alert',
      title,
      body,
      actionHref: href,
      actionLabel: 'Open commissioner',
      severity: 'high',
      meta: {
        leagueId: input.leagueId,
        sport: input.sport,
        alertCount: input.createdAlerts.length,
      },
    })
  }
  /*
   * 🛑 THE CHAT HALF USED TO GO NOWHERE. It posted "[AI Commissioner] …" into a platform thread named
   * by `League.settings.leagueChatThreadId`, which nothing sets, so "chat" and "both" were silently
   * the same as "in_app". It now goes to the league's OWN chat as Chimmy — Chimmy's name and badge,
   * no "AI" label — once per cycle, and it counts against Chimmy's daily cap because nobody pressed a
   * button for it (lib/league-chat/chimmyMoments.ts). Never throws.
   */
  if (input.mode === 'chat' || input.mode === 'both') {
    const ids = input.createdAlerts.map((a) => a.alertId).sort()
    await postChimmyMoment({
      leagueId: input.leagueId,
      kind: 'commissioner_alerts',
      dedupeKey: `cycle:${ids[0]}:${ids.length}`,
      text: commissionerAlertsText(input.createdAlerts),
      card: { commissionerAlerts: { count: input.createdAlerts.length } },
    })
  }
}

export async function runAICommissionerCycle(input: {
  leagueId: string
  sport?: string | null
  season?: number | null
  source?: string
}): Promise<{
  config: AICommissionerConfigView
  analysis: GovernanceAnalysis
  createdAlerts: AICommissionerAlertView[]
  touchedAlerts: number
}> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      userId: true,
      sport: true,
      season: true,
      settings: true,
    },
  })
  if (!league) throw new Error('League not found')

  const config = await ensureAICommissionerConfig({
    leagueId: input.leagueId,
    sport: input.sport ?? league.sport,
  })
  const sport = normalizeSportForCommissioner(input.sport ?? config.sport)
  const analysis = await analyzeLeagueGovernance({
    leagueId: input.leagueId,
    sport,
    season: input.season ?? league.season ?? null,
  })
  const signals = generateCommissionerAlerts({ analysis, config })
  const createdAlerts: AICommissionerAlertView[] = []
  let touchedAlerts = 0

  for (const signal of signals) {
    const existing = await prisma.aiCommissionerAlert.findFirst({
      where: {
        leagueId: input.leagueId,
        alertType: signal.alertType,
        headline: signal.headline,
        relatedTradeId: signal.relatedTradeId ?? null,
        relatedMatchupId: signal.relatedMatchupId ?? null,
        status: { in: ['open', 'snoozed'] },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      await prisma.aiCommissionerAlert.update({
        where: { alertId: existing.alertId },
        data: {
          sport: sport as LeagueSport,
          severity: signal.severity,
          summary: signal.summary,
          relatedManagerIds: signal.relatedManagerIds ?? [],
          status:
            existing.status === 'snoozed' &&
            existing.snoozedUntil &&
            existing.snoozedUntil.getTime() > Date.now()
              ? 'snoozed'
              : 'open',
        },
      })
      touchedAlerts += 1
      continue
    }

    const created = await prisma.aiCommissionerAlert.create({
      data: {
        leagueId: input.leagueId,
        sport: sport as LeagueSport,
        alertType: signal.alertType,
        severity: signal.severity,
        headline: signal.headline,
        summary: signal.summary,
        relatedManagerIds: signal.relatedManagerIds ?? [],
        relatedTradeId: signal.relatedTradeId ?? null,
        relatedMatchupId: signal.relatedMatchupId ?? null,
        status: 'open',
      },
    })
    createdAlerts.push(toAlertView(created))
    touchedAlerts += 1
  }

  const mode = normalizeNotificationMode(config.commissionerNotificationMode)
  await fanOutCommissionerNotices({
    leagueId: input.leagueId,
    sport: sport as LeagueSport,
    mode,
    commissionerUserId: league.userId,
    createdAlerts,
  })

  await appendAICommissionerActionLog({
    leagueId: input.leagueId,
    sport: sport as LeagueSport,
    actionType: 'RUN_CYCLE',
    source: input.source ?? 'system',
    summary: `AI Commissioner cycle completed. Signals: ${signals.length}, new alerts: ${createdAlerts.length}.`,
  })

  return {
    config: toConfigView(config),
    analysis,
    createdAlerts,
    touchedAlerts,
  }
}

export async function updateAICommissionerAlertStatus(input: {
  leagueId: string
  alertId: string
  action: AlertAction
  source?: string
  snoozeHours?: number
}): Promise<AICommissionerAlertView> {
  const alert = await prisma.aiCommissionerAlert.findFirst({
    where: { alertId: input.alertId, leagueId: input.leagueId },
  })
  if (!alert) throw new Error('Alert not found')

  let status: AICommissionerAlertStatus = alert.status as AICommissionerAlertStatus
  let resolvedAt = alert.resolvedAt
  let snoozedUntil = alert.snoozedUntil

  if (input.action === 'approve') {
    status = 'approved'
    resolvedAt = null
    snoozedUntil = null
  } else if (input.action === 'dismiss') {
    status = 'dismissed'
    resolvedAt = new Date()
    snoozedUntil = null
  } else if (input.action === 'resolve') {
    status = 'resolved'
    resolvedAt = new Date()
    snoozedUntil = null
  } else if (input.action === 'reopen') {
    status = 'open'
    resolvedAt = null
    snoozedUntil = null
  } else if (input.action === 'snooze') {
    const snoozeHours = Math.max(1, Math.min(168, input.snoozeHours ?? 24))
    status = 'snoozed'
    resolvedAt = null
    snoozedUntil = new Date(Date.now() + snoozeHours * 60 * 60 * 1000)
  }

  const updated = await prisma.aiCommissionerAlert.update({
    where: { alertId: alert.alertId },
    data: {
      status,
      resolvedAt,
      snoozedUntil,
    },
  })

  await appendAICommissionerActionLog({
    leagueId: updated.leagueId,
    sport: updated.sport,
    actionType: `ALERT_${input.action.toUpperCase()}`,
    source: input.source ?? 'commissioner_ui',
    summary: `${input.action} applied to ${updated.alertType} (${updated.alertId}).`,
    relatedAlertId: updated.alertId,
  })

  return toAlertView(updated)
}

export async function getAICommissionerInsights(input: {
  leagueId: string
  sport?: string | null
  season?: number | null
}): Promise<LeagueInsightReport> {
  return generateLeagueInsights({
    leagueId: input.leagueId,
    sport: input.sport ?? null,
    season: input.season ?? null,
  })
}

function buildDeterministicCommissionerAnswer(input: {
  question: string
  insights: LeagueInsightReport
}): string {
  const q = input.question.trim().toLowerCase()
  const { insights } = input

  if (q.includes('rule')) {
    return [
      `League rule guidance for ${insights.sport}:`,
      ...insights.suggestedRuleAdjustments.slice(0, 3).map((row) => `- ${row}`),
    ].join('\n')
  }
  if (q.includes('matchup') || q.includes('weekly recap') || q.includes('recap')) {
    return [
      insights.weeklyRecapPost.body,
      ...insights.matchupSummaries.slice(0, 3).map((row) => `- ${row.summary}`),
    ].join('\n')
  }
  if (q.includes('trade')) {
    if (insights.controversialTrades.length === 0) {
      return 'No controversial trades are currently flagged for this league context.'
    }
    return insights.controversialTrades
      .slice(0, 3)
      .map(
        (trade) =>
          `- ${trade.summary} (fairness ${trade.fairnessScore}/100, controversy ${trade.controversyLevel})`
      )
      .join('\n')
  }
  if (q.includes('waiver')) {
    if (insights.waiverHighlights.length === 0) {
      return 'No recent waiver transactions were found in this league context.'
    }
    return insights.waiverHighlights
      .slice(0, 4)
      .map((row) => `- ${row.summary}`)
      .join('\n')
  }
  if (q.includes('draft')) {
    if (insights.draftCommentary.length === 0) {
      return 'No draft commentary is available yet for this league context.'
    }
    return insights.draftCommentary
      .slice(0, 4)
      .map((row) => `- ${row.summary}`)
      .join('\n')
  }

  return [
    `AI Commissioner recap for ${insights.sport}:`,
    `- ${insights.weeklyRecapPost.body}`,
    `- ${insights.controversialTrades.length} controversial trade(s) currently tracked.`,
    `- ${insights.waiverHighlights.length} waiver highlight(s) in the latest cycle.`,
    `- ${insights.draftCommentary.length} draft commentary note(s) available.`,
  ].join('\n')
}

/** 30-minute TTL — commissioner questions are highly variable but not real-time. */
const COMMISSIONER_QUESTION_TTL_MS = 30 * 60 * 1000

export async function answerAICommissionerQuestion(input: {
  leagueId: string
  question: string
  sport?: string | null
  season?: number | null
}): Promise<{ answer: string; source: 'ai' | 'template'; insights: LeagueInsightReport }> {
  const insights = await getAICommissionerInsights({
    leagueId: input.leagueId,
    sport: input.sport ?? null,
    season: input.season ?? null,
  })
  const fallback = buildDeterministicCommissionerAnswer({
    question: input.question,
    insights,
  })

  // ── AiResult cache gate ───────────────────────────────────────────────────
  const cacheInputs = {
    leagueId: input.leagueId,
    question: input.question.trim().toLowerCase(),
    sport: insights.sport ?? null,
    season: insights.season ?? null,
  }
  const { resultKey, inputHash } = buildAiCacheKey('commissioner-question', cacheInputs)
  const cached = await readAiResultCache(resultKey)
  if (cached?.resultText) {
    console.log(`[ai-commissioner] AiResult cache hit { key: '${resultKey.slice(0, 48)}...' }`)
    return { answer: cached.resultText, source: 'ai', insights }
  }

  const aiResult = await openaiChatText({
    messages: [
      {
        role: 'system',
        content:
          'You are the AllFantasy AI League Commissioner assistant. Use only supplied league context. Keep answers concise and actionable. Cover rule explanations, matchup recap, trade fairness concerns, waiver outcomes, and draft commentary without inventing facts.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.question,
          leagueId: input.leagueId,
          sport: insights.sport,
          season: insights.season,
          recap: insights.weeklyRecapPost,
          matchups: insights.matchupSummaries,
          waivers: insights.waiverHighlights,
          draftCommentary: insights.draftCommentary,
          controversialTrades: insights.controversialTrades,
          suggestedRuleAdjustments: insights.suggestedRuleAdjustments,
        }),
      },
    ],
    temperature: 0.35,
    maxTokens: 420,
  }).catch(() => null)

  const answer = aiResult?.ok && aiResult.text?.trim() ? aiResult.text.trim() : fallback
  const source: 'ai' | 'template' = aiResult?.ok && aiResult.text?.trim() ? 'ai' : 'template'

  // Write to AiResult cache on AI success (fire-and-forget).
  if (source === 'ai') {
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'commissioner-question',
      scopeType: 'league',
      scopeId: input.leagueId,
      provider: 'openai',
      inputJson: cacheInputs,
      resultText: answer,
      ttlMs: COMMISSIONER_QUESTION_TTL_MS,
    }).catch(() => undefined)
  }

  return { answer, source, insights }
}
