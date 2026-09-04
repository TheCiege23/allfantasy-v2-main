import { Card, CardContent } from '@/components/ui/card'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import { getSeverityStyle, SEVERITY_LABELS } from './severityStyles'

export interface AlertCardProps {
  message: string
  severity: SeverityTier
  onClick?: () => void
}

/** Severity-coded, minimal, scannable — links to evidence, never explains itself in full (Design Language §4). */
export function AlertCard({ message, severity, onClick }: AlertCardProps) {
  const style = getSeverityStyle(severity)
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
          {message}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: style.text, borderColor: style.border, border: '1px solid' }}
        >
          {SEVERITY_LABELS[severity]}
        </span>
      </CardContent>
    </Card>
  )
}
