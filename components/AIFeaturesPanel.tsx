'use client'

import React, { useState, useEffect, useCallback } from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

interface AIFeature {
  icon: string
  title: string
  description: string
  route: string
  tabId: string
  featureKey: string
  gradient: string
  glow: string
  accentText: string
  tagClasses: string
  tag: string
}

const AI_FEATURES: AIFeature[] = [
  {
    icon: '\u{2696}\uFE0F',
    title: 'AI Trade Analyzer',
    description: 'Context-aware evaluations using manager tendencies, league scoring, and competitive windows',
    route: '/af-legacy',
    tabId: 'trade',
    featureKey: 'trade',
    gradient: 'from-red-500/20 to-orange-500/10',
    glow: 'neon-glow-red',
    accentText: 'text-red-400',
    tagClasses: 'text-red-400 bg-red-500/10 border-red-500/20',
    tag: 'Core Tool',
  },
  {
    icon: '\u{1F525}',
    title: 'Rivalry Week Storylines',
    description: 'AI-generated weekly narratives with rivalry scoring, revenge games, and trade tension tracking',
    route: '/af-legacy',
    tabId: 'transfer',
    featureKey: 'rivalry',
    gradient: 'from-amber-500/20 to-yellow-500/10',
    glow: 'neon-glow-amber',
    accentText: 'text-amber-400',
    tagClasses: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    tag: 'New',
  },
  {
    icon: '\u{1F3AF}',
    title: 'AF Legacy Draft',
    description: 'Real-time draft recommendations, value-based rankings, and trade-up/down strategies',
    route: '/af-legacy',
    tabId: 'mock-draft',
    featureKey: 'draft',
    gradient: 'from-emerald-500/20 to-teal-500/10',
    glow: 'neon-glow-emerald',
    accentText: 'text-emerald-400',
    tagClasses: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    tag: 'Draft Season',
  },
  {
    icon: '\u{1F4CB}',
    title: 'Waiver "One Move" Plan',
    description: 'Weekly waiver priority with one high-impact recommendation tailored to your team needs',
    route: '/af-legacy',
    tabId: 'waiver',
    featureKey: 'waiver',
    gradient: 'from-purple-500/20 to-violet-500/10',
    glow: 'neon-glow-purple',
    accentText: 'text-purple-400',
    tagClasses: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    tag: 'Weekly',
  },
  {
    icon: '\u{1F4CA}',
    title: 'Power + Luck Rankings',
    description: 'Luck-adjusted power rankings with 5-score composite, win probability, and Monte Carlo projections',
    route: '/af-legacy',
    tabId: 'rankings',
    featureKey: 'rankings',
    gradient: 'from-cyan-500/20 to-blue-500/10',
    glow: 'neon-glow-cyan',
    accentText: 'text-cyan-400',
    tagClasses: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    tag: 'Rankings v2',
  },
  {
    icon: '\u{1F50D}',
    title: 'AI Trade Finder',
    description: 'Scans every roster in your league to surface mutually beneficial trade proposals with acceptance odds',
    route: '/af-legacy',
    tabId: 'finder',
    featureKey: 'finder',
    gradient: 'from-pink-500/20 to-rose-500/10',
    glow: 'neon-glow-red',
    accentText: 'text-pink-400',
    tagClasses: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
    tag: 'Smart Match',
  },
]

function FeatureCard({
  feature,
  index,
  onNavigate,
  leagueId,
}: {
  feature: AIFeature
  index: number
  onNavigate: (tabId: string) => void
  leagueId?: string
}) {
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [insight, setInsight] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100 + index * 80)
    return () => clearTimeout(t)
  }, [index])

  const fetchInsight = useCallback(async () => {
    if (insight || loading) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/ai-features', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featureId: feature.featureKey, leagueId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(true)
        return
      }
      setInsight(data.insight || 'AI insight unavailable.')
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [feature.featureKey, leagueId, insight, loading])

  function handleClick() {
    if (expanded) {
      onNavigate(feature.tabId)
      return
    }
    setExpanded(true)
    fetchInsight()
  }

  return (
    <div
      className={cx(
        'group relative w-full text-left rounded-xl glass-card overflow-hidden transition-all duration-300',
        expanded ? 'sm:col-span-2 ring-1 ring-white/10' : 'hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]',
        feature.glow,
        visible ? 'animate-slide-up' : 'opacity-0'
      )}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className={cx('absolute inset-0 bg-gradient-to-br pointer-events-none rounded-xl transition-opacity -z-10', feature.gradient, expanded ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')} />

      <button
        onClick={handleClick}
        className="relative w-full text-left p-3.5 flex items-start gap-3"
      >
        <div className={cx('text-xl shrink-0 mt-0.5', expanded ? 'animate-rival-pulse' : 'group-hover:animate-rival-pulse')}>{feature.icon}</div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-white">{feature.title}</span>
            <span className={cx('text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0', feature.tagClasses)}>{feature.tag}</span>
          </div>
          <p className="text-[9px] text-white/35 leading-relaxed line-clamp-2 group-hover:text-white/45 transition-colors">{feature.description}</p>
        </div>
        <svg
          className={cx(
            'w-4 h-4 shrink-0 mt-1 transition-all',
            expanded
              ? 'text-white/40 rotate-90'
              : 'text-white/15 group-hover:text-white/40 group-hover:translate-x-0.5'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-2.5 animate-slide-up">
          <div className="border-t border-white/[0.06] pt-2.5">
            {loading && (
              <div className="flex items-center gap-2 py-2">
                <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
                <span className="text-[10px] text-white/40">Generating personalized insight...</span>
              </div>
            )}
            {error && (
              <div className="text-[10px] text-red-300/70 py-1">
                Could not load AI insight. Try again later.
              </div>
            )}
            {insight && !loading && (
              <div className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <div className={cx('w-4 h-4 rounded-md flex items-center justify-center shrink-0 mt-0.5 text-[8px] font-black', feature.tagClasses)}>AI</div>
                  <p className="text-[10px] text-white/60 leading-relaxed">{insight}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
              className="text-[9px] text-white/25 hover:text-white/50 transition-colors"
            >
              Collapse
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(feature.tabId) }}
              className={cx('text-[9px] font-bold px-3 py-1.5 rounded-lg border transition-all hover:scale-105', feature.tagClasses)}
            >
              Open {feature.title} &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface AIFeaturesPanelProps {
  leagueName?: string
  leagueId?: string
  onNavigate: (tabId: string) => void
}

export default function AIFeaturesPanel({ leagueName, leagueId, onNavigate }: AIFeaturesPanelProps) {
  return (
    <div className="w-full space-y-5">
      <div className="rounded-2xl glass-card-vivid neon-glow-cyan overflow-hidden animate-neon-border">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.06] via-purple-500/[0.03] to-transparent pointer-events-none" />
          <div className="relative px-5 py-4 border-b border-cyan-500/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-sm font-black text-white shadow-lg shadow-cyan-500/25">
                AF
              </div>
              <div>
                <h3 className="text-sm font-black text-white">AI Features Included at Launch</h3>
                <p className="text-[10px] text-white/35 mt-0.5">
                  {leagueName ? (
                    <>Unlocked for <span className="text-cyan-400/60 font-semibold">{leagueName}</span></>
                  ) : (
                    <>Unlocked for your imported league</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-rival-pulse" />
                <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">All Active</span>
              </div>
              <span className="text-[8px] text-white/20">{AI_FEATURES.length} AI-powered tools ready</span>
            </div>
          </div>
        </div>

        <div className="relative p-4">
          <div className="grid gap-2.5 sm:grid-cols-2 stagger-children">
            {AI_FEATURES.map((feature, i) => (
              <FeatureCard key={feature.featureKey} feature={feature} index={i} onNavigate={onNavigate} leagueId={leagueId} />
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-white/[0.04] text-center">
            <p className="text-[9px] text-white/20 font-medium">
              All features are context-aware and personalized to your league settings, scoring, and manager history
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
