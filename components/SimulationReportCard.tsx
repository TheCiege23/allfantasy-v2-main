'use client'

import React, { useState } from 'react'
import { BarChart3, TrendingUp, TrendingDown, Shield, Zap, ChevronDown } from 'lucide-react'

interface ReportCardCategory {
  name: string
  grade: string
  score: number
  explanation: string
}

interface SimulationResult {
  iterations: number
  winProbability: { before: number; after: number; change: number }
  playoffProbability: { before: number; after: number; change: number }
  championshipProbability: { before: number; after: number; change: number }
  rosterStrength: { before: number; after: number; change: number }
  riskProfile: { level: string; factors: string[] }
  distribution: { bestCase: string; expectedCase: string; worstCase: string }
  grade: string
  summary: string
  reportCard: {
    overallGrade: string
    categories: ReportCardCategory[]
    verdict: string
    keyTakeaways: string[]
  }
}

const gradeColors: Record<string, string> = {
  'A+': 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
  'A': 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
  'A-': 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25',
  'B+': 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30',
  'B': 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30',
  'B-': 'text-cyan-400 bg-cyan-500/15 border-cyan-500/25',
  'C+': 'text-amber-400 bg-amber-500/20 border-amber-500/30',
  'C': 'text-amber-400 bg-amber-500/20 border-amber-500/30',
  'C-': 'text-amber-400 bg-amber-500/15 border-amber-500/25',
  'D+': 'text-orange-400 bg-orange-500/20 border-orange-500/30',
  'D': 'text-orange-400 bg-orange-500/20 border-orange-500/30',
  'F': 'text-red-400 bg-red-500/20 border-red-500/30',
}

const riskColors: Record<string, string> = {
  low: 'text-emerald-400 bg-emerald-500/20',
  moderate: 'text-amber-400 bg-amber-500/20',
  high: 'text-orange-400 bg-orange-500/20',
  extreme: 'text-red-400 bg-red-500/20',
}

function ProbBar({ label, change }: { label: string; change: number }) {
  const isPositive = change >= 0
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-white/60">{label}</span>
      <span className={`text-xs font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}{change}%
      </span>
    </div>
  )
}

export default function SimulationReportCard({ result }: { result: SimulationResult }) {
  const [expanded, setExpanded] = useState(false)
  const rc = result.reportCard
  const gradeStyle = gradeColors[rc.overallGrade] || 'text-white/50 bg-white/10 border-white/20'
  const riskStyle = riskColors[result.riskProfile.level] || 'text-white/50 bg-white/10'

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a1a2e]/80 to-[#16213e]/80 overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-black border ${gradeStyle}`}>
          {rc.overallGrade}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{rc.verdict}</div>
          <div className="text-xs text-white/50 mt-1">
            {result.iterations.toLocaleString()} simulations ran
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${riskStyle}`}>
              {result.riskProfile.level.toUpperCase()} RISK
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        {result.distribution.bestCase && (
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
            <div className="text-[11px] text-emerald-300/60 uppercase">Best</div>
            <div className="text-xs font-bold text-emerald-400">{result.distribution.bestCase}</div>
          </div>
        )}
        <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-center">
          <div className="text-[11px] text-cyan-300/60 uppercase">Expected</div>
          <div className="text-xs font-bold text-cyan-400">{result.distribution.expectedCase}</div>
        </div>
        {result.distribution.worstCase && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
            <div className="text-[11px] text-red-300/60 uppercase">Worst</div>
            <div className="text-xs font-bold text-red-400">{result.distribution.worstCase}</div>
          </div>
        )}
      </div>

      <div className="px-4 pb-3">
        <ProbBar label="Win Probability" change={result.winProbability.change} />
        <ProbBar label="Playoff Odds" change={result.playoffProbability.change} />
        <ProbBar label="Championship" change={result.championshipProbability.change} />
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center justify-center gap-1 text-xs text-white/40 hover:text-white/60 border-t border-white/5"
      >
        {expanded ? 'Hide Details' : 'Show Full Report Card'}
        <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5">
          <div className="pt-3 space-y-2">
            {rc.categories.map((cat, i) => {
              const catGrade = gradeColors[cat.grade] || 'text-white/50 bg-white/10 border-white/20'
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold border ${catGrade}`}>
                    {cat.grade}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-white">{cat.name}</div>
                    <div className="text-[11px] text-white/50">{cat.explanation}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {result.riskProfile.factors.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-white/60 mb-1">Risk Factors</div>
              <div className="flex flex-wrap gap-1">
                {result.riskProfile.factors.map((factor, i) => (
                  <span key={i} className="px-2 py-0.5 rounded text-[11px] bg-orange-500/10 text-orange-300 border border-orange-500/20">
                    {factor}
                  </span>
                ))}
              </div>
            </div>
          )}

          {rc.keyTakeaways.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-white/60 mb-1">Key Takeaways</div>
              <ul className="space-y-1">
                {rc.keyTakeaways.map((takeaway, i) => (
                  <li key={i} className="text-xs text-white/50 flex items-start gap-1.5">
                    <span className="text-cyan-400 mt-0.5">-</span>
                    {takeaway}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
