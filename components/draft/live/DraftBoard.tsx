'use client'

import type { DraftPickSnapshot, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

/**
 * Compact grid: rounds × columns — for specialty overlays use `session.devy` / `session.c2c` from parent.
 */
export function DraftBoard({
  session,
  picks,
}: {
  session: DraftSessionSnapshot
  picks: DraftPickSnapshot[]
}) {
  const { teamCount, rounds } = session
  const byRoundSlot = new Map<string, (typeof picks)[0]>()
  for (const p of picks) {
    byRoundSlot.set(`${p.round}:${p.slot}`, p)
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#040915]/95" data-testid="draft-board-grid">
      <table className="w-full min-w-[640px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-white/[0.08] text-white/45">
            <th className="sticky left-0 bg-[#040915] px-2 py-2 text-left font-semibold">Rnd</th>
            {Array.from({ length: teamCount }, (_, i) => (
              <th key={i} className="px-1 py-2 text-center font-semibold">
                Slot {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, ri) => {
            const round = ri + 1
            return (
              <tr key={round} className="border-b border-white/[0.05]">
                <td className="sticky left-0 bg-[#040915] px-2 py-1.5 font-mono text-cyan-200/80">{round}</td>
                {Array.from({ length: teamCount }, (_, ti) => {
                  const slot = ti + 1
                  const pick = byRoundSlot.get(`${round}:${slot}`)
                  return (
                    <td key={slot} className="px-1 py-1 align-top">
                      <div className="min-h-[36px] rounded-lg border border-white/[0.06] bg-white/[0.03] px-1 py-1 text-[11px] leading-tight text-white/85">
                        {pick ? (
                          <>
                            <div className="truncate font-semibold">{pick.playerName}</div>
                            <div className="text-white/40">
                              {pick.position}
                              {pick.team ? ` · ${pick.team}` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="text-white/25">—</span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
