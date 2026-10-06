import NextLink from 'next/link'
import { User, Cpu } from 'lucide-react'
import { getActivitySeverityStyle, ACTIVITY_SEVERITY_LABELS, getModuleLabel, ACTIVITY_SOURCE_ICONS } from './activityLabels'
import { formatRelativeTime } from '@/lib/commissioner-ui/utils/time'
import type { CommissionerActivityEventContract } from '@/lib/commissioner-ui/contracts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  composedEventText,
  eventSeverityText,
  relativeTimeText,
  sectionNameText,
  toolsText,
  viewInText,
} from '@/lib/commissioner-os/i18n/toolsCopy'

export interface ActivityEventRowProps {
  event: CommissionerActivityEventContract
  isLast: boolean
}

/**
 * One entry in the chronological record — a summary, its source, who or
 * what triggered it, and a link back to the module that owns the real
 * detail. Never a second copy of that module's own data (Decision
 * Ownership Matrix) — this row only ever renders the five fields
 * `CommissionerActivityEventContract` already carries.
 */
export function ActivityEventRow({ event, isLast }: ActivityEventRowProps) {
  const Icon = ACTIVITY_SOURCE_ICONS[event.sourceModuleId]
  const InitiatorIcon = event.initiator === 'human' ? User : Cpu
  const severityStyle = getActivitySeverityStyle(event.severity)
  const { language } = useOptionalLanguage()
  const t = (english: string) => toolsText(english, language)
  const sourceLabel = sectionNameText(event.sourceModuleId, getModuleLabel(event.sourceModuleId), language)

  return (
    <li className="relative flex gap-3 pb-6">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[7px] top-4 h-full w-px"
          style={{ background: 'var(--border)' }}
        />
      )}
      <div
        aria-hidden
        className="z-10 mt-1 h-4 w-4 flex-shrink-0 rounded-full border-2"
        style={{ background: severityStyle.bg, borderColor: severityStyle.border }}
      />
      <div className="flex-1 space-y-1 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ background: severityStyle.bg, color: severityStyle.text, border: `1px solid ${severityStyle.border}` }}
          >
            {eventSeverityText(event.severity, ACTIVITY_SEVERITY_LABELS[event.severity], language)}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted2)' }}>
            <Icon size={12} aria-hidden />
            {sourceLabel}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted2)' }} title={t(event.initiator === 'human' ? 'Initiated by a person' : 'Initiated automatically')}>
            <InitiatorIcon size={12} aria-hidden />
            {t(event.initiator === 'human' ? 'Human' : 'System')}
          </span>
          <time className="text-xs" dateTime={event.timestamp} style={{ color: 'var(--muted2)' }}>
            {relativeTimeText(formatRelativeTime(event.timestamp), language)}
          </time>
        </div>
        <p className="text-sm" style={{ color: 'var(--text)' }}>
          {composedEventText(event.summary, language)}
        </p>
        {event.evidenceHref && (
          <NextLink href={event.evidenceHref} className="focus-ring link-themed text-xs">
            {viewInText(sourceLabel, language)}
          </NextLink>
        )}
      </div>
    </li>
  )
}
