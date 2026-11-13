'use client'

import React from 'react'
import { CheckCircle2 } from 'lucide-react'

interface ActionPlanCardProps {
  /** Suggested next action */
  suggestedNextAction: string
  /** Optional alternate path */
  alternatePath?: string
  className?: string
}

/**
 * Action plan block: one clear next step + optional alternate.
 */
export default function ActionPlanCard({
  suggestedNextAction,
  alternatePath,
  className = '',
}: ActionPlanCardProps) {
  if (!suggestedNextAction?.trim()) return null

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-400/80 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Suggested next step</p>
          <p className="mt-1 text-sm font-medium text-white/90">{suggestedNextAction}</p>
          {alternatePath?.trim() && (
            <p className="mt-2 text-xs text-white/60">Alternatively: {alternatePath}</p>
          )}
        </div>
      </div>
    </div>
  )
}
