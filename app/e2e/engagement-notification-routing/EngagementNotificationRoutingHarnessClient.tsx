'use client'

import { useMemo } from 'react'
import { NotificationPanelView } from '@/components/notifications/NotificationPanel'
import type { PlatformNotification } from '@/types/platform-shared'
import type { NotificationPanelState } from '@/components/notifications/NotificationPanel'

function buildHarnessNotifications(nowIso: string): PlatformNotification[] {
  return [
    {
      id: 'engagement-harness-daily',
      type: 'daily_digest',
      title: 'Daily digest ready',
      body: 'Harness: digest links route through NotificationRouteResolver.',
      product: 'app',
      read: false,
      createdAt: nowIso,
      meta: { actionHref: '/trade-analyzer', actionLabel: 'Open digest' },
    },
    {
      id: 'engagement-harness-league',
      type: 'league_reminder',
      title: 'League lineup reminder',
      body: 'Harness: leagueId-only meta resolves to /league/{id}.',
      product: 'app',
      read: false,
      createdAt: nowIso,
      meta: { leagueId: 'league-123' },
    },
    {
      id: 'engagement-harness-ai',
      type: 'ai_insight',
      title: 'AI insight unlocked',
      body: 'Harness: Chimmy deep link.',
      product: 'app',
      read: false,
      createdAt: nowIso,
      meta: { actionHref: '/chimmy', actionLabel: 'Open Chimmy' },
    },
    {
      id: 'engagement-harness-weekly',
      type: 'weekly_recap',
      title: 'Weekly recap summary',
      body: 'Harness: tools hub deep link.',
      product: 'app',
      read: false,
      createdAt: nowIso,
      meta: { actionHref: '/tools-hub', actionLabel: 'Open recap' },
    },
    {
      id: 'engagement-harness-blocked',
      type: 'notification',
      title: 'Unsafe link blocked',
      body: 'Harness: external actionHref falls back to dashboard.',
      product: 'app',
      read: false,
      createdAt: nowIso,
      meta: { actionHref: 'https://evil.example/phish', actionLabel: 'Blocked' },
    },
  ]
}

export default function EngagementNotificationRoutingHarnessClient() {
  const state: NotificationPanelState = useMemo(() => {
    const nowIso = new Date().toISOString()
    return {
      notifications: buildHarnessNotifications(nowIso),
      loading: false,
      error: null,
      markAsRead: () => {},
      markAllAsRead: () => {},
      refresh: () => {},
    }
  }, [])

  return (
    <main
      className="min-h-screen bg-[#060b18] p-6 text-white"
      data-testid="engagement-notification-routing-harness"
    >
      <h1 className="mb-4 text-xl font-semibold">Engagement Notification Routing Harness</h1>
      <p className="mb-4 max-w-2xl text-sm text-white/65">
        E2E harness for retention routing: engagement notification types, deep links, and blocked external URLs.
      </p>
      <div className="max-w-md">
        <NotificationPanelView state={state} showFooter={false} />
      </div>
    </main>
  )
}
