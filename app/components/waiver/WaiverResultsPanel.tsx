'use client'

import { useState } from 'react'
import type { WaiverResponseV2, WaiverSuggestionV2 } from '@/lib/waiver-engine/waiver-recommendation-types'

// ---------------------------------------------------------------------------
// Filter Types
// ---------------------------------------------------------------------------

type WaiverFilter =
  | 'all'
  | 'win_now'
  | 'upside'
  | 'stash'
  | 'streamer'
  | 'injury'
  | 'safest'
  | 'cheapest'
  | 'most_urgent'

const FILTER_LABELS: Record<WaiverFilter, string> = {
  all: 'All',
  win_now: 'Win Now',
  upside: 'Upside',
  stash: 'Stash',
  streamer: 'Streamer',
  injury: 'Injury Fill',
  safest: 'Safest',
  cheapest: 'Cheapest',
  most_urgent: 'Most Urgent',
}

function filterSuggestions(suggestions: WaiverSuggestionV2[], filter: WaiverFilter): WaiverSuggestionV2[] {
  if (filter === 'all') return suggestions
  return suggestions.filter(s => {
    switch (filter) {
      case 'win_now':
        return s.recommendationType === 'Immediate Starter' || s.recommendationType === 'Injury Fill-In'
      case 'upside':
        return s.longTermUpside >= 60
      case 'stash':
        return s.recommendationType === 'Dynasty Stash' || s.recommendationType === 'High-Upside Stash' || s.recommendationType === 'Playoff Stash'
      case 'streamer':
        return s.recommendationType === 'Short-Term Streamer' || s.recommendationType === 'Schedule-Based Pickup' || s.recommendationType === 'Bye Week Cover'
      case 'injury':
        return s.recommendationType === 'Injury Fill-In'
      case 'safest':
        return s.dropConfidence === 'safe' && s.waiverFitScore >= 50
      case 'cheapest':
        return s.faabBidRecommendation <= 5
      case 'most_urgent':
        return s.urgencyScore >= 70
      default:
        return true
    }
  })
}

// ---------------------------------------------------------------------------
// Badge Component
// ---------------------------------------------------------------------------

function RecTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    'Immediate Starter': 'bg-green-500/20 text-green-400 border-green-500/30',
    'Short-Term Streamer': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'Injury Fill-In': 'bg-red-500/20 text-red-400 border-red-500/30',
    'High-Upside Stash': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    'Dynasty Stash': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'Bye Week Cover': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    'Handcuff Protection': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'Playoff Stash': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'Schedule-Based Pickup': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    'Speculative Add': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${colors[type] ?? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}`}>
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Score Ring
// ---------------------------------------------------------------------------

function ScoreRing({ score, label, size = 'md' }: { score: number; label: string; size?: 'sm' | 'md' }) {
  const color = score >= 70 ? 'text-green-400' : score >= 45 ? 'text-amber-400' : 'text-red-400'
  const sizeClasses = size === 'sm' ? 'w-10 h-10 text-xs' : 'w-14 h-14 text-sm'
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`${sizeClasses} rounded-full border-2 border-current flex items-center justify-center font-bold ${color}`}>
        {score}
      </div>
      <span className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team Diagnosis Card
// ---------------------------------------------------------------------------

function TeamDiagnosisCard({ data, callouts }: { data: WaiverResponseV2['teamDiagnosis']; callouts: WaiverResponseV2['callouts'] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Team Diagnosis</h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
          {data.teamDirection}
        </span>
      </div>

      {data.biggestNeeds.length > 0 && (
        <div>
          <span className="text-xs text-zinc-500 uppercase">Biggest Needs</span>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {data.biggestNeeds.map(need => (
              <span key={need} className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
                {need}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.benchProblems.length > 0 && (
        <div>
          <span className="text-xs text-zinc-500 uppercase">Bench Issues</span>
          <ul className="text-xs text-zinc-400 mt-1 space-y-0.5">
            {data.benchProblems.map((p, i) => <li key={i}>- {p}</li>)}
          </ul>
        </div>
      )}

      {/* Callout chips */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800">
        {callouts.bestAddForPoints && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">Best for Points: {callouts.bestAddForPoints}</span>
        )}
        {callouts.bestAddForUpside && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">Best Upside: {callouts.bestAddForUpside}</span>
        )}
        {callouts.safestAdd && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Safest: {callouts.safestAdd}</span>
        )}
        {callouts.bestDropCandidate && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Best Drop: {callouts.bestDropCandidate}</span>
        )}
        {callouts.holdFAABRecommendation && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">Hold FAAB this week</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suggestion Card
// ---------------------------------------------------------------------------

function SuggestionCard({ suggestion, expanded, onToggle }: {
  suggestion: WaiverSuggestionV2
  expanded: boolean
  onToggle: () => void
}) {
  const s = suggestion
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base font-semibold text-white">{s.playerName}</span>
              <span className="text-xs text-zinc-500">{s.position} - {s.team ?? '?'}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <RecTypeBadge type={s.recommendationType} />
              <span className="text-xs text-zinc-500">#{s.rank}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <ScoreRing score={s.waiverFitScore} label="Fit" />
            <ScoreRing score={s.urgencyScore} label="Urgency" size="sm" />
          </div>
        </div>

        {/* Compact reasons */}
        <div className="mt-2 space-y-0.5">
          {s.reason.slice(0, 2).map((r, i) => (
            <p key={i} className="text-xs text-zinc-400">- {r}</p>
          ))}
        </div>

        {/* Drop + FAAB row */}
        <div className="flex items-center gap-3 mt-2 text-xs">
          {s.dropCandidate && (
            <span className={`px-1.5 py-0.5 rounded ${
              s.dropConfidence === 'safe' ? 'bg-green-500/10 text-green-400' :
              s.dropConfidence === 'risky' ? 'bg-red-500/10 text-red-400' :
              'bg-amber-500/10 text-amber-400'
            }`}>
              Drop: {s.dropCandidate} ({s.dropConfidence})
            </span>
          )}
          {s.faabBidRecommendation > 0 && (
            <span className="text-zinc-500">FAAB: ${s.faabBidRecommendation}</span>
          )}
          <span className={`ml-auto ${
            s.timingRecommendation === 'Add now' ? 'text-green-400' :
            s.timingRecommendation === 'Bid tonight' ? 'text-amber-400' :
            'text-zinc-500'
          }`}>
            {s.timingRecommendation}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-zinc-800 space-y-3">
          {/* Team fit explanation */}
          {s.teamFitExplanation && (
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-xs text-zinc-500 uppercase block mb-1">Why This Fits Your Team</span>
              <p className="text-sm text-zinc-300">{s.teamFitExplanation}</p>
            </div>
          )}

          {/* Score breakdown */}
          <div className="grid grid-cols-4 gap-2">
            <ScoreRing score={s.needFitScore} label="Need" size="sm" />
            <ScoreRing score={s.leagueFitScore} label="League" size="sm" />
            <ScoreRing score={s.opportunityScore} label="Opp" size="sm" />
            <ScoreRing score={s.shortTermProjection} label="Short" size="sm" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ScoreRing score={s.longTermUpside} label="Upside" size="sm" />
            <ScoreRing score={s.rosterUpgradeDelta} label="Upgrade" size="sm" />
            <ScoreRing score={s.newsUrgency} label="News" size="sm" />
          </div>

          {/* FAAB detail */}
          {(s.faabBidConservative != null || s.faabBidAggressive != null) && (
            <div className="text-xs text-zinc-400 flex gap-3">
              <span>Conservative: ${s.faabBidConservative ?? 0}</span>
              <span>Recommended: ${s.faabBidRecommendation}</span>
              <span>Aggressive: ${s.faabBidAggressive ?? 0}</span>
              {s.faabBidConfidence && <span className="text-zinc-500">({s.faabBidConfidence} confidence)</span>}
            </div>
          )}

          {/* Drop detail */}
          {s.dropCandidate && s.dropReason && (
            <div className="text-xs text-zinc-400">
              <span className="text-zinc-500">Drop rationale: </span>{s.dropReason}
            </div>
          )}

          {/* Evidence chips */}
          {s.factualEvidence.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {s.factualEvidence.map((e, i) => (
                <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  {e.source}: {e.metric} = {e.value}
                </span>
              ))}
            </div>
          )}

          {/* All reasons */}
          {s.reason.length > 2 && (
            <ul className="text-xs text-zinc-400 space-y-0.5">
              {s.reason.slice(2).map((r, i) => <li key={i}>- {r}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function WaiverResultsPanel({ data }: { data: WaiverResponseV2 }) {
  const [filter, setFilter] = useState<WaiverFilter>('all')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const filtered = filterSuggestions(data.suggestions, filter)

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Team Diagnosis */}
      <TeamDiagnosisCard data={data.teamDiagnosis} callouts={data.callouts} />

      {/* Strategy Notes */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1">
        <p className="text-xs text-zinc-400"><span className="text-zinc-500">FAAB:</span> {data.strategyNotes.faabPlan}</p>
        <p className="text-xs text-zinc-400"><span className="text-zinc-500">Approach:</span> {data.strategyNotes.claimApproach}</p>
        <p className="text-xs text-zinc-400"><span className="text-zinc-500">Guidance:</span> {data.strategyNotes.stashVsPointsGuidance}</p>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(FILTER_LABELS) as WaiverFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
              filter === f
                ? 'bg-white text-black font-medium'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Roster Alerts */}
      {data.rosterAlerts.length > 0 && (
        <div className="space-y-1">
          {data.rosterAlerts.map((alert, i) => (
            <div key={i} className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
              {alert}
            </div>
          ))}
        </div>
      )}

      {/* Suggestion Cards */}
      <div className="space-y-2">
        {filtered.map((s, i) => (
          <SuggestionCard
            key={`${s.playerName}-${s.rank}`}
            suggestion={s}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-sm text-zinc-500 py-8">
            No recommendations match this filter.
          </div>
        )}
      </div>
    </div>
  )
}
