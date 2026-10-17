'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { localWeekRange } from '@/lib/core-app/localWeekRange'

/** Resolve after hydration so the server timezone cannot set the viewer's calendar. */
export function WeekDateRange() {
  const { language } = useOptionalLanguage()
  const [range, setRange] = useState<{ label: string; timezone: string } | null>(null)
  useEffect(() => {
    const update = () => {
      const { start, end } = localWeekRange(new Date())
      const format = new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', { month: 'short', day: 'numeric', year: 'numeric' })
      setRange({ label: format.formatRange(start, end), timezone: format.resolvedOptions().timeZone })
    }
    update()
    const interval = window.setInterval(update, 60_000)
    return () => window.clearInterval(interval)
  }, [language])
  return <span title={range?.timezone}>{range?.label ?? (language === 'es' ? 'Esta semana' : 'This week')}</span>
}
