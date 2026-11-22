'use client'

import { ArrowRight } from 'lucide-react'

interface HandoffAction {
  label: string
  tab: string
  icon?: string
  context?: Record<string, string>
}

export function parseAIHandoffs(aiText: string | null, weakPositions?: string[]): HandoffAction[] {
  const actions: HandoffAction[] = []

  if (weakPositions && weakPositions.length > 0) {
    actions.push({
      label: `Find ${weakPositions[0]} upgrades`,
      tab: 'finder',
      icon: '🔍',
      context: { weak_pos: weakPositions[0] },
    })
  }

  if (aiText) {
    const lower = aiText.toLowerCase()
    if (lower.includes('trade') && !actions.some(a => a.tab === 'finder')) {
      actions.push({ label: 'Open Trade Finder', tab: 'finder', icon: '🔄' })
    }
    if (lower.includes('waiver') || lower.includes('free agent')) {
      actions.push({ label: 'Run Waiver Chimmy', tab: 'waiver', icon: '📋' })
    }
    if (lower.includes('ranking') || lower.includes('power rank')) {
      actions.push({ label: 'View Rankings', tab: 'rankings', icon: '📊' })
    }
    if (lower.includes('trade analyz') || lower.includes('evaluate')) {
      actions.push({ label: 'Analyze a Trade', tab: 'trade', icon: '⚖️' })
    }
  }

  return actions.slice(0, 3)
}

export default function ActionHandoffButtons({
  actions,
  onNavigate,
}: {
  actions: HandoffAction[]
  onNavigate: (tab: string, context?: Record<string, string>) => void
}) {
  if (!actions || actions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onNavigate(action.tab, action.context)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/20 text-xs text-cyan-300 transition font-medium group"
        >
          {action.icon && <span className="text-sm">{action.icon}</span>}
          {action.label}
          <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 transition" />
        </button>
      ))}
    </div>
  )
}
