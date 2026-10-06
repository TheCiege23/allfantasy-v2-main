'use client'

import { useMemo, useState } from 'react'
import { TIMELINE_KIND_LABEL, type TimelineEntry, type TimelineKind } from '@/lib/core-app/commissioner/timeline'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy, hubDateLocale } from '@/lib/core-app/commissionerHubCopy'

const KINDS: TimelineKind[] = ['import', 'sync', 'rules', 'commissioner', 'announcement', 'automation']

function when(iso: string, language: string): string {
  return new Date(iso).toLocaleString(hubDateLocale(language), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
}

/**
 * The audit log with a filter by kind. Entries are read and merged on the
 * server; filtering is the only thing this component does.
 */
export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const [kind, setKind] = useState<TimelineKind | 'all'>('all')
  const present = useMemo(() => KINDS.filter((k) => entries.some((e) => e.kind === k)), [entries])
  const shown = kind === 'all' ? entries : entries.filter((e) => e.kind === kind)

  return (
    <div className="af-ch-timeline">
      {present.length > 1 ? (
        <div className="af-ch-timeline-filter" role="group" aria-label={t('Filter the audit log')}>
          <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            {t('All')}
          </button>
          {present.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(TIMELINE_KIND_LABEL[k])}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="af-ch-log">
        {shown.map((e) => (
          <li key={e.id} data-kind={e.kind} data-tone={e.tone}>
            <span className="af-ch-log-kind af-label">{t(TIMELINE_KIND_LABEL[e.kind])}</span>
            <div className="af-ch-log-body">
              <p className="af-ch-log-title">{t(e.title)}</p>
              {e.detail ? <p className="af-ch-log-detail">{t(e.detail)}</p> : null}
            </div>
            <div className="af-ch-log-meta">
              <time dateTime={e.at} className="af-num">
                {when(e.at, language)}
              </time>
              {e.actor ? <span>{e.actor}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
