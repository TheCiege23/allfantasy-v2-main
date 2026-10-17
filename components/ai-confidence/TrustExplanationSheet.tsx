'use client'

import React, { useState, useEffect } from 'react'
import { X, Check, HelpCircle, TrendingUp, ArrowUpRight, Database, Users, BarChart3, Brain } from 'lucide-react'
import type { TrustData, DataSource } from '@/lib/analytics/confidence-types'
import ConfidenceMeter from './ConfidenceMeter'
import RiskChip from './RiskChip'

interface TrustExplanationSheetProps {
  data: TrustData
  open: boolean
  onClose: () => void
}

const dataSourceIcons: Record<DataSource['icon'], React.ElementType> = {
  history: Database,
  market: BarChart3,
  league: Users,
  dna: Brain,
  news: TrendingUp,
  excel: Database,
  api: ArrowUpRight,
}

function SheetContent({ data }: { data: TrustData }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-5">
        <ConfidenceMeter score={data.score} state={data.state} size="lg" />
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-sm text-white/70 leading-relaxed">{data.explanation}</p>
        </div>
      </div>

      {data.riskChips.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2.5">Risk Factors</h4>
          <div className="flex flex-wrap gap-1.5">
            {data.riskChips.map((chip) => (
              <RiskChip key={chip.tag} chip={chip} size="md" />
            ))}
          </div>
        </div>
      )}

      {data.dataSources && data.dataSources.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Check className="w-3 h-3" /> Data Sources Used
          </h4>
          <div className="space-y-1.5">
            {data.dataSources.map((source) => {
              const Icon = dataSourceIcons[source.icon] || Database
              return (
                <div
                  key={source.name}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition ${
                    source.available
                      ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-300'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/30'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">{source.name}</span>
                  {source.available ? (
                    <Check className="w-3 h-3 ml-auto opacity-60" />
                  ) : (
                    <span className="text-[11px] ml-auto opacity-50">Not available</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {data.knownUnknowns && data.knownUnknowns.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" /> Known Unknowns
          </h4>
          <div className="space-y-1">
            {data.knownUnknowns.map((item, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <span className="text-amber-400 text-xs mt-0.5">?</span>
                <span className="text-xs text-white/50 leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.improvementHints && data.improvementHints.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" /> What Would Increase Confidence?
          </h4>
          <div className="space-y-1">
            {data.improvementHints.map((hint, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <span className="text-cyan-400 text-xs mt-0.5">+</span>
                <span className="text-xs text-cyan-200/70 leading-relaxed">{hint}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TrustExplanationSheet({
  data,
  open,
  onClose,
}: TrustExplanationSheetProps) {
  const [visible, setVisible] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startYRef = React.useRef(0)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
      const timer = setTimeout(() => {
        document.body.style.overflow = ''
      }, 300)
      return () => clearTimeout(timer)
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY
    setDragging(true)
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return
    const delta = e.touches[0].clientY - startYRef.current
    if (delta > 0) setDragOffset(delta)
  }
  const handleTouchEnd = () => {
    setDragging(false)
    if (dragOffset > 100) onClose()
    setDragOffset(0)
  }

  if (!open && !visible) return null

  return (
    <>
      <div className="fixed inset-0 z-[200] lg:hidden" role="dialog" aria-modal="true">
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 max-h-[85vh] bg-gradient-to-b from-slate-900 to-slate-950 rounded-t-3xl border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out flex flex-col ${visible ? 'translate-y-0' : 'translate-y-full'}`}
          style={{ transform: visible ? `translateY(${dragOffset}px)` : 'translateY(100%)' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/8">
            <div className="flex items-center gap-2.5">
              <Brain className="w-4 h-4 text-cyan-400" />
              <h3 className="text-base font-semibold text-white">AI Confidence</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition touch-manipulation"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <SheetContent data={data} />
          </div>
        </div>
      </div>

      <div className={`fixed inset-0 z-[200] hidden lg:flex items-start justify-end ${open ? '' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        <div
          className={`relative w-[400px] h-full bg-gradient-to-b from-slate-900 to-slate-950 border-l border-white/10 shadow-[-20px_0_60px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out overflow-y-auto ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-slate-900/95 backdrop-blur-sm border-b border-white/8">
            <div className="flex items-center gap-2.5">
              <Brain className="w-4 h-4 text-cyan-400" />
              <h3 className="text-base font-semibold text-white">AI Confidence</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-6 py-5">
            <SheetContent data={data} />
          </div>
        </div>
      </div>
    </>
  )
}
