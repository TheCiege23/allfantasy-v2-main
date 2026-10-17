'use client'

import type { C2CPlayerRow } from './c2cPlayerTypes'

export function C2CCampusPlayerCard({
  player,
  pointsThisWeek,
  onOpen,
  compact,
}: {
  player: C2CPlayerRow
  pointsThisWeek?: number | null
  onOpen?: () => void
  compact?: boolean
}) {
  const ring = 'ring-2 ring-violet-500/60'
  const pts = pointsThisWeek ?? null
  const scoring =
    player.bucketState === 'campus_starter' ? (
      <span className="text-[11px] font-bold text-emerald-300">✓ Counts</span>
    ) : player.bucketState === 'devy' ? (
      <span className="text-[11px] font-bold text-violet-300/90">Prospect</span>
    ) : (
      <span className="text-[11px] font-bold text-white/35">Display only</span>
    )

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full gap-3 rounded-xl border border-white/[0.07] bg-black/25 p-2.5 text-left transition hover:bg-white/[0.04] ${compact ? 'p-2' : ''}`}
      data-testid={`c2c-campus-card-${player.playerId}`}
    >
      <div className={`relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-white/[0.06] ${ring}`}>
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/40">
          {player.playerName
            .split(' ')
            .map((s) => s[0])
            .join('')
            .slice(0, 3)}
        </div>
        {player.schoolLogoUrl ? (
          <img
            src={player.schoolLogoUrl}
            alt=""
            className="absolute bottom-0 right-0 h-5 w-5 rounded-sm border border-white/10 bg-black/40 object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-bold text-white">{player.playerName}</span>
          <span className="rounded-full bg-violet-600/30 px-1.5 py-0.5 text-[11px] font-bold uppercase text-violet-100">
            🎓 Campus
          </span>
          {scoring}
        </div>
        <p className="text-[11px] text-white/45">
          {player.position}
          {player.school ? ` · ${player.school}` : ''}
          {player.classYear ? ` · ${player.classYear}` : ''}
        </p>
        {pts != null ? <p className="text-[13px] font-semibold text-violet-200">{pts.toFixed(1)} pts</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/50">Yds —</span>
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/50">TDs —</span>
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/50">Recs —</span>
        </div>
      </div>
    </button>
  )
}
