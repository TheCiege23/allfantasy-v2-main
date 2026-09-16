'use client'

import { useMemo, useState } from 'react'
import { TIMELINE_KIND_LABEL, type TimelineEntry, type TimelineKind } from '@/lib/core-app/commissioner/timeline'

const KINDS: TimelineKind[] = ['import', 'sync', 'rules', 'commissioner', 'announcement', 'automation']

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
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
  const [kind, setKind] = useState<TimelineKind | 'all'>('all')
  const present = useMemo(() => KINDS.filter((k) => entries.some((e) => e.kind === k)), [entries])
  const shown = kind === 'all' ? entries : entries.filter((e) => e.kind === kind)

  return (
    <div className="af-ch-timeline">
      {present.length > 1 ? (
        <div className="af-ch-timeline-filter" role="group" aria-label="Filter the audit log">
          <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            All
          </button>
          {present.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {TIMELINE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="af-ch-log">
        {shown.map((e) => (
          <li key={e.id} data-kind={e.kind} data-tone={e.tone}>
            <span className="af-ch-log-kind af-label">{TIMELINE_KIND_LABEL[e.kind]}</span>
            <div className="af-ch-log-body">
              <p className="af-ch-log-title">{e.title}</p>
              {e.detail ? <p className="af-ch-log-detail">{e.detail}</p> : null}
            </div>
            <div className="af-ch-log-meta">
              <time dateTime={e.at} className="af-num">
                {when(e.at)}
              </time>
              {e.actor ? <span>{e.actor}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
