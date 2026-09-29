'use client'

import React from 'react'
import type { ChimmyAlertSeverity } from '@/lib/chimmy-alerts'

export interface ChimmyUrgencyBadgeProps {
  severity: ChimmyAlertSeverity
  urgencyScore: number
}

const STYLE: Record<ChimmyAlertSeverity, string> = {
  informational: 'border-slate-300/30 bg-slate-500/10 text-slate-100',
  action_recommended: 'border-cyan-300/40 bg-cyan-500/15 text-cyan-100',
  urgent: 'border-amber-300/45 bg-amber-500/18 text-amber-100',
  critical: 'border-rose-300/45 bg-rose-500/20 text-rose-100',
}

const LABEL: Record<ChimmyAlertSeverity, string> = {
  informational: 'Informational',
  action_recommended: 'Action Recommended',
  urgent: 'Urgent',
  critical: 'Critical',
}

export default function ChimmyUrgencyBadge({ severity, urgencyScore }: ChimmyUrgencyBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STYLE[severity]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      <span>{LABEL[severity]}</span>
      <span className="opacity-70">{urgencyScore}</span>
    </span>
  )
}
