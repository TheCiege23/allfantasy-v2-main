'use client'

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReportTemplate } from '@/lib/commissioner-ui/reports/decision-os-client'
import { shortDate } from '@/components/commissioner-os/primitives/pinnedTime'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { reportsCopy, reportText } from '@/lib/commissioner-os/i18n/analyticsCopy'

export interface ReportTemplateCardProps {
  template: ReportTemplate
  onGenerate: () => void
  disabled?: boolean
}

/** Templates never embed the underlying data they'd package — only a description and which modules they draw from. */
export function ReportTemplateCard({ template, onGenerate, disabled }: ReportTemplateCardProps) {
  const { language } = useOptionalLanguage()
  const c = reportsCopy(language)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{reportText(template.name, language)}</CardTitle>
          <Badge variant="outline">{c.category[template.category]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {reportText(template.description, language)}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          {c.frequency[template.schedule.frequency]}
          {template.schedule.nextRunAt && c.next(shortDate(template.schedule.nextRunAt, language))}
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={onGenerate} disabled={disabled}>
          {c.generateReport}
        </Button>
      </CardFooter>
    </Card>
  )
}
