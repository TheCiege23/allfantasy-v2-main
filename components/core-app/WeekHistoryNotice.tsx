'use client'

import { useMessages } from '@/components/i18n/useMessages'
import { coreWidgetsMessages } from '@/lib/core-app/messages/coreWidgets'

/** Partial history must not look like proof that the manager has never played. */
export function WeekHistoryNotice({ retryHref }: { retryHref: string }) {
  const m = useMessages(coreWidgetsMessages)
  return (
    <div className="af-card" role="status" style={{ padding: 16, marginBottom: 16 }}>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        {m.weekHistoryBody}
      </p>
      <a className="af-btn" href={retryHref} style={{ display: 'inline-flex', marginTop: 12, minHeight: 44, alignItems: 'center' }}>
        {m.weekHistoryRetry}
      </a>
    </div>
  )
}
