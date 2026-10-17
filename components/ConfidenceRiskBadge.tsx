"use client"

import { useState } from "react"
import { TrendingUp, TrendingDown, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react"

function AFCrest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z" fill="currentColor" opacity="0.2" />
      <path d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="bold" fontFamily="system-ui, sans-serif">AF</text>
    </svg>
  )
}

export interface ConfidenceRiskData {
  confidence: number
  level: "high" | "learning" | "evolving"
  volatility: "Low" | "Medium" | "High"
  volatilityScore?: number
  riskProfile: "low" | "moderate" | "high" | "extreme"
  riskTags: string[]
  explanation: string
}

interface ConfidenceRiskBadgeProps {
  data: ConfidenceRiskData
  size?: "sm" | "md" | "lg"
  showTags?: boolean
  showExplanation?: boolean
  compact?: boolean
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 70) return { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/25", ring: "ring-emerald-500/30" }
  if (confidence >= 45) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25", ring: "ring-amber-500/30" }
  return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25", ring: "ring-blue-500/30" }
}

function getVolatilityColor(vol: string) {
  if (vol === "High") return { bg: "bg-red-500/12", text: "text-red-400", border: "border-red-500/20" }
  if (vol === "Medium") return { bg: "bg-amber-500/12", text: "text-amber-400", border: "border-amber-500/20" }
  return { bg: "bg-emerald-500/12", text: "text-emerald-400", border: "border-emerald-500/20" }
}

function getRiskColor(profile: string) {
  if (profile === "extreme") return { bg: "bg-red-600/15", text: "text-red-400" }
  if (profile === "high") return { bg: "bg-red-500/12", text: "text-red-400" }
  if (profile === "moderate") return { bg: "bg-amber-500/12", text: "text-amber-400" }
  return { bg: "bg-emerald-500/12", text: "text-emerald-400" }
}

const TAG_LABELS: Record<string, string> = {
  aging_asset: "Aging Asset",
  injury_risk: "Injury Risk",
  role_uncertainty: "Role Uncertainty",
  thin_market: "Thin Market",
  position_scarcity: "Position Scarcity",
  future_pick_variance: "Future Pick",
  consolidation_risk: "Consolidation",
  rb_cliff: "RB Cliff",
  rookie_unknown: "Rookie",
  qb_dependency: "QB Dependency",
  schedule_volatility: "Schedule Vol",
  low_data: "Low Data",
  small_sample: "Small Sample",
  negative_trend: "Neg Trend",
  high_value_swing: "Value Swing",
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  injury_risk: { bg: "bg-red-500/15", text: "text-red-400" },
  rb_cliff: { bg: "bg-red-500/15", text: "text-red-400" },
  high_value_swing: { bg: "bg-red-500/15", text: "text-red-400" },
  negative_trend: { bg: "bg-red-500/15", text: "text-red-400" },
  aging_asset: { bg: "bg-amber-500/15", text: "text-amber-400" },
  role_uncertainty: { bg: "bg-amber-500/15", text: "text-amber-400" },
  consolidation_risk: { bg: "bg-amber-500/15", text: "text-amber-400" },
  qb_dependency: { bg: "bg-amber-500/15", text: "text-amber-400" },
  future_pick_variance: { bg: "bg-amber-500/15", text: "text-amber-400" },
}

const DEFAULT_TAG_COLOR = { bg: "bg-slate-500/15", text: "text-slate-400" }

export default function ConfidenceRiskBadge({
  data,
  size = "sm",
  showTags = true,
  showExplanation = false,
  compact = false,
}: ConfidenceRiskBadgeProps) {
  const [expanded, setExpanded] = useState(false)
  const confColor = getConfidenceColor(data.confidence)
  const volColor = getVolatilityColor(data.volatility)
  const riskColor = getRiskColor(data.riskProfile)

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <div
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${confColor.bg} ${confColor.border} border text-[11px] font-semibold ${confColor.text} cursor-help`}
          title={data.explanation}
        >
          <AFCrest className="h-2.5 w-2.5" />
          {data.confidence}
        </div>
        <div
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${volColor.bg} ${volColor.border} border text-[11px] font-medium ${volColor.text}`}
        >
          {data.volatility === "High" ? <TrendingUp className="h-2.5 w-2.5" /> : data.volatility === "Low" ? <TrendingDown className="h-2.5 w-2.5" /> : null}
          {data.volatility}
        </div>
      </div>
    )
  }

  const sizeClasses = {
    sm: { wrapper: "text-xs", score: "text-sm", pill: "px-2 py-0.5 text-[11px]", tag: "px-1.5 py-0.5 text-[11px]" },
    md: { wrapper: "text-sm", score: "text-base", pill: "px-2.5 py-1 text-xs", tag: "px-2 py-0.5 text-[11px]" },
    lg: { wrapper: "text-base", score: "text-lg", pill: "px-3 py-1 text-sm", tag: "px-2 py-0.5 text-xs" },
  }[size]

  return (
    <div className={`rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 ${sizeClasses.wrapper}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 ${sizeClasses.pill} rounded-full ${confColor.bg} ${confColor.border} border font-semibold ${confColor.text}`}>
            <AFCrest className="h-3 w-3" />
            <span className={sizeClasses.score}>{data.confidence}</span>
            <span className="opacity-60">/100</span>
          </div>

          <div className={`flex items-center gap-1 ${sizeClasses.pill} rounded-full ${volColor.bg} ${volColor.border} border font-medium ${volColor.text}`}>
            {data.volatility === "High" ? (
              <TrendingUp className="h-3 w-3" />
            ) : data.volatility === "Low" ? (
              <TrendingDown className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {data.volatility} Vol
          </div>

          <div className={`${sizeClasses.pill} rounded-full ${riskColor.bg} border border-white/[0.06] font-medium ${riskColor.text} capitalize`}>
            {data.riskProfile}
          </div>
        </div>

        {(showExplanation || data.riskTags.length > 0) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/40 hover:text-white/60 transition-colors p-0.5"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {showTags && data.riskTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {data.riskTags.slice(0, expanded ? data.riskTags.length : 4).map((tag) => {
            const color = TAG_COLORS[tag] || DEFAULT_TAG_COLOR
            return (
              <span
                key={tag}
                className={`${sizeClasses.tag} rounded-full ${color.bg} ${color.text} font-medium`}
              >
                {TAG_LABELS[tag] || tag}
              </span>
            )
          })}
          {!expanded && data.riskTags.length > 4 && (
            <span className={`${sizeClasses.tag} rounded-full bg-white/5 text-white/40 font-medium`}>
              +{data.riskTags.length - 4}
            </span>
          )}
        </div>
      )}

      {expanded && showExplanation && data.explanation && (
        <div className="mt-2 flex items-start gap-1.5 text-white/50 text-[11px] leading-relaxed">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <p>{data.explanation}</p>
        </div>
      )}
    </div>
  )
}
