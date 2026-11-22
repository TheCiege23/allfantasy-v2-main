'use client'

import { useEffect, useState } from 'react'
import { seasonReportPath } from '@/lib/tournament/seasonReportFormat'
import type { SeasonLiveCut } from '@/lib/tournament/seasonLiveCut'

const tieLabels = { best_week: 'Best period', wins: 'Record', previous_seed: 'Previous seed', frozen_draw: 'Frozen draw' }

export function SeasonLiveCutPanel({ tournamentId }: { tournamentId: string }) {
  const [cut, setCut] = useState<SeasonLiveCut | null>(null)
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const response = await fetch(seasonReportPath(tournamentId) + '?live=1', { signal: controller.signal })
        if (!response.ok) throw new Error('Could not refresh the cut line.')
        const data: { cut: SeasonLiveCut | null } = await response.json()
        if (!controller.signal.aborted) { setCut(data.cut); setStale(false) }
      } catch {
        if (!controller.signal.aborted) setStale(true)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 60_000)
      }
    }
    setCut(null)
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [tournamentId])

  if (!cut) return null
  return <section className="space-y-2 rounded-xl border border-cyan-300/30 p-3" aria-label="Live cut line">
    <h3 className="font-semibold">Live cut line · Stage {cut.stage}</h3>
    <p className="text-sm text-slate-300">Through period {cut.through}{cut.through < cut.current && ' · Waiting for comparable scores in period ' + cut.current}{stale && ' · Refresh delayed'}</p>
    {cut.pending && <p className="text-sm">{cut.pending}</p>}
    {!!cut.rows.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{['Rank', 'Manager', 'Points', 'Cut status', 'Points vs berth', 'Tiebreaker'].map(label => <th key={label} className="p-2" scope="col">{label}</th>)}</tr></thead>
      <tbody>{cut.rows.map((row, index) => <tr key={index} className="border-t border-white/10">
        <td className="p-2">{row.rank}</td><th className="p-2 font-medium" scope="row">{row.manager}</th><td className="p-2">{row.points}</td>
        <td className="p-2">{row.standing} · {row.path}</td><td className="p-2">{row.pointsGap == null ? '—' : (row.pointsGap > 0 ? '+' : '') + row.pointsGap}</td>
        <td className="p-2">{row.tie ? tieLabels[row.tie] : '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}
