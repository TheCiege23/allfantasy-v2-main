'use client'

import React from 'react'
import { useAISurface } from '../AISurfaceContext'
import ChimmySurfaceShell from '../ChimmySurfaceShell'
import ChimmyCommissionerCard from '../ChimmyCommissionerCard'
import ChimmyAlertBanner from '../ChimmyAlertBanner'
import ChimmyThinkingState from '../ChimmyThinkingState'
import ChimmyEmptyState from '../ChimmyEmptyState'
import ChimmyRoleGate from '../ChimmyRoleGate'
import ChimmyLauncherButton from '../ChimmyLauncherButton'
import ChimmySurfaceActionFeed from '../ChimmySurfaceActionFeed'
import ChimmyUnifiedAlertFeed from '../ChimmyUnifiedAlertFeed'
import type { ChimmyFeedRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { buildActionContext } from '@/lib/chimmy-actions'

export interface CommissionerAlert {
  id: string
  title: string
  body: string
  area?: 'health' | 'activity' | 'trade' | 'parity' | 'general'
  suggestedAction?: string
  onTakeAction?: () => void
}

export interface CommissionerAISurfaceProps {
  alerts?: CommissionerAlert[]
  banners?: Array<{ id: string; message: string; severity?: 'warning' | 'info' }>
  isLoading?: boolean
  onOpenChat?: () => void
  className?: string
  actionFeed?: ChimmyFeedRecommendation[]
  actionContext?: AIActionContext
}

export default function CommissionerAISurface({
  alerts = [],
  banners = [],
  isLoading = false,
  onOpenChat,
  className = '',
  actionFeed,
  actionContext,
}: CommissionerAISurfaceProps) {
  const surface = useAISurface()
  const resolvedActionContext = actionContext ?? buildActionContext(surface)
  return (
    <ChimmyRoleGate allowedRoles={['commissioner', 'admin']}>
      <ChimmySurfaceShell className={className}>
        <ChimmyUnifiedAlertFeed
          leagueId={surface.leagueState?.leagueId ?? undefined}
          surface="commissioner_panel"
          className="mb-3"
          presentation="inline_banner"
        />

        <ChimmyUnifiedAlertFeed
          leagueId={surface.leagueState?.leagueId ?? undefined}
          surface="commissioner_panel"
          className="mb-3"
          presentation="feed"
        />

        {actionFeed && actionFeed.length > 0 && (
          <ChimmySurfaceActionFeed recommendations={actionFeed} context={resolvedActionContext} className="mb-4" />
        )}

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Commissioner AI</h3>
          {onOpenChat && <ChimmyLauncherButton label="Commissioner Tools" onClick={onOpenChat} />}
        </div>

        {banners.map((b) => (
          <ChimmyAlertBanner key={b.id} variant={b.severity} message={b.message} className="mb-2" />
        ))}

        {isLoading && <ChimmyThinkingState message="Monitoring league health…" />}

        {!isLoading && alerts.length === 0 && (
          <ChimmyEmptyState
            title="League looks healthy"
            message="Chimmy will surface commissioner alerts, parity concerns, and activity drops."
            prompts={onOpenChat ? [{ label: 'League health report?', onClick: onOpenChat }] : undefined}
          />
        )}

        {!isLoading && alerts.map((a) => (
          <ChimmyCommissionerCard
            key={a.id}
            title={a.title}
            body={a.body}
            area={a.area}
            suggestedAction={a.suggestedAction}
            onTakeAction={a.onTakeAction}
            className="mb-2"
          />
        ))}
      </ChimmySurfaceShell>
    </ChimmyRoleGate>
  )
}
