'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, ArrowLeftRight } from 'lucide-react'

export interface CounterOffer {
  label: string
  ifTheyObject: string
  counterTrade: {
    youAdd?: string[]
    youRemove?: string[]
    theyAdd?: string[]
    theyRemove?: string[]
    faabAdd?: number
  }
  rationale: string
}

export default function CounterButtons({
  counters,
  onApplyCounter,
}: {
  counters: CounterOffer[]
  onApplyCounter?: (counter: CounterOffer) => void
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (!counters || counters.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-white/40">No counter-offers needed — trade looks fair as-is</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {counters.map((counter, idx) => {
        const isOpen = expandedIdx === idx
        const hasChanges = (counter.counterTrade.youAdd?.length || 0) +
          (counter.counterTrade.youRemove?.length || 0) +
          (counter.counterTrade.theyAdd?.length || 0) +
          (counter.counterTrade.theyRemove?.length || 0) > 0

        return (
          <div key={idx} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <button
              onClick={() => setExpandedIdx(isOpen ? null : idx)}
              className="w-full flex items-center justify-between p-3 text-left touch-manipulation"
            >
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-white">{counter.label}</span>
              </div>
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-white/40" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/40" />
              )}
            </button>

            {isOpen && (
              <div className="px-3 pb-3 space-y-3">
                <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/15">
                  <p className="text-[11px] font-bold uppercase text-amber-400/70 mb-1">If they say:</p>
                  <p className="text-xs text-amber-200/80 italic">"{counter.ifTheyObject}"</p>
                </div>

                {hasChanges && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase text-cyan-400/70">Your side</p>
                      {counter.counterTrade.youAdd?.map((asset, i) => (
                        <div key={`ya-${i}`} className="flex items-center gap-1 text-xs">
                          <span className="text-emerald-400">+</span>
                          <span className="text-white/70">{asset}</span>
                        </div>
                      ))}
                      {counter.counterTrade.youRemove?.map((asset, i) => (
                        <div key={`yr-${i}`} className="flex items-center gap-1 text-xs">
                          <span className="text-rose-400">−</span>
                          <span className="text-white/50 line-through">{asset}</span>
                        </div>
                      ))}
                      {counter.counterTrade.faabAdd && (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-emerald-400">+</span>
                          <span className="text-white/70">${counter.counterTrade.faabAdd} FAAB</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase text-amber-400/70">Their side</p>
                      {counter.counterTrade.theyAdd?.map((asset, i) => (
                        <div key={`ta-${i}`} className="flex items-center gap-1 text-xs">
                          <span className="text-emerald-400">+</span>
                          <span className="text-white/70">{asset}</span>
                        </div>
                      ))}
                      {counter.counterTrade.theyRemove?.map((asset, i) => (
                        <div key={`tr-${i}`} className="flex items-center gap-1 text-xs">
                          <span className="text-rose-400">−</span>
                          <span className="text-white/50 line-through">{asset}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-white/60 leading-relaxed">{counter.rationale}</p>

                {onApplyCounter && (
                  <button
                    onClick={() => onApplyCounter(counter)}
                    className="w-full py-2 rounded-lg bg-cyan-500/15 border border-cyan-400/25 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 transition-colors touch-manipulation"
                  >
                    Apply This Counter
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
