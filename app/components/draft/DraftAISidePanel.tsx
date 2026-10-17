'use client'

import { useState } from 'react'
import type {
  DraftDecisionResult,
  DraftPickRecommendation,
  DraftAlert,
} from '@/lib/draft-intelligence'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type DraftFilter = 'best' | 'value' | 'safest' | 'upside' | 'need'

const FILTER_LABELS: Record<DraftFilter, string> = {
  best: 'Best Available',
  value: 'Best Value',
  safest: 'Safest',
  upside: 'Highest Upside',
  need: 'By Need',
}

function filterRecommendations(
  rec: DraftPickRecommendation,
  alts: DraftPickRecommendation[],
  filter: DraftFilter,
): DraftPickRecommendation[] {
  const all = [rec, ...alts]
  switch (filter) {
    case 'best': return all
    case 'value': return [...all].sort((a, b) => b.boardValueScore - a.boardValueScore)
    case 'safest': return [...all].sort((a, b) => b.teamFitScore - a.teamFitScore)
    case 'upside': return [...all].sort((a, b) => b.overallScore - a.overallScore) // upside weighted
    case 'need': return [...all].sort((a, b) => b.needScore - a.needScore)
    default: return all
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickTypeColor(type: string): string {
  switch (type) {
    case 'value': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
    case 'upside': return 'bg-purple-500/15 text-purple-400 border-purple-500/25'
    case 'safe': return 'bg-blue-500/15 text-blue-400 border-blue-500/25'
    default: return 'bg-amber-500/15 text-amber-400 border-amber-500/25'
  }
}

function alertColor(severity: string): string {
  if (severity === 'critical') return 'bg-red-500/10 border-red-500/20 text-red-400'
  if (severity === 'warning') return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
  return 'bg-blue-500/10 border-blue-500/20 text-blue-400'
}

function alertIcon(type: string): string {
  switch (type) {
    case 'tier_break': return '🔥'
    case 'positional_run': return '🏃'
    case 'stack_opportunity': return '📊'
    case 'value_cliff': return '📉'
    case 'scarcity_warning': return '⚠️'
    default: return 'ℹ️'
  }
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? 'text-emerald-400' : score >= 45 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-9 h-9 rounded-full border-2 border-current flex items-center justify-center text-xs font-bold ${color}`}>
        {score}
      </div>
      <span className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alert Bar
// ---------------------------------------------------------------------------

function AlertBar({ alerts }: { alerts: DraftAlert[] }) {
  const [collapsed, setCollapsed] = useState(false)
  if (alerts.length === 0) return null

  return (
    <div className="space-y-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {collapsed ? '▶' : '▼'} {alerts.length} Alert{alerts.length > 1 ? 's' : ''}
      </button>
      {!collapsed && alerts.map((alert, i) => (
        <div key={i} className={`text-xs px-2.5 py-1.5 rounded-lg border ${alertColor(alert.severity)}`}>
          {alertIcon(alert.type)} {alert.message}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recommendation Card
// ---------------------------------------------------------------------------

function RecommendationCard({
  rec,
  isTop,
  expanded,
  onToggle,
  onAddToQueue,
}: {
  rec: DraftPickRecommendation
  isTop: boolean
  expanded: boolean
  onToggle: () => void
  onAddToQueue?: (playerId: string) => void
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${
      isTop ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'
    }`}>
      <button onClick={onToggle} className="w-full p-3 text-left hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isTop && <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">#1</span>}
              <span className="text-sm font-semibold text-white truncate">{rec.playerName}</span>
              <span className="text-xs text-zinc-500">{rec.position}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${pickTypeColor(rec.pickType)}`}>
                {rec.pickType}
              </span>
              {rec.isValue && <span className="text-[11px] text-emerald-400">VALUE</span>}
              {rec.isReach && <span className="text-[11px] text-amber-400">REACH</span>}
              {rec.stackNote && <span className="text-[11px] text-purple-400">STACK</span>}
            </div>
          </div>
          <ScoreRing score={rec.overallScore} label="Score" />
        </div>

        {/* Top reason */}
        {rec.reasoning.length > 0 && (
          <p className="text-xs text-zinc-400 mt-1.5 line-clamp-1">{rec.reasoning[0]}</p>
        )}
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-zinc-800 space-y-2">
          {/* Score breakdown */}
          <div className="flex gap-2 pt-2">
            <ScoreRing score={rec.teamFitScore} label="Fit" />
            <ScoreRing score={rec.boardValueScore} label="Value" />
            <ScoreRing score={rec.needScore} label="Need" />
          </div>

          {/* Why this pick */}
          <div>
            <span className="text-[11px] text-zinc-500 uppercase">Why this pick</span>
            <ul className="text-xs text-zinc-400 mt-0.5 space-y-0.5">
              {rec.reasoning.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>

          {/* Notes */}
          {rec.stackNote && (
            <p className="text-xs text-purple-400">Stack: {rec.stackNote}</p>
          )}
          {rec.handcuffNote && (
            <p className="text-xs text-orange-400">Handcuff: {rec.handcuffNote}</p>
          )}

          {/* Risk flags */}
          {rec.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rec.riskFlags.map(flag => (
                <span key={flag} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {flag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}

          {/* Avoid notes */}
          {rec.avoidNotes.length > 0 && (
            <div>
              <span className="text-[11px] text-red-500 uppercase">Caution</span>
              {rec.avoidNotes.map((n, i) => (
                <p key={i} className="text-xs text-red-400">⚠ {n}</p>
              ))}
            </div>
          )}

          {/* Queue button */}
          {onAddToQueue && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToQueue(rec.playerId) }}
              className="w-full text-xs font-medium py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors border border-emerald-500/25"
            >
              + Add to Queue
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function DraftAISidePanel({
  result,
  onAddToQueue,
}: {
  result: DraftDecisionResult
  onAddToQueue?: (playerId: string) => void
}) {
  const [filter, setFilter] = useState<DraftFilter>('best')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0) // auto-expand top pick

  const filtered = filterRecommendations(result.recommendedPick, result.topAlternatives, filter)

  return (
    <div className="w-full max-w-sm space-y-3 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">AI Pick Assistant</h3>
        <span className="text-[11px] text-zinc-500">{result.confidencePct}% confident</span>
      </div>

      {/* Alerts */}
      <AlertBar alerts={result.alerts} />

      {/* Plan note */}
      {result.draftPlanNote && (
        <div className="text-xs text-zinc-400 bg-zinc-800/50 rounded-lg px-2.5 py-1.5 border border-zinc-700">
          {result.draftPlanNote}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {(Object.keys(FILTER_LABELS) as DraftFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap transition-colors ${
              filter === f
                ? 'bg-white text-black font-medium'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Recommendations */}
      <div className="space-y-1.5">
        {filtered.map((rec, i) => (
          <RecommendationCard
            key={`${rec.playerId}-${rec.rank}`}
            rec={rec}
            isTop={i === 0 && filter === 'best'}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
            onAddToQueue={onAddToQueue}
          />
        ))}
      </div>

      {/* Board Analysis Summary */}
      <div className="text-[11px] text-zinc-600 flex justify-between">
        <span>{result.boardAnalysis.totalAvailable} players available</span>
        <span>{result.boardAnalysis.picksMade} picks made</span>
      </div>
    </div>
  )
}
