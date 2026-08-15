"use client"

import { useMemo, useState } from "react"
import { NotificationPanelView, type NotificationPanelState } from "@/components/notifications/NotificationPanel"
import AlertSettingsClient from "@/app/alerts/settings/AlertSettingsClient"
import type { PlatformNotification } from "@/types/platform-shared"
import { getNotificationReadEndpoint, NOTIFICATIONS_READ_ALL_ENDPOINT } from "@/lib/notification-center"

function buildSportsNotifications(): PlatformNotification[] {
  const createdAt = new Date().toISOString()
  return [
    {
      id: "sports-league-alert",
      type: "injury_alert",
      title: "League injury alert",
      body: "QB1 is out this week. Review your roster moves.",
      product: "app",
      severity: "high",
      read: false,
      createdAt,
      meta: {
        actionHref: "/leagues/league-alert-1",
        actionLabel: "Open league",
        leagueId: "league-alert-1",
        sport: "NFL",
      },
    },
    {
      id: "sports-player-alert",
      type: "performance_alert",
      title: "Player performance alert",
      body: "Player X posted a major performance.",
      product: "legacy",
      severity: "medium",
      read: false,
      createdAt,
      meta: {
        actionHref: "/af-legacy?tab=players&playerId=player-12",
        actionLabel: "Open player",
        playerId: "player-12",
        playerName: "Player X",
        sport: "NBA",
      },
    },
    {
      id: "sports-lineup-alert",
      type: "lineup_alert",
      title: "Lineup update",
      body: "Your starter was moved to questionable.",
      product: "app",
      severity: "medium",
      read: false,
      createdAt,
      meta: {
        actionHref: "/alerts/settings",
        actionLabel: "Manage alerts",
        leagueId: "league-alert-1",
        sport: "NHL",
      },
    },
  ]
}

export default function SportsAlertsHarnessClient() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>(() => buildSportsNotifications())
  const [dismissCount, setDismissCount] = useState(0)
  const [dismissAllCount, setDismissAllCount] = useState(0)

  const state = useMemo<NotificationPanelState>(
    () => ({
      notifications,
      loading: false,
      error: null,
      markAsRead: async (notificationId: string) => {
        setNotifications((prev) =>
          prev.map((item) => (item.id === notificationId ? { ...item, read: true } : item))
        )
        setDismissCount((prev) => prev + 1)
        await fetch(getNotificationReadEndpoint(notificationId), { method: "PATCH" })
      },
      markAllAsRead: async () => {
        setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
        setDismissAllCount((prev) => prev + 1)
        await fetch(NOTIFICATIONS_READ_ALL_ENDPOINT, { method: "PATCH" })
      },
      refresh: async () => {},
    }),
    [notifications]
  )

  return (
    <main className="min-h-screen bg-[#0b1020] p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <section className="space-y-3" data-testid="sports-alerts-harness-panel">
          <h1 className="text-xl font-semibold">Sports Alerts Click Audit Harness</h1>
          <p className="text-sm text-white/70">
            Verifies alert notification click routing, settings toggles, and dismissal behavior.
          </p>
          <NotificationPanelView state={state} showFooter={false} />
          <div className="flex items-center gap-4 text-xs text-white/70">
            <span data-testid="sports-alert-dismiss-count">Dismiss calls: {dismissCount}</span>
            <span data-testid="sports-alert-dismiss-all-count">Dismiss all calls: {dismissAllCount}</span>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-lg font-semibold">Alert settings</h2>
          <p className="mt-1 text-xs text-white/60">
            Uses the same settings component as production at <code>/alerts/settings</code>.
          </p>
          <AlertSettingsClient />
        </section>
      </div>
    </main>
  )
}
