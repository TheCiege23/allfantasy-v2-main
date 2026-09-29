'use client'

import { useEffect, useState } from 'react'
import { Users, ChevronDown, ChevronUp } from 'lucide-react'

type DepthEntry = {
  team: string
  position: string
  players: string[]
  source: string
}

export function DepthChartPanel({ sport, team }: { sport: string; team?: string }) {
  const [entries, setEntries] = useState<DepthEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!team) { setLoading(false); return }
    let active = true
    fetch(`/api/sports/depth-charts?sport=${encodeURIComponent(sport)}&team=${encodeURIComponent(team)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return
        const rows = Array.isArray(data?.depthCharts) ? data.depthCharts
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data) ? data : []
        setEntries(rows)
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sport, team])

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4">
        <div className="mb-3 h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-2 h-10 animate-pulse rounded-lg bg-white/[0.04]" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/30">
          <Users className="h-3.5 w-3.5" /> Depth Chart
        </div>
        <p className="mt-2 text-xs text-white/40">No depth chart data available{team ? ` for ${team}` : ''}.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/30">
          <Users className="h-3.5 w-3.5" /> Depth Chart {team && `· ${team}`}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-white/30" /> : <ChevronDown className="h-4 w-4 text-white/30" />}
      </button>
      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={`${e.position}-${i}`} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-300/70">{e.position}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.players.map((p, j) => (
                    <span
                      key={`${p}-${j}`}
                      className={`rounded-md px-2 py-0.5 text-[11px] ${
                        j === 0
                          ? 'bg-cyan-500/15 font-semibold text-cyan-200'
                          : 'bg-white/[0.04] text-white/50'
                      }`}
                    >
                      {j === 0 && <span className="mr-1 text-[11px] text-cyan-400">★</span>}
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
