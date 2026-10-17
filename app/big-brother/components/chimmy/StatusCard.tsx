'use client'

import { useEffect, useState } from 'react'

export function StatusCard({ leagueId }: { leagueId: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/summary`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { cycle?: { phase?: string; week?: number }; myStatus?: string }) => {
        setText(`Week ${d.cycle?.week ?? '—'} · ${d.cycle?.phase ?? '—'} · You: ${d.myStatus ?? '—'}`)
      })
      .catch(() => setText('Could not load status.'))
  }, [leagueId])

  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-[#0a1228] p-3 text-[12px] text-white/85" data-testid="bb-status-card">
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">@chimmy status</p>
      <p className="mt-1 whitespace-pre-wrap">{text ?? '…'}</p>
    </div>
  )
}
