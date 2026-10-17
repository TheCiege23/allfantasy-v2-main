'use client'

import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import ChimmyAlertCard from './ChimmyAlertCard'

export interface ChimmyCommissionerAlertCardProps {
  alert: ChimmyAlert
  onSnooze?: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
}

export default function ChimmyCommissionerAlertCard({ alert, onSnooze, onDismiss }: ChimmyCommissionerAlertCardProps) {
  return (
    <div className="rounded-xl border border-amber-300/35 bg-gradient-to-r from-amber-500/18 via-amber-500/8 to-transparent p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-100/80">Commissioner Ops Alert</p>
        <span className="rounded-full border border-amber-200/35 bg-black/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-100/80">
          League Health
        </span>
      </div>
      <ChimmyAlertCard alert={alert} onSnooze={onSnooze} onDismiss={onDismiss} defaultExpanded />
    </div>
  )
}
