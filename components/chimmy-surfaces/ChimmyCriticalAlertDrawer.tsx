'use client'

import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import ChimmyDrawer from './ChimmyDrawer'
import ChimmyAlertActionButton from './ChimmyAlertActionButton'

export interface ChimmyCriticalAlertDrawerProps {
  open: boolean
  alert: ChimmyAlert
  onAcknowledge: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
}

export default function ChimmyCriticalAlertDrawer({
  open,
  alert,
  onAcknowledge,
  onDismiss,
}: ChimmyCriticalAlertDrawerProps) {
  const action = alert.actions[0]

  return (
    <ChimmyDrawer open={open} onClose={() => onAcknowledge(alert)} title="Critical Chimmy Alert" height="half">
      <div className="space-y-3">
        <div className="inline-flex rounded-full border border-rose-300/45 bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-100">
          Immediate attention
        </div>

        <div>
          <p className="text-base font-semibold text-white">{alert.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-white/78">{alert.message}</p>
          <p className="mt-2 text-xs text-white/60">This alert needs explicit acknowledgement before it is hidden.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {action && (
            <ChimmyAlertActionButton
              label={action.label}
              href={action.href}
              onClick={() => onAcknowledge(alert)}
            />
          )}
          <button
            type="button"
            onClick={() => onAcknowledge(alert)}
            className="rounded-md border border-white/25 bg-white/12 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/18"
          >
            Acknowledge
          </button>
          {alert.dismissible && onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(alert)}
              className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </ChimmyDrawer>
  )
}
