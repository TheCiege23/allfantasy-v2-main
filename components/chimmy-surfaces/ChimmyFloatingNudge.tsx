'use client'

import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import { BellRing, X } from 'lucide-react'
import ChimmyAlertActionButton from './ChimmyAlertActionButton'

export interface ChimmyFloatingNudgeProps {
  alert: ChimmyAlert
  onAction?: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
}

export default function ChimmyFloatingNudge({ alert, onAction, onDismiss }: ChimmyFloatingNudgeProps) {
  const action = alert.actions[0]

  return (
    <aside className="pointer-events-auto fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 w-[min(92vw,360px)] rounded-2xl border border-cyan-300/35 bg-[#06263a]/95 p-3 shadow-[0_14px_28px_rgba(1,10,18,0.45)] backdrop-blur-md">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
          <BellRing className="h-3 w-3" />
          Chimmy Nudge
        </div>
        <button
          type="button"
          aria-label="Dismiss nudge"
          onClick={() => onDismiss?.(alert)}
          className="rounded-md p-1 text-white/65 hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-sm font-semibold text-white">{alert.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/75">{alert.message}</p>

      {action && (
        <div className="mt-2">
          <ChimmyAlertActionButton
            label={action.label}
            href={action.href}
            onClick={() => onAction?.(alert)}
          />
        </div>
      )}
    </aside>
  )
}
