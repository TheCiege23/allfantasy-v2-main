'use client'

import { useEffect, useState } from 'react'

export function DeadlinesCard({ leagueId }: { leagueId: string }) {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/config`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { config?: Record<string, unknown> }) => {
        const c = d.config
        if (!c) {
          setLines(['No config'])
          return
        }
        const out: string[] = []
        if (c.nominationDeadlineDayOfWeek != null) out.push(`Noms close: DOW ${String(c.nominationDeadlineDayOfWeek)} ${String(c.nominationDeadlineTimeUtc ?? '')}`)
        if (c.evictionVoteCloseDayOfWeek != null) out.push(`Vote closes: DOW ${String(c.evictionVoteCloseDayOfWeek)} ${String(c.evictionVoteCloseTimeUtc ?? '')}`)
        setLines(out.length ? out : ['Deadlines configured in league settings'])
      })
      .catch(() => setLines(['Could not load deadlines']))
  }, [leagueId])

  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-[#0a1228] p-3 text-[12px] text-white/85" data-testid="bb-deadlines-card">
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">@chimmy deadlines</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}
