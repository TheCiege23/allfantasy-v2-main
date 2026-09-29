'use client'

import { useCallback, useEffect, useState } from 'react'
import { Crown, X } from 'lucide-react'

interface ChampionCelebrationProps {
  championName: string
  tournamentName: string
  record?: string
  pointsFor?: number
  totalRounds?: number
}

const STORAGE_KEY = 'af-champion-celebration-seen-'

export function ChampionCelebration({
  championName,
  tournamentName,
  record,
  pointsFor,
  totalRounds,
}: ChampionCelebrationProps) {
  const [visible, setVisible] = useState(false)
  const storageKey = `${STORAGE_KEY}${tournamentName}`

  useEffect(() => {
    try {
      const seen = localStorage.getItem(storageKey) === '1'
      if (!seen) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [storageKey])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }, [storageKey])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border-2 border-yellow-500/50 bg-gradient-to-b from-[#1a1500] via-[#0f1114] to-[#0f1114] p-8 text-center shadow-[0_0_60px_rgba(245,184,0,0.15)]">
        {/* Dismiss */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 text-white/40 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Glow ring */}
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-yellow-400/30 to-yellow-600/10 shadow-[0_0_40px_rgba(245,184,0,0.3)]">
          <Crown className="h-10 w-10 text-yellow-400 drop-shadow-[0_0_8px_rgba(245,184,0,0.6)]" />
        </div>

        {/* Title */}
        <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-yellow-300 drop-shadow-[0_0_12px_rgba(245,184,0,0.4)]">
          CHAMPION
        </h1>

        <p className="mb-4 text-[14px] font-bold text-white">{championName}</p>

        <p className="mb-6 text-[12px] text-white/50">
          Winner of <span className="font-semibold text-white/80">{tournamentName}</span>
        </p>

        {/* Stats row */}
        <div className="mx-auto mb-6 flex max-w-xs justify-center gap-6">
          {record && (
            <div>
              <p className="text-[18px] font-bold text-white">{record}</p>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Record</p>
            </div>
          )}
          {pointsFor != null && (
            <div>
              <p className="text-[18px] font-bold text-white">{pointsFor.toFixed(1)}</p>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Points for</p>
            </div>
          )}
          {totalRounds != null && (
            <div>
              <p className="text-[18px] font-bold text-white">{totalRounds}</p>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Rounds</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-6 py-2.5 text-sm font-medium text-yellow-200 hover:bg-yellow-500/20"
        >
          Continue to tournament
        </button>
      </div>
    </div>
  )
}
