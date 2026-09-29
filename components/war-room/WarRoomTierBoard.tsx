'use client'

import React from 'react'

export type WarRoomTierBoardProps = {
  sport: string
  tierBoard?: Array<{
    tierLabel: string
    playersRemainingInTier: number
    nextTierDropRisk: 'low' | 'medium' | 'high'
    notes: string[]
  }>
  scarcity?: string[]
  className?: string
}

export function WarRoomTierBoard({ sport, tierBoard, scarcity, className = '' }: WarRoomTierBoardProps) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-[#060d1e]/90 p-3 ${className}`}
      data-testid="war-room-tier-board"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Tier board</p>
      <p className="mt-0.5 text-[11px] text-white/45">{sport}</p>
      {tierBoard && tierBoard.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {tierBoard.map((t) => (
            <li key={t.tierLabel} className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-white/90">{t.tierLabel}</span>
                <span
                  className={`text-[11px] uppercase ${
                    t.nextTierDropRisk === 'high'
                      ? 'text-amber-300/90'
                      : t.nextTierDropRisk === 'medium'
                        ? 'text-cyan-200/80'
                        : 'text-white/45'
                  }`}
                >
                  cliff {t.nextTierDropRisk} · {t.playersRemainingInTier} left
                </span>
              </div>
              {t.notes[0] && <p className="mt-0.5 text-[11px] text-white/50">{t.notes[0]}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-white/55">Run intel to populate tiers from the live brain.</p>
      )}
      {scarcity && scarcity.length > 0 && (
        <div className="mt-2 border-t border-white/8 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/70">Scarcity</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100/75">
            {scarcity.slice(0, 5).map((s) => (
              <li key={s.slice(0, 40)}>• {s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
