import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'

interface StatusCardProps {
  label: string
  statusText: string
  icon?: LucideIcon
  onClick?: () => void
}

/**
 * Workflow state, never severity-colored — the neutral family from the
 * Status Language split (Design Language §14). Used for things like
 * automation and sync status, distinct from AlertCard's severity coding.
 */
export function StatusCard({ label, statusText, icon: Icon, onClick }: StatusCardProps) {
  return (
    <Card
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={onClick ? 'focus-ring cursor-pointer hover:opacity-90 transition-premium' : undefined}
    >
      <CardContent className="flex items-center gap-3 pt-0">
        {Icon && <Icon size={18} aria-hidden style={{ color: 'var(--muted)' }} />}
        <div>
          <div className="text-xs" style={{ color: 'var(--muted2)' }}>
            {label}
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {statusText}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
