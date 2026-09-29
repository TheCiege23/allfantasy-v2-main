'use client'

import { ArrowRight, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { UnifiedSavedRecommendation } from '@/lib/chimmy-actions/AIActionModel'

export interface SavedRecommendationStaleCompareProps {
  saved: UnifiedSavedRecommendation
  freshPayload: Record<string, unknown>
  freshLabel?: string
  className?: string
}

function labelKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

type DiffEntry = {
  key: string
  saved: unknown
  fresh: unknown
  direction: 'up' | 'down' | 'neutral' | 'new' | 'removed'
}

function diffPayloads(savedPayload: Record<string, unknown>, freshPayload: Record<string, unknown>): DiffEntry[] {
  const allKeys = new Set([...Object.keys(savedPayload), ...Object.keys(freshPayload)])
  const result: DiffEntry[] = []

  for (const key of allKeys) {
    const s = savedPayload[key]
    const f = freshPayload[key]
    const changed = JSON.stringify(s) !== JSON.stringify(f)
    if (!changed) continue

    let direction: DiffEntry['direction'] = 'neutral'
    if (!(key in savedPayload)) direction = 'new'
    else if (!(key in freshPayload)) direction = 'removed'
    else if (typeof s === 'number' && typeof f === 'number') direction = f > s ? 'up' : f < s ? 'down' : 'neutral'

    result.push({ key, saved: s, fresh: f, direction })
  }

  return result
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

const DIRECTION_ICON = {
  up: <TrendingUp className="h-3 w-3 text-emerald-400" />,
  down: <TrendingDown className="h-3 w-3 text-red-400" />,
  neutral: <Minus className="h-3 w-3 text-white/30" />,
  new: <span className="text-[11px] font-bold text-sky-400">NEW</span>,
  removed: <span className="text-[11px] font-bold text-red-400">GONE</span>,
}

export default function SavedRecommendationStaleCompare({
  saved,
  freshPayload,
  freshLabel = 'Current Advice',
  className = '',
}: SavedRecommendationStaleCompareProps) {
  const diffs = diffPayloads(saved.recommendationPayload, freshPayload)

  const whyChanged = (() => {
    if (diffs.length === 0) return 'No significant shift in context or recommendation signals.'
    const keys = diffs.map((d) => d.key.toLowerCase())
    if (keys.some((k) => k.includes('injury') || k.includes('status'))) {
      return 'Player availability or injury context changed since this was saved.'
    }
    if (keys.some((k) => k.includes('projection') || k.includes('confidence'))) {
      return 'Expected outcome confidence shifted as projections updated.'
    }
    if (keys.some((k) => k.includes('matchup') || k.includes('schedule') || k.includes('opponent'))) {
      return 'Matchup and schedule context changed enough to alter priority.'
    }
    return 'Multiple recommendation inputs changed and the ranking was recalculated.'
  })()

  const preferredActionNow = (() => {
    const hasConfidenceDrop = diffs.some(
      (d) => d.key.toLowerCase().includes('confidence') && d.direction === 'down',
    )
    const hasConfidenceRise = diffs.some(
      (d) => d.key.toLowerCase().includes('confidence') && d.direction === 'up',
    )
    if (hasConfidenceDrop) return 'Re-evaluate before acting; this move is less reliable now.'
    if (hasConfidenceRise) return 'This move gained support; prioritize it if team needs still match.'
    if (diffs.length >= 3) return 'Use the current recommendation instead of the saved one.'
    return 'Treat this as a minor update and proceed with the latest context.'
  })()

  return (
    <div className={`rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/10">
        <div className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold text-amber-300">Comparison</span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 px-4 py-2 border-b border-amber-500/10 bg-white/[0.02]">
        <span className="text-[11px] text-white/40 uppercase tracking-wide">Saved ({new Date(saved.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</span>
        <span />
        <span className="text-[11px] text-white/40 uppercase tracking-wide">{freshLabel}</span>
      </div>

      {diffs.length === 0 ? (
        <div className="px-4 py-4 text-center text-xs text-white/40">No material changes detected.</div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {diffs.map((d) => (
            <div key={d.key} className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] text-white/40 truncate">{labelKey(d.key)}</p>
                <p className={`text-xs truncate ${d.direction === 'removed' ? 'text-red-400 line-through' : 'text-white/60'}`}>
                  {formatValue(d.saved)}
                </p>
              </div>
              <div className="flex items-center justify-center">{DIRECTION_ICON[d.direction]}</div>
              <div className="min-w-0">
                <p className="text-[11px] text-white/40 invisible">·</p>
                <p className={`text-xs font-medium truncate ${
                  d.direction === 'up' ? 'text-emerald-300' :
                  d.direction === 'down' ? 'text-red-300' :
                  d.direction === 'new' ? 'text-sky-300' :
                  d.direction === 'removed' ? 'text-white/30' :
                  'text-white/80'
                }`}>
                  {d.direction === 'removed' ? 'No longer present' : formatValue(d.fresh)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-3 border-t border-amber-500/10 bg-amber-500/5">
        <p className="text-xs text-amber-200/60">
          {diffs.length === 0
            ? 'The underlying advice is materially unchanged.'
            : `${diffs.length} field${diffs.length > 1 ? 's' : ''} changed since this was saved.`}
        </p>
        <p className="mt-1 text-xs text-white/65">Why it changed: {whyChanged}</p>
        <p className="mt-1 text-xs text-cyan-200/85">Preferred action now: {preferredActionNow}</p>
      </div>
    </div>
  )
}
