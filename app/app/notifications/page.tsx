"use client"

import Link from "next/link"
import {
  Bell,
  Check,
  CheckCheck,
  MessageSquare,
  Megaphone,
  Handshake,
  Mail,
  AtSign,
  ArrowLeft,
} from "lucide-react"
import { EmptyStateRenderer, ErrorStateRenderer, LoadingStateRenderer } from "@/components/ui-states"
import { resolveNoResultsState, resolveRecoveryActions } from "@/lib/ui-state"
import { useNotifications } from "@/hooks/useNotifications"
import type { PlatformNotification } from "@/types/platform-shared"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import {
  getNotificationDestination,
  getUnreadCount,
  groupNotifications,
  NOTIFICATION_GROUP_LABELS,
  NOTIFICATION_GROUP_ORDER,
  type NotificationGroupKey,
} from "@/lib/notification-center"

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  mention: AtSign,
  trade_offer: Handshake,
  league_invite: Mail,
  announcement: Megaphone,
  chat_message: MessageSquare,
  trade: Handshake,
  notification: Bell,
}

function getIcon(type: string) {
  return TYPE_ICONS[type] ?? Bell
}

function toSafeTestId(raw: string) {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function formatTime(
  iso: string,
  formatTimeInTimezone: (date: Date | string | number) => string,
  formatDateInTimezone: (date: Date | string | number) => string
): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return formatTimeInTimezone(iso)
  if (diff < 172800000) return "Yesterday"
  return formatDateInTimezone(iso)
}

export default function NotificationsPage() {
  const { formatTimeInTimezone, formatDateInTimezone } = useUserTimezone()
  const { notifications, loading, error, markAsRead, markAllAsRead, refresh } = useNotifications(100, {
    usePlaceholders: false,
  })
  const groups = groupNotifications(notifications)
  const unreadCount = getUnreadCount(notifications)

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/core"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-black/5"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            Notifications
          </h1>
          <Link
            href="/app/notifications/compact"
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/35 px-2 py-1 text-[11px] font-medium text-cyan-300 transition-colors hover:bg-black/5"
          >
            Compact
          </Link>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllAsRead()}
            data-testid="notification-mark-all-read"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-black/5"
            style={{ borderColor: "var(--border)", color: "var(--accent-cyan-strong)" }}
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
        )}
      </header>

      <div
        className="rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        {loading ? (
          <div className="p-4">
            <LoadingStateRenderer compact label="Loading notifications..." testId="notifications-loading-state" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorStateRenderer
              compact
              title="Unable to load notifications"
              message={error}
              onRetry={() => void refresh()}
              actions={resolveRecoveryActions("notifications").map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
              testId="notifications-error-state"
            />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-4">
            <EmptyStateRenderer
              compact
              title={resolveNoResultsState({ context: "notifications" }).title}
              description={resolveNoResultsState({ context: "notifications" }).description}
              actions={resolveNoResultsState({ context: "notifications" }).actions.map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
              testId="notifications-empty-state"
            />
          </div>
        ) : (
          <>
            {NOTIFICATION_GROUP_ORDER.map((key: NotificationGroupKey) => {
              const items = groups[key]
              if (items.length === 0) return null
              const label = NOTIFICATION_GROUP_LABELS[key]
              return (
                <div key={key} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <div
                    className="sticky top-0 z-10 px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: "var(--panel)", color: "var(--muted)" }}
                  >
                    {label}
                  </div>
                  <ul>
                    {items.map((n) => {
                      const Icon = getIcon(n.type)
                      const destination = getNotificationDestination(n)
                      const safeId = toSafeTestId(n.id)
                      const rowClassName = "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-black/5"
                      const rowStyle = {
                        background: n.read ? "transparent" : "color-mix(in srgb, var(--accent-cyan-strong) 8%, transparent)",
                      }
                      const inner = (
                        <>
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{
                              background: "var(--panel2)",
                              border: "1px solid var(--border)",
                              color: "var(--muted2)",
                            }}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                              {n.title}
                            </p>
                            {n.body && (
                              <p className="mt-0.5 text-xs" style={{ color: "var(--muted2)" }}>
                                {n.body}
                              </p>
                            )}
                            <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                              {formatTime(n.createdAt, formatTimeInTimezone, formatDateInTimezone)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              {!n.read ? (
                                <button
                                  type="button"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    void markAsRead(n.id)
                                  }}
                                  data-testid={`notification-dismiss-${safeId}`}
                                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium"
                                  style={{ color: "var(--accent-cyan-strong)" }}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Mark read
                                </button>
                              ) : null}
                              {destination ? (
                                <span
                                  className="inline-flex items-center gap-1 text-xs font-medium"
                                  style={{ color: "var(--accent-cyan-strong)" }}
                                >
                                  {destination.label === "Open chat" ? (
                                    <MessageSquare className="h-3.5 w-3.5" />
                                  ) : null}
                                  {destination.label}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </>
                      )
                      return (
                        <li key={n.id} data-testid={`notification-item-${safeId}`}>
                          {destination ? (
                            <Link
                              href={destination.href}
                              className={rowClassName}
                              style={rowStyle}
                              data-testid={`notification-link-${safeId}`}
                            >
                              {inner}
                            </Link>
                          ) : (
                            <div className={rowClassName} style={rowStyle}>
                              {inner}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </>
        )}
      </div>
    </main>
  )
}
