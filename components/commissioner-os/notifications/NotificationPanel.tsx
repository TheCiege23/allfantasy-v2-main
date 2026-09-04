'use client'

import { useMemo, useState } from 'react'
import { Bell, Settings } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { useNotificationReadState } from './useNotificationReadState'
import { useNotificationPreferences } from './useNotificationPreferences'
import { NotificationRow } from './NotificationRow'
import { getModuleLabel, NOTIFICATION_SOURCE_ICONS } from './notificationLabels'
import type { CommissionerNotificationPayload } from '@/lib/commissioner-ui/contracts'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'

export interface NotificationPanelProps {
  notifications: CommissionerNotificationPayload[]
  /**
   * Set when `adapter.notifications.getNotifications()` itself failed
   * (e.g. live mode, not yet integrated) — added during the Phase 2
   * production-hardening audit. Before this, an empty `notifications` from
   * a real error and an empty list from a genuinely clear inbox were
   * indistinguishable, both silently showing "No notifications yet." —
   * the one inconsistency with every other module's honest ErrorState in
   * live mode.
   */
  errorMessage?: string | null
}

type FilterMode = 'all' | 'unread'

/**
 * Notification Center's panel — the same Dialog + `openServiceId`
 * mechanism Global Search's palette already established, mounted once in
 * the layout. Never a second copy of the underlying module data: every
 * row only ever shows `message` + `sourceModuleId` + an optional
 * `relatedLink`, and clicking through is how a commissioner actually acts
 * on one.
 */
export function NotificationPanel({ notifications, errorMessage }: NotificationPanelProps) {
  const { openServiceId, closeService } = useCommissionerPlatform()
  const { markRead, markAllRead, isRead } = useNotificationReadState()
  const { mutedModuleIds, toggleMuted, isMuted } = useNotificationPreferences()
  const [filter, setFilter] = useState<FilterMode>('all')
  const [showPreferences, setShowPreferences] = useState(false)
  const open = openServiceId === 'notifications'

  const sourceModuleIds = useMemo(() => {
    const ids = new Set<CommissionerModuleId>(notifications.map((n) => n.sourceModuleId))
    return Array.from(ids)
  }, [notifications])

  const visible = useMemo(() => {
    return notifications
      .filter((n) => !isMuted(n.sourceModuleId))
      .filter((n) => (filter === 'unread' ? !(n.read || isRead(n.id)) : true))
  }, [notifications, isMuted, filter, isRead])

  const grouped = useMemo(() => {
    const map = new Map<CommissionerModuleId, CommissionerNotificationPayload[]>()
    for (const notification of visible) {
      const list = map.get(notification.sourceModuleId) ?? []
      list.push(notification)
      map.set(notification.sourceModuleId, list)
    }
    return map
  }, [visible])

  const unreadIds = notifications.filter((n) => !n.read && !isRead(n.id)).map((n) => n.id)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeService()
      }}
    >
      <DialogContent className="max-w-lg gap-0 p-0" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <DialogTitle className="sr-only">Notifications</DialogTitle>
        <DialogDescription className="sr-only">
          Notifications from League Health, Recommendations, Automations, Reports, and other Commissioner OS modules.
        </DialogDescription>

        <div className="flex items-center justify-between border-b p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>
              All
            </Button>
            <Button size="sm" variant={filter === 'unread' ? 'secondary' : 'ghost'} onClick={() => setFilter('unread')}>
              Unread
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => markAllRead(unreadIds)} disabled={unreadIds.length === 0}>
              Mark all as read
            </Button>
            <button
              type="button"
              aria-label="Notification preferences"
              aria-pressed={showPreferences}
              onClick={() => setShowPreferences((prev) => !prev)}
              className="focus-ring rounded-[var(--radius-standard)] p-2"
              style={{ color: 'var(--muted)' }}
            >
              <Settings size={16} aria-hidden />
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div className="p-4">
            <ErrorState message={errorMessage} />
          </div>
        ) : showPreferences ? (
          <div className="max-h-[400px] overflow-y-auto p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
              Muted sources
            </h3>
            <ul className="space-y-1">
              {sourceModuleIds.map((moduleId) => {
                const Icon = NOTIFICATION_SOURCE_ICONS[moduleId]
                return (
                  <li key={moduleId} className="flex items-center justify-between rounded-[var(--radius-standard)] px-2 py-1.5 text-sm" style={{ color: 'var(--text)' }}>
                    <span className="flex items-center gap-2">
                      <Icon size={14} aria-hidden />
                      {getModuleLabel(moduleId)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => toggleMuted(moduleId)}>
                      {isMuted(moduleId) ? 'Unmute' : 'Mute'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={filter === 'unread' ? 'You’re all caught up.' : 'No notifications yet.'}
            description={filter === 'unread' ? 'No unread notifications right now.' : 'Notifications from across Commissioner OS will show up here.'}
          />
        ) : (
          <div className="max-h-[400px] overflow-y-auto p-3">
            <ul className="space-y-2">
              {Array.from(grouped.entries()).map(([moduleId, moduleNotifications]) => (
                <li key={moduleId}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                    {getModuleLabel(moduleId)}
                  </h3>
                  <ul className="space-y-2">
                    {moduleNotifications.map((notification) => (
                      <NotificationRow
                        key={notification.id}
                        notification={notification}
                        read={notification.read || isRead(notification.id)}
                        onMarkRead={markRead}
                        onNavigate={closeService}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
