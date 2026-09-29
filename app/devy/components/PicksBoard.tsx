'use client'

import { useMemo, useState } from 'react'

export type PickRow = {
  id: string
  round: number
  originalOwnerId: string
  currentOwnerId: string
  pickType: string
  isTradeable: boolean
  isUsed: boolean
  season?: number
}

type TeamColor = { id: string; color: string }

const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#ec4899', '#06b6d4', '#84cc16']

export function PicksBoard({
  picks,
  rosterIdByColumn,
}: {
  picks: PickRow[]
  rosterIdByColumn: string[]
}) {
  const colorByRoster = useMemo(() => {
    const m = new Map<string, string>()
    rosterIdByColumn.forEach((id, i) => m.set(id, PALETTE[i % PALETTE.length]))
    return m
  }, [rosterIdByColumn])

  const rounds = useMemo(() => {
    const r = new Set<number>()
    for (const p of picks) r.add(p.round)
    return [...r].sort((a, b) => a - b)
  }, [picks])

  const [hover, setHover] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[11px] text-white/80">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border border-white/[0.06] bg-[#0a1228] px-2 py-2 text-white/50">
              Rd
            </th>
            {rosterIdByColumn.map((rid) => (
              <th
                key={rid}
                className="min-w-[72px] border border-white/[0.06] px-1 py-2 text-center font-semibold"
                style={{ borderBottomColor: colorByRoster.get(rid) }}
              >
                {rid.slice(0, 6)}…
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              <td className="sticky left-0 z-10 border border-white/[0.06] bg-[#080c14] px-2 py-2 font-mono text-white/60">
                {round}
              </td>
              {rosterIdByColumn.map((rid) => {
                const cell = picks.find((p) => p.round === round && p.currentOwnerId === rid)
                const bg = cell ? colorByRoster.get(rid) : 'transparent'
                return (
                  <td
                    key={`${round}-${rid}`}
                    className="border border-white/[0.06] px-1 py-2 text-center"
                    style={{ background: cell ? `${bg}22` : undefined }}
                    onMouseEnter={() => cell && setHover(cell.id)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {cell ? (
                      <span className="text-[11px] text-white/70" title={hover === cell.id ? cell.id : undefined}>
                        {cell.isUsed ? '✓' : '○'}
                      </span>
                    ) : (
                      <span className="text-white/25">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-white/40">Hover a cell for pick id. Empty = traded away.</p>
    </div>
  )
}
