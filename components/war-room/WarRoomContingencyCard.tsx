'use client'

import React from 'react'
import type { ContingencyPlan, RosterBuildAnalysis, StackOpportunity } from '@/lib/war-room/draft-intelligence-engine'

export type WarRoomContingencyCardProps = {
  plans?: ContingencyPlan[]
  stacks?: StackOpportunity[]
  rosterBuild?: RosterBuildAnalysis
  className?: string
}

export function WarRoomContingencyCard({ plans, stacks, rosterBuild, className = '' }: WarRoomContingencyCardProps) {
  return (
    <div
      className={`space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 ${className}`}
      data-testid="war-room-contingency-card"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Contingency · stacks · build</p>
        {rosterBuild && (
          <p className="mt-1 text-[11px] text-amber-100/75">{rosterBuild.buildSummary}</p>
        )}
      </div>
      {plans && plans.length > 0 && (
        <ul className="space-y-1.5">
          {plans.slice(0, 6).map((c) => (
            <li key={c.id} className="rounded-lg border border-white/8 bg-black/20 px-2 py-1 text-[11px] text-amber-50/95">
              <span className="text-white/55">{c.trigger}</span> → <strong>{c.thenPick}</strong> ({c.position}) —{' '}
              {c.rationale}
            </li>
          ))}
        </ul>
      )}
      {stacks && stacks.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200/70">Stack signals</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-cyan-100/80">
            {stacks.slice(0, 4).map((s) => (
              <li key={s.playerName}>
                {s.playerName} + {s.stacksWith}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(!plans || plans.length === 0) && (!stacks || stacks.length === 0) && (
        <p className="text-[11px] text-amber-100/60">Run intel to generate 2–6 pick contingencies and stack hints.</p>
      )}
    </div>
  )
}
