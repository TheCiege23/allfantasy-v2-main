'use client'

/**
 * [NEW] components/schedule/NbaGameVolumeBar.tsx
 * Visual bar showing NBA game density per day for a fantasy week.
 * Shows day classification with color coding + game counts.
 */

interface DayVolume {
  date: string
  dayOfWeek: number
  gameCount: number
  classification: 'heavy' | 'moderate' | 'light' | 'off'
}

interface NbaGameVolumeBarProps {
  days: DayVolume[]
  highlightDate?: string | null
  highlightRole?: string | null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function classColor(c: string): string {
  switch (c) {
    case 'heavy': return 'bg-orange-500/80'
    case 'moderate': return 'bg-amber-500/60'
    case 'light': return 'bg-emerald-500/50'
    case 'off': return 'bg-white/10'
    default: return 'bg-white/10'
  }
}

function classLabel(c: string): string {
  switch (c) {
    case 'heavy': return 'Heavy'
    case 'moderate': return 'Moderate'
    case 'light': return 'Light'
    case 'off': return 'Off'
    default: return ''
  }
}

export function NbaGameVolumeBar({ days, highlightDate, highlightRole }: NbaGameVolumeBarProps) {
  const maxGames = Math.max(...days.map((d) => d.gameCount), 1)

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1">
        {days.map((d) => {
          const height = d.gameCount > 0 ? Math.max(16, (d.gameCount / maxGames) * 64) : 8
          const isHighlighted = d.date === highlightDate

          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              {/* Bar */}
              <div
                className={`w-full rounded-t-sm transition-all ${classColor(d.classification)} ${
                  isHighlighted ? 'ring-2 ring-cyan-400/60' : ''
                }`}
                style={{ height: `${height}px` }}
                title={`${d.date}: ${d.gameCount} games (${classLabel(d.classification)})`}
              />
              {/* Game count */}
              <span className="text-[11px] font-mono text-white/60">
                {d.gameCount > 0 ? d.gameCount : '—'}
              </span>
              {/* Day label */}
              <span className={`text-[11px] ${isHighlighted ? 'font-bold text-cyan-300' : 'text-white/40'}`}>
                {DAY_LABELS[d.dayOfWeek] ?? '?'}
              </span>
              {/* Event role badge */}
              {isHighlighted && highlightRole && (
                <span className="mt-0.5 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[11px] font-bold text-cyan-200">
                  {highlightRole}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-white/40">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-orange-500/80" /> Heavy (9+)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500/60" /> Moderate (5-8)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/50" /> Light (1-4)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-white/10" /> Off</span>
      </div>
    </div>
  )
}
