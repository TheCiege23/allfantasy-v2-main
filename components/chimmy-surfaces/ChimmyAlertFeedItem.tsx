'use client'

import React from 'react'
import { useMemo, useState } from 'react'
import { BellDot, Clock3 } from 'lucide-react'
import type { ChimmyAlert } from '@/lib/chimmy-alerts'
import { useChimmyAlertActions } from '@/hooks/useChimmyAlertActions'
import ChimmyAlertActionButton from './ChimmyAlertActionButton'
import ChimmyDismissAction from './ChimmyDismissAction'

export interface ChimmyAlertFeedItemProps {
  alert: ChimmyAlert
  defaultUnread?: boolean
  onMarkRead?: (alert: ChimmyAlert) => void
  onQuickAction?: (alert: ChimmyAlert) => void
  onSnooze?: (alert: ChimmyAlert) => void
  onDismiss?: (alert: ChimmyAlert) => void
}

export default function ChimmyAlertFeedItem({
  alert,
  defaultUnread = true,
  onMarkRead,
  onQuickAction,
  onDismiss,
}: ChimmyAlertFeedItemProps) {
  const [isUnread, setIsUnread] = useState(defaultUnread)
  const [hidden, setHidden] = useState(false)
  const { dismiss, markRead } = useChimmyAlertActions()
  const createdAt = useMemo(() => {
    const raw = typeof alert.metadata?.createdAt === 'string' ? alert.metadata.createdAt : null
    if (!raw) return 'just now'
    const value = Date.parse(raw)
    if (Number.isNaN(value)) return 'just now'
    const diffMs = Date.now() - value
    const mins = Math.max(1, Math.floor(diffMs / 60000))
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }, [alert.metadata])

  const action = alert.actions[0]

  const handleMarkRead = async () => {
    setIsUnread(false)
    await markRead(alert)
    onMarkRead?.(alert)
  }

  const handleDismiss = async () => {
    await dismiss(alert)
    setHidden(true)
    onDismiss?.(alert)
  }

  if (hidden) return null

  return (
    <article className={`rounded-xl border px-3 py-2.5 transition ${isUnread ? 'border-cyan-300/35 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/25">
          <BellDot className="h-4 w-4 text-white/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{alert.title}</p>
            {isUnread && <span className="rounded-full bg-cyan-400 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-950">Unread</span>}
          </div>
          <p className="text-xs text-white/72">{alert.message}</p>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-white/45">
            <Clock3 className="h-3 w-3" />
            <span>{createdAt}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {action && (
              <ChimmyAlertActionButton
                label={action.label}
                href={action.href}
                onClick={() => onQuickAction?.(alert)}
                className="!py-1"
              />
            )}
            {isUnread && (
              <button
                type="button"
                onClick={handleMarkRead}
                className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
              >
                Mark read
              </button>
            )}
            {alert.dismissible && <ChimmyDismissAction onDismiss={handleDismiss} />}
          </div>
        </div>
      </div>
    </article>
  )
}
