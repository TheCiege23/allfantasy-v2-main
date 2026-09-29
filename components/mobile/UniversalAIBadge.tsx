'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, HelpCircle, Zap, Brain } from 'lucide-react'

function AFCrest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z" fill="currentColor" opacity="0.2" />
      <path d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="bold" fontFamily="system-ui, sans-serif">AF</text>
    </svg>
  )
}

type ConfidenceLevel = 'high' | 'medium' | 'learning'

interface RiskChip {
  label: string
  type: 'age' | 'injury' | 'market' | 'role' | 'pick' | 'depth' | 'schedule' | 'trend' | 'unknown'
}

interface UniversalAIBadgeProps {
  confidence: ConfidenceLevel
  riskChips?: RiskChip[]
  explanation?: string
  compact?: boolean
}

const confidenceConfig: Record<ConfidenceLevel, { label: string; icon: React.ElementType; bg: string; text: string; border: string }> = {
  high: {
    label: 'High Confidence',
    icon: AFCrest,
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    border: 'border-emerald-500/25',
  },
  medium: {
    label: 'Medium',
    icon: Zap,
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    border: 'border-amber-500/25',
  },
  learning: {
    label: 'Learning',
    icon: Brain,
    bg: 'bg-purple-500/15',
    text: 'text-purple-300',
    border: 'border-purple-500/25',
  },
}

const riskColors: Record<RiskChip['type'], { bg: string; text: string; border: string }> = {
  age: { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/20' },
  injury: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/20' },
  market: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/20' },
  role: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/20' },
  pick: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/20' },
  depth: { bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/20' },
  schedule: { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/20' },
  trend: { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/20' },
  unknown: { bg: 'bg-white/5', text: 'text-white/60', border: 'border-white/10' },
}

export default function UniversalAIBadge({
  confidence,
  riskChips = [],
  explanation,
  compact = false,
}: UniversalAIBadgeProps) {
  const [expanded, setExpanded] = useState(false)
  const config = confidenceConfig[confidence]
  const Icon = config.icon

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${config.bg} border ${config.border}`}>
        <Icon className={`w-3 h-3 ${config.text}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${config.text}`}>
          {config.label}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl ${config.bg} border ${config.border}`}>
          <Icon className={`w-3.5 h-3.5 ${config.text}`} />
          <span className={`text-xs font-semibold ${config.text}`}>
            {config.label}
          </span>
        </div>

        {riskChips.map((chip, i) => {
          const colors = riskColors[chip.type] || riskColors.unknown
          return (
            <span
              key={`${chip.type}-${i}`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
            >
              {chip.label}
            </span>
          )
        })}
      </div>

      {explanation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-white/40 hover:text-white/60 transition touch-manipulation"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">Why?</span>
          {expanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      )}

      {expanded && explanation && (
        <div className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/8 text-xs text-white/60 leading-relaxed">
          {explanation}
        </div>
      )}
    </div>
  )
}
