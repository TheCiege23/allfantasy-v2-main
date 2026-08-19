'use client'

export function MatchupWeekSelector({
  season,
  week,
  maxWeek,
  onChange,
  disabled,
}: {
  season: number
  week: number
  maxWeek?: number
  onChange: (next: { season: number; week: number }) => void
  disabled?: boolean
}) {
  const cap = maxWeek ?? 40
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-[#0a1228]/90 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">Week</span>
      <button
        type="button"
        disabled={disabled || week <= 1}
        className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-sm text-white/80 disabled:opacity-30"
        onClick={() => onChange({ season, week: Math.max(1, week - 1) })}
      >
        −
      </button>
      <div className="min-w-[72px] text-center text-sm font-bold text-[#ffb8d1]">
        W{week}{' '}
        <span className="text-[11px] font-medium text-white/40">· {season}</span>
      </div>
      <button
        type="button"
        disabled={disabled || week >= cap}
        className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-sm text-white/80 disabled:opacity-30"
        onClick={() => onChange({ season, week: Math.min(cap, week + 1) })}
      >
        +
      </button>
    </div>
  )
}
