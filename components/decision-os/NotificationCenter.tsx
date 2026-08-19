'use client'
/**
 * Fantasy OS Suite — Phase OS-B4: Notification Engine Foundation.
 *
 * Purely presentational over an already-composed `DecisionOsNotification[]` (from
 * `composeNotificationFeed`, `lib/decision-os/notifications.ts`) — no fetch, no derivation of its own.
 * The one piece of real state this component owns is read/dismissed status, and it is DELIBERATELY
 * session-local (`useState`, lost on refresh) — the notification objects themselves carry no
 * read/dismissed fields (see `notifications.ts`'s own header comment for why), and this phase's own
 * instructions explicitly ask for session-local state, not database persistence.
 */
import { useMemo, useState } from 'react'
import { Bell, CheckCircle2, X } from 'lucide-react'
import type { DecisionOsNotification } from '@/lib/decision-os/notifications'
import { DecisionOsBadge, decisionOsCardClassName, SEVERITY_DOT_CLASS } from './DecisionOsCardPrimitives'

type NotificationCenterProps = {
  notifications: DecisionOsNotification[]
  leagueNameById: Map<string, string>
}

function formatTimestamp(timestamp: string): string | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationCenter({ notifications, leagueNameById }: NotificationCenterProps) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const visible = useMemo(
    () => notifications.filter((notification) => !dismissedIds.has(notification.id)),
    [notifications, dismissedIds],
  )
  const unreadCount = useMemo(
    () => visible.filter((notification) => !readIds.has(notification.id)).length,
    [visible, readIds],
  )

  const markRead = (id: string) => setReadIds((prev) => new Set(prev).add(id))
  const dismiss = (id: string) => setDismissedIds((prev) => new Set(prev).add(id))

  return (
    <div className={decisionOsCardClassName} data-testid="notification-center">
      <div className="flex items-center justify-between border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <DecisionOsBadge icon={Bell}>Notification Center</DecisionOsBadge>
        {unreadCount > 0 ? (
          <span
            className="inline-flex min-w-6 items-center justify-center rounded-full bg-brand-primary px-2 py-0.5 text-xs font-bold text-content-inverse"
            data-testid="notification-center-unread-count"
          >
            {unreadCount}
          </span>
        ) : null}
      </div>

      <div className="p-5">
        {visible.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted" data-testid="notification-center-empty">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
            You&apos;re all caught up.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="notification-center-list">
            {visible.map((notification) => {
              const isRead = readIds.has(notification.id)
              const formattedTimestamp = formatTimestamp(notification.createdAt)
              return (
                <li
                  key={notification.id}
                  data-testid={`notification-center-item-${notification.id}`}
                  data-severity={notification.severity}
                  className={`flex items-start gap-2 rounded-lg border border-subtle px-3 py-2 text-sm ${
                    isRead ? 'bg-surface-muted/50 opacity-70' : 'bg-surface'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[notification.severity]}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-primary">
                      {notification.leagueId
                        ? leagueNameById.get(notification.leagueId) ?? notification.leagueId
                        : 'All leagues'}
                    </p>
                    <p className="text-xs leading-5 text-secondary">{notification.body}</p>
                    {notification.recommendedAction ? (
                      <p className="mt-1 text-xs font-medium leading-5 text-primary">
                        {notification.recommendedAction}
                      </p>
                    ) : null}
                    {formattedTimestamp ? (
                      <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-muted">{formattedTimestamp}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!isRead ? (
                      <button
                        type="button"
                        onClick={() => markRead(notification.id)}
                        data-testid={`notification-center-mark-read-${notification.id}`}
                        className="focus-ring rounded-md px-2 py-1 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/10"
                      >
                        Mark read
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => dismiss(notification.id)}
                      data-testid={`notification-center-dismiss-${notification.id}`}
                      aria-label="Dismiss"
                      className="focus-ring rounded-md p-1 text-muted hover:bg-surface-muted"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
