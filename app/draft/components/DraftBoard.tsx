'use client'

import { useMemo } from 'react'
import type { DraftPickRecord, DraftPickOrderEntry } from '../types'
import { ManagerHeader } from './ManagerHeader'
import { PickCell } from './PickCell'
function overallForManagerColumn(round: number, managerCol: number, numTeams: number): number {
  if (round % 2 === 1) return (round - 1) * numTeams + (managerCol + 1)
  return round * numTeams - managerCol
}

type Props = {
  numTeams: number
  numRounds: number
  pickOrder: DraftPickOrderEntry[]
  picks: DraftPickRecord[]
  currentOverall: number
}

export function DraftBoard({ numTeams, numRounds, pickOrder, picks, currentOverall }: Props) {
  const byOverall = useMemo(() => {
    const m = new Map<number, DraftPickRecord>()
    for (const p of picks) {
      m.set(p.overallPick, p)
    }
    return m
  }, [picks])

  return (
    <div
      data-testid="legacy-draft-board"
      className="flex max-h-[40vh] min-h-[200px] flex-col overflow-auto rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c1220] via-[#080c14] to-[#06090f] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.04]"
    >
      <div className="sticky left-0 top-0 z-20 flex border-b border-white/[0.06] bg-[#080c14]/95 pb-1.5 pl-[3.25rem] pt-2.5 backdrop-blur-md">
        <ManagerHeader slots={pickOrder} />
      </div>
      <div className="flex min-w-max flex-col gap-1.5 p-3">
        {Array.from({ length: numRounds }, (_, ri) => {
          const round = ri + 1
          return (
            <div key={round} className="flex items-stretch gap-1.5">
              <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-[11px] font-bold tabular-nums tracking-tight text-white/60 shadow-inner shadow-black/30">
                R{round}
              </div>
              {Array.from({ length: numTeams }, (_, mi) => {
                const overall = overallForManagerColumn(round, mi, numTeams)
                const pick = byOverall.get(overall) ?? null
                const pickInRound = round % 2 === 1 ? mi + 1 : numTeams - mi
                const pickLabel = `${round}.${String(pickInRound).padStart(2, '0')}`
                return (
                  <div key={`${round}-${mi}`} className="w-[100px] shrink-0">
                    <PickCell
                      pickLabel={pickLabel}
                      pick={pick}
                      managerIndex={mi}
                      isCurrentPick={overall === currentOverall && !pick?.playerName}
                      isTraded={pick?.isTraded}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
