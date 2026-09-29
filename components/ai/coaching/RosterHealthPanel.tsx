'use client'

import { Activity } from 'lucide-react'
import type { CoachingPlanResponse } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

function signalColor(outlook: NonNullable<CoachingPlanResponse['positionHealth']>[number]['outlook']) {
  if (outlook === 'strong') return 'text-emerald-300'
  if (outlook === 'weak') return 'text-rose-300'
  return 'text-amber-200'
}

function barClass(outlook: NonNullable<CoachingPlanResponse['positionHealth']>[number]['outlook']) {
  if (outlook === 'strong') return 'from-emerald-500/50 to-emerald-400/20'
  if (outlook === 'weak') return 'from-rose-500/50 to-rose-400/15'
  return 'from-amber-400/45 to-amber-300/15'
}

export function RosterHealthPanel({
  positionHealth,
}: {
  positionHealth: NonNullable<CoachingPlanResponse['positionHealth']>
}) {
  if (!positionHealth.length) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#070d18] p-5 text-[13px] text-white/50">
        Position health will populate when roster projections sync.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#070d18] p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-300/90" aria-hidden />
        <h2 className="text-sm font-bold text-white">Roster health</h2>
      </div>
      <p className="mt-1 text-[11px] text-white/45">Strength, depth, and outlook by position group</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {positionHealth.map((p) => (
          <div
            key={p.position}
            className="rounded-xl border border-white/[0.06] bg-black/30 p-4 shadow-inner"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-white">{p.position}</span>
              <span className={cn('text-[11px] font-bold uppercase tracking-wide', signalColor(p.outlook))}>
                {p.outlook}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {[
                { label: 'Strength', v: p.strengthScore },
                { label: 'Depth', v: p.depthScore ?? 50 },
                { label: 'Age curve', v: p.ageScore ?? 50 },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-0.5 flex justify-between text-[11px] text-white/45">
                    <span>{row.label}</span>
                    <span className="tabular-nums text-white/60">{Math.round(row.v)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={cn('h-full rounded-full bg-gradient-to-r', barClass(p.outlook))}
                      style={{ width: `${Math.min(100, Math.max(8, row.v))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
