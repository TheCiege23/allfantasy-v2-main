'use client'

import { Map } from 'lucide-react'

export function CoachingTimeline({
  timelinePlan,
  horizonYears,
}: {
  timelinePlan: Array<{ year: number; title: string; actions: string[] }>
  horizonYears: number
}) {
  const rows = timelinePlan.filter((_, i) => i < horizonYears)

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-[#070d18] p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Map className="h-4 w-4 text-violet-300" aria-hidden />
        <h2 className="text-sm font-bold text-white">Roadmap</h2>
      </div>
      <p className="mt-1 text-[11px] text-white/45">Year-by-year focus — updates with your timeline selector</p>
      <div className="relative mt-5 space-y-0">
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-violet-500/50 via-cyan-500/30 to-transparent" aria-hidden />
        {rows.map((row, idx) => (
          <div key={row.year} className="relative flex gap-4 pb-8 last:pb-0">
            <div className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-400/40 bg-[#0a1020] text-[11px] font-bold text-violet-100">
              {idx + 1}
            </div>
            <div className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-black/30 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{row.year}</p>
              <p className="mt-1 text-[14px] font-semibold text-white">{row.title}</p>
              <ul className="mt-2 space-y-1.5">
                {row.actions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-white/70">
                    <span className="text-violet-400/90">→</span>
                    <span className="leading-snug">{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
