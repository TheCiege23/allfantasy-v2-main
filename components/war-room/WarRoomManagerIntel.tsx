'use client'

import React from 'react'

export type WarRoomManagerIntelProps = {
  leagueId: string
  className?: string
}

export function WarRoomManagerIntel({ leagueId, className = '' }: WarRoomManagerIntelProps) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-[#060d1e]/90 p-3 ${className}`}
      data-testid="war-room-manager-intel"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Opponent tendencies</p>
      <p className="mt-1 text-[11px] text-white/55">
        POST <code className="text-cyan-200/80">/api/war-room/opponent-tendencies</code> →{' '}
        <code className="text-white/50">manager_tendencies</code>. League {leagueId.slice(0, 8)}…
      </p>
    </div>
  )
}
