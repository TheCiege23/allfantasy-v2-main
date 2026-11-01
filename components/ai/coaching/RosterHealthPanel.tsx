'use client'

import { Activity } from 'lucide-react'
import type { CoachingPlanResponse } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

function signalColor(outlook: NonNullable<CoachingPlanResponse['positionHealth']>[number]['outlook']) {
  if (outlook === 'strong') return 'rdt-good'
  if (outlook === 'weak') return 'rdt-bad'
  return 'rdt-warn'
}

function barClass(outlook: NonNullable<CoachingPlanResponse['positionHealth']>[number]['outlook']) {
  if (outlook === 'strong') return 'bg-[var(--rdt-good)]'
  if (outlook === 'weak') return 'bg-[var(--rdt-bad)]'
  return 'bg-[var(--rdt-warn)]'
}

export function RosterHealthPanel({
  positionHealth,
}: {
  positionHealth: NonNullable<CoachingPlanResponse['positionHealth']>
}) {
  if (!positionHealth.length) {
    return (
      <section className="rounded-2xl border rdt-line rdt-surface p-5 text-[13px] rdt-faint">
        Position health will populate when roster projections sync.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border rdt-line rdt-surface p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 rdt-accent" aria-hidden />
        <h2 className="text-sm font-bold rdt-text">Roster health</h2>
      </div>
      <p className="mt-1 text-[11px] rdt-faint">Strength, depth, and outlook by position group</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {positionHealth.map((p) => (
          <div
            key={p.position}
            className="rounded-xl border rdt-line rdt-well p-4 shadow-inner"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold rdt-text">{p.position}</span>
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
                  <div className="mb-0.5 flex justify-between text-[11px] rdt-faint">
                    <span>{row.label}</span>
                    <span className="tabular-nums rdt-muted">{Math.round(row.v)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full rdt-skel">
                    <div
                      className={cn('h-full rounded-full', barClass(p.outlook))}
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
