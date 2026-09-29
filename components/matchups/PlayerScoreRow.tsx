'use client'

type Props = {
  playerId: string
  points: number
  isStarter: boolean
}

export default function PlayerScoreRow({ playerId, points, isStarter }: Props) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
        isStarter ? 'border-white/10 bg-black/30' : 'border-white/5 bg-black/10 opacity-70'
      }`}
      data-testid={`player-score-row-${playerId}`}
    >
      <span className="truncate text-white/90">
        {isStarter ? <span className="mr-2 text-[11px] font-bold uppercase text-cyan-300/90">Start</span> : null}
        <span className="font-mono text-xs text-white/55">{playerId}</span>
      </span>
      <span className="font-semibold tabular-nums text-white">{points.toFixed(2)}</span>
    </div>
  )
}
