'use client'

import React from 'react'
import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import { useChimmyAlertActions, type ChimmySnoozePreset } from '@/hooks/useChimmyAlertActions'
import ChimmyConfidenceBadge from './ChimmyConfidenceBadge'
import ChimmyUrgencyBadge from './ChimmyUrgencyBadge'
import ChimmyAlertActionButton from './ChimmyAlertActionButton'
import ChimmySnoozeAction from './ChimmySnoozeAction'
import ChimmyDismissAction from './ChimmyDismissAction'

export interface ChimmyAlertCardProps {
  alert: ChimmyAlert
  onSnooze?: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
  onDone?: (alert: ChimmyAlert) => void
  defaultExpanded?: boolean
}

export default function ChimmyAlertCard({
  alert,
  onSnooze,
  onDismiss,
  onDone,
  defaultExpanded = false,
}: ChimmyAlertCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [hidden, setHidden] = useState(false)
  const { dismiss, snooze, markDone } = useChimmyAlertActions()
  const action = alert.actions[0]
  const fullExplanation =
    typeof alert.metadata?.explanation === 'string'
      ? alert.metadata.explanation
      : `Chimmy confidence ${alert.confidenceScore}% with urgency ${alert.urgencyScore}/100 for this ${alert.class.replace('_', ' ')} signal.`

  const handleSnooze = async (duration: ChimmySnoozePreset) => {
    await snooze(alert, duration)
    setHidden(true)
    onSnooze?.(alert)
  }

  const handleDismiss = async () => {
    await dismiss(alert)
    setHidden(true)
    onDismiss?.(alert)
  }

  const handleDone = async () => {
    await markDone(alert)
    setHidden(true)
    onDone?.(alert)
  }

  if (hidden) return null

  return (
    <article className="rounded-xl border border-white/10 bg-gradient-to-br from-[#0f172a] via-[#0a2234] to-[#0f172a] p-3 shadow-[0_6px_20px_rgba(0,0,0,0.28)]">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <ChimmyUrgencyBadge severity={alert.severity} urgencyScore={alert.urgencyScore} />
        <ChimmyConfidenceBadge pct={alert.confidenceScore} showPct={false} />
      </div>

      <p className="text-sm font-semibold text-white">{alert.title}</p>
      <p className="mt-1 text-xs text-white/75">{alert.message}</p>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-cyan-200/90 hover:text-cyan-100"
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? 'Hide full explanation' : 'Expand explanation'}
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/25 p-2.5">
          <p className="text-xs leading-relaxed text-white/72">{fullExplanation}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action && (
          <ChimmyAlertActionButton label={action.label} href={action.href} onClick={handleDone} />
        )}
        {alert.snoozable && <ChimmySnoozeAction onSnooze={handleSnooze} />}
        {alert.dismissible && <ChimmyDismissAction onDismiss={handleDismiss} />}
        <button
          type="button"
          onClick={handleDone}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          <CheckCircle2 className="h-3 w-3" />
          Done
        </button>
      </div>
    </article>
  )
}
