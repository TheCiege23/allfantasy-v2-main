'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAISurface } from '../AISurfaceContext'
import ChimmySurfaceShell from '../ChimmySurfaceShell'
import ChimmyInsightCard from '../ChimmyInsightCard'
import ChimmyStoryCard from '../ChimmyStoryCard'
import ChimmyAlertBanner from '../ChimmyAlertBanner'
import ChimmyThinkingState from '../ChimmyThinkingState'
import ChimmyEmptyState from '../ChimmyEmptyState'
import ChimmyErrorState from '../ChimmyErrorState'
import ChimmyRightRailPanel from '../ChimmyRightRailPanel'
import ChimmyModalDeepDive from '../ChimmyModalDeepDive'
import ChimmyLauncherButton from '../ChimmyLauncherButton'
import ChimmySurfaceActionFeed from '../ChimmySurfaceActionFeed'
import ChimmyUnifiedAlertFeed from '../ChimmyUnifiedAlertFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'
import { mapAlertPreferenceToSensitivity, shouldShowStoryContent } from '@/lib/chimmy-personalization'
import { useChimmyPersonalization } from '@/lib/chimmy-personalization/useChimmyPersonalization'

export interface LeagueHomeAISurfaceProps {
  leagueName?: string
  currentWeek?: number
  insights?: Array<{ id: string; title: string; summary: string; severity?: 'info' | 'warning' | 'success' | 'critical'; tag?: string }>
  story?: { period: string; headline: string; body: string; highlights?: Array<{ label: string; value: string }> }
  alerts?: Array<{ id: string; message: string; severity?: 'info' | 'warning' }>
  isLoading?: boolean
  error?: string
  onRetry?: () => void
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
}

export default function LeagueHomeAISurface({
  leagueName,
  currentWeek,
  insights = [],
  story,
  alerts = [],
  isLoading = false,
  error,
  onRetry,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
}: LeagueHomeAISurfaceProps) {
  const surface = useAISurface()
  const { profile } = useChimmyPersonalization()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  const [deepDiveOpen, setDeepDiveOpen] = useState(false)
  const [selectedInsight, setSelectedInsight] = useState<{ title: string; summary: string } | null>(null)

  const allowStoryContent = useMemo(() => {
    if (!profile) return true
    return shouldShowStoryContent(profile)
  }, [profile])

  const alertSensitivity = useMemo<'low' | 'normal' | 'high'>(() => {
    if (!profile) return 'normal'
    return mapAlertPreferenceToSensitivity(profile.effective.alertPreference)
  }, [profile])

  const trackPersonalizationEvent = useCallback(async (type: 'story_opened' | 'story_hidden', metadata?: Record<string, unknown>) => {
    try {
      await fetch('/api/user/chimmy-personalization/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, metadata }),
      })
    } catch {
      // Non-blocking analytics event.
    }
  }, [])

  useEffect(() => {
    if (!story || allowStoryContent) return
    void trackPersonalizationEvent('story_hidden', {
      surface: 'league_home',
      period: story.period,
      leagueId: surface.leagueState?.leagueId,
    })
  }, [allowStoryContent, story, surface.leagueState?.leagueId, trackPersonalizationEvent])

  const railContent = (
    <div className="space-y-3">
      {insights.slice(0, 3).map((ins) => (
        <ChimmyInsightCard
          key={ins.id}
          title={ins.title}
          summary={ins.summary}
          severity={ins.severity}
          tag={ins.tag}
          onExpand={() => { setSelectedInsight(ins); setDeepDiveOpen(true) }}
        />
      ))}
      {onOpenChat && (
        <ChimmyLauncherButton label="Ask about this league" onClick={onOpenChat} className="w-full justify-center" />
      )}
    </div>
  )

  return (
    <ChimmySurfaceShell withRightRail={insights.length > 0} rightRail={<ChimmyRightRailPanel title={leagueName ?? 'League AI'}>{railContent}</ChimmyRightRailPanel>} className={className}>
      <ChimmyUnifiedAlertFeed
        leagueId={surface.leagueState?.leagueId ?? undefined}
        surface="league_home"
        className="mb-3"
        presentation="inline_banner"
        userPreferences={{ sensitivity: alertSensitivity }}
      />

      <ChimmyUnifiedAlertFeed
        leagueId={surface.leagueState?.leagueId ?? undefined}
        surface="league_home"
        className="mb-3"
        presentation="feed"
        userPreferences={{ sensitivity: alertSensitivity }}
      />

      {actionFeed && actionFeed.length > 0 && (
        <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {alerts.map((a) => (
            <ChimmyAlertBanner key={a.id} variant={a.severity} message={a.message} />
          ))}
        </div>
      )}

      {isLoading && <ChimmyThinkingState message="Loading league insights…" />}
      {error && !isLoading && <ChimmyErrorState message={error} onRetry={onRetry} />}

      {!isLoading && !error && story && allowStoryContent && (
        <ChimmyStoryCard
          period={story.period}
          headline={story.headline}
          body={story.body}
          highlights={story.highlights}
          storyType="league"
          onDeepDive={() => {
            void trackPersonalizationEvent('story_opened', {
              surface: 'league_home',
              period: story.period,
              leagueId: surface.leagueState?.leagueId,
            })
            setSelectedInsight({ title: story.headline, summary: story.body })
            setDeepDiveOpen(true)
          }}
        />
      )}

      {!isLoading && !error && insights.length === 0 && !story && (
        <ChimmyEmptyState title="League insights loading" message="Chimmy is analyzing your league. Check back soon." />
      )}

      <ChimmyModalDeepDive
        open={deepDiveOpen}
        onClose={() => setDeepDiveOpen(false)}
        title={selectedInsight?.title ?? 'Deep Dive'}
        subtitle={leagueName ? `${leagueName}${currentWeek ? ` · Week ${currentWeek}` : ''}` : undefined}
      >
        <p className="text-sm text-white/70 leading-relaxed">{selectedInsight?.summary}</p>
      </ChimmyModalDeepDive>
    </ChimmySurfaceShell>
  )
}
