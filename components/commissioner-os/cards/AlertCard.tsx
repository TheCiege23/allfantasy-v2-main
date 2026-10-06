'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import { getSeverityStyle, SEVERITY_LABELS } from './severityStyles'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cosLoaderText, severityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'

export interface AlertCardProps {
  message: string
  severity: SeverityTier
  onClick?: () => void
}

/**
 * Severity-coded, minimal, scannable — links to evidence, never explains itself in full (Design Language §4).
 *
 * Spanish: an alert is health-engine / attention text the server wrote in English, translated here at
 * render (`cosLoaderText`, which falls back to `commissionerOsText`); unknown text passes through.
 */
export function AlertCard({ message, severity, onClick }: AlertCardProps) {
  const style = getSeverityStyle(severity)
  const { language } = useOptionalLanguage()
  return (
    <Card
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={onClick ? 'focus-ring cursor-pointer' : undefined}
      style={{ background: style.bg, borderColor: style.border }}
    >
      <CardContent className="flex items-center justify-between gap-2 pt-0">
        <span className="text-sm" style={{ color: style.text }}>
          {cosLoaderText(message, language)}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: style.text, borderColor: style.border, border: '1px solid' }}
        >
          {severityLabelText(severity, SEVERITY_LABELS[severity], language)}
        </span>
      </CardContent>
    </Card>
  )
}
