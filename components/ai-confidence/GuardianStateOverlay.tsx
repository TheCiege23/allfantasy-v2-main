'use client'

import React from 'react'
import { ShieldAlert, AlertTriangle, Info } from 'lucide-react'
import type { TrustState, GuardianBehavior } from '@/lib/analytics/confidence-types'
import { getGuardianBehavior } from '@/lib/analytics/confidence-types'

interface GuardianStateOverlayProps {
  trustState: TrustState
  deviationScore: number
  headline: string
  details: string[]
  severity: 'low' | 'medium' | 'high' | 'critical'
}

const behaviorConfig: Record<GuardianBehavior, {
  icon: React.ElementType
  title: string
  borderColor: string
  bgColor: string
  textColor: string
  iconColor: string
  description: string
}> = {
  strong: {
    icon: ShieldAlert,
    title: 'Strong Warning',
    borderColor: 'border-red-500/30',
    bgColor: 'bg-red-500/10',
    textColor: 'text-red-300',
    iconColor: 'text-red-400',
    description: 'High confidence data suggests this action could be harmful.',
  },
  advisory: {
    icon: AlertTriangle,
    title: 'Advisory Notice',
    borderColor: 'border-amber-500/30',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-300',
    iconColor: 'text-amber-400',
    description: 'Moderate confidence — consider the risk factors below.',
  },
  informational: {
    icon: Info,
    title: 'For Your Information',
    borderColor: 'border-purple-500/30',
    bgColor: 'bg-purple-500/10',
    textColor: 'text-purple-300',
    iconColor: 'text-purple-400',
    description: 'Limited data available — this is informational only.',
  },
}

export default function GuardianStateOverlay({
  trustState,
  deviationScore,
  headline,
  details,
  severity,
}: GuardianStateOverlayProps) {
  const behavior = getGuardianBehavior(trustState)
  const config = behaviorConfig[behavior]
  const Icon = config.icon

  const severityBar = {
    low: 'w-1/4 bg-emerald-400',
    medium: 'w-1/2 bg-amber-400',
    high: 'w-3/4 bg-orange-400',
    critical: 'w-full bg-red-400',
  }[severity]

  return (
    <div className={`rounded-2xl border ${config.borderColor} ${config.bgColor} p-4 space-y-3`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 p-2 rounded-xl ${config.bgColor} border ${config.borderColor}`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-sm font-semibold ${config.textColor}`}>{config.title}</span>
            {deviationScore > 0 && (
              <span className={`text-[11px] font-mono ${config.textColor} opacity-60`}>
                {deviationScore}% deviation
              </span>
            )}
          </div>
          <p className="text-xs text-white/50">{config.description}</p>
        </div>
      </div>

      {headline && (
        <div className="px-3 py-2.5 rounded-xl bg-black/20 border border-white/[0.04]">
          <p className="text-sm font-medium text-white/80">{headline}</p>
        </div>
      )}

      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/30 uppercase tracking-wider">Risk Level</span>
          <span className={`text-[11px] font-medium capitalize ${config.textColor}`}>{severity}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full ${severityBar} transition-all duration-500`} />
        </div>
      </div>

      {details.length > 0 && (
        <div className="space-y-1">
          {details.map((detail, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/50">
              <span className={`mt-1 w-1 h-1 rounded-full flex-shrink-0 ${config.iconColor.replace('text-', 'bg-')}`} />
              <span className="leading-relaxed">{detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
