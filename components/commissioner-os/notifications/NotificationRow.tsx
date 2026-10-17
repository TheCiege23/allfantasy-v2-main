import NextLink from 'next/link'
import { NOTIFICATION_SEVERITY_LABELS, NOTIFICATION_SOURCE_ICONS, getModuleLabel, getNotificationSeverityStyle } from './notificationLabels'
import { formatRelativeTime } from '@/lib/commissioner-ui/utils/time'
import type { CommissionerNotificationPayload } from '@/lib/commissioner-ui/contracts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  composedEventText,
  eventSeverityText,
  relatedLinkText,
  relativeTimeText,
  toolsText,
} from '@/lib/commissioner-os/i18n/toolsCopy'
import { moduleLabelText } from '@/lib/commissioner-os/i18n/shellCopy'

export interface NotificationRowProps {
  notification: CommissionerNotificationPayload
  read: boolean
  onMarkRead: (id: string) => void
  onNavigate: () => void
}

export function NotificationRow({ notification, read, onMarkRead, onNavigate }: NotificationRowProps) {
  const Icon = NOTIFICATION_SOURCE_ICONS[notification.sourceModuleId]
  const severityStyle = getNotificationSeverityStyle(notification.severity)
  const { language } = useOptionalLanguage()

  return (
    <li
      className="flex gap-3 rounded-[var(--radius-standard)] border p-3"
      style={{
        background: read ? 'var(--panel)' : 'var(--panel2)',
        borderColor: 'var(--border)',
      }}
    >
      <div
        aria-hidden
        className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: read ? 'transparent' : 'var(--accent)' }}
      />
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ background: severityStyle.bg, color: severityStyle.text, border: `1px solid ${severityStyle.border}` }}
          >
            {eventSeverityText(notification.severity, NOTIFICATION_SEVERITY_LABELS[notification.severity], language)}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted2)' }}>
            <Icon size={12} aria-hidden />
            {moduleLabelText(notification.sourceModuleId, getModuleLabel(notification.sourceModuleId), language)}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted2)' }}>
            {relativeTimeText(formatRelativeTime(notification.createdAt), language)}
          </span>
        </div>
        <p className="text-sm" style={{ color: 'var(--text)' }}>
          {composedEventText(notification.message, language)}
        </p>
        <div className="flex items-center gap-3">
          {notification.relatedLink && (
            <NextLink
              href={notification.relatedLink.href}
              onClick={() => {
                onMarkRead(notification.id)
                onNavigate()
              }}
              className="focus-ring link-themed text-xs"
            >
              {relatedLinkText(notification.relatedLink.label, language)}
            </NextLink>
          )}
          {!read && (
            <button
              type="button"
              onClick={() => onMarkRead(notification.id)}
              className="focus-ring text-xs"
              style={{ color: 'var(--muted)' }}
            >
              {toolsText('Mark as read', language)}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
