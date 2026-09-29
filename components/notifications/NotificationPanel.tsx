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
  AlertCircle,
  Clock,
  Pause,
  Play,
} from "lucide-react"
import { useNotifications } from "@/hooks/useNotifications"
import type { PlatformNotification } from "@/types/platform-shared"
import {
  groupNotifications,
  getUnreadCount,
  NOTIFICATION_GROUP_ORDER,
  NOTIFICATION_GROUP_LABELS,
  getNotificationDestination,
} from "@/lib/notification-center"
import type { NotificationGroupKey } from "@/lib/notification-center"
import { EmptyStateRenderer, ErrorStateRenderer, LoadingStateRenderer } from "@/components/ui-states"
import { resolveNoResultsState } from "@/lib/ui-state"

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  mention: AtSign,
  trade_offer: Handshake,
  league_invite: Mail,
  announcement: Megaphone,
  chat_message: MessageSquare,
  trade: Handshake,
  notification: Bell,
  daily_digest: Bell,
  league_reminder: Bell,
  ai_insight: Bell,
  weekly_recap: Bell,
  injury_alert: AlertCircle,
  performance_alert: Bell,
  lineup_alert: MessageSquare,
  draft_on_the_clock: Clock,
  draft_approaching_timeout: Clock,
  draft_auto_pick_fired: Bell,
  draft_queue_player_unavailable: AlertCircle,
  draft_paused: Pause,
  draft_resumed: Play,
  draft_trade_offer_received: Handshake,
  draft_ai_trade_review_available: Bell,
  draft_orphan_ai_assigned: Bell,
  draft_auction_outbid: Bell,
  draft_slow_reminder: Bell,
  draft_starting_soon: Bell,
  draft_intel_queue_ready: Bell,
  draft_intel_player_taken: AlertCircle,
  draft_intel_on_clock_urgent: Clock,
  draft_intel_pick_confirmation: Check,
  draft_intel_tier_break: AlertCircle,
  draft_intel_orphan_team_pick: Bell,
  draft_intel_post_draft_recap: Bell,
}

function getIcon(type: string) {
  return TYPE_ICONS[type] ?? Bell
}

function toSafeTestId(raw: string) {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (diff < 172800000) return "Yesterday"
  return d.toLocaleDateString()
}

export interface NotificationPanelState {
  notifications: PlatformNotification[]
  loading: boolean
  error: string | null
  markAsRead: (notificationId: string) => Promise<void> | void
  markAllAsRead: () => Promise<void> | void
  refresh: () => Promise<void> | void
}

export interface NotificationPanelViewProps {
  state: NotificationPanelState
  onClose?: () => void
  showFooter?: boolean
}

export function NotificationPanelView({
  state,
  onClose,
  showFooter = true,
}: NotificationPanelViewProps) {
  const { notifications, loading, error, markAsRead, markAllAsRead, refresh } = state
  const groups = groupNotifications(notifications)
  const unreadCount = getUnreadCount(notifications)

  return (
    <div
      className="flex w-[min(380px,calc(100vw-1rem))] flex-col rounded-xl border shadow-lg"
      style={{
        borderColor: "var(--border)",
        background: "var(--panel)",
      }}
      data-testid="notification-drawer-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Notifications
        </h2>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllAsRead()}
            data-testid="notification-mark-all-read"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--accent-cyan-strong)" }}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        )}
      </header>

      <div className="max-h-[min(70vh,420px)] overflow-y-auto">
        {loading ? (
          <div className="p-3">
            <LoadingStateRenderer compact label="Loading notifications..." />
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorStateRenderer
              compact
              title="Unable to load notifications"
              message={error}
              onRetry={() => void refresh()}
            />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-3">
            <EmptyStateRenderer
              compact
              title={resolveNoResultsState({ context: "notifications" }).title}
              description={resolveNoResultsState({ context: "notifications" }).description}
              actions={resolveNoResultsState({ context: "notifications" }).actions.map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
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
                    className="sticky top-0 z-10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ background: "var(--panel)", color: "var(--muted)" }}
                  >
                    {label}
                  </div>
                  <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {items.map((n) => {
                      const Icon = getIcon(n.type)
                      const dest = getNotificationDestination(n)
                      const safeId = toSafeTestId(n.id)
                      const rowClassName = "group flex items-start gap-2 px-3 py-2 transition-colors hover:bg-black/5"
                      const rowStyle = {
                        background: n.read ? "transparent" : "color-mix(in srgb, var(--accent-cyan-strong) 8%, transparent)",
                      }
                      const inner = (
                        <>
                            <div
                              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                              style={{
                                background: "var(--panel2)",
                                border: "1px solid var(--border)",
                                color: "var(--muted2)",
                              }}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-medium" style={{ color: "var(--text)" }}>
                                {n.title}
                              </p>
                              {n.body && (
                                <p className="mt-0.5 line-clamp-2 text-[11px]" style={{ color: "var(--muted2)" }}>
                                  {n.body}
                                </p>
                              )}
                              <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                                {formatTime(n.createdAt)}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                {!n.read && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                    }}
                                    onPointerDown={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                    }}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      markAsRead(n.id)
                                    }}
                                    data-testid={`notification-dismiss-${safeId}`}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                                    style={{ color: "var(--accent-cyan-strong)" }}
                                  >
                                    <Check className="h-3 w-3" />
                                    Mark read
                                  </button>
                                )}
                                {dest ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--accent-cyan-strong)" }}>
                                    {dest.label === "Open chat" && <MessageSquare className="h-3 w-3" />}
                                    {dest.label}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                        </>
                      )
                      return (
                        <li key={n.id} data-testid={`notification-item-${safeId}`}>
                          {dest ? (
                            <Link
                              href={dest.href}
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

      {showFooter ? (
        <footer className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <Link
            href="/app/notifications"
            className="block text-center text-[11px] font-medium"
            style={{ color: "var(--accent-cyan-strong)" }}
          >
            See all notifications
          </Link>
        </footer>
      ) : null}
    </div>
  )
}

export default function NotificationPanel({ onClose }: { onClose?: () => void }) {
  const state = useNotifications(40, { usePlaceholders: false })
  return <NotificationPanelView state={state} onClose={onClose} />
}
