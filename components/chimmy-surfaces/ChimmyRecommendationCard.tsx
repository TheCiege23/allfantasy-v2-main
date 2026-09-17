'use client'

import React from 'react'
import { ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react'

export type ChimmyRecommendationPriority = 'high' | 'medium' | 'low'

export interface ChimmyRecommendationCardProps {
  action: string
  rationale: string
  priority?: ChimmyRecommendationPriority
  /** e.g. 'Add Player', 'Make Trade', 'Drop Player' */
  actionType?: string
  /** Confidence percentage 0–100 */
  confidencePct?: number
  /** Whether the user has already completed this recommendation */
  completed?: boolean
  onAction?: () => void
  actionLabel?: string
  className?: string
}

const PRIORITY_BADGE: Record<ChimmyRecommendationPriority, string> = {
  high:   'bg-red-500/20 text-red-300',
  medium: 'bg-amber-500/20 text-amber-300',
  low:    'bg-slate-500/20 text-slate-300',
}

export default function ChimmyRecommendationCard({
  action,
  rationale,
  priority = 'medium',
  actionType,
  confidencePct,
  completed = false,
  onAction,
  actionLabel = 'Take Action',
  className = '',
}: ChimmyRecommendationCardProps) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {completed
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          }
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {actionType && (
                <span className="text-xs text-white/50 uppercase tracking-wide">{actionType}</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[priority]}`}>
                {priority}
              </span>
              {confidencePct !== undefined && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/40">
                  {confidencePct}%
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-white">{action}</p>
            <p className="mt-1 text-sm text-white/60 leading-relaxed">{rationale}</p>
          </div>
        </div>
      </div>

      {onAction && !completed && (
        <button
          onClick={onAction}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          {actionLabel}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
