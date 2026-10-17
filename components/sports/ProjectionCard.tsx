'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export type ProjectionData = {
  playerName: string
  position?: string
  team?: string
  projectedPoints: number | null
  projectedPointsPerGame?: number | null
  restOfSeasonPoints?: number | null
  ceiling?: number | null
  floor?: number | null
  delta?: number | null
}

function deltaDisplay(delta: number | null | undefined) {
  if (delta == null || delta === 0) return { icon: <Minus className="h-3 w-3" />, color: 'text-white/30', prefix: '' }
  if (delta > 0) return { icon: <TrendingUp className="h-3 w-3" />, color: 'text-emerald-400', prefix: '+' }
  return { icon: <TrendingDown className="h-3 w-3" />, color: 'text-red-400', prefix: '' }
}

/** Compact inline projection chip for use inside roster rows, matchup cards, etc. */
export function ProjectionChip({ points, label }: { points: number | null; label?: string }) {
  if (points == null) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-300">
      {points.toFixed(1)} {label ?? 'proj'}
    </span>
  )
}

/** Full projection card for standalone display (player profile, matchup detail). */
export function ProjectionCard({ data }: { data: ProjectionData }) {
  const d = deltaDisplay(data.delta)

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-white/80">{data.playerName}</p>
          {(data.position || data.team) && (
            <p className="text-[11px] text-white/35">
              {data.position && <span className="font-semibold text-cyan-300/60">{data.position}</span>}
              {data.position && data.team && ' · '}
              {data.team}
            </p>
          )}
        </div>
        {data.delta != null && (
          <div className={`flex items-center gap-0.5 text-[11px] font-bold ${d.color}`}>
            {d.icon} {d.prefix}{data.delta.toFixed(1)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ProjStat label="Week Proj" value={data.projectedPoints} />
        <ProjStat label="Pts/Game" value={data.projectedPointsPerGame} />
        <ProjStat label="Ceiling" value={data.ceiling} accent="emerald" />
        <ProjStat label="Floor" value={data.floor} accent="amber" />
      </div>

      {data.restOfSeasonPoints != null && (
        <div className="mt-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-center">
          <span className="text-[11px] uppercase text-white/25">Rest of Season</span>
          <p className="text-[15px] font-bold text-white/70">{data.restOfSeasonPoints.toFixed(1)}</p>
        </div>
      )}
    </div>
  )
}

function ProjStat({ label, value, accent }: { label: string; value: number | null | undefined; accent?: string }) {
  const color = accent === 'emerald' ? 'text-emerald-400' : accent === 'amber' ? 'text-amber-300' : 'text-white/75'
  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-wide text-white/25">{label}</p>
      <p className={`text-[14px] font-bold ${value != null ? color : 'text-white/20'}`}>
        {value != null ? value.toFixed(1) : '—'}
      </p>
    </div>
  )
}

/** Projection row for tables (waiver wire, rankings, draft board). */
export function ProjectionRow({
  playerName,
  position,
  team,
  projected,
  delta,
}: {
  playerName: string
  position?: string
  team?: string
  projected: number | null
  delta?: number | null
}) {
  const d = deltaDisplay(delta)
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="min-w-0 flex-1">
        <span className="text-[12px] font-medium text-white/70">{playerName}</span>
        {(position || team) && (
          <span className="ml-1 text-[11px] text-white/30">{position} {team}</span>
        )}
      </div>
      <span className="text-[12px] font-bold text-cyan-300">
        {projected != null ? projected.toFixed(1) : '—'}
      </span>
      {delta != null && delta !== 0 && (
        <span className={`flex items-center gap-0.5 text-[11px] font-bold ${d.color}`}>
          {d.icon}{d.prefix}{delta.toFixed(1)}
        </span>
      )}
    </div>
  )
}
