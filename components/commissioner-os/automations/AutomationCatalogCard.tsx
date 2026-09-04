import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { getSeverityStyle, SEVERITY_LABELS } from '@/components/commissioner-os/cards'
import { AUTOMATION_STATUS_LABELS, AUTOMATION_CATEGORY_LABELS } from './automationLabels'
import type { AutomationCatalogEntry } from '@/lib/commissioner-ui/automations/decision-os-client'

export interface AutomationCatalogCardProps {
  automation: AutomationCatalogEntry
  enabled: boolean
  onToggle: (checked: boolean) => void
  onViewHistory: () => void
}

/**
 * Health (colored severity badge) and status (neutral pill, driven by the
 * live `enabled` toggle state rather than the original fetched value) are
 * kept visually distinct — a running automation can still be unhealthy,
 * and a disabled one can still have a clean history.
 */
export function AutomationCatalogCard({ automation, enabled, onToggle, onViewHistory }: AutomationCatalogCardProps) {
  const style = getSeverityStyle(automation.health)

  return (
    <Card style={{ borderColor: style.border }}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{automation.name}</CardTitle>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted2)' }}>
              {AUTOMATION_CATEGORY_LABELS[automation.category]}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              {AUTOMATION_STATUS_LABELS[enabled ? 'enabled' : 'disabled']}
            </span>
            <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>{SEVERITY_LABELS[automation.health]}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {automation.description}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          {automation.schedule.description}
        </p>
        {automation.lastRunAt && (
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>
            Last ran {new Date(automation.lastRunAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {automation.successRatePercent}%
            success over {automation.totalRunsCount} runs
          </p>
        )}
        {automation.relatedLinks.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {automation.relatedLinks.map((link) => (
              <li key={link.href + link.label}>
                <Link href={link.href} className="focus-ring link-themed text-xs">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="items-center justify-between gap-2">
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`${enabled ? 'Disable' : 'Enable'} ${automation.name}`} />
        <Button size="sm" variant="outline" onClick={onViewHistory}>
          View History
        </Button>
      </CardFooter>
    </Card>
  )
}
