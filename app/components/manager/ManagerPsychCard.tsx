'use client'

import { useState } from 'react'
import type { ManagerEdgeProfile, NegotiationTip, ExploitNote, CautionNote } from '@/lib/manager-edge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function archetypeColor(archetype: string): string {
  const colors: Record<string, string> = {
    Shark: 'bg-red-500/15 text-red-400 border-red-500/25',
    Taco: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    Gambler: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    Hoarder: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
    Impulsive: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
    'Patient Builder': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    'Win-Now Addict': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    Contrarian: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
    'Fair Dealer': 'bg-green-500/15 text-green-400 border-green-500/25',
  }
  return colors[archetype] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
}

function archetypeEmoji(archetype: string): string {
  const emojis: Record<string, string> = {
    Shark: '🦈', Taco: '🌮', Gambler: '🎲', Hoarder: '🏦',
    Impulsive: '⚡', 'Patient Builder': '🧱', 'Win-Now Addict': '🏆',
    Contrarian: '🔄', 'Fair Dealer': '🤝',
  }
  return emojis[archetype] ?? '👤'
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-red-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-emerald-400'
}

function confidenceColor(conf: string): string {
  if (conf === 'high') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  if (conf === 'medium') return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
}

// ---------------------------------------------------------------------------
// Trait Radar (simplified bar chart)
// ---------------------------------------------------------------------------

function TraitRadar({ scores }: { scores: Record<string, number> }) {
  const traits = [
    { key: 'aggression', label: 'Aggression' },
    { key: 'patience', label: 'Patience' },
    { key: 'riskTaking', label: 'Risk' },
    { key: 'negotiation', label: 'Negotiation' },
    { key: 'marketAwareness', label: 'Market IQ' },
    { key: 'consistency', label: 'Consistency' },
  ]

  return (
    <div className="space-y-1">
      {traits.map(({ key, label }) => {
        const score = scores[key] ?? 50
        const color = score >= 70 ? 'bg-red-500' : score >= 45 ? 'bg-amber-500' : 'bg-emerald-500'
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500 w-16 text-right">{label}</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-[11px] text-zinc-400 w-6 text-right">{score}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tip Card
// ---------------------------------------------------------------------------

function TipCard({ tip }: { tip: NegotiationTip }) {
  const catColors: Record<string, string> = {
    approach: 'text-blue-400',
    framing: 'text-purple-400',
    timing: 'text-amber-400',
    asset_preference: 'text-emerald-400',
    avoid: 'text-red-400',
  }

  return (
    <div className="text-xs text-zinc-400 flex gap-2">
      <span className={`text-[11px] uppercase font-medium ${catColors[tip.category] ?? 'text-zinc-500'} whitespace-nowrap`}>
        {tip.category.replace('_', ' ')}
      </span>
      <span>{tip.tip}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exploit/Caution Section
// ---------------------------------------------------------------------------

function ExploitSection({ exploits, cautions }: { exploits: ExploitNote[]; cautions: CautionNote[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Exploits */}
      <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
        <h4 className="text-[11px] text-emerald-500 uppercase font-medium mb-1">Exploitable Patterns</h4>
        {exploits.length > 0 ? (
          <div className="space-y-1">
            {exploits.map((e, i) => (
              <div key={i} className="text-[11px] text-zinc-400">
                <span className="text-emerald-400 mr-1">{e.reliability}%</span>
                {e.description}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">No clear exploitable patterns detected.</p>
        )}
      </div>

      {/* Cautions */}
      <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2">
        <h4 className="text-[11px] text-red-500 uppercase font-medium mb-1">Caution Notes</h4>
        {cautions.length > 0 ? (
          <div className="space-y-1">
            {cautions.map((c, i) => (
              <div key={i} className="text-[11px] text-zinc-400">
                <span className={`mr-1 ${c.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`}>
                  {c.severity === 'high' ? '⚠️' : 'ℹ️'}
                </span>
                {c.description}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">No significant caution flags.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Card
// ---------------------------------------------------------------------------

export default function ManagerPsychCard({
  profile,
  compact = false,
}: {
  profile: ManagerEdgeProfile
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const p = profile

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => !compact && setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base font-semibold text-white">{p.managerName}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${archetypeColor(p.archetype)}`}>
                {archetypeEmoji(p.archetype)} {p.archetype}
              </span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${confidenceColor(p.confidenceLevel)}`}>
                {p.confidenceLevel} conf ({p.sampleSize} trades)
              </span>
            </div>
            <p className="text-xs text-zinc-400">{p.archetypeDescription}</p>
          </div>
        </div>

        {/* Quick approach summary */}
        <div className="mt-2 bg-zinc-800/50 rounded-lg px-2.5 py-1.5">
          <span className="text-[11px] text-zinc-500 uppercase">Best Approach</span>
          <p className="text-xs text-zinc-300">{p.bestApproachSummary}</p>
        </div>

        {/* Value/undervalue chips */}
        <div className="flex gap-3 mt-2">
          {p.likelyToValue.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-zinc-500">Values:</span>
              {p.likelyToValue.map(v => (
                <span key={v} className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{v}</span>
              ))}
            </div>
          )}
          {p.likelyToUndervalue.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-zinc-500">Undervalues:</span>
              {p.likelyToUndervalue.map(v => (
                <span key={v} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{v}</span>
              ))}
            </div>
          )}
        </div>

        {!compact && (
          <span className="text-[11px] text-zinc-600 mt-1 block">{expanded ? '▲ Collapse' : '▼ Full profile'}</span>
        )}
      </button>

      {/* Expanded */}
      {expanded && !compact && (
        <div className="px-4 pb-4 pt-0 border-t border-zinc-800 space-y-3">
          {/* Trait Radar */}
          <div className="pt-2">
            <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Trait Profile</h4>
            <TraitRadar scores={p.traitRadar as unknown as Record<string, number>} />
          </div>

          {/* Key Tendency Scores */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Panic', score: p.tendencies.panicLikelihood },
              { label: 'Buy High', score: p.tendencies.buyHighTendency },
              { label: 'Sell Low', score: p.tendencies.sellLowTendency },
              { label: 'Injury React', score: p.tendencies.injuryOverreaction },
              { label: 'Risk', score: p.tendencies.riskAppetite },
              { label: 'Patience', score: p.tendencies.patienceScore },
            ].map(({ label, score }) => (
              <div key={label} className="text-center">
                <div className={`text-sm font-bold ${scoreColor(score)}`}>{score}</div>
                <div className="text-[11px] text-zinc-500 uppercase">{label}</div>
              </div>
            ))}
          </div>

          {/* Negotiation Tips */}
          <div>
            <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Negotiation Tips</h4>
            <div className="space-y-1.5">
              {p.negotiationTips.map((tip, i) => <TipCard key={i} tip={tip} />)}
            </div>
          </div>

          {/* Exploit / Caution */}
          <ExploitSection exploits={p.exploitNotes} cautions={p.cautionNotes} />

          {/* Common Mistakes */}
          {p.commonMistakes.length > 0 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Common Mistakes</h4>
              <ul className="text-[11px] text-zinc-400 space-y-0.5">
                {p.commonMistakes.map((m, i) => <li key={i}>• {m}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
