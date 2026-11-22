'use client'

import type { BroadcastMatchupRow } from '@/lib/broadcast-engine/types'

interface LiveScoreRendererProps {
  matchups: BroadcastMatchupRow[]
  leagueName: string | null
  sport: string
  week: number | null
  className?: string
}

export function LiveScoreRenderer({
  matchups,
  leagueName,
  sport,
  week,
  className = '',
}: LiveScoreRendererProps) {
  if (matchups.length === 0) {
    return (
      <div className={`flex min-h-[200px] flex-col items-center justify-center rounded-2xl bg-black/40 p-8 ${className}`}>
        <p className="text-2xl font-semibold text-white md:text-3xl xl:text-4xl">{leagueName ?? 'League'}</p>
        <p className="mt-2 text-lg text-zinc-400 xl:text-xl">No matchups this week</p>
        {week != null && <p className="mt-1 text-zinc-500">Week {week}</p>}
      </div>
    )
  }

  return (
    <div className={`space-y-6 rounded-2xl bg-black/40 p-6 md:p-8 xl:p-10 ${className}`}>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white md:text-4xl xl:text-5xl 2xl:text-6xl">{leagueName ?? 'League'}</h2>
        <p className="mt-1 text-lg text-zinc-400 xl:text-xl 2xl:text-2xl">
          {sport}
          {week != null && ` · Week ${week}`}
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {matchups.map((m) => (
          <div
            key={m.matchupId}
            className="rounded-xl border border-white/10 bg-white/5 p-5 text-center xl:p-6"
          >
            <div className="flex items-center justify-center gap-4">
              <div className="min-w-0 flex-1 text-right">
                <p className="truncate text-lg font-semibold text-white md:text-xl xl:text-2xl">{m.teamAName}</p>
                <p className="text-3xl font-bold text-amber-400 md:text-4xl xl:text-5xl 2xl:text-6xl">{m.scoreA.toFixed(1)}</p>
              </div>
              <span className="text-zinc-500 xl:text-lg">vs</span>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-lg font-semibold text-white md:text-xl xl:text-2xl">{m.teamBName}</p>
                <p className="text-3xl font-bold text-amber-400 md:text-4xl xl:text-5xl 2xl:text-6xl">{m.scoreB.toFixed(1)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
