'use client'

import React from 'react'
import { Plus, Gift } from 'lucide-react'

export interface Sweetener {
  label: string
  addOn: {
    faab?: number | null
    pickSwap?: {
      youAddPickId?: string
      youRemovePickId?: string
    } | string | null
  }
  whenToUse: string
}

export default function SweetenerButtons({
  sweeteners,
  onApplySweetener,
}: {
  sweeteners: Sweetener[]
  onApplySweetener?: (sweetener: Sweetener) => void
}) {
  if (!sweeteners || sweeteners.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-white/40">No sweeteners needed — value is balanced</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sweeteners.map((sw, idx) => (
        <div key={idx} className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">{sw.label}</span>
            </div>
            {onApplySweetener && (
              <button
                onClick={() => onApplySweetener(sw)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-400/25 text-[11px] font-medium text-purple-300 hover:bg-purple-500/25 transition-colors touch-manipulation"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {sw.addOn.faab != null && sw.addOn.faab > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-emerald-300">
                +${sw.addOn.faab} FAAB
              </span>
            )}
            {sw.addOn.pickSwap && (
              typeof sw.addOn.pickSwap === 'string' ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/20 text-cyan-300">
                  {sw.addOn.pickSwap}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/20 text-cyan-300">
                  {sw.addOn.pickSwap.youAddPickId && `+${sw.addOn.pickSwap.youAddPickId}`}
                  {sw.addOn.pickSwap.youAddPickId && sw.addOn.pickSwap.youRemovePickId && ' / '}
                  {sw.addOn.pickSwap.youRemovePickId && `-${sw.addOn.pickSwap.youRemovePickId}`}
                </span>
              )
            )}
          </div>

          <p className="text-xs text-white/50 italic">{sw.whenToUse}</p>
        </div>
      ))}
    </div>
  )
}
