"use client"

import { useMemo, useState } from "react"
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  TrendingDown,
  X,
} from "lucide-react"

export interface GuardianEvaluationData {
  shouldIntervene: boolean
  verdict: "proceed" | "caution" | "warn" | "danger"
  severity: "low" | "medium" | "high" | "critical"
  deviationScore: number
  expectedValueLoss: number
  headline: string
  details: string[]
  riskFactors: string[]
  aiRecommendation: string
  userAction: string
  confidenceInWarning: number
  acceptancePct?: number
  confidenceState?: "HIGH" | "MODERATE" | "LEARNING"
  mode?: "STRONG_WARN" | "SOFT_WARN" | "INFO"
  driversTop3?: { key: string; label: string; delta: number }[]
  failureRiskLine?: string
  title?: string
  body?: string
  recommendedActionLabel?: string
}

interface DecisionGuardianModalProps {
  evaluation: GuardianEvaluationData
  interventionId?: string | null
  actionType: "trade" | "player_drop" | "faab_bid"
  guardianPayload?: any
  onProceed: () => void
  onCancel: () => void
  onClose: () => void
}

function ConfidenceBadge({ state }: { state: "HIGH" | "MODERATE" | "LEARNING" }) {
  const cls =
    state === "HIGH"
      ? "bg-green-500/15 text-green-200 border-green-400/25"
      : state === "MODERATE"
      ? "bg-yellow-500/15 text-yellow-200 border-yellow-400/25"
      : "bg-indigo-500/15 text-indigo-200 border-indigo-400/25 border-dashed"

  const label = state === "HIGH" ? "High Confidence" : state === "MODERATE" ? "Moderate" : "Learning"

  return <span className={`ml-2 px-2 py-0.5 text-[11px] rounded-full border ${cls}`}>{label}</span>
}

const SEVERITY_CONFIG = {
  low: {
    bg: "from-slate-900/95 to-slate-800/95",
    border: "border-slate-500/30",
    icon: ShieldCheck,
    iconColor: "text-slate-400",
    badgeBg: "bg-slate-500/15",
    badgeText: "text-slate-400",
    label: "Low Risk",
    barColor: "bg-slate-400",
  },
  medium: {
    bg: "from-amber-950/95 to-slate-900/95",
    border: "border-amber-500/30",
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-400",
    label: "Caution",
    barColor: "bg-amber-400",
  },
  high: {
    bg: "from-orange-950/95 to-slate-900/95",
    border: "border-orange-500/30",
    icon: ShieldAlert,
    iconColor: "text-orange-400",
    badgeBg: "bg-orange-500/15",
    badgeText: "text-orange-400",
    label: "Warning",
    barColor: "bg-orange-400",
  },
  critical: {
    bg: "from-red-950/95 to-slate-900/95",
    border: "border-red-500/30",
    icon: XCircle,
    iconColor: "text-red-400",
    badgeBg: "bg-red-500/15",
    badgeText: "text-red-400",
    label: "Danger",
    barColor: "bg-red-500",
  },
}

const MODE_CONFIG: Record<string, { border: string; bg: string; text: string; label: string }> = {
  STRONG_WARN: { border: "border-red-500/30", bg: "bg-red-500/10", text: "text-red-300", label: "Strong Warning" },
  SOFT_WARN: { border: "border-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-300", label: "Caution" },
  INFO: { border: "border-cyan-500/30", bg: "bg-cyan-500/10", text: "text-cyan-300", label: "Info" },
}

const ACTION_LABELS = {
  trade: "Trade",
  player_drop: "Player Drop",
  faab_bid: "FAAB Bid",
}

export default function DecisionGuardianModal({
  evaluation,
  interventionId,
  actionType,
  guardianPayload,
  onProceed,
  onCancel,
  onClose,
}: DecisionGuardianModalProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")
  const [resolving, setResolving] = useState(false)
  const [showReasonInput, setShowReasonInput] = useState(false)

  const config = SEVERITY_CONFIG[evaluation.severity]
  const IconComponent = config.icon

  const hasAcceptanceData = typeof evaluation.acceptancePct === "number"
  const modeConfig = evaluation.mode ? MODE_CONFIG[evaluation.mode] : null

  const displayTitle = evaluation.title || evaluation.headline || "AI Decision Check"
  const displayBody = evaluation.body || evaluation.aiRecommendation || "Review the risk factors before confirming."

  const cancelLabel = evaluation.recommendedActionLabel || (actionType === "trade" ? "Adjust Trade" : "Revise Decision")
  const proceedLabel =
    evaluation.severity === "high" || evaluation.severity === "critical" ? "Confirm Override" : "Proceed Anyway"

  const requiresReason = evaluation.severity === "critical" || evaluation.severity === "high"

  const driverChips = useMemo(() => {
    if (!evaluation.driversTop3?.length) return []
    return evaluation.driversTop3.slice(0, 3).map((d) => ({
      key: d.key,
      label: d.label,
      text: `${d.label}: ${d.delta >= 0 ? "+" : ""}${d.delta}`,
      negative: d.delta < 0,
    }))
  }, [evaluation.driversTop3])

  const resolveIntervention = async (decision: "proceed" | "cancel") => {
    const id = interventionId || guardianPayload?.interventionId
    if (!id) {
      decision === "proceed" ? onProceed() : onCancel()
      return
    }

    setResolving(true)
    try {
      await fetch("/api/legacy/decision-guardian/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interventionId: id,
          decision,
          reason: decision === "proceed" ? overrideReason || undefined : undefined,
          acceptancePct: evaluation.acceptancePct,
          confidenceState: evaluation.confidenceState,
          mode: evaluation.mode,
          severity: evaluation.severity,
          verdict: evaluation.verdict,
        }),
      })
    } catch {
    } finally {
      setResolving(false)
    }

    if (decision === "proceed") {
      onProceed()
    } else {
      onCancel()
    }
  }

  const handleProceedClick = () => {
    if (requiresReason) {
      if (!showReasonInput) {
        setShowReasonInput(true)
        return
      }
    }
    resolveIntervention("proceed")
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className={`relative w-full max-w-lg rounded-2xl bg-gradient-to-b ${config.bg} border ${config.border} shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto`}
      >
        <div className="absolute top-0 left-0 right-0 h-1">
          <div
            className={`h-full ${config.barColor} transition-all`}
            style={{ width: `${Math.min(100, evaluation.deviationScore)}%` }}
          />
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white/70 transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className={`p-3 rounded-xl ${config.badgeBg} border ${config.border}`}>
              <IconComponent className={`h-6 w-6 ${config.iconColor}`} />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${config.badgeBg} ${config.badgeText}`}
                >
                  {config.label}
                </span>

                {modeConfig ? (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${modeConfig.bg} ${modeConfig.text} border ${modeConfig.border}`}
                  >
                    {modeConfig.label}
                  </span>
                ) : null}

                <span className="text-[11px] text-white/40 uppercase tracking-wider">
                  {ACTION_LABELS[actionType]} Guardian
                </span>
              </div>

              <h3 className="text-lg font-semibold text-white leading-tight">{displayTitle}</h3>

              {displayBody ? <p className="mt-1.5 text-sm text-white/60 leading-relaxed">{displayBody}</p> : null}
            </div>
          </div>

          {hasAcceptanceData && (
            <div className="mb-5 p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-3xl font-bold text-white">{evaluation.acceptancePct}%</div>
                  {evaluation.confidenceState ? <ConfidenceBadge state={evaluation.confidenceState} /> : null}
                </div>
                <div className="text-xs text-white/50">Acceptance Probability</div>
              </div>

              <div className="mt-3 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, evaluation.acceptancePct as number))}%`,
                    background:
                      evaluation.confidenceState === "HIGH"
                        ? "rgba(34,197,94,.55)"
                        : evaluation.confidenceState === "MODERATE"
                        ? "rgba(234,179,8,.55)"
                        : "rgba(99,102,241,.55)",
                  }}
                />
              </div>

              {driverChips.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {driverChips.map((d) => (
                    <span
                      key={d.key}
                      className="text-xs rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/70"
                      title={d.label}
                    >
                      {d.text}
                    </span>
                  ))}
                </div>
              ) : null}

              {evaluation.failureRiskLine ? (
                <div className="mt-2 text-xs text-white/50">{evaluation.failureRiskLine}</div>
              ) : null}
            </div>
          )}

          <div className="space-y-3 mb-5">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5">
              <div className="flex items-center gap-2 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-white/40 w-16">You</div>
                <ArrowRight className="h-3 w-3 text-white/20" />
                <div className="text-sm text-white/80">{evaluation.userAction}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5">
              <div className="flex items-center gap-2 flex-1">
                <div className="text-[11px] uppercase tracking-wider text-white/40 w-16">AI</div>
                <ArrowRight className="h-3 w-3 text-white/20" />
                <div className="text-sm text-white/80">{evaluation.aiRecommendation}</div>
              </div>
            </div>
          </div>

          <div className={`grid ${hasAcceptanceData ? "grid-cols-2" : "grid-cols-3"} gap-3 mb-5`}>
            <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Deviation</div>
              <div className={`text-xl font-bold ${config.badgeText}`}>{evaluation.deviationScore}</div>
              <div className="text-[11px] text-white/30">/100</div>
            </div>

            <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">EV Loss</div>
              <div className="flex items-center justify-center gap-1">
                {evaluation.expectedValueLoss > 0 && <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
                <div
                  className={`text-xl font-bold ${
                    evaluation.expectedValueLoss > 0 ? "text-red-400" : "text-white/60"
                  }`}
                >
                  {evaluation.expectedValueLoss > 0 ? evaluation.expectedValueLoss.toLocaleString() : "—"}
                </div>
              </div>
            </div>

            {!hasAcceptanceData && (
              <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-center">
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Confidence</div>
                <div className="text-xl font-bold text-white/80">{evaluation.confidenceInWarning}%</div>
              </div>
            )}
          </div>

          {evaluation.riskFactors.length > 0 && (
            <div className="mb-5">
              <div className="flex flex-wrap gap-1.5">
                {evaluation.riskFactors.slice(0, showDetails ? evaluation.riskFactors.length : 3).map((factor, idx) => (
                  <span
                    key={idx}
                    className={`px-2.5 py-1 rounded-lg text-xs ${config.badgeBg} ${config.badgeText} border ${config.border}`}
                  >
                    {factor}
                  </span>
                ))}
                {!showDetails && evaluation.riskFactors.length > 3 && (
                  <span className="px-2.5 py-1 rounded-lg text-xs bg-white/5 text-white/40">
                    +{evaluation.riskFactors.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}

          {evaluation.details.length > 0 && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors mb-4"
            >
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showDetails ? "Hide details" : "Show details"}
            </button>
          )}

          {showDetails && evaluation.details.length > 0 && (
            <div className="mb-5 space-y-2">
              {evaluation.details.map((detail, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm text-white/60">
                  <span className="text-white/20 mt-0.5">•</span>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          )}

          {showReasonInput && (
            <div className="mb-5">
              <label className="text-xs text-white/50 mb-1.5 block">
                Why are you overriding this warning? (optional)
              </label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g., I have insider knowledge about this player's situation..."
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white/80 placeholder-white/30 resize-none focus:outline-none focus:border-white/20"
                rows={2}
                maxLength={500}
              />
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => resolveIntervention("cancel")}
              disabled={resolving}
              className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-white/80 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>

            <button
              onClick={handleProceedClick}
              disabled={resolving}
              className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${
                evaluation.severity === "critical"
                  ? "bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25"
                  : evaluation.severity === "high"
                  ? "bg-orange-500/15 border-orange-500/30 text-orange-400 hover:bg-orange-500/25"
                  : "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
              }`}
            >
              {showReasonInput ? "Confirm Override" : proceedLabel}
            </button>
          </div>

          <div className="mt-3 text-center text-[11px] text-white/25">
            AI Decision Guardian — Override decisions are logged for learning
          </div>
        </div>
      </div>
    </div>
  )
}
