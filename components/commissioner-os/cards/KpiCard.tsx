import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import { getSeverityStyle } from './severityStyles'

export interface KpiCardTrend {
  direction: 'up' | 'down' | 'flat'
  label: string
}

export interface KpiCardProps {
  label: string
  value: string
  size?: 'large' | 'small'
  severity?: SeverityTier
  trend?: KpiCardTrend
  icon?: LucideIcon
  onClick?: () => void
}

const TREND_ICONS = { up: ArrowUp, down: ArrowDown, flat: Minus }

/**
 * Large variant: the page's hero metric, used sparingly (1-2 per screen).
 * Small variant: used in a row of several, per Design Language §4.
 */
export function KpiCard({ label, value, size = 'small', severity, trend, icon: Icon, onClick }: KpiCardProps) {
  const style = severity ? getSeverityStyle(severity) : null
  const TrendIcon = trend ? TREND_ICONS[trend.direction] : null

  return (
    <Card
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={onClick ? 'focus-ring cursor-pointer hover:opacity-90 transition-premium' : undefined}
      style={{ borderColor: style?.border }}
    >
      <CardContent className={size === 'large' ? 'pt-4' : 'pt-2'}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {label}
          </span>
          {Icon && <Icon size={16} aria-hidden style={{ color: 'var(--muted2)' }} />}
        </div>
        <div
          className="text-metric font-bold"
          style={{
            color: style?.text ?? 'var(--text)',
            fontSize: size === 'large' ? 'var(--text-display)' : 'var(--text-header)',
          }}
        >
          {value}
        </div>
        {trend && TrendIcon && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted2)' }}>
            <TrendIcon size={12} aria-hidden />
            <span>{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
