'use client'

import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import type { ChimmySnoozePreset } from '@/hooks/useChimmyAlertActions'

const PRESETS: { value: ChimmySnoozePreset; label: string }[] = [
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
]

export interface ChimmySnoozeActionProps {
  onSnooze?: (duration: ChimmySnoozePreset) => void
  disabled?: boolean
}

export default function ChimmySnoozeAction({ onSnooze, disabled }: ChimmySnoozeActionProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pick = (preset: ChimmySnoozePreset) => {
    setOpen(false)
    onSnooze?.(preset)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/60 transition hover:bg-white/10 disabled:opacity-40"
      >
        <Clock className="h-3 w-3" />
        Snooze
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[130px] rounded-xl border border-white/15 bg-[#0f172a] py-1 shadow-xl">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => pick(p.value)}
              className="w-full px-3 py-1.5 text-left text-xs text-white/75 hover:bg-white/10"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
