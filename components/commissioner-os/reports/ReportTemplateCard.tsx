import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { REPORT_CATEGORY_LABELS, REPORT_FREQUENCY_LABELS } from './reportsLabels'
import type { ReportTemplate } from '@/lib/commissioner-ui/reports/decision-os-client'

export interface ReportTemplateCardProps {
  template: ReportTemplate
  onGenerate: () => void
  disabled?: boolean
}

/** Templates never embed the underlying data they'd package — only a description and which modules they draw from. */
export function ReportTemplateCard({ template, onGenerate, disabled }: ReportTemplateCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{template.name}</CardTitle>
          <Badge variant="outline">{REPORT_CATEGORY_LABELS[template.category]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {template.description}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          {REPORT_FREQUENCY_LABELS[template.schedule.frequency]}
          {template.schedule.nextRunAt &&
            ` · Next: ${new Date(template.schedule.nextRunAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={onGenerate} disabled={disabled}>
          Generate Report
        </Button>
      </CardFooter>
    </Card>
  )
}
