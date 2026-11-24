'use client'

/**
 * PROMPT 4: Draft Center — Startup Vet Draft, Rookie Draft, Devy Draft tabs.
 * Snake/linear visualization note, traded picks, current roster, devy slots used/remaining, class depth sidebar, best ball tips.
 */

import { useState } from 'react'
import Link from 'next/link'

type DevyDraftTab = 'startup' | 'rookie' | 'devy'

type NflClassDepth = { qb: number; rb: number; wr: number; te: number }
type NbaClassDepth = { g: number; f: number; c: number }

interface DevyDraftCenterProps {
  leagueId: string
  sport?: 'NFL' | 'NBA'
  startupRounds?: number
  rookieRounds: number
  devyRounds: number
  startupType: string
  rookieType: string
  devyType: string
  devySlotsUsed: number
  devySlotCount: number
  bestBallEnabled: boolean
  classDepthByYear?: Record<number, NflClassDepth | NbaClassDepth>
  /**
   * The league's current draft phase (the devy summary's draftPhaseInfo). The Devy home used to show it in a separate
   * "Draft" card with its own "Go to Draft" above this one (Devy audit item 3); it now heads this section, which opens
   * on that draft's tab.
   */
  current?: { phase: string; status: string } | null
}

const PHASE_TO_TAB: Record<string, DevyDraftTab> = { startup_vet: 'startup', startup: 'startup', rookie: 'rookie', devy: 'devy' }
const PHASE_LABEL: Record<DevyDraftTab, string> = { startup: 'Startup vet draft', rookie: 'Rookie draft', devy: 'Devy draft' }
const STATUS_LABEL: Record<string, string> = { not_started: 'not started', in_progress: 'in progress', paused: 'paused', completed: 'completed' }

export function DevyDraftCenter({
  leagueId,
  sport = 'NFL',
  startupRounds,
  rookieRounds,
  devyRounds,
  startupType,
  rookieType,
  devyType,
  devySlotsUsed,
  devySlotCount,
  bestBallEnabled,
  classDepthByYear = {},
  current = null,
}: DevyDraftCenterProps) {
  const currentTab = current ? PHASE_TO_TAB[current.phase] ?? null : null
  const [tab, setTab] = useState<DevyDraftTab>(currentTab ?? 'startup')

  const tabs: { id: DevyDraftTab; label: string; rounds: number; type: string }[] = [
    { id: 'startup', label: 'Startup Vet Draft', rounds: startupRounds ?? 0, type: startupType },
    { id: 'rookie', label: 'Rookie Draft', rounds: rookieRounds, type: rookieType },
    { id: 'devy', label: 'Devy Draft', rounds: devyRounds, type: devyType },
  ]

  const years = Object.keys(classDepthByYear)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(0, 5)

  return (
    <div data-devy-draft-center className="flex flex-col gap-4 rounded-xl border border-[var(--line)] bg-[var(--chip)] p-4 lg:flex-row">
      <div className="flex-1 space-y-3">
        <h3 className="text-base font-semibold text-[var(--text)]">Draft Center</h3>
        {current && currentTab ? (
          <p className="text-xs text-[var(--text2)]">
            Now: {PHASE_LABEL[currentTab]} · {STATUS_LABEL[current.status] ?? current.status.replace(/_/g, ' ')}
          </p>
        ) : null}
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                tab === t.id ? 'bg-[var(--chip)] text-[var(--text)]' : 'text-[var(--text2)] hover:bg-[var(--chip)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-[var(--chip)] p-3">
          <p className="text-sm text-[var(--text)]">
            {tab === 'startup' && 'Startup vet draft: veterans only. No NCAA or rookies.'}
            {tab === 'rookie' && (sport === 'NBA'
              ? 'Rookie draft: first-year NBA pros. Devy-held promoted players are excluded.'
              : 'Rookie draft: first-year NFL pros. Devy-held promoted players are excluded.')}
            {tab === 'devy' && (sport === 'NBA'
              ? 'Devy draft: NCAA Basketball prospects only (G/F/C). Graduated and rostered excluded.'
              : 'Devy draft: NCAA Football prospects only (QB/RB/WR/TE). Graduated and rostered excluded.')}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {tabs.find((t) => t.id === tab)?.rounds} rounds · {tabs.find((t) => t.id === tab)?.type}
          </p>
          <Link
            href={`/league/${leagueId}?tab=Draft`}
            className="mt-3 inline-block rounded-lg bg-[var(--chip)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--chip)]"
          >
            Go to Draft
          </Link>
        </div>
        {bestBallEnabled && (
          <p className="text-xs text-[var(--muted)]">
            Best ball roster construction: prioritize ceiling and depth; lineup is auto-optimized each period.
          </p>
        )}
      </div>
      <div className="w-full space-y-3 lg:w-64">
        {/* Devy slots used is the stash card's count above; not repeated here (2026-11-23). */}
        {years.length > 0 && (
          <div className="rounded-lg bg-[var(--chip)] p-3">
            <h4 className="text-xs font-medium text-[var(--text)]">Class depth (by year)</h4>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text2)]">
              {years.map((y) => {
                const d = classDepthByYear[y]
                if (!d) return null
                if (sport === 'NBA') {
                  const nb = d as NbaClassDepth
                  return <li key={y}>{y}: G {nb.g ?? 0} · F {nb.f ?? 0} · C {nb.c ?? 0}</li>
                }
                const nf = d as NflClassDepth
                return <li key={y}>{y}: QB {nf.qb} · RB {nf.rb} · WR {nf.wr} · TE {nf.te}</li>
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
