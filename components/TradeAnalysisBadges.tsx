'use client'

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Database,
  Clock,
  Shield,
  XCircle,
} from 'lucide-react'

interface FreshnessSource {
  grade: string
  age: string
}

interface DataFreshnessData {
  compositeGrade: string
  compositeScore: number
  sources?: {
    rosters?: FreshnessSource
    valuations?: FreshnessSource
    injuries?: FreshnessSource
    adp?: FreshnessSource
    analytics?: FreshnessSource
    tradeHistory?: FreshnessSource
  }
  warnings?: string[]
}

interface CoverageBadge {
  label: string
  description: string
  color: 'green' | 'yellow' | 'red'
}

interface CoverageDimension {
  score: number
  detail: string
}

interface DataCoverageData {
  tier: 'FULL' | 'PARTIAL' | 'MINIMAL'
  score: number
  badge: CoverageBadge
  dimensions?: {
    assetCoverage?: CoverageDimension
    sourceFreshness?: CoverageDimension
    dataCompleteness?: CoverageDimension
  }
}

interface DisagreementData {
  winnerMismatch?: boolean
  confidenceSpread?: number
  keyDifferences?: string[]
  reviewMode?: boolean
}

interface TradeAnalysisBadgesProps {
  dataFreshness?: DataFreshnessData | null
  dataCoverage?: DataCoverageData | null
  disagreement?: DisagreementData | null
  disagreementCodes?: string[]
  compact?: boolean
}

const GRADE_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
  fresh: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    icon: <CheckCircle className="w-3 h-3" />,
  },
  aging: {
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/30',
    icon: <Clock className="w-3 h-3" />,
  },
  stale: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/30',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  expired: {
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    icon: <XCircle className="w-3 h-3" />,
  },
  unavailable: {
    color: 'text-slate-500',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/20',
    icon: <XCircle className="w-3 h-3" />,
  },
}

const COVERAGE_COLOR_MAP: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
}

function FreshnessBadge({ data, compact }: { data: DataFreshnessData; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = GRADE_CONFIG[data.compositeGrade] || GRADE_CONFIG.stale

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} ${cfg.border} transition-colors hover:opacity-80`}
      >
        {cfg.icon}
        <span>Data: {data.compositeGrade}</span>
        <span className="opacity-60">({data.compositeScore}/100)</span>
        {!compact && (
          expanded ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />
        )}
      </button>

      {expanded && !compact && data.sources && (
        <div className="ml-2 pl-3 border-l border-slate-700/50 space-y-0.5">
          {Object.entries(data.sources).map(([key, src]) => {
            if (!src) return null
            const srcCfg = GRADE_CONFIG[src.grade] || GRADE_CONFIG.stale
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
            return (
              <div key={key} className={`flex items-center gap-2 text-xs ${srcCfg.color}`}>
                {srcCfg.icon}
                <span className="opacity-80">{label}:</span>
                <span>{src.grade}</span>
                <span className="opacity-50">({src.age})</span>
              </div>
            )
          })}
          {data.warnings && data.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {data.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-orange-400/80">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CoverageBadgeDisplay({ data, compact }: { data: DataCoverageData; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const colorClass = COVERAGE_COLOR_MAP[data.badge.color] || COVERAGE_COLOR_MAP.yellow

  const icon = data.tier === 'FULL'
    ? <Database className="w-3 h-3" />
    : data.tier === 'PARTIAL'
      ? <Activity className="w-3 h-3" />
      : <AlertTriangle className="w-3 h-3" />

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass} transition-colors hover:opacity-80`}
      >
        {icon}
        <span>{data.badge.label}</span>
        <span className="opacity-60">({data.score}/100)</span>
        {!compact && (
          expanded ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />
        )}
      </button>

      {expanded && !compact && (
        <div className="ml-2 pl-3 border-l border-slate-700/50 space-y-1">
          <p className="text-xs text-slate-400">{data.badge.description}</p>
          {data.dimensions && Object.entries(data.dimensions).map(([key, dim]) => {
            if (!dim) return null
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
            const barPct = Math.min(100, Math.max(0, dim.score))
            const barColor =
              dim.score >= 70 ? 'bg-emerald-500' :
              dim.score >= 40 ? 'bg-yellow-500' :
              'bg-red-500'
            return (
              <div key={key} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="text-slate-300 font-medium">{dim.score}%</span>
                </div>
                <div className="w-full h-1 bg-slate-700/50 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
                </div>
                <p className="text-xs text-slate-500">{dim.detail}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DisagreementBadge({ data, codes }: { data: DisagreementData; codes?: string[] }) {
  const [expanded, setExpanded] = useState(false)

  const hasDisagreement = data.winnerMismatch || data.reviewMode || (data.confidenceSpread && data.confidenceSpread > 20)
  if (!hasDisagreement && (!codes || codes.length === 0)) return null

  const severity = data.winnerMismatch ? 'high' : (data.confidenceSpread && data.confidenceSpread > 30) ? 'medium' : 'low'
  const colorClass = severity === 'high'
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : severity === 'medium'
      ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
      : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass} transition-colors hover:opacity-80`}
      >
        <Shield className="w-3 h-3" />
        <span>AI {data.reviewMode ? 'Review Mode' : 'Disagreement'}</span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
      </button>

      {expanded && (
        <div className="ml-2 pl-3 border-l border-slate-700/50 space-y-1">
          {data.winnerMismatch && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <XCircle className="w-3 h-3" />
              <span>AI models disagree on trade winner</span>
            </div>
          )}
          {data.confidenceSpread != null && data.confidenceSpread > 15 && (
            <div className="flex items-center gap-1.5 text-xs text-orange-400">
              <AlertTriangle className="w-3 h-3" />
              <span>Confidence spread: {data.confidenceSpread} points between models</span>
            </div>
          )}
          {codes && codes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {codes.map(code => (
                <Badge key={code} variant="outline" className="text-[11px] px-1.5 py-0">
                  {code.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          )}
          {data.keyDifferences && data.keyDifferences.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {data.keyDifferences.map((diff, i) => (
                <p key={i} className="text-xs text-slate-400">- {diff}</p>
              ))}
            </div>
          )}
          {data.reviewMode && (
            <p className="text-xs text-yellow-400/80 mt-1">
              Review Mode active — consider getting a second opinion before acting
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function TradeAnalysisBadges({
  dataFreshness,
  dataCoverage,
  disagreement,
  disagreementCodes,
  compact = false,
}: TradeAnalysisBadgesProps) {
  const hasFreshness = dataFreshness != null
  const hasCoverage = dataCoverage != null
  const hasDisagreement = disagreement != null && (
    disagreement.winnerMismatch ||
    disagreement.reviewMode ||
    (disagreement.confidenceSpread && disagreement.confidenceSpread > 15) ||
    (disagreementCodes && disagreementCodes.length > 0)
  )

  if (!hasFreshness && !hasCoverage && !hasDisagreement) return null

  return (
    <div className={`flex ${compact ? 'flex-row gap-2' : 'flex-col gap-1.5'} flex-wrap`}>
      {hasCoverage && dataCoverage && (
        <CoverageBadgeDisplay data={dataCoverage} compact={compact} />
      )}
      {hasFreshness && dataFreshness && (
        <FreshnessBadge data={dataFreshness} compact={compact} />
      )}
      {hasDisagreement && disagreement && (
        <DisagreementBadge data={disagreement} codes={disagreementCodes} />
      )}
    </div>
  )
}
