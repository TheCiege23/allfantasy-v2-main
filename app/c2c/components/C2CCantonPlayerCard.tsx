'use client'

import type { C2CPlayerRow } from './c2cPlayerTypes'

export function C2CCantonPlayerCard({
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
  const ring = 'ring-2 ring-blue-500/60'
  const pts = pointsThisWeek ?? null
  const status =
    player.bucketState === 'canton_starter'
      ? 'STARTER'
      : player.bucketState === 'taxi'
        ? 'TAXI'
        : player.bucketState === 'ir'
          ? 'IR'
          : player.isRookieEligible
            ? 'ROOKIE'
            : 'BENCH'

  const scoring =
    player.bucketState === 'canton_starter' ? (
      <span className="text-[11px] font-bold text-emerald-300">✓ Counts</span>
    ) : player.bucketState === 'taxi' ? (
      <span className="text-[11px] font-bold text-amber-300/90">Taxi — Not Counted</span>
    ) : (
      <span className="text-[11px] font-bold text-white/35">Display Only</span>
    )

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full gap-3 rounded-xl border border-white/[0.07] bg-black/25 p-2.5 text-left transition hover:bg-white/[0.04] ${compact ? 'p-2' : ''}`}
      data-testid={`c2c-canton-card-${player.playerId}`}
    >
      <div className={`relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-white/[0.06] ${ring}`}>
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/40">
          {player.playerName
            .split(' ')
            .map((s) => s[0])
            .join('')
            .slice(0, 3)}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-bold text-white">{player.playerName}</span>
          <span className="rounded-full bg-blue-600/30 px-1.5 py-0.5 text-[11px] font-bold uppercase text-blue-100">
            🏙 Canton
          </span>
          <span className="rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[11px] font-bold text-white/45">
            {status}
          </span>
          {scoring}
        </div>
        <p className="text-[11px] text-white/45">
          {player.position}
          {player.nflNbaTeam ? ` · ${player.nflNbaTeam}` : ''}
        </p>
        {pts != null ? <p className="text-[13px] font-semibold text-blue-200">{pts.toFixed(1)} pts</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/50">Yds —</span>
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/50">TDs —</span>
        </div>
      </div>
    </button>
  )
}
