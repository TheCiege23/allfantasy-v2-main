'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { PlayerImage } from '@/app/components/PlayerImage'
import { cn } from '@/lib/utils'

export type SwapCandidate = {
  id: string
  name: string
  position: string
  team: string
  ownPct?: number
  startPct?: number
  eligible: boolean
  /** Roster section badge (S, BN, IR, TX, DV). */
  badge?: string
}

type TeamLineupSwapModalProps = {
  open: boolean
  onClose: () => void
  slotLabel: string
  candidates: SwapCandidate[]
  sport: string
  onPick: (playerId: string) => void
  locked?: boolean
  lockMessage?: string | null
}

export function TeamLineupSwapModal({
  open,
  onClose,
  slotLabel,
  candidates,
  sport,
  onPick,
  locked,
  lockMessage,
}: TeamLineupSwapModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lineup-swap-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div className="relative z-[81] max-h-[min(80vh,560px)] w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a1228] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div>
            <p id="lineup-swap-title" className="text-sm font-bold text-white">
              Swap {slotLabel}
            </p>
            <p className="text-[11px] text-white/45">Choose a player from your roster</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/[0.06] hover:text-white"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {locked ? (
          <p className="px-4 py-3 text-xs text-amber-200/90">{lockMessage ?? 'Lineup is locked.'}</p>
        ) : null}
        <div className="max-h-[min(60vh,440px)] overflow-y-auto px-2 py-2">
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={locked || !c.eligible}
                  onClick={() => {
                    if (locked || !c.eligible) return
                    onPick(c.id)
                    onClose()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition',
                    c.eligible && !locked
                      ? 'bg-white/[0.06] hover:bg-white/[0.1]'
                      : 'opacity-35',
                  )}
                  data-testid={`lineup-swap-candidate-${c.id}`}
                >
                  <span className="min-w-[2.25rem] text-center text-[11px] font-bold text-white/35">
                    {c.badge ?? '—'}
                  </span>
                  <div className="relative shrink-0">
                    <PlayerImage
                      sleeperId={c.id}
                      sport={sport}
                      name={c.name}
                      position={c.position}
                      size={32}
                      variant="round"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                    <p className="text-[11px] text-white/40">
                      {c.position} · {c.team}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-[11px] text-cyan-200/80">
                    <span className="w-9 text-right">{c.ownPct != null ? `${c.ownPct}%` : '—'}</span>
                    <span className="w-9 text-right">{c.startPct != null ? `${c.startPct}%` : '—'}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
