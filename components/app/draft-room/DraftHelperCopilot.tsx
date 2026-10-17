'use client'

import { Sparkles } from 'lucide-react'
import type { DraftRecommendation } from '@/components/app/draft-room/DraftHelperPanel'

interface DraftHelperCopilotProps {
  loading: boolean
  recommendation: DraftRecommendation | null
  alternatives: Array<{ player: { name: string; position: string; team?: string | null }; reason: string; confidence: number }>
  onRefresh: () => void
  onPlayerClick?: (player: { name: string; position: string; team?: string | null }) => void
  explanation: string
  evidence: string[]
  caveats: string[]
  round: number
  pick: number
  sport: string
  showAiOverlays?: boolean
  recommendationOverlay?: {
    valueDelta?: number | null
    stackAvailable?: boolean
    byeWeekConflict?: boolean
    safetyLevel?: 'safe' | 'upside' | null
  } | null
}

export function DraftHelperCopilot({
  loading,
  recommendation,
  alternatives,
  onRefresh,
  explanation,
  evidence,
  caveats,
  showAiOverlays = true,
  recommendationOverlay = null,
}: DraftHelperCopilotProps) {
  if (!recommendation?.player?.name) {
    return (
      <div className="text-center py-4 text-slate-400">
        <p className="text-sm">No recommendation available</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-2">
      <div className="rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100/85">
        Assistant guidance. Validate against your board context before locking a pick.
      </div>
      {/* Main Recommendation */}
      <div className="rounded-lg border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(16,32,58,0.85),rgba(10,18,36,0.92))] p-3">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold text-white">{recommendation.player.name}</h4>
            <p className="text-xs text-slate-400">
              {recommendation.player.position}
              {recommendation.player.team && ` • ${recommendation.player.team}`}
            </p>
            <p className="text-xs text-slate-300 mt-1">{recommendation.reason}</p>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-cyan-400">{Math.round(recommendation.confidence * 100)}%</div>
            <div className="text-xs text-slate-500">confidence</div>
          </div>
        </div>
        {showAiOverlays && recommendationOverlay ? (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
            {recommendationOverlay.valueDelta != null && Number.isFinite(recommendationOverlay.valueDelta) ? (
              <span
                className={`rounded border px-1.5 py-0.5 ${
                  recommendationOverlay.valueDelta >= 0
                    ? 'border-emerald-300/35 bg-emerald-500/12 text-emerald-100'
                    : 'border-amber-300/35 bg-amber-500/12 text-amber-100'
                }`}
              >
                {recommendationOverlay.valueDelta >= 0
                  ? `Value +${recommendationOverlay.valueDelta.toFixed(1)}`
                  : `Reach ${recommendationOverlay.valueDelta.toFixed(1)}`}
              </span>
            ) : null}
            {recommendationOverlay.stackAvailable ? (
              <span className="rounded border border-violet-300/35 bg-violet-500/10 px-1.5 py-0.5 text-violet-100">
                Stack available
              </span>
            ) : null}
            {recommendationOverlay.byeWeekConflict ? (
              <span className="rounded border border-amber-300/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-100">
                Bye-week conflict
              </span>
            ) : null}
            {recommendationOverlay.safetyLevel ? (
              <span
                className={`rounded border px-1.5 py-0.5 ${
                  recommendationOverlay.safetyLevel === 'safe'
                    ? 'border-sky-300/35 bg-sky-500/10 text-sky-100'
                    : 'border-rose-300/35 bg-rose-500/10 text-rose-100'
                }`}
              >
                {recommendationOverlay.safetyLevel === 'safe' ? 'Safe profile' : 'Upside profile'}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Alternatives */}
      {alternatives && alternatives.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-2">Alternatives</h5>
          <div className="space-y-1">
            {alternatives.slice(0, 3).map((alt, idx) => (
              <div key={idx} className="text-xs bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <p className="text-white font-medium">{alt.player.name}</p>
                <p className="text-slate-500">{alt.player.position}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explanation */}
      {explanation && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-1">Explanation</h5>
          <p className="text-xs text-slate-300 bg-slate-900/30 p-2 rounded">{explanation}</p>
        </div>
      )}

      {/* Evidence */}
      {evidence && evidence.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-1">Evidence</h5>
          <ul className="text-xs text-slate-300 space-y-1 ml-3">
            {evidence.slice(0, 3).map((item, idx) => (
              <li key={idx} className="list-disc">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="w-full rounded border border-cyan-300/35 bg-cyan-500/18 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/28 disabled:opacity-50"
      >
        {loading ? 'Refreshing...' : 'Refresh Recommendation'}
      </button>
    </div>
  )
}
