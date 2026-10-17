'use client'

import { useCallback, useState } from 'react'
import { Pause, Play, RotateCcw, Undo2, CheckCircle } from 'lucide-react'

export function CommissionerDraftControls({
  leagueId,
  disabled,
  onSessionUpdated,
}: {
  leagueId: string
  disabled?: boolean
  onSessionUpdated?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async (action: string) => {
      if (disabled) return
      setBusy(action)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error('[CommissionerDraftControls]', data)
          return
        }
        onSessionUpdated?.()
      } finally {
        setBusy(null)
      }
    },
    [disabled, leagueId, onSessionUpdated],
  )

  const btn =
    'inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition disabled:opacity-40'

  return (
    <div
      className="rounded-2xl border border-violet-500/25 bg-violet-950/20 p-3"
      data-testid="draft-commissioner-controls"
    >
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-violet-200/80">Commissioner</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || busy !== null} className={`${btn} border-white/15 bg-black/30 text-white/90`} onClick={() => void run('pause')}>
          <Pause className="h-3.5 w-3.5" aria-hidden />
          {busy === 'pause' ? '…' : 'Pause'}
        </button>
        <button type="button" disabled={disabled || busy !== null} className={`${btn} border-white/15 bg-black/30 text-white/90`} onClick={() => void run('resume')}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {busy === 'resume' ? '…' : 'Resume'}
        </button>
        <button type="button" disabled={disabled || busy !== null} className={`${btn} border-white/15 bg-black/30 text-white/90`} onClick={() => void run('reset_timer')}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset clock
        </button>
        <button type="button" disabled={disabled || busy !== null} className={`${btn} border-amber-500/30 bg-amber-950/30 text-amber-100`} onClick={() => void run('undo_pick')}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          Undo last
        </button>
        <button type="button" disabled={disabled || busy !== null} className={`${btn} border-emerald-500/35 bg-emerald-950/25 text-emerald-100`} onClick={() => void run('complete')}>
          <CheckCircle className="h-3.5 w-3.5" aria-hidden />
          Complete
        </button>
      </div>
    </div>
  )
}
