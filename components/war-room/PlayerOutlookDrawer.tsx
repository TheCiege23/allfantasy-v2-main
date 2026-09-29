'use client'

import React from 'react'

export type PlayerOutlookDrawerProps = {
  open: boolean
  onClose: () => void
  leagueId: string
  sport: string
}

export function PlayerOutlookDrawer({ open, onClose, leagueId, sport }: PlayerOutlookDrawerProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      data-testid="war-room-player-outlook-drawer"
    >
      <div className="h-full w-full max-w-md border-l border-white/10 bg-[#0a1228] p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Player outlook</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-[11px] text-white/55">
          <code className="text-cyan-200/80">POST /api/war-room/outlook</code> persists rows to{' '}
          <code className="text-white/50">player_outlooks</code> and feeds Waiver AI / Chimmy.
        </p>
        <p className="mt-2 text-[11px] text-white/40">
          {leagueId.slice(0, 8)}… · {sport}
        </p>
      </div>
    </div>
  )
}
