'use client'

import { paidToolFetchWithConfirm } from '@/lib/tokens/paidToolClient'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bot, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { useUserTimezone } from '@/hooks/useUserTimezone'
import { previewTokenSpend, type TokenSpendClientPreview } from '@/lib/tokens/client-confirm'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import { TokenSpendPreflightModal } from '@/components/monetization/TokenSpendPreflightModal'

type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
type AlertStatus = 'open' | 'approved' | 'dismissed' | 'resolved' | 'snoozed'
type NotificationMode = 'off' | 'in_app' | 'chat' | 'both'

interface ConfigView {
  configId: string
  leagueId: string
  sport: SupportedSport
  remindersEnabled: boolean
  disputeAnalysisEnabled: boolean
  collusionMonitoringEnabled: boolean
  voteSuggestionEnabled: boolean
  inactivityMonitoringEnabled: boolean
  commissionerNotificationMode: NotificationMode
  updatedAt: string
}

interface AlertView {
  alertId: string
  leagueId: string
  sport: SupportedSport
  alertType: string
  severity: AlertSeverity
  headline: string
  summary: string
  relatedManagerIds: string[]
  relatedTradeId: string | null
  relatedMatchupId: string | null
  status: AlertStatus
  snoozedUntil: string | null
  createdAt: string
  resolvedAt: string | null
}

interface ActionLogView {
  actionId: string
  actionType: string
  source: string
  summary: string
  createdAt: string
}

interface TradeFairnessView {
  tradeId: string
  transactionId: string | null
  createdAt: string
  sport: SupportedSport
  fairnessScore: number
  imbalancePct: number
  controversyLevel: 'low' | 'medium' | 'high'
  summary: string
  relatedManagerIds: string[]
}

interface RecapView {
  title: string
  body: string
  bullets: string[]
  actionHref: string
  actionLabel: string
}

interface MatchupInsightView {
  matchupId: string
  weekOrPeriod: number
  summary: string
}

interface WaiverInsightView {
  claimId: string | null
  summary: string
  processedAt: string | null
}

interface DraftInsightView {
  pickId: string
  summary: string
  createdAt: string
}

interface InsightPayload {
  leagueId: string
  sport: SupportedSport
  season: number
  generatedAt: string
  weeklyRecapPost: RecapView
  matchupSummaries: MatchupInsightView[]
  waiverHighlights: WaiverInsightView[]
  draftCommentary: DraftInsightView[]
  controversialTrades: TradeFairnessView[]
  suggestedRuleAdjustments: string[]
}

interface OverviewPayload {
  leagueId: string
  sport: SupportedSport
  season: number
  config: ConfigView
  alerts: AlertView[]
  actionLogs: ActionLogView[]
}

type UnifiedActionKey =
  | 'enable_ai_alerts'
  | 'enable_collusion_monitoring'
  | 'tighten_trade_review_window'
  | 'set_playoff_defaults'
  | 'promote_commissioner_notifications'
  | 'run_commissioner_cycle'

interface UnifiedActionProposalView {
  key: UnifiedActionKey
  title: string
  summary: string
  requiresSubscription: boolean
  requiresConfirmation: boolean
  suggestedPayload?: Record<string, unknown>
}

interface UnifiedAssessmentPayload {
  leagueId: string
  sport: SupportedSport
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
  }
  integrityReview: {
    riskBand: 'low' | 'medium' | 'high'
    summary: string
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
  scheduleAndPlayoffs: {
    recommendation: string
  }
  proposedActions: UnifiedActionProposalView[]
}

type PendingCommissionerAction = 'run_cycle' | 'ask_question'

function sportLabel(sport: SupportedSport): string {
  if (sport === 'NCAAB') return 'NCAA Basketball'
  if (sport === 'NCAAF') return 'NCAA Football'
  if (sport === 'SOCCER') return 'Soccer'
  return sport
}

function severityClass(severity: AlertSeverity): string {
  if (severity === 'critical') return 'border-red-500/50 bg-red-500/10 text-red-100'
  if (severity === 'high') return 'border-orange-500/50 bg-orange-500/10 text-orange-100'
  if (severity === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-100'
  return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
}

export default function AICommissionerPanel({ leagueId }: { leagueId: string }) {
  const { formatInTimezone } = useUserTimezone()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sport, setSport] = useState<SupportedSport>(normalizeToSupportedSport(DEFAULT_SPORT))
  const [season, setSeason] = useState<string>('')
  const [includeResolved, setIncludeResolved] = useState(false)
  const [payload, setPayload] = useState<OverviewPayload | null>(null)
  const [draft, setDraft] = useState<ConfigView | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [running, setRunning] = useState(false)
  const [actioning, setActioning] = useState<Record<string, string>>({})
  const [explaining, setExplaining] = useState<Record<string, boolean>>({})
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [insights, setInsights] = useState<InsightPayload | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [commissionerQuestion, setCommissionerQuestion] = useState('Explain league rules for this week.')
  const [commissionerAnswer, setCommissionerAnswer] = useState<string>('')
  const [chatting, setChatting] = useState(false)
  const [runCycleTokenCost, setRunCycleTokenCost] = useState<number | null>(null)
  const [chatTokenCost, setChatTokenCost] = useState<number | null>(null)
  const [tokenModalPreview, setTokenModalPreview] = useState<TokenSpendClientPreview | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingCommissionerAction | null>(null)
  const [unifiedLoading, setUnifiedLoading] = useState(false)
  const [unifiedError, setUnifiedError] = useState<string | null>(null)
  const [unifiedAssessment, setUnifiedAssessment] = useState<UnifiedAssessmentPayload | null>(null)
  const [unifiedActioning, setUnifiedActioning] = useState<UnifiedActionKey | null>(null)

  const canRun = !loading && !running && !savingConfig
  const hasOpenAlerts = (payload?.alerts ?? []).some((alert) => alert.status === 'open')

  const load = useCallback(
    async (options?: { includeResolved?: boolean }) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams()
        qs.set('sport', sport)
        qs.set('includeResolved', String(options?.includeResolved ?? includeResolved))
        qs.set('includeDismissed', 'false')
        qs.set('includeSnoozed', 'true')
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner?${qs.toString()}`,
          { cache: 'no-store' }
        )
        const data = (await res.json().catch(() => ({}))) as OverviewPayload & { error?: string }
        if (!res.ok) throw new Error(data.error || 'Failed to load AI Commissioner data')
        setPayload(data)
        setDraft(data.config)
        setSeason(String(data.season || ''))
        setSport(normalizeToSupportedSport(data.config?.sport ?? sport))
      } catch (e: any) {
        setError(e?.message || 'Failed to load AI Commissioner data')
      } finally {
        setLoading(false)
      }
    },
    [includeResolved, leagueId, sport]
  )

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    setInsightsError(null)
    try {
      const qs = new URLSearchParams()
      qs.set('sport', sport)
      if (season.trim()) qs.set('season', season.trim())
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/insights?${qs.toString()}`,
        { cache: 'no-store' }
      )
      const data = (await res.json().catch(() => ({}))) as InsightPayload & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to load AI Commissioner insights')
      setInsights(data)
    } catch (e: any) {
      setInsightsError(e?.message || 'Failed to load AI Commissioner insights')
    } finally {
      setInsightsLoading(false)
    }
  }, [leagueId, season, sport])

  const loadUnified = useCallback(async () => {
    setUnifiedLoading(true)
    setUnifiedError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/unified`,
        { cache: 'no-store' }
      )
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        assessment?: UnifiedAssessmentPayload
      }
      if (!res.ok || !data.assessment) {
        throw new Error(data.error || 'Failed to load unified commissioner assessment')
      }
      setUnifiedAssessment(data.assessment)
    } catch (e: any) {
      setUnifiedError(e?.message || 'Failed to load unified commissioner assessment')
    } finally {
      setUnifiedLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadInsights()
  }, [loadInsights])

  useEffect(() => {
    void loadUnified()
  }, [loadUnified])

  useEffect(() => {
    let cancelled = false
    const loadTokenCosts = async () => {
      try {
        const [runPreview, chatPreview] = await Promise.all([
          previewTokenSpend('commissioner_ai_cycle_run'),
          previewTokenSpend('commissioner_ai_chat_question'),
        ])
        if (cancelled) return
        setRunCycleTokenCost(runPreview.tokenCost)
        setChatTokenCost(chatPreview.tokenCost)
      } catch {
        if (cancelled) return
        setRunCycleTokenCost(null)
        setChatTokenCost(null)
      }
    }
    void loadTokenCosts()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await load()
    await loadInsights()
    await loadUnified()
  }, [load, loadInsights, loadUnified])

  const saveConfig = useCallback(async () => {
    if (!draft) return
    setSavingConfig(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          remindersEnabled: draft.remindersEnabled,
          disputeAnalysisEnabled: draft.disputeAnalysisEnabled,
          collusionMonitoringEnabled: draft.collusionMonitoringEnabled,
          voteSuggestionEnabled: draft.voteSuggestionEnabled,
          inactivityMonitoringEnabled: draft.inactivityMonitoringEnabled,
          commissionerNotificationMode: draft.commissionerNotificationMode,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as ConfigView & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to save AI Commissioner settings')
      setDraft(data)
      setPayload((prev) => (prev ? { ...prev, config: data } : prev))
      toast.success('AI Commissioner settings saved')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save AI Commissioner settings')
    } finally {
      setSavingConfig(false)
    }
  }, [draft, leagueId, sport])

  const executeRunCycle = useCallback(async () => {
    setRunning(true)
    try {
      const res = await paidToolFetchWithConfirm(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          season: season.trim() ? Number.parseInt(season.trim(), 10) : undefined,
          confirmTokenSpend: true,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; createdAlerts?: Array<unknown> }
      if (!res.ok) throw new Error(data.error || 'AI Commissioner run failed')
      toast.success(`AI Commissioner run complete (${data.createdAlerts?.length ?? 0} new alerts)`)
      await refreshAll()
    } catch (e: any) {
      toast.error(e?.message || 'AI Commissioner run failed')
    } finally {
      setRunning(false)
    }
  }, [leagueId, refreshAll, season, sport])

  const mutateAlert = useCallback(
    async (alertId: string, action: 'approve' | 'dismiss' | 'snooze' | 'resolve' | 'reopen' | 'send_notice') => {
      setActioning((prev) => ({ ...prev, [alertId]: action }))
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/alerts/${encodeURIComponent(alertId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              ...(action === 'snooze' ? { snoozeHours: 24 } : {}),
            }),
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Failed to ${action} alert`)
        toast.success(
          action === 'send_notice'
            ? 'Notice sent to league chat'
            : `Alert ${action.replace('_', ' ')} action applied`
        )
        await load()
      } catch (e: any) {
        toast.error(e?.message || `Failed to ${action} alert`)
      } finally {
        setActioning((prev) => {
          const next = { ...prev }
          delete next[alertId]
          return next
        })
      }
    },
    [leagueId, load]
  )

  const explainAlert = useCallback(
    async (alertId: string) => {
      setExplaining((prev) => ({ ...prev, [alertId]: true }))
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/explain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertId }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; narrative?: string }
        if (!res.ok) throw new Error(data.error || 'Failed to explain alert')
        const narrative = String(data.narrative ?? '').trim()
        if (narrative) {
          setExplanations((prev) => ({ ...prev, [alertId]: narrative }))
        }
      } catch (e: any) {
        toast.error(e?.message || 'Failed to explain alert')
      } finally {
        setExplaining((prev) => ({ ...prev, [alertId]: false }))
      }
    },
    [leagueId]
  )

  const explainTradeFairness = useCallback(
    async (tradeId: string) => {
      const key = `trade:${tradeId}`
      setExplaining((prev) => ({ ...prev, [key]: true }))
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/explain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeId }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; narrative?: string }
        if (!res.ok) throw new Error(data.error || 'Failed to explain trade fairness')
        const narrative = String(data.narrative ?? '').trim()
        if (narrative) {
          setExplanations((prev) => ({ ...prev, [key]: narrative }))
        }
      } catch (e: any) {
        toast.error(e?.message || 'Failed to explain trade fairness')
      } finally {
        setExplaining((prev) => ({ ...prev, [key]: false }))
      }
    },
    [leagueId]
  )

  const executeAskAICommissioner = useCallback(async () => {
    const question = commissionerQuestion.trim()
    if (!question) return

    setChatting(true)
    try {
      const res = await paidToolFetchWithConfirm(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          sport,
          season: season.trim() ? Number.parseInt(season.trim(), 10) : undefined,
          confirmTokenSpend: true,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; answer?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to reach AI Commissioner')
      setCommissionerAnswer(String(data.answer ?? '').trim())
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reach AI Commissioner')
    } finally {
      setChatting(false)
    }
  }, [commissionerQuestion, leagueId, season, sport])

  const requestTokenPreflight = useCallback(
    async (action: PendingCommissionerAction, ruleCode: string) => {
      try {
        const preview = await previewTokenSpend(ruleCode)
        setTokenModalPreview(preview)
        setPendingAction(action)
      } catch (e: any) {
        toast.error(e?.message || 'Unable to preview token spend')
      }
    },
    []
  )

  const applyUnifiedAction = useCallback(
    async (action: UnifiedActionProposalView) => {
      if (action.requiresSubscription && !unifiedAssessment?.entitlement.afCommissionerSub) {
        toast.error('AF Commissioner subscription required for this action')
        return
      }
      const accepted = window.confirm(`Apply action: ${action.title}?`)
      if (!accepted) return

      setUnifiedActioning(action.key)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/unified`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionKey: action.key,
            confirmed: true,
            payload:
              action.key === 'run_commissioner_cycle'
                ? {
                    ...(action.suggestedPayload ?? {}),
                    sport,
                    season: season.trim() ? Number.parseInt(season.trim(), 10) : undefined,
                  }
                : action.suggestedPayload,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        // A refused action comes back as { ok: false, message } (e.g. the league locked that area).
        if (!res.ok) throw new Error(data.error || data.message || 'Failed to apply unified action')
        toast.success(data.message || 'Commissioner action applied')
        await refreshAll()
      } catch (e: any) {
        toast.error(e?.message || 'Failed to apply unified action')
      } finally {
        setUnifiedActioning(null)
      }
    },
    [leagueId, refreshAll, season, sport, unifiedAssessment?.entitlement.afCommissionerSub]
  )

  const runCycle = useCallback(async () => {
    await requestTokenPreflight('run_cycle', 'commissioner_ai_cycle_run')
  }, [requestTokenPreflight])

  const askAICommissioner = useCallback(async () => {
    if (!commissionerQuestion.trim()) return
    await requestTokenPreflight('ask_question', 'commissioner_ai_chat_question')
  }, [commissionerQuestion, requestTokenPreflight])

  const handleTokenModalConfirm = useCallback(async () => {
    if (!tokenModalPreview?.canSpend || !pendingAction) return
    setTokenModalPreview(null)
    const nextAction = pendingAction
    setPendingAction(null)
    if (nextAction === 'run_cycle') {
      await executeRunCycle()
      return
    }
    await executeAskAICommissioner()
  }, [executeAskAICommissioner, executeRunCycle, pendingAction, tokenModalPreview?.canSpend])

  const alertSummary = useMemo(() => {
    const alerts = payload?.alerts ?? []
    const counts = {
      total: alerts.length,
      open: alerts.filter((a) => a.status === 'open').length,
      high: alerts.filter((a) => a.severity === 'high' || a.severity === 'critical').length,
      snoozed: alerts.filter((a) => a.status === 'snoozed').length,
    }
    return counts
  }, [payload?.alerts])

  return (
    <section className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Bot className="h-4 w-4 text-purple-300" /> AI Commissioner
          </h2>
          <p className="mt-1 text-xs text-white/65">
            Governance assistant for rule enforcement, reminders, disputes, collusion signals, and commissioner notice workflow.
          </p>
          <p className="mt-1 text-[11px] text-white/50">
            AI Commissioner provides explainable guidance and does not silently override league rules.
          </p>
        </div>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=Settings`}
          className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
        >
          Back to settings
        </Link>
      </div>

      <InContextMonetizationCard
        title="AI Commissioner Access"
        featureId="commissioner_automation"
        tokenRuleCodes={[
          'commissioner_ai_cycle_run',
          'commissioner_ai_chat_question',
          'ai_storyline_creation',
          'commissioner_ai_collusion_detection_scan',
          'commissioner_ai_tanking_detection_scan',
        ]}
        className="mb-1"
        testIdPrefix="commissioner-monetization"
      />

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Total alerts</p>
          <p className="text-sm font-semibold text-white">{alertSummary.total}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Open</p>
          <p className="text-sm font-semibold text-white">{alertSummary.open}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">High / critical</p>
          <p className="text-sm font-semibold text-white">{alertSummary.high}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Snoozed</p>
          <p className="text-sm font-semibold text-white">{alertSummary.snoozed}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Latest action</p>
          <p className="text-xs font-medium text-white/85 truncate">
            {payload?.actionLogs?.[0]?.actionType ?? 'No actions yet'}
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-3">
        <div>
          <Label className="text-[11px] text-white/65">Sport</Label>
          <select
            aria-label="AI commissioner sport filter"
            value={sport}
            onChange={(event) => setSport(normalizeToSupportedSport(event.target.value))}
            className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
            data-testid="ai-commissioner-sport"
          >
            {SUPPORTED_SPORTS.map((option) => (
              <option key={option} value={option}>
                {sportLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[11px] text-white/65">Season</Label>
          <Input
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            className="mt-1 bg-black/40 border-white/20 text-xs text-white"
            data-testid="ai-commissioner-season"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refreshAll()}
            disabled={loading || running || insightsLoading}
            data-testid="ai-commissioner-refresh"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1">Refresh</span>
          </Button>
          <Button
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
            onClick={() => void runCycle()}
            disabled={!canRun}
            data-testid="ai-commissioner-run"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span className="ml-1">
              {running
                ? 'Running...'
                : `Run AI cycle${runCycleTokenCost ? ` (${runCycleTokenCost} token${runCycleTokenCost === 1 ? '' : 's'})` : ''}`}
            </span>
          </Button>
        </div>
        <label className="md:col-span-3 flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(event) => {
              const next = event.target.checked
              setIncludeResolved(next)
              void load({ includeResolved: next })
            }}
            className="rounded border-white/25"
            data-testid="ai-commissioner-include-resolved"
          />
          Include resolved alerts
        </label>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white">Commissioner behaviors</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void saveConfig()}
            disabled={!draft || savingConfig}
            data-testid="ai-commissioner-save-config"
          >
            {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save settings'}
          </Button>
        </div>
        {draft ? (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={draft.remindersEnabled}
                onChange={(event) =>
                  setDraft((prev) => (prev ? { ...prev, remindersEnabled: event.target.checked } : prev))
                }
              />
              Lineup reminders
            </label>
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={draft.disputeAnalysisEnabled}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, disputeAnalysisEnabled: event.target.checked } : prev
                  )
                }
              />
              Dispute analysis
            </label>
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={draft.collusionMonitoringEnabled}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, collusionMonitoringEnabled: event.target.checked } : prev
                  )
                }
              />
              Collusion monitoring
            </label>
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={draft.voteSuggestionEnabled}
                onChange={(event) =>
                  setDraft((prev) => (prev ? { ...prev, voteSuggestionEnabled: event.target.checked } : prev))
                }
              />
              Vote suggestions
            </label>
            <label className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={draft.inactivityMonitoringEnabled}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, inactivityMonitoringEnabled: event.target.checked } : prev
                  )
                }
              />
              Inactivity monitoring
            </label>
            <div>
              <Label className="text-[11px] text-white/65">Notification mode</Label>
              <select
                aria-label="AI commissioner notification mode"
                value={draft.commissionerNotificationMode}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          commissionerNotificationMode: event.target.value as NotificationMode,
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                <option value="in_app">In-app only</option>
                <option value="chat">League chat only</option>
                <option value="both">In-app + league chat</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>
        ) : (
          <p className="text-xs text-white/60">Loading commissioner behavior settings...</p>
        )}
      </div>

      <div
        className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3"
        data-testid="ai-commissioner-recap-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white">AI recap panel</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadInsights()}
            disabled={insightsLoading}
            data-testid="ai-commissioner-recap-refresh"
          >
            {insightsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh recap'}
          </Button>
        </div>
        {insightsError ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-100">
            {insightsError}
          </p>
        ) : null}
        {insights ? (
          <>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-semibold text-white">{insights.weeklyRecapPost.title}</p>
              <p className="mt-1 text-xs text-white/75">{insights.weeklyRecapPost.body}</p>
              {insights.weeklyRecapPost.bullets.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] text-white/70">
                  {insights.weeklyRecapPost.bullets.slice(0, 4).map((row) => (
                    <li key={`recap-bullet-${row}`}>- {row}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Weekly matchup summaries</p>
                <div className="mt-1 space-y-1">
                  {insights.matchupSummaries.slice(0, 3).map((row) => (
                    <p key={row.matchupId} className="text-[11px] text-white/70">
                      {row.summary}
                    </p>
                  ))}
                  {insights.matchupSummaries.length === 0 ? (
                    <p className="text-[11px] text-white/50">No matchup facts available yet.</p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Waiver wire highlights</p>
                <div className="mt-1 space-y-1">
                  {insights.waiverHighlights.slice(0, 3).map((row, idx) => (
                    <p key={`${row.claimId ?? idx}-${row.summary}`} className="text-[11px] text-white/70">
                      {row.summary}
                    </p>
                  ))}
                  {insights.waiverHighlights.length === 0 ? (
                    <p className="text-[11px] text-white/50">No recent waiver transactions found.</p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Draft commentary</p>
                <div className="mt-1 space-y-1">
                  {insights.draftCommentary.slice(0, 3).map((row) => (
                    <p key={row.pickId} className="text-[11px] text-white/70">
                      {row.summary}
                    </p>
                  ))}
                  {insights.draftCommentary.length === 0 ? (
                    <p className="text-[11px] text-white/50">No draft notes available yet.</p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Rule adjustment suggestions</p>
                <div className="mt-1 space-y-1">
                  {insights.suggestedRuleAdjustments.slice(0, 3).map((row) => (
                    <p key={row} className="text-[11px] text-white/70">
                      - {row}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-[11px] font-semibold text-white/90">Controversial trade watchlist</p>
              <div className="mt-2 space-y-2">
                {insights.controversialTrades.slice(0, 3).map((trade) => {
                  const key = `trade:${trade.tradeId}`
                  return (
                    <div key={trade.tradeId} className="rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="text-[11px] text-white/80">
                        {trade.summary} (fairness {trade.fairnessScore}/100)
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() => void explainTradeFairness(trade.tradeId)}
                        disabled={!!explaining[key]}
                        data-testid={`ai-commissioner-trade-explain-${trade.tradeId}`}
                      >
                        {explaining[key] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'AI explain'}
                      </Button>
                      {explanations[key] ? (
                        <p className="mt-1 text-[11px] text-white/80">{explanations[key]}</p>
                      ) : null}
                    </div>
                  )
                })}
                {insights.controversialTrades.length === 0 ? (
                  <p className="text-[11px] text-white/50">No controversial trades detected in this cycle.</p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-white/55">Loading AI recap insights...</p>
        )}

        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-white/90">Ask AI Commissioner</p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={commissionerQuestion}
              onChange={(event) => setCommissionerQuestion(event.target.value)}
              className="min-w-[220px] flex-1 bg-black/40 border-white/20 text-xs text-white"
              data-testid="ai-commissioner-chat-input"
            />
            <Button
              size="sm"
              onClick={() => void askAICommissioner()}
              disabled={chatting || !commissionerQuestion.trim()}
              data-testid="ai-commissioner-chat-button"
            >
              {chatting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `Ask${chatTokenCost ? ` (${chatTokenCost} token${chatTokenCost === 1 ? '' : 's'})` : ''}`
              )}
            </Button>
          </div>
          {commissionerAnswer ? (
            <p
              className="rounded-md border border-white/15 bg-black/25 px-2 py-1.5 text-xs text-white/90"
              data-testid="ai-commissioner-chat-response"
            >
              {commissionerAnswer}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white">Unified commissioner tools</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadUnified()}
            disabled={unifiedLoading}
            data-testid="ai-commissioner-unified-refresh"
          >
            {unifiedLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh unified'}
          </Button>
        </div>

        {unifiedError ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-100">
            {unifiedError}
          </p>
        ) : null}

        {unifiedAssessment ? (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Setup score</p>
                <p className="text-sm font-semibold text-white">{unifiedAssessment.setupAssistant.score}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Health</p>
                <p className="text-sm font-semibold text-white">
                  {unifiedAssessment.healthMonitor.score} ({unifiedAssessment.healthMonitor.band})
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Integrity risk</p>
                <p className="text-sm font-semibold text-white">{unifiedAssessment.integrityReview.riskBand}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-white/50">Dispute stage</p>
                <p className="text-sm font-semibold text-white">{unifiedAssessment.conflictResolution.workflow.stage}</p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Commissioner memory profile</p>
                <p className="mt-1 text-[11px] text-white/70">
                  Mode: {unifiedAssessment.memoryProfile.dominantMode} • confidence {unifiedAssessment.memoryProfile.confidence}
                </p>
                <p className="text-[11px] text-white/70">
                  Actions (30d): {unifiedAssessment.memoryProfile.recentActionCount} total, automation {unifiedAssessment.memoryProfile.automationActionsLast30d}, dispute {unifiedAssessment.memoryProfile.disputeActionsLast30d}
                </p>
                <div className="mt-1 space-y-1">
                  {unifiedAssessment.memoryProfile.notes.map((note) => (
                    <p key={note} className="text-[11px] text-white/65">
                      - {note}
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Advanced dispute workflow</p>
                <p className="mt-1 text-[11px] text-white/70">
                  SLA target: {unifiedAssessment.conflictResolution.workflow.suggestedSlaHours}h
                </p>
                <div className="mt-1 space-y-1">
                  {unifiedAssessment.conflictResolution.workflow.checklist.map((row) => (
                    <p key={row} className="text-[11px] text-white/65">
                      - {row}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {unifiedAssessment.conflictResolution.workflow.recentOpenDisputes.length > 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[11px] font-semibold text-white/90">Recent open disputes</p>
                <div className="mt-1 space-y-1">
                  {unifiedAssessment.conflictResolution.workflow.recentOpenDisputes.map((item) => (
                    <p key={item.alertId} className="text-[11px] text-white/70">
                      {item.headline} • {formatInTimezone(item.createdAt)}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
              <p className="text-[11px] font-semibold text-white/90">Proposed actions</p>
              <div className="grid gap-2 md:grid-cols-2">
                {unifiedAssessment.proposedActions.map((action) => {
                  const locked = action.requiresSubscription && !unifiedAssessment.entitlement.afCommissionerSub
                  const busy = unifiedActioning === action.key
                  return (
                    <div key={action.key} className="rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="text-xs font-medium text-white">{action.title}</p>
                      <p className="mt-0.5 text-[11px] text-white/70">{action.summary}</p>
                      {locked ? (
                        <p className="mt-1 text-[11px] text-amber-200">AF Commissioner subscription required.</p>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        disabled={locked || busy}
                        onClick={() => void applyUnifiedAction(action)}
                        data-testid={`ai-commissioner-unified-action-${action.key}`}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply with confirmation'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            <p className="text-[11px] text-white/60">{unifiedAssessment.scheduleAndPlayoffs.recommendation}</p>
          </>
        ) : (
          <p className="text-xs text-white/55">Loading unified commissioner assessment...</p>
        )}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/90">Alert center</h3>
        {loading && !payload ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/65 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading alert center...
          </div>
        ) : null}
        {!loading && payload && payload.alerts.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/65">
            No alerts yet. Run the AI cycle to generate commissioner guidance.
          </div>
        ) : null}
        {(payload?.alerts ?? []).map((alert) => (
          <article
            key={alert.alertId}
            className={`rounded-xl border p-3 ${severityClass(alert.severity)}`}
            data-testid={`ai-commissioner-alert-${alert.alertId}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{alert.headline}</p>
                <p className="mt-1 text-xs opacity-90">{alert.summary}</p>
                <p className="mt-1 text-[11px] opacity-80">
                  {alert.alertType} • status {alert.status} • {formatInTimezone(alert.createdAt)}
                </p>
                {alert.snoozedUntil ? (
                  <p className="text-[11px] opacity-80">Snoozed until {formatInTimezone(alert.snoozedUntil)}</p>
                ) : null}
                {alert.relatedManagerIds.length > 0 ? (
                  <div className="mt-1 space-y-1 text-[11px] opacity-90">
                    <p>Managers:</p>
                    <div className="flex flex-wrap gap-2">
                      {alert.relatedManagerIds.map((managerId) => (
                        <span
                          key={`${alert.alertId}-manager-${managerId}`}
                          className="inline-flex items-center gap-1 rounded border border-white/20 bg-black/25 px-1.5 py-0.5"
                        >
                          <span className="text-white/85">{managerId}</span>
                          <Link
                            href={`/league/${encodeURIComponent(leagueId)}?tab=Settings&settingsTab=${encodeURIComponent('Reputation')}&reputationManagerId=${encodeURIComponent(managerId)}`}
                            className="text-cyan-200 underline underline-offset-2"
                            data-testid={`ai-commissioner-alert-manager-trust-${alert.alertId}-${managerId}`}
                          >
                            trust
                          </Link>
                          <Link
                            href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=MANAGER&entityId=${encodeURIComponent(managerId)}&sport=${encodeURIComponent(alert.sport)}`}
                            className="text-amber-200 underline underline-offset-2"
                            data-testid={`ai-commissioner-alert-manager-legacy-${alert.alertId}-${managerId}`}
                          >
                            legacy
                          </Link>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  {alert.relatedTradeId ? (
                    <Link
                      href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
                      className="underline underline-offset-2"
                    >
                      Open trade review context
                    </Link>
                  ) : null}
                  {alert.relatedMatchupId ? (
                    <Link
                      href={`/league/${encodeURIComponent(leagueId)}?tab=Matchups`}
                      className="underline underline-offset-2"
                    >
                      Open matchup context
                    </Link>
                  ) : null}
                </div>
              </div>
              <ShieldAlert className="h-4 w-4 shrink-0 opacity-80" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutateAlert(alert.alertId, 'approve')}
                disabled={!!actioning[alert.alertId]}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutateAlert(alert.alertId, 'dismiss')}
                disabled={!!actioning[alert.alertId]}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutateAlert(alert.alertId, 'snooze')}
                disabled={!!actioning[alert.alertId]}
              >
                Snooze 24h
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutateAlert(alert.alertId, alert.status === 'resolved' ? 'reopen' : 'resolve')}
                disabled={!!actioning[alert.alertId]}
              >
                {alert.status === 'resolved' ? 'Reopen' : 'Resolve'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void mutateAlert(alert.alertId, 'send_notice')}
                disabled={!!actioning[alert.alertId]}
              >
                Send notice
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void explainAlert(alert.alertId)}
                disabled={!!explaining[alert.alertId]}
                data-testid={`ai-commissioner-alert-explain-${alert.alertId}`}
              >
                {explaining[alert.alertId] ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'AI explain'
                )}
              </Button>
            </div>
            {explanations[alert.alertId] ? (
              <p className="mt-2 rounded-md border border-white/15 bg-black/20 px-2 py-1.5 text-xs text-white/90">
                {explanations[alert.alertId]}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <TokenSpendPreflightModal
        open={Boolean(tokenModalPreview)}
        preview={tokenModalPreview}
        title={pendingAction === 'run_cycle' ? 'Confirm AI Commissioner cycle run' : 'Confirm AI Commissioner question'}
        confirmLabel={pendingAction === 'run_cycle' ? 'Run cycle now' : 'Ask question'}
        onClose={() => {
          setTokenModalPreview(null)
          setPendingAction(null)
        }}
        onConfirm={() => {
          void handleTokenModalConfirm()
        }}
        testIdPrefix="commissioner-token-preflight"
      />

      {!loading && payload ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <h4 className="text-xs font-semibold text-white/90">Recent commissioner actions</h4>
          <div className="mt-2 space-y-1">
            {payload.actionLogs.length > 0 ? (
              payload.actionLogs.slice(0, 8).map((log) => (
                <p key={log.actionId} className="text-[11px] text-white/70">
                  {formatInTimezone(log.createdAt)} • {log.actionType} • {log.summary}
                </p>
              ))
            ) : (
              <p className="text-[11px] text-white/55">No actions logged yet.</p>
            )}
          </div>
          {!hasOpenAlerts ? (
            <p className="mt-2 text-[11px] text-emerald-200/85">
              No open alerts currently. Continue regular run cadence and reminder monitoring.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
