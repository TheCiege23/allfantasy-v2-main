'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import ChimmyAlertFeedItem from './ChimmyAlertFeedItem'

export interface ChimmyGroupedAlertCardProps {
  groupTitle: string
  alerts: ChimmyAlert[]
  onSnooze?: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
}

export default function ChimmyGroupedAlertCard({ groupTitle, alerts, onSnooze, onDismiss }: ChimmyGroupedAlertCardProps) {
  const [expanded, setExpanded] = useState(alerts.length <= 2)
  if (alerts.length === 0) return null
  const summary = `${alerts.length} ${groupTitle.toLowerCase()} opportunities available`

  return (
    <section className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35">{groupTitle}</p>
          {alerts.length > 1 && <p className="mt-0.5 text-xs text-white/65">{summary}</p>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <ChimmyAlertFeedItem key={alert.alertId} alert={alert} onSnooze={onSnooze} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </section>
  )
}
