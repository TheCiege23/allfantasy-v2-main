'use client'

import React, { useMemo, useState } from 'react'
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
import ChimmyAnalyticsSummaryPanel from '../ChimmyAnalyticsSummaryPanel'
import ChimmyUnifiedAlertFeed from '../ChimmyUnifiedAlertFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'
import ChimmyPersonalizationHints from '../ChimmyPersonalizationHints'
import ChimmyMemoryAwareCues from '../ChimmyMemoryAwareCues'
import {
  prioritizeDashboardSections,
  rankRecommendationForProfile,
  recommendationLimitByActionPreference,
} from '@/lib/chimmy-personalization'
import { useChimmyPersonalization } from '@/lib/chimmy-personalization/useChimmyPersonalization'

export interface DashboardAISurfaceInsight {
  id: string
  title: string
  summary: string
  tag?: string
  confidencePct?: number
  severity?: 'info' | 'warning' | 'success' | 'critical'
}

export interface DashboardAISurfaceRecommendation {
  id: string
  action: string
  rationale: string
  priority?: 'high' | 'medium' | 'low'
  actionType?: string
  confidencePct?: number
  onAction?: () => void
  actionLabel?: string
}

export interface DashboardAISurfaceProps {
  insights?: DashboardAISurfaceInsight[]
  recommendations?: DashboardAISurfaceRecommendation[]
  isLoading?: boolean
  error?: string
  onRetry?: () => void
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
  showLearningSummary?: boolean
}

export default function DashboardAISurface({
  insights = [],
  recommendations = [],
  isLoading = false,
  error,
  onRetry,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
  showLearningSummary = true,
}: DashboardAISurfaceProps) {
  const surface = useAISurface()
  const { profile } = useChimmyPersonalization()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const orderedRecommendations = useMemo(() => {
    if (!profile) return recommendations
    const ranked = [...recommendations].sort((a, b) => {
      const scoreA = rankRecommendationForProfile({
        confidencePct: a.confidencePct,
        priority: a.priority,
        actionType: a.actionType,
        profile,
      })
      const scoreB = rankRecommendationForProfile({
        confidencePct: b.confidencePct,
        priority: b.priority,
        actionType: b.actionType,
        profile,
      })
      return scoreB - scoreA
    })

    return ranked.slice(0, recommendationLimitByActionPreference(profile))
  }, [profile, recommendations])

  const sectionOrder = useMemo(() => {
    if (!profile) {
      return ['recommendations', 'alerts', 'insights', 'saved'] as const
    }
    return prioritizeDashboardSections(profile)
  }, [profile])

  return (
    <ChimmySurfaceShell className={className}>
      {actionFeed && actionFeed.length > 0 && (
        <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
      )}

      <ChimmyPersonalizationHints className="mb-3" />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Today's AI Insights</h2>
        <ChimmyLauncherButton
          label="Ask Chimmy"
          hasNotification={insights.length > 0}
          onClick={() => setDrawerOpen(true)}
        />
      </div>

      {isLoading && <ChimmyThinkingState message="Loading your dashboard insights…" />}

      {error && !isLoading && <ChimmyErrorState message={error} onRetry={onRetry} />}

      {!isLoading && !error && insights.length === 0 && recommendations.length === 0 && (
        <ChimmyEmptyState
          title="No insights yet"
          message="Chimmy will surface your best moves, risks, and opportunities here."
          prompts={onOpenChat ? [{ label: 'Ask about my roster', onClick: onOpenChat }] : undefined}
        />
      )}

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          {sectionOrder.map((section) => {
            if (section === 'alerts') {
              return (
                <ChimmyUnifiedAlertFeed
                  key="dashboard-prioritized-alerts"
                  leagueId={surface.leagueState?.leagueId ?? undefined}
                  surface="dashboard"
                  className="mb-1"
                  presentation="feed"
                />
              )
            }

            if (section === 'insights') {
              return insights.map((ins) => (
                <ChimmyInsightCard
                  key={ins.id}
                  title={ins.title}
                  summary={ins.summary}
                  tag={ins.tag}
                  severity={ins.severity}
                  confidencePct={ins.confidencePct}
                  onExpand={onOpenChat}
                />
              ))
            }

            if (section === 'recommendations') {
              return (
                <ChimmyPremiumGate
                  key="dashboard-recommendations"
                  requiredTier="premium"
                  featureLabel="AI Recommendations"
                  featureDescription="Actionable moves ranked by expected value. Upgrade to Pro to unlock."
                  onUpgrade={onOpenChat}
                >
                  {orderedRecommendations.map((rec) => (
                    <ChimmyRecommendationCard
                      key={rec.id}
                      action={rec.action}
                      rationale={rec.rationale}
                      priority={rec.priority}
                      actionType={rec.actionType}
                      confidencePct={rec.confidencePct}
                      onAction={rec.onAction}
                      actionLabel={rec.actionLabel}
                    />
                  ))}
                </ChimmyPremiumGate>
              )
            }

            // 'saved' renders nothing: saved recommendations were retired (2026-09-16).
            return null
          })}

          {showLearningSummary && <ChimmyAnalyticsSummaryPanel className="mt-1" />}
        </div>
      )}

      <ChimmyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Dashboard AI">
        <ChimmyMemoryAwareCues className="mb-3" />
        <ChimmyEmptyState
          title="Ask Chimmy"
          message="Ask about any of your leagues, teams, or players."
          prompts={onOpenChat ? [
            { label: 'Best waiver add?', onClick: () => { setDrawerOpen(false); onOpenChat() } },
            { label: 'Trade advice?', onClick: () => { setDrawerOpen(false); onOpenChat() } },
          ] : undefined}
        />
      </ChimmyDrawer>
    </ChimmySurfaceShell>
  )
}
