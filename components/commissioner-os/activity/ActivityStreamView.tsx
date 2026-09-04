'use client'

import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ActivityEventRow } from './ActivityEventRow'
import { getModuleLabel } from './activityLabels'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerActivityEventContract } from '@/lib/commissioner-ui/contracts'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'

export interface ActivityStreamViewProps {
  events: CommissionerActivityEventContract[]
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

const ALL_SOURCES = 'all' as const
type SourceFilter = CommissionerModuleId | typeof ALL_SOURCES

/**
 * The curated, cross-module chronological record — per the module's own
 * placeholder text, "never a duplicate of any module's own evidence,
 * workflow, or audit log." Filtering by source module reuses the exact
 * tablist pattern Workspace's WorkQueueStrip and Recommendations Center's
 * Queue/History toggle already established, rather than inventing a new
 * filter UI.
 */
export function ActivityStreamView({ events, dataMode, errorMessage }: ActivityStreamViewProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(ALL_SOURCES)

  const sources = useMemo(() => {
    const ids = new Set<CommissionerModuleId>(events.map((event) => event.sourceModuleId))
    return Array.from(ids)
  }, [events])

  const visible = useMemo(() => {
    if (sourceFilter === ALL_SOURCES) return events
    return events.filter((event) => event.sourceModuleId === sourceFilter)
  }, [events, sourceFilter])

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Activity source">
            <button
              type="button"
              role="tab"
              aria-selected={sourceFilter === ALL_SOURCES}
              onClick={() => setSourceFilter(ALL_SOURCES)}
              className="focus-ring shrink-0 whitespace-nowrap rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
              style={{
                background: sourceFilter === ALL_SOURCES ? 'var(--panel2)' : 'transparent',
                color: sourceFilter === ALL_SOURCES ? 'var(--text)' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              All <span style={{ color: 'var(--muted2)' }}>({events.length})</span>
            </button>
            {sources.map((moduleId) => {
              const count = events.filter((event) => event.sourceModuleId === moduleId).length
              const isActive = sourceFilter === moduleId
              return (
                <button
                  key={moduleId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSourceFilter(moduleId)}
                  className="focus-ring shrink-0 whitespace-nowrap rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
                  style={{
                    background: isActive ? 'var(--panel2)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {getModuleLabel(moduleId)} <span style={{ color: 'var(--muted2)' }}>({count})</span>
                </button>
              )
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No activity yet."
              description="Meaningful events from across Commissioner OS will show up here."
            />
          ) : (
            <ol className="ml-1">
              {visible.map((event, index) => (
                <ActivityEventRow key={event.id} event={event} isLast={index === visible.length - 1} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
