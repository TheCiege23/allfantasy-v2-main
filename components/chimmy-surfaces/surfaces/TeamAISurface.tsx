'use client'

import React from 'react'
import { useAISurface } from '../AISurfaceContext'
import ChimmySurfaceShell from '../ChimmySurfaceShell'
import ChimmyInsightCard from '../ChimmyInsightCard'
import ChimmyRecommendationCard from '../ChimmyRecommendationCard'
import ChimmyThinkingState from '../ChimmyThinkingState'
import ChimmyEmptyState from '../ChimmyEmptyState'
import ChimmyLauncherButton from '../ChimmyLauncherButton'
import ChimmySurfaceActionFeed from '../ChimmySurfaceActionFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'

export type TeamDirection = 'contend' | 'rebuild' | 'reload' | 'undecided'

export interface TeamAISurfaceProps {
  teamName?: string
  direction?: TeamDirection
  directionRationale?: string
  insights?: Array<{ id: string; title: string; summary: string; tag?: string; severity?: 'info' | 'warning' | 'success' | 'critical' }>
  recommendations?: Array<{ id: string; action: string; rationale: string; priority?: 'high' | 'medium' | 'low'; onAction?: () => void; actionLabel?: string }>
  isLoading?: boolean
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
}

const DIRECTION_LABEL: Record<TeamDirection, { label: string; color: string }> = {
  contend:   { label: 'Contend Now', color: 'bg-emerald-500/20 text-emerald-300' },
  rebuild:   { label: 'Full Rebuild', color: 'bg-red-500/20 text-red-300' },
  reload:    { label: 'Win-Now Reload', color: 'bg-amber-500/20 text-amber-300' },
  undecided: { label: 'At a Crossroads', color: 'bg-white/10 text-white/60' },
}

export default function TeamAISurface({
  teamName,
  direction,
  directionRationale,
  insights = [],
  recommendations = [],
  isLoading = false,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
}: TeamAISurfaceProps) {
  const surface = useAISurface()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  return (
    <ChimmySurfaceShell className={className}>
      {actionFeed && actionFeed.length > 0 && (
        <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
      )}
      <div className="flex items-center justify-between mb-3">
        <div>
          {teamName && <p className="text-sm font-semibold text-white">{teamName}</p>}
        </div>
        {onOpenChat && <ChimmyLauncherButton label="Team Strategy" onClick={onOpenChat} />}
      </div>

      {isLoading && <ChimmyThinkingState message="Evaluating team trajectory…" />}

      {!isLoading && direction && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${DIRECTION_LABEL[direction].color}`}>
              {DIRECTION_LABEL[direction].label}
            </span>
          </div>
          {directionRationale && (
            <p className="text-sm text-white/65 leading-relaxed">{directionRationale}</p>
          )}
        </div>
      )}

      {!isLoading && (
        <div className="space-y-2">
          {insights.map((ins) => (
            <ChimmyInsightCard key={ins.id} title={ins.title} summary={ins.summary} tag={ins.tag} severity={ins.severity} />
          ))}
          {recommendations.map((rec) => (
            <ChimmyRecommendationCard
              key={rec.id}
              action={rec.action}
              rationale={rec.rationale}
              priority={rec.priority}
              onAction={rec.onAction}
              actionLabel={rec.actionLabel}
            />
          ))}

          {!direction && insights.length === 0 && recommendations.length === 0 && (
            <ChimmyEmptyState
              title="Team analysis"
              message="Chimmy will assess your team's direction: contend, rebuild, or reload."
              prompts={onOpenChat ? [{ label: 'What is my team trajectory?', onClick: onOpenChat }] : undefined}
            />
          )}
        </div>
      )}
    </ChimmySurfaceShell>
  )
}
