'use client'

import { BookmarkCheck, CheckCircle2, ArchiveX, ChevronRight, AlertTriangle } from 'lucide-react'
import type { UnifiedSavedRecommendation } from '@/lib/chimmy-actions/AIActionModel'

const TYPE_COLORS: Record<string, string> = {
  waiver:       'bg-sky-500/20 text-sky-300',
  trade:        'bg-emerald-500/20 text-emerald-300',
  lineup:       'bg-violet-500/20 text-violet-300',
  start_sit:    'bg-amber-500/20 text-amber-300',
  draft:        'bg-blue-500/20 text-blue-300',
  player_comparison: 'bg-rose-500/20 text-rose-300',
  matchup_simulation: 'bg-orange-500/20 text-orange-300',
  roster_strategy:   'bg-teal-500/20 text-teal-300',
  story_draft:  'bg-pink-500/20 text-pink-300',
  commissioner_announcement: 'bg-yellow-600/20 text-yellow-300',
  league_health: 'bg-indigo-500/20 text-indigo-300',
  general:      'bg-white/10 text-white/50',
}

const TYPE_LABELS: Record<string, string> = {
  waiver: 'Waiver',
  trade: 'Trade',
  lineup: 'Lineup',
  start_sit: 'Start/Sit',
  draft: 'Draft',
  player_comparison: 'Player Compare',
  matchup_simulation: 'Matchup',
  roster_strategy: 'Roster',
  story_draft: 'Story',
  commissioner_announcement: 'Commissioner',
  league_health: 'League Health',
  general: 'General',
}

const STATUS_ICON = {
  saved: null,
  acted_on: <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />,
  dismissed: <ArchiveX className="h-3 w-3 text-white/30 shrink-0" />,
  stale: <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />,
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

export interface SavedRecommendationRowProps {
  rec: UnifiedSavedRecommendation
  onOpen?: (rec: UnifiedSavedRecommendation) => void
  onArchive?: (rec: UnifiedSavedRecommendation) => void
  onMarkActedOn?: (rec: UnifiedSavedRecommendation) => void
  isUpdating?: boolean
}

export default function SavedRecommendationRow({
  rec,
  onOpen,
  onArchive,
  onMarkActedOn,
  isUpdating = false,
}: SavedRecommendationRowProps) {
  const typeColor = TYPE_COLORS[rec.recommendationType] ?? TYPE_COLORS.general
  const typeLabel = TYPE_LABELS[rec.recommendationType] ?? rec.recommendationType
  const statusIcon = STATUS_ICON[rec.status]
  const isStale = rec.status === 'stale'
  const isActedOn = rec.status === 'acted_on'
  const confidencePct = Math.round(rec.confidence * 100)

  return (
    <div
      className={`group relative px-4 py-3 transition hover:bg-white/[0.03] ${
        isActedOn ? 'opacity-60' : ''
      }`}
    >
      {/* Stale banner */}
      {isStale && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1">
          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">Chimmy&apos;s view may have changed</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpen?.(rec)}
        className="w-full text-left"
        disabled={!onOpen}
      >
        <div className="flex items-start justify-between gap-2">
          {/* Left: title + meta */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${typeColor}`}>
                {typeLabel}
              </span>
              {rec.sport && rec.sport !== 'all' && (
                <span className="text-[11px] text-white/35 uppercase">{rec.sport}</span>
              )}
              {statusIcon}
            </div>

            <p className="text-sm font-medium text-white leading-snug truncate">{rec.title}</p>
            <p className="mt-0.5 text-xs text-white/50 line-clamp-2">{rec.summary}</p>

            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-white/30">{relativeTime(rec.createdAt)}</span>
              {confidencePct > 0 && (
                <span className="text-[11px] text-white/30">{confidencePct}% conf.</span>
              )}
              {rec.riskLevel && (
                <span className={`text-[11px] font-medium ${
                  rec.riskLevel === 'high' || rec.riskLevel === 'critical' ? 'text-red-400' :
                  rec.riskLevel === 'medium' ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {rec.riskLevel} risk
                </span>
              )}
            </div>
          </div>

          {/* Right: chevron */}
          {onOpen && (
            <ChevronRight className="mt-1 h-4 w-4 text-white/20 group-hover:text-white/50 transition shrink-0" />
          )}
        </div>
      </button>

      {/* Row actions */}
      <div className="mt-2 flex items-center gap-2 flex-wrap opacity-90 group-hover:opacity-100 transition">
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(rec)}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20 transition"
          >
            Reopen
          </button>
        )}

        {rec.status === 'saved' && onMarkActedOn && (
          <button
            type="button"
            onClick={() => onMarkActedOn(rec)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-50"
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            Execute
          </button>
        )}
        {!rec.isArchived && onArchive && (
          <button
            type="button"
            onClick={() => onArchive(rec)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/40 hover:text-white/70 hover:bg-white/10 transition disabled:opacity-50"
          >
            <ArchiveX className="h-2.5 w-2.5" />
            Archive
          </button>
        )}
      </div>
    </div>
  )
}
