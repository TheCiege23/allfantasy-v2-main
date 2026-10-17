'use client'

import { useEffect, useState } from 'react'
import { BotPersonalityBadge } from '@/components/league-feed/BotPersonalityBadge'

export type LeagueFeedCardRow = {
  id: string
  type: string
  message: string
  title?: string | null
  flavorLine?: string | null
  actorType?: string | null
  actorName?: string | null
  teamName?: string | null
  category?: string | null
  importance?: string | null
  botArchetypeLabel?: string | null
  createdAt: string
  source?: string | null
}

function importanceRing(importance?: string | null): string {
  if (importance === 'high') return 'ring-1 ring-amber-400/35 border-amber-500/20'
  if (importance === 'low') return 'border-white/[0.06] opacity-90'
  return 'border-white/10'
}

export function LeagueFeedCard({ row, animateIn }: { row: LeagueFeedCardRow; animateIn?: boolean }) {
  const [show, setShow] = useState(!animateIn)

  useEffect(() => {
    if (!animateIn) return
    const t = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(t)
  }, [animateIn])

  const flavor = row.flavorLine?.trim()
  const who = row.teamName?.trim() || row.actorName?.trim()
  const isAi = row.actorType === 'ai'

  return (
    <li
      className={`rounded-xl border bg-[#0c1224]/90 px-3 py-2.5 text-left shadow-sm transition duration-300 ${
        importanceRing(row.importance)
      } ${show ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-slate-600/40 to-slate-900/60 text-[11px] font-bold text-white/85">
          {(who ?? '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {who ? (
              <span className="truncate text-[11px] font-semibold text-white/90" title={who}>
                {who}
              </span>
            ) : null}
            {isAi && row.botArchetypeLabel ? (
              <BotPersonalityBadge archetypeLabel={row.botArchetypeLabel} compact className="max-w-[140px]" />
            ) : null}
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
              {row.source ? `${row.source} · ` : ''}
              {row.type}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-white/88">{row.message}</p>
          {flavor ? (
            <p className="mt-1 border-l-2 border-sky-500/40 pl-2 text-[11px] italic leading-snug text-sky-100/75">
              {flavor}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] text-white/35">{new Date(row.createdAt).toLocaleString()}</p>
        </div>
      </div>
    </li>
  )
}
