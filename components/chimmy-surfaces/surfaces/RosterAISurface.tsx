'use client'

import React, { useState } from 'react'
import { useAISurface } from '../AISurfaceContext'
import ChimmySurfaceShell from '../ChimmySurfaceShell'
import ChimmyInsightCard from '../ChimmyInsightCard'
import ChimmyRecommendationCard from '../ChimmyRecommendationCard'
import ChimmyThinkingState from '../ChimmyThinkingState'
import ChimmyEmptyState from '../ChimmyEmptyState'
import ChimmyErrorState from '../ChimmyErrorState'
import ChimmyLauncherButton from '../ChimmyLauncherButton'
import ChimmyDrawer from '../ChimmyDrawer'
import ChimmyPremiumGate from '../ChimmyPremiumGate'
import ChimmySurfaceActionFeed from '../ChimmySurfaceActionFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'

export interface RosterAISurfaceProps {
  insights?: Array<{ id: string; title: string; summary: string; tag?: string; severity?: 'info' | 'warning' | 'success' | 'critical' }>
  recommendations?: Array<{ id: string; action: string; rationale: string; priority?: 'high' | 'medium' | 'low'; onAction?: () => void; actionLabel?: string }>
  isLoading?: boolean
  error?: string
  onRetry?: () => void
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
}

export default function RosterAISurface({
  insights = [],
  recommendations = [],
  isLoading = false,
  error,
  onRetry,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
}: RosterAISurfaceProps) {
  const surface = useAISurface()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <ChimmySurfaceShell className={className}>
      {actionFeed && actionFeed.length > 0 && (
        <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Roster AI</h3>
        <ChimmyLauncherButton label="Optimize Roster" hasNotification={recommendations.length > 0} onClick={() => setDrawerOpen(true)} />
      </div>

      {isLoading && <ChimmyThinkingState message="Analyzing your roster…" />}
      {error && !isLoading && <ChimmyErrorState message={error} onRetry={onRetry} />}

      {!isLoading && !error && (
        <div className="space-y-2">
          {insights.map((ins) => (
            <ChimmyInsightCard key={ins.id} title={ins.title} summary={ins.summary} tag={ins.tag} severity={ins.severity} onExpand={() => setDrawerOpen(true)} />
          ))}

          <ChimmyPremiumGate
            requiredTier="premium"
            featureLabel="Roster Optimization Recommendations"
            featureDescription="Weekly start/sit decisions, position balance, and waiver targets."
            onUpgrade={onOpenChat}
          >
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
          </ChimmyPremiumGate>

          {insights.length === 0 && recommendations.length === 0 && (
            <ChimmyEmptyState
              title="Roster looks set"
              message="Ask Chimmy about start/sit decisions or position weaknesses."
              prompts={onOpenChat ? [
                { label: 'Who should I start?', onClick: onOpenChat },
                { label: 'Any weak positions?', onClick: onOpenChat },
              ] : undefined}
            />
          )}
        </div>
      )}

      <ChimmyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Roster AI">
        <ChimmyEmptyState
          title="Roster Help"
          message="Get start/sit advice, depth chart analysis, and injury impact assessment."
          prompts={onOpenChat ? [
            { label: 'Start/sit this week', onClick: () => { setDrawerOpen(false); onOpenChat?.() } },
            { label: 'Waiver targets for my needs', onClick: () => { setDrawerOpen(false); onOpenChat?.() } },
          ] : undefined}
        />
      </ChimmyDrawer>
    </ChimmySurfaceShell>
  )
}
