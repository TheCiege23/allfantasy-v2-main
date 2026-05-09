'use client'

import React, { useMemo, useState } from 'react'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import { LazyDraftImage } from '@/components/app/draft-room/LazyDraftImage'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { DEFAULT_SPORT } from '@/lib/sport-scope'

function PickRow({
  pick,
  sport,
  isLatest = false,
}: {
  pick: DraftPickSnapshot
  sport: string
  isLatest?: boolean
}) {
  const normalized = useMemo(
    () =>
      normalizePlayer({
        name: pick.playerName,
        position: pick.position,
        team: pick.team,
        playerId: pick.playerId,
        byeWeek: pick.byeWeek,
        sport,
      }),
    [pick.playerName, pick.position, pick.team, pick.playerId, pick.playerImageUrl, pick.byeWeek, sport],
  )
  const img = pick.playerImageUrl?.trim() || getPlayerImage(normalized, sport)
  const [imgErr, setImgErr] = useState(false)

  return (
    <li
      className={`flex animate-in fade-in slide-in-from-left-2 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-[12px] duration-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)] ${
        isLatest
          ? 'draft-pick-history-latest border-amber-400/25 bg-gradient-to-r from-[#1a1208]/90 to-[#0a1228]/80 shadow-[0_4px_20px_rgba(246,196,69,0.08)] hover:border-amber-400/35'
          : 'border-white/[0.06] bg-gradient-to-r from-[#0c1528]/90 to-[#0a1228]/80 shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:border-white/12'
      }`}
      style={{ animationDelay: '0ms', animationFillMode: 'both' }}
    >
      <span className="shrink-0 font-mono text-[11px] font-semibold text-cyan-300/95" aria-label={`Pick ${pick.pickLabel}`}>
        {pick.pickLabel}
      </span>
      <div className="relative h-9 w-9 shrink-0">
        {img && !imgErr ? (
          <LazyDraftImage
            src={img}
            alt=""
            width={36}
            height={36}
            className="rounded-full object-cover bg-white/10 ring-2 ring-white/10 shadow-md"
            lazy
            onError={() => setImgErr(true)}
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-[12px] font-bold text-white/80 ring-2 ring-white/10">
            {pick.playerName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <span className="font-bold text-white/95">{pick.playerName}</span>
        <span className="mt-0.5 block text-[11px] text-white/52">
          {pick.position}
          {pick.team ? ` · ${pick.team}` : ''}
        </span>
      </div>
    </li>
  )
}

export function PickHistory({
  picks,
  max = 24,
  sport = DEFAULT_SPORT,
}: {
  picks: DraftPickSnapshot[]
  max?: number
  /** League sport for headshot / logo resolution */
  sport?: string
}) {
  const rows = picks.slice(-max).reverse()
  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#0c1528] to-[#070d18]/98 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
      data-testid="draft-pick-history"
    >
      <div className="border-b border-white/[0.07] bg-black/20 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">Recent picks</p>
      </div>
      <ul className="max-h-[min(50vh,420px)] space-y-1.5 overflow-y-auto px-2 py-2.5">
        {rows.length === 0 ? (
          <li className="animate-in px-3 py-10 text-center fade-in duration-500">
            <p className="text-[13px] font-semibold text-white/55">No picks yet</p>
            <p className="mt-1 text-[11px] text-white/35">Selections will show here as the draft progresses.</p>
          </li>
        ) : (
          rows.map((p, idx) => <PickRow key={p.id} pick={p} sport={sport} isLatest={idx === 0} />)
        )}
      </ul>
    </div>
  )
}
