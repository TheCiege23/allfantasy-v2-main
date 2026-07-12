'use client'

import { AlertCircle, Zap, Bot, TrendingUp } from 'lucide-react'
import type { DraftHelperPanelProps } from '@/components/app/draft-room/DraftHelperPanel'

/** Mirrors draft-room helper feed shapes so callers can pass `DraftHelperPanelProps['sportsFeed']` unchanged. */
interface DraftHelperIntelligenceProps {
  aiFeatureStatus?: DraftHelperPanelProps['aiFeatureStatus']
  sportsFeed?: DraftHelperPanelProps['sportsFeed']
  showAiOverlays?: boolean
  recommendationOverlay?: {
    label?: string | null
    confidencePct?: number | null
    stackAvailable?: boolean
    byeWeekConflict?: boolean
    safetyLevel?: 'safe' | 'upside' | null
  } | null
}

export function DraftHelperIntelligence({
  aiFeatureStatus,
  sportsFeed,
  showAiOverlays = true,
  recommendationOverlay = null,
}: DraftHelperIntelligenceProps) {
  const features = [
    { name: 'Draft assistant', active: aiFeatureStatus?.chimmyReady, icon: Bot },
    { name: 'Live recommendations', active: aiFeatureStatus?.liveBrainReady, icon: Zap },
    { name: 'Market rankings', active: aiFeatureStatus?.aiAdpEnabled, icon: TrendingUp },
    { name: 'Smart queue', active: aiFeatureStatus?.queueReorderEnabled, icon: TrendingUp },
  ]

  const activeFeatures = features.filter((f) => f.active)
  const headlines = sportsFeed?.headlines?.slice(0, 3) || []
  const injuries = sportsFeed?.injuries?.slice(0, 2) || []

  return (
    <div className="space-y-2 p-2">
      {showAiOverlays && recommendationOverlay ? (
        <div className="rounded border border-cyan-400/20 bg-cyan-500/10 p-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/90">Recommendation overlay</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {recommendationOverlay.label ? (
              <span className="rounded border border-cyan-300/35 bg-cyan-500/14 px-1.5 py-0.5 text-cyan-100">
                {recommendationOverlay.label}
              </span>
            ) : null}
            {recommendationOverlay.confidencePct != null ? (
              <span className="rounded border border-sky-300/35 bg-sky-500/10 px-1.5 py-0.5 text-sky-100">
                {recommendationOverlay.confidencePct}% confidence
              </span>
            ) : null}
            {recommendationOverlay.stackAvailable ? (
              <span className="rounded border border-violet-300/35 bg-violet-500/10 px-1.5 py-0.5 text-violet-100">Stack available</span>
            ) : null}
            {recommendationOverlay.byeWeekConflict ? (
              <span className="rounded border border-amber-300/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-100">Bye conflict</span>
            ) : null}
            {recommendationOverlay.safetyLevel ? (
              <span
                className={`rounded border px-1.5 py-0.5 ${
                  recommendationOverlay.safetyLevel === 'safe'
                    ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
                    : 'border-rose-300/35 bg-rose-500/10 text-rose-100'
                }`}
              >
                {recommendationOverlay.safetyLevel === 'safe' ? 'Safe lean' : 'Upside lean'}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* AI Features Status */}
      {activeFeatures.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Draft assist
          </h5>
          <div className="flex flex-wrap gap-1">
            {activeFeatures.map((feature) => (
              <span key={feature.name} className="rounded border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200">
                ✓ {feature.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Headlines */}
      {headlines.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Headlines
          </h5>
          <div className="space-y-1">
            {headlines.map((headline, idx) => (
              <div key={idx} className="rounded border border-white/12 bg-[#0c1630]/80 p-2 text-xs">
                <p className="text-slate-200 line-clamp-2">{headline.title}</p>
                {headline.playerName && <p className="text-slate-500 text-[10px] mt-1">{headline.playerName}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Injuries */}
      {injuries.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 mb-2">Injury Updates</h5>
          <div className="space-y-1">
            {injuries.map((injury, idx) => (
              <div key={idx} className="rounded border border-rose-400/25 bg-rose-500/10 p-2 text-xs">
                <p className="text-red-300 font-medium">{injury.playerName}</p>
                {injury.status && <p className="text-red-200 text-[10px]">{injury.status}</p>}
                {injury.note && <p className="text-slate-400 text-[10px] mt-0.5">{injury.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!activeFeatures.length && !headlines.length && !injuries.length && (
        <div className="text-center py-4 text-slate-500">
          <p className="text-xs font-medium text-slate-300">Draft guidance is getting ready</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Recommendations and player context will appear here when enough draft data is available.
          </p>
        </div>
      )}
    </div>
  )
}
