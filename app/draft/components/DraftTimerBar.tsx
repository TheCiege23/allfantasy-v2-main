'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Props = {
  timerEndsAt: string | null
  timerPaused: boolean
  onTheClockLabel: string
  isCommissioner: boolean
  onPause?: () => void
  onResume?: () => void
  autopickActive?: boolean
}

export function DraftTimerBar({
  timerEndsAt,
  timerPaused,
  onTheClockLabel,
  isCommissioner,
  onPause,
  onResume,
  autopickActive,
}: Props) {
  const { t } = useLanguage()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  const { secsLeft, pct } = useMemo(() => {
    if (!timerEndsAt || timerPaused) return { secsLeft: null as number | null, pct: 100 }
    const end = new Date(timerEndsAt).getTime()
    const left = Math.max(0, Math.floor((end - now) / 1000))
    const total = 120
    const p = Math.min(100, Math.max(0, (left / total) * 100))
    return { secsLeft: left, pct: p }
  }, [timerEndsAt, timerPaused, now])

  const color =
    secsLeft == null ? 'bg-slate-600' : secsLeft > 30 ? 'bg-emerald-500' : secsLeft > 10 ? 'bg-amber-400' : 'bg-red-500'

  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#0c0c1e] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-white/40">{t('draftRoom.timer.onTheClock')}</p>
          <p className="truncate text-sm font-semibold text-white">{onTheClockLabel}</p>
        </div>
        <div className="text-right font-mono text-xl font-bold tabular-nums text-white">
          {secsLeft == null ? '—' : `${secsLeft}s`}
        </div>
        {isCommissioner ? (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onPause}
              className="rounded border border-white/15 px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={onResume}
              className="rounded border border-cyan-500/40 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/10"
            >
              {t('draftRoom.timer.resume')}
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      {autopickActive ? (
        <p className="mt-1 text-[11px] text-cyan-300/80">{t('draftRoom.timer.autopickArmed')}</p>
      ) : null}
    </div>
  )
}
