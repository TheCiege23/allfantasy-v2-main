"use client"

import { useEffect, useMemo, useState } from "react"
import { NotificationPanelView, type NotificationPanelState } from "@/components/notifications/NotificationPanel"
import { NotificationCategoryRenderer } from "@/components/notification-settings/NotificationCategoryRenderer"
import type { PlatformNotification } from "@/types/platform-shared"

function buildDraftNotifications(): PlatformNotification[] {
  const createdAt = new Date().toISOString()
  return [
    {
      id: "draft-on-clock",
      type: "draft_on_the_clock",
      title: "You're on the clock - Harness League",
      body: "Pick 2.04. Make your selection.",
      product: "app",
      read: false,
      createdAt,
      meta: {
        leagueId: "harness-league",
      },
    },
    {
      id: "draft-slow-reminder",
      type: "draft_slow_reminder",
      title: "Slow draft reminder - Harness League",
      body: "Your pick is due in about 12 minutes.",
      product: "app",
      read: false,
      createdAt,
      meta: {
        leagueId: "harness-league",
      },
    },
  ]
}

export default function DraftNotificationsHarnessClient() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>(() => buildDraftNotifications())
  const [hydrated, setHydrated] = useState(false)
  const [prefs, setPrefs] = useState({
    enabled: true,
    inApp: true,
    email: true,
    sms: true,
  })

  const panelState = useMemo<NotificationPanelState>(
    () => ({
      notifications,
      loading: false,
      error: null,
      markAsRead: async (notificationId: string) => {
        setNotifications((prev) =>
          prev.map((item) => (item.id === notificationId ? { ...item, read: true } : item))
        )
      },
      markAllAsRead: async () => {
        setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
      },
      refresh: async () => {},
    }),
    [notifications]
  )

  useEffect(() => {
    setHydrated(true)
    ;(globalThis as any).__draftNotifHarnessMarkOnClockRead = () => {
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === "draft-on-clock"
            ? { ...item, read: true }
            : item
        )
      )
    }
    return () => {
      delete (globalThis as any).__draftNotifHarnessMarkOnClockRead
    }
  }, [])

  return (
    <main className="min-h-screen bg-[#0b1020] p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-xl font-semibold">Draft Notifications Harness</h1>
        <p className="text-sm text-white/70">
          Validates deterministic draft notification links, read/unread transitions, and disabled channel rendering.
        </p>
        <p className="text-[11px] text-white/60" data-testid="harness-hydrated">
          {hydrated ? "hydrated" : "loading"}
        </p>

        <NotificationPanelView state={panelState} showFooter={false} />
        <p className="text-xs text-white/70" data-testid="harness-unread-count">
          Unread: {notifications.filter((item) => !item.read).length}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="harness-mark-on-clock-read"
            className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white"
            onClick={() =>
              setNotifications((prev) =>
                prev.map((item) =>
                  item.id === "draft-on-clock"
                    ? { ...item, read: true }
                    : item
                )
              )
            }
          >
            Mark on-clock notification read
          </button>
        </div>

        <section className="rounded-xl border border-white/15 bg-[#111a2f] p-4">
          <h2 className="text-sm font-semibold text-white">Draft alerts channel settings preview</h2>
          <p className="mt-1 text-xs text-white/70">
            Email and SMS are intentionally unavailable to validate that dead channel actions are hidden.
          </p>
          <div className="mt-3">
            <NotificationCategoryRenderer
              categoryId="draft_alerts"
              prefs={prefs}
              deliveryAvailability={{ inApp: true, email: false, sms: false }}
              expanded
              onToggleExpand={() => {}}
              onToggleEnabled={(enabled) => setPrefs((prev) => ({ ...prev, enabled }))}
              onToggleChannel={(channel, value) => setPrefs((prev) => ({ ...prev, [channel]: value }))}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
