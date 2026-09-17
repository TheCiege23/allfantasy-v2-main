'use client'

import React, { useState } from 'react'
import { useAISurface } from '../AISurfaceContext'
import ChimmySurfaceShell from '../ChimmySurfaceShell'
import ChimmyRecommendationCard from '../ChimmyRecommendationCard'
import ChimmyInsightCard from '../ChimmyInsightCard'
import ChimmyThinkingState from '../ChimmyThinkingState'
import ChimmyEmptyState from '../ChimmyEmptyState'
import ChimmyErrorState from '../ChimmyErrorState'
import ChimmyLauncherButton from '../ChimmyLauncherButton'
import ChimmyPremiumGate from '../ChimmyPremiumGate'
import ChimmySurfaceActionFeed from '../ChimmySurfaceActionFeed'
import ChimmyUnifiedAlertFeed from '../ChimmyUnifiedAlertFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'

export interface WaiverAISurfaceAdd {
  id: string
  playerName: string
  position: string
  addRationale: string
  urgency: 'high' | 'medium' | 'low'
  faabBid?: string
  confidencePct?: number
  onAdd?: () => void
}

export interface WaiverAISurfaceProps {
  topAdds?: WaiverAISurfaceAdd[]
  insights?: Array<{ id: string; title: string; summary: string; tag?: string }>
  isLoading?: boolean
  error?: string
  onRetry?: () => void
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
}

export default function WaiverAISurface({
  topAdds = [],
  insights = [],
  isLoading = false,
  error,
  onRetry,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
}: WaiverAISurfaceProps) {
  const surface = useAISurface()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  return (
    <ChimmySurfaceShell className={className}>
      <ChimmyUnifiedAlertFeed
        leagueId={surface.leagueState?.leagueId ?? undefined}
        surface="waiver"
        presentation="critical_drawer"
      />
      <ChimmyUnifiedAlertFeed
        leagueId={surface.leagueState?.leagueId ?? undefined}
        surface="waiver"
        presentation="floating_nudge"
      />

      {actionFeed && actionFeed.length > 0 && (
        <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Waiver AI</h3>
        {onOpenChat && <ChimmyLauncherButton label="Waiver Advice" onClick={onOpenChat} />}
      </div>

      {isLoading && <ChimmyThinkingState message="Scanning the waiver wire…" />}
      {error && !isLoading && <ChimmyErrorState message={error} onRetry={onRetry} />}

      {!isLoading && !error && (
        <div className="space-y-2">
          <ChimmyPremiumGate
            requiredTier="premium"
            featureLabel="AI Waiver Recommendations"
            featureDescription="Top adds ranked by projected value and your roster needs."
            onUpgrade={onOpenChat}
          >
            {topAdds.map((add) => (
              <ChimmyRecommendationCard
                key={add.id}
                action={`Add ${add.playerName} (${add.position})`}
                rationale={add.addRationale}
                priority={add.urgency}
                actionType={add.faabBid ? `FAAB: ${add.faabBid}` : 'Waiver'}
                confidencePct={add.confidencePct}
                onAction={add.onAdd}
                actionLabel="Add Player"
              />
            ))}
          </ChimmyPremiumGate>

          {insights.map((ins) => (
            <ChimmyInsightCard key={ins.id} title={ins.title} summary={ins.summary} tag={ins.tag} />
          ))}

          {topAdds.length === 0 && insights.length === 0 && (
            <ChimmyEmptyState
              title="Waiver wire scanning"
              message="Chimmy will surface top waiver targets based on your roster needs."
              prompts={onOpenChat ? [
                { label: 'Top adds this week?', onClick: onOpenChat },
                { label: 'FAAB strategy?', onClick: onOpenChat },
              ] : undefined}
            />
          )}
        </div>
      )}
    </ChimmySurfaceShell>
  )
}
