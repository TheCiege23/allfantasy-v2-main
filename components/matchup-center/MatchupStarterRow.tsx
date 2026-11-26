'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { MatchupPlayerSlot } from '@/lib/matchup-center/types'
import { AfInjuryTag } from '@/components/league/AfInjuryTag'
import { POSITION_COLORS } from '@/lib/league-labels/catalog'
import { TeamLogo } from '@/app/components/TeamLogo'
import { isNoTeam } from '@/lib/players/teamLogos'
import { initialsFor } from '@/lib/draft-room/classify-avatar-source'

const MUTED = { color: 'var(--lsk-muted, rgba(255,255,255,.6))' }

function PlayerCell({ side, align, sport }: { side: MatchupPlayerSlot; align: 'left' | 'right'; sport: string }) {
  const prevPointsRef = useRef(side.currentPoints)
  const [delta, setDelta] = useState<number | null>(null)
  const [failedHeadshot, setFailedHeadshot] = useState<string | null>(null)

  useEffect(() => {
    const d = side.currentPoints - prevPointsRef.current
    prevPointsRef.current = side.currentPoints
    if (d > 0) {
      setDelta(d)
      const t = setTimeout(() => setDelta(null), 2500)
      return () => clearTimeout(t)
    }
  }, [side.currentPoints])

  const rev = align === 'right'
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${rev ? 'flex-row-reverse text-right' : ''}`}>
      <div className="relative h-12 w-12 shrink-0">
      <div className="h-12 w-12 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
        {side.headshotUrl && side.headshotUrl !== failedHeadshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={side.headshotUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailedHeadshot(side.headshotUrl)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] font-bold text-white/45">
            {initialsFor(side.name)}
          </div>
        )}
      </div>
      {/* The club crest on the photo's corner; the shared TeamLogo shows the team's initials when no crest loads. */}
      {side.team && !isNoTeam(side.team) ? (
        <span className={`absolute -bottom-1 ${rev ? '-left-1' : '-right-1'} rounded-full ring-2 ring-[#0b1020]`} data-testid="matchup-row-team-logo">
          <TeamLogo teamAbbr={side.team} sport={sport} size={20} />
        </span>
      ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-1.5 text-[15px] font-bold ${rev ? 'flex-row-reverse' : ''}`} style={{ color: 'var(--lsk-text, #fff)' }}>
          {side.aiInsight ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-violet-400/30 bg-violet-500/15 px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-violet-100/90"
              title={side.aiInsight}
            >
              <Sparkles className="h-2.5 w-2.5" />
              Chimmy
            </span>
          ) : null}
          <span className="truncate">{side.name}</span>
          <AfInjuryTag status={side.injuryStatus} className="shrink-0" />
        </div>
        <div className={`flex items-center gap-1 truncate text-[13px] ${rev ? 'flex-row-reverse' : ''}`} style={MUTED}>
          {side.gameStatus === 'live' ? (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" aria-label="Live" />
          ) : null}
          <span className="truncate">
            {side.opponent ? `${side.team ?? '—'} vs ${side.opponent}` : (side.team ?? '—')} · {side.gameLabel}
            {side.gameStatus === 'live' ? ' · Live' : side.gameStatus === 'final' ? ' · Final' : ''}
          </span>
        </div>
        {side.newsBlurb ? (
          <div className="truncate text-[13px]" style={MUTED}>{side.newsBlurb}</div>
        ) : null}
        {side.aiInsight ? (
          <div className="truncate text-[13px] text-violet-200/80">{side.aiInsight}</div>
        ) : null}
        {side.weatherSummary ? (
          <div className={`mt-0.5 flex ${rev ? 'justify-end' : ''}`}>
            <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[12px] text-sky-100/90">{side.weatherSummary}</span>
          </div>
        ) : null}
      </div>
      <div className={`shrink-0 tabular-nums ${rev ? 'text-left' : 'text-right'}`}>
        <div className="relative">
          <div className="text-[18px] font-bold" style={{ color: 'var(--lsk-text, #fff)' }}>{side.currentPoints.toFixed(1)}</div>
          {delta !== null ? (
            <span className="absolute -top-3 left-0 animate-[fade-out_2.5s_ease-out_forwards] text-[12px] font-bold text-emerald-300">
              +{delta.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="text-[13px]" style={MUTED}>
          {side.hasRealProjection ? `proj. ${side.projectedPoints.toFixed(1)}` : 'proj. —'}
        </div>
        {side.afProjectedPoints != null ? (
          <div className="af-proj-af text-[13px]">AF {side.afProjectedPoints.toFixed(1)}</div>
        ) : null}
      </div>
    </div>
  )
}

export function MatchupStarterRow({
  position,
  left,
  right,
  onStartSit,
  sport = 'NFL',
}: {
  position: string
  /** The league's sport, for the crest on each player's photo. */
  sport?: string
  left: MatchupPlayerSlot | null
  right: MatchupPlayerSlot | null
  /** Opens AI start/sit for this positional pairing when both sides exist. */
  onStartSit?: (a: MatchupPlayerSlot, b: MatchupPlayerSlot) => void
}) {
  const chip = POSITION_COLORS[position.toUpperCase()]
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b py-3" style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.06))' }}>
      {left ? <PlayerCell side={left} align="left" sport={sport} /> : <div className="opacity-40" />}
      <div className="flex flex-col items-center gap-1 px-1">
        <span
          className="min-w-[2.75rem] rounded-md px-2 py-1 text-center text-[12px] font-extrabold"
          style={chip ? { background: chip.fill, color: chip.text } : { background: 'var(--lsk-surface2, rgba(255,255,255,.08))', color: 'var(--lsk-text2, #fff)' }}
        >
          {position}
        </span>
        {left && right && onStartSit ? (
          <button
            type="button"
            data-testid="matchup-start-sit-row"
            onClick={() => onStartSit(left, right)}
            className="min-h-[32px] rounded-md border border-violet-400/35 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-100/95 hover:bg-violet-500/20"
          >
            Start/Sit
          </button>
        ) : null}
      </div>
      {right ? <PlayerCell side={right} align="right" sport={sport} /> : <div className="opacity-40" />}
    </div>
  )
}
