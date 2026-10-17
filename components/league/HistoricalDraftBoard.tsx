'use client'

import { useEffect, useMemo, useState } from 'react'

type Pick = {
  draftId: string
  season: number | null
  round: number
  pickNumber: number
  playerId: string
  managerId: string | null
}

type ApiResponse = {
  seasons: { year: number; picks: Pick[] }[]
}

export type HistoricalDraftBoardProps = {
  leagueId: string
  season: number
}

export function HistoricalDraftBoard({ leagueId, season }: HistoricalDraftBoardProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Pick[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/league/${encodeURIComponent(leagueId)}/draft-history?season=${season}`)
      .then(async (res) => {
        const data = (await res.json()) as ApiResponse | { error?: string }
        if (!res.ok) throw new Error(('error' in data && data.error) || 'Failed to load draft')
        if (cancelled) return
        const seasonEntry = (data as ApiResponse).seasons?.find((s) => s.year === season)
        setPicks(seasonEntry?.picks ?? [])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, season])

  const { rounds, columns, grid } = useMemo(() => {
    if (!picks.length) return { rounds: [] as number[], columns: [] as string[], grid: new Map<string, Pick>() }
    const rSet = new Set<number>()
    const cSet = new Set<string>()
    const g = new Map<string, Pick>()
    const sorted = [...picks].sort((a, b) => a.round - b.round || a.pickNumber - b.pickNumber)
    const maxPicksPerRound = sorted.reduce((max, p) => {
      const rp = sorted.filter((x) => x.round === p.round).length
      return Math.max(max, rp)
    }, 0)
    for (const p of sorted) {
      rSet.add(p.round)
      const slot = ((p.pickNumber - 1) % Math.max(1, maxPicksPerRound)) + 1
      const colKey = String(slot)
      cSet.add(colKey)
      g.set(`${p.round}:${colKey}`, p)
    }
    return {
      rounds: Array.from(rSet).sort((a, b) => a - b),
      columns: Array.from(cSet).sort((a, b) => Number(a) - Number(b)),
      grid: g,
    }
  }, [picks])

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.06]" />
        ))}
      </div>
    )
  }

  if (error) {
    return <div className="p-3 text-xs text-rose-300/90">{error}</div>
  }

  if (!picks.length) {
    return <div className="p-3 text-xs text-white/40">No draft picks recorded for {season}.</div>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.03] p-2">
      <table className="min-w-full text-[11px]">
        <thead>
          <tr className="text-white/40">
            <th className="px-2 py-1 text-left font-medium">Rd</th>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-left font-medium">
                T{c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r} className="border-t border-white/[0.05]">
              <td className="px-2 py-1 font-semibold text-white/60">{r}</td>
              {columns.map((c) => {
                const p = grid.get(`${r}:${c}`)
                return (
                  <td key={c} className="px-2 py-1 text-white/75">
                    {p ? (
                      <div className="flex flex-col">
                        <span className="text-white/80">#{p.pickNumber}</span>
                        <span className="truncate text-[11px] text-white/45">{p.playerId}</span>
                      </div>
                    ) : (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default HistoricalDraftBoard
