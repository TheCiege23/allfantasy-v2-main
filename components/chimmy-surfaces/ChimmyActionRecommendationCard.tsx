'use client'

/**
 * ChimmyActionRecommendationCard — Pattern A
 * The central action-ready recommendation card. Replaces the basic
 * ChimmyRecommendationCard when AI actions need to be bound to real workflows.
 *
 * Features:
 * - Recommendation headline + confidence + risk badges
 * - Short reasoning text
 * - Primary action button (full ChimmyActionGroup with confirm modal)
 * - Secondary action links
 * - Inline deep dive with full analysis, evidence, caveats, alternatives
 * - Save / dismiss affordances
 */

import { useState } from 'react'
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { ChimmyActionGroup } from '@/components/chimmy-actions'
import ChimmyConfidenceBadge from './ChimmyConfidenceBadge'
import ChimmyRiskBadge from './ChimmyRiskBadge'
import type { ChimmyRiskLevel } from './ChimmyRiskBadge'

export interface ChimmyActionRecommendationCardProps {
  rec: ChimmyFeedRecommendation
  context: AIActionContext
  /** Called after primary action completes successfully */
  onActionSuccess?: (rec: ChimmyFeedRecommendation) => void
  /**
   * @deprecated Never called. The save button was retired with the saved-recommendations stub
   * (2026-09-16) — it posted to a route that always failed. Kept so existing callers still compile.
   */
  onSave?: (rec: ChimmyFeedRecommendation) => void
  onDismiss?: (rec: ChimmyFeedRecommendation) => void
  /** Start with deep dive open */
  defaultExpanded?: boolean
  /** Compact layout (no deep dive, tighter padding) */
  compact?: boolean
  className?: string
}

// ─── Priority → accent color map ───────────────────────────────────────────────

const RISK_ACCENT: Record<ChimmyRiskLevel, string> = {
  low:      'border-l-emerald-500',
  medium:   'border-l-amber-500',
  high:     'border-l-orange-500',
  critical: 'border-l-red-500',
}

const ACTION_TYPE_COLORS: Record<string, string> = {
  Waiver:      'bg-sky-500/15 text-sky-300',
  Lineup:      'bg-indigo-500/15 text-indigo-300',
  Trade:       'bg-violet-500/15 text-violet-300',
  Draft:       'bg-emerald-500/15 text-emerald-300',
  Roster:      'bg-teal-500/15 text-teal-300',
  Commissioner: 'bg-amber-500/15 text-amber-300',
  Matchup:     'bg-cyan-500/15 text-cyan-300',
}

export default function ChimmyActionRecommendationCard({
  rec,
  context,
  onActionSuccess,
  onDismiss,
  defaultExpanded = false,
  compact = false,
  className = '',
}: ChimmyActionRecommendationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [dismissed, setDismissed] = useState(rec.isDismissed ?? false)

  if (dismissed) return null

  const riskLevel = rec.riskLevel as ChimmyRiskLevel | undefined
  const borderAccent = riskLevel ? RISK_ACCENT[riskLevel] : 'border-l-indigo-500'
  const tagColor = rec.actionType ? (ACTION_TYPE_COLORS[rec.actionType] ?? 'bg-white/10 text-white/60') : null

  function handleDismiss() {
    setDismissed(true)
    onDismiss?.(rec)
  }

  return (
    <div
      className={[
        'group relative rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02]',
        'border-l-2', borderAccent,
        compact ? 'p-3' : 'p-4',
        className,
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Chimmy icon */}
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 ring-1 ring-indigo-500/30">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {rec.actionType && tagColor && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tagColor}`}>
                {rec.actionType}
              </span>
            )}
            {rec.confidencePct !== undefined && (
              <ChimmyConfidenceBadge pct={rec.confidencePct} showPct={!compact} />
            )}
            {riskLevel && (
              <ChimmyRiskBadge level={riskLevel} />
            )}
          </div>

          {/* Headline */}
          <p className="text-sm font-semibold text-white leading-snug">{rec.headline}</p>

          {/* Reason */}
          {!compact && (
            <p className="mt-1 text-sm text-white/60 leading-relaxed">{rec.reason}</p>
          )}
        </div>

        {/* Utility buttons */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1.5 text-white/30 hover:text-white/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label="Dismiss recommendation"
            title="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Action area */}
      {(rec.primaryAction || (rec.secondaryActions && rec.secondaryActions.length > 0)) && (
        <div className="mt-3 pl-10">
          <ChimmyActionGroup
            primaryAction={rec.primaryAction!}
            secondaryActions={rec.secondaryActions ?? []}
            context={context}
            onSuccess={() => onActionSuccess?.(rec)}
          />
        </div>
      )}

      {/* Deep dive toggle */}
      {!compact && (rec.detailedAnalysis || rec.evidence || (rec.alternatives && rec.alternatives.length > 0)) && (
        <div className="mt-3 pl-10">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 rounded"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
                Hide analysis
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                Full analysis
              </>
            )}
          </button>
        </div>
      )}

      {/* Deep dive panel */}
      {expanded && (
        <DeepDivePanel rec={rec} />
      )}
    </div>
  )
}

// ─── Deep Dive Panel ────────────────────────────────────────────────────────────

function DeepDivePanel({ rec }: { rec: ChimmyFeedRecommendation }) {
  return (
    <div className="mt-3 ml-10 space-y-3 border-t border-white/5 pt-3">
      {rec.detailedAnalysis && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/30">
            Full Analysis
          </p>
          <p className="text-sm text-white/70 leading-relaxed">{rec.detailedAnalysis}</p>
        </div>
      )}

      {rec.evidence && (
        <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/30">
            What the data says
          </p>
          <p className="text-sm text-white/60">{rec.evidence}</p>
        </div>
      )}

      {rec.caveats && rec.caveats.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-400" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wider text-white/30">Caveats</p>
          </div>
          <ul className="space-y-1">
            {rec.caveats.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/50">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500/60" aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rec.alternatives && rec.alternatives.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/30">
            Alternatives
          </p>
          <div className="flex flex-wrap gap-1.5">
            {rec.alternatives.map((alt, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/50"
              >
                <ArrowRight className="h-2.5 w-2.5 text-white/30" aria-hidden="true" />
                {alt}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
