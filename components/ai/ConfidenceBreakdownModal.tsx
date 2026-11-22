'use client'

import React, { useEffect } from 'react'
import type { ConfidenceRating } from './ConfidencePill'

interface ConfidenceBreakdown {
  rating: ConfidenceRating
  score: number
  drivers: string[]
}

const RATING_CONFIG: Record<ConfidenceRating, { color: string; border: string; bg: string; label: string }> = {
  HIGH: { color: 'text-green-400', border: 'border-green-500/30', bg: 'bg-green-500/10', label: 'High Confidence' },
  MEDIUM: { color: 'text-yellow-400', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', label: 'Moderate Confidence' },
  LEARNING: { color: 'text-gray-400', border: 'border-gray-500/30', bg: 'bg-gray-500/10', label: 'Learning' },
}

interface ConfidenceBreakdownModalProps {
  open: boolean
  onClose: () => void
  confidence: ConfidenceBreakdown
}

export default function ConfidenceBreakdownModal({
  open,
  onClose,
  confidence,
}: ConfidenceBreakdownModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const config = RATING_CONFIG[confidence.rating]

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl w-full max-w-md p-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${confidence.rating === 'HIGH' ? 'bg-green-400' : confidence.rating === 'MEDIUM' ? 'bg-yellow-400' : 'bg-gray-400'}`} />
            <h3 className="text-lg font-semibold text-white">
              {config.label}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition touch-manipulation"
            aria-label="Close"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-xl ${config.bg} ${config.border} border mb-4`}>
          <div className="text-2xl font-bold text-white">{confidence.score}%</div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-xs text-white/60 leading-relaxed">
            Overall confidence score based on data completeness, market clarity, and risk factors.
          </div>
        </div>

        {confidence.drivers.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40 font-medium">Why this rating</div>
            <ul className="space-y-2">
              {confidence.drivers.map((driver, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-white/80">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-white/30 flex-shrink-0" />
                  <span className="leading-relaxed">{driver}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-3 border-t border-white/5 text-xs text-white/30 leading-relaxed">
          Confidence reflects data completeness, market clarity, and risk factors — not a guarantee.
        </div>
      </div>
    </div>
  )
}
