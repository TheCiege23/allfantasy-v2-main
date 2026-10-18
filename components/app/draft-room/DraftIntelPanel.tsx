'use client'

/**
 * Intel tab — "before your next pick". One row per pick other managers make
 * before the viewer's next turn: how that manager has drafted so far, the
 * positions they have not filled, and a projected pick. All numbers come from
 * `lib/draft-room/draftIntelLookahead`.
 */

import React from 'react'
import { positionColor } from '@/lib/draft/positions'
import { formatAdpDelta, type ManagerTendencyKind } from '@/lib/draft-room/draftPulse'
import type { LookaheadResult, LookaheadRow } from '@/lib/draft-room/draftIntelLookahead'

export type DraftIntelPanelProps = {
  lookahead: LookaheadResult | null
  /** True when the draft has not started or is complete — there is nothing to look ahead to. */
  idle: boolean
  sport?: string
  formatPickLabel: (overall: number) => string
}

const MAX_NEEDS_SHOWN = 4

const TENDENCY_STYLE: Record<ManagerTendencyKind, { label: string; className: string }> = {
  reacher: { label: 'Reacher', className: 'border-rose-400/30 bg-rose-500/12 text-rose-200' },
  value_hunter: { label: 'Value hunter', className: 'border-emerald-400/30 bg-emerald-500/12 text-emerald-200' },
  adp_loyal: { label: 'ADP loyal', className: 'border-white/15 bg-white/[0.06] text-white/80' },
  unknown: { label: 'Too early', className: 'border-white/10 bg-transparent text-white/50' },
}

function PositionChip({ pos, sport }: { pos: string; sport?: string }) {
  return (
    <span
      className="inline-flex h-[18px] items-center rounded px-1 text-[11px] font-bold tracking-wide text-[#0a111d]"
      style={{ backgroundColor: positionColor(pos, sport) }}
    >
      {pos}
    </span>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

function habitLine(row: LookaheadRow): string {
  const t = row.tendency
  if (row.isAuto && t.kind === 'unknown') return 'Auto-drafting · follows best available'
  if (t.kind === 'unknown' || t.averageDelta == null) return 'Not enough picks with ADP to read yet'
  const avg = Math.abs(t.averageDelta).toFixed(1)
  if (t.kind === 'reacher') return `Picks ${avg} spots before ADP on average`
  if (t.kind === 'value_hunter') return `Picks ${avg} spots after ADP on average`
  return `Picks within 2 spots of ADP (${formatAdpDelta(t.averageDelta)})`
}

function IntelRow({ row, sport }: { row: LookaheadRow; sport?: string }) {
  const tendency = TENDENCY_STYLE[row.tendency.kind]
  const needs = row.needs.slice(0, MAX_NEEDS_SHOWN)
  const moreNeeds = row.needs.length - needs.length
  return (
    <li
      className="flex gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
      data-testid="draft-intel-row"
    >
      <div className="flex w-9 shrink-0 flex-col items-center gap-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/85">
          {initials(row.displayName)}
        </span>
        <span className="text-[11px] font-semibold text-white/50">{row.pickLabel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="truncate text-[12px] font-semibold text-white">{row.displayName}</span>
          {row.isAuto ? (
            <span className="rounded border border-violet-400/30 bg-violet-500/12 px-1 text-[11px] font-bold uppercase tracking-wide text-violet-200">
              Auto
            </span>
          ) : null}
          <span className={`rounded border px-1 text-[11px] font-bold uppercase tracking-wide ${tendency.className}`}>
            {tendency.label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-white/55">{habitLine(row)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-white/45">Needs</span>
          {needs.length > 0 ? (
            needs.map((pos) => <PositionChip key={pos} pos={pos} sport={sport} />)
          ) : (
            <span className="text-[11px] text-white/55">Depth</span>
          )}
          {moreNeeds > 0 ? <span className="text-[11px] text-white/45">+{moreNeeds}</span> : null}
        </div>
      </div>
      <div className="w-[96px] shrink-0 text-right">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">Likely</p>
        {row.projected ? (
          <>
            <p className="truncate text-[12px] font-semibold text-white" title={row.projected.name}>
              {row.projected.name}
            </p>
            <span className="inline-flex items-center gap-1">
              <PositionChip pos={row.projected.position} sport={sport} />
              <span className="text-[11px] text-white/45">ADP {row.projected.adp.toFixed(1)}</span>
            </span>
          </>
        ) : (
          <p className="text-[11px] text-white/45">—</p>
        )}
      </div>
    </li>
  )
}

function DraftIntelPanelInner({ lookahead, idle, sport, formatPickLabel }: DraftIntelPanelProps) {
  if (idle || !lookahead) {
    return (
      <div className="p-3 text-[12px] text-white/60" data-testid="draft-intel-panel-idle">
        Intel appears once the draft is running: who picks before you, how they draft, and who they are likely to take.
      </div>
    )
  }

  const { rows, windowSize, startOverall, viewerNextOverall } = lookahead
  const windowLabel =
    windowSize > 0 ? `${formatPickLabel(startOverall)} → ${formatPickLabel(startOverall + windowSize - 1)}` : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="draft-intel-panel">
      <div className="shrink-0 px-2.5 pb-1.5 pt-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-200/90">
          {viewerNextOverall != null ? 'Before your next pick' : 'Next picks'}
          {windowLabel ? ` · ${windowLabel}` : ''}
        </p>
        <p className="mt-0.5 text-[11px] text-white/55">
          Style comes from this draft&apos;s picks vs ADP. &ldquo;Likely&rdquo; is an estimate: best ADP that fills a need.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] text-white/60" data-testid="draft-intel-panel-empty">
          {viewerNextOverall != null ? 'You pick again right away — nobody picks in between.' : 'No picks left to look ahead to.'}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 space-y-1.5 overflow-auto px-2.5 pb-2.5">
          {rows.map((row) => (
            <IntelRow key={row.overall} row={row} sport={sport} />
          ))}
          {windowSize > rows.length ? (
            <li className="py-1 text-center text-[11px] text-white/45">
              +{windowSize - rows.length} more picks before {viewerNextOverall != null ? 'yours' : 'the end'}
            </li>
          ) : null}
        </ol>
      )}
    </div>
  )
}

export const DraftIntelPanel = React.memo(DraftIntelPanelInner)
