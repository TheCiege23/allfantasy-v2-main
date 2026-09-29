'use client'

import React from 'react'

export type WarRoomQueueProps = {
  leagueId: string
  draftSessionId?: string | null
  className?: string
}

export function WarRoomQueue({ leagueId, draftSessionId, className = '' }: WarRoomQueueProps) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-[#060d1e]/90 p-3 ${className}`}
      data-testid="war-room-queue"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Queue</p>
      <p className="mt-1 text-[11px] text-white/55">
        League <span className="text-white/70">{leagueId.slice(0, 8)}…</span>
        {draftSessionId ? ` · session ${draftSessionId.slice(0, 8)}…` : ''}. Persist with{' '}
        <code className="text-cyan-200/80">POST /api/war-room/queue</code> (writes{' '}
        <code className="text-white/50">draft_queue_entries</code>).
      </p>
    </div>
  )
}
