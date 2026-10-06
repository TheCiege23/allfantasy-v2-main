'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import { getSeverityStyle, SEVERITY_LABELS } from './severityStyles'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { severityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'

export interface SummaryCardProps {
  title: string
  status: SeverityTier
  summary: string
  icon?: LucideIcon
  onClick?: () => void
}

/**
 * Rolls one pillar/module up into one glanceable card, used on Mission Control per module (Design Language §4).
 * The severity badge is the card's own word and follows the language; `title` and `summary` are the caller's.
 */
export function SummaryCard({ title, status, summary, icon: Icon, onClick }: SummaryCardProps) {
  const style = getSeverityStyle(status)
  const { language } = useOptionalLanguage()
  return (
    <Card
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={onClick ? 'focus-ring cursor-pointer hover:opacity-90 transition-premium' : undefined}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {Icon && <Icon size={16} aria-hidden style={{ color: 'var(--muted)' }} />}
            {title}
          </CardTitle>
          <span className="text-xs font-semibold" style={{ color: style.text }}>
            {severityLabelText(status, SEVERITY_LABELS[status], language)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {summary}
        </p>
      </CardContent>
    </Card>
  )
}
