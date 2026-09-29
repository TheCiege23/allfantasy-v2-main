'use client'

import React, { useState, useEffect } from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

interface DataQuality {
  fetchedAt: number
  sources: {
    users: boolean
    rosters: boolean
    matchups: boolean
    trades: boolean
    draftPicks: boolean
    playerMap: boolean
    history: boolean
  }
  rosterCoverage: number
  matchupWeeksCovered: number
  completenessScore: number
  confidencePenalty: number
  tier: 'FULL' | 'PARTIAL' | 'MINIMAL'
  signals: string[]
}

function timeAgoShort(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const SOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  users: { label: 'Managers', icon: '\u{1F464}' },
  rosters: { label: 'Rosters', icon: '\u{1F4CB}' },
  matchups: { label: 'Matchups', icon: '\u{26A1}' },
  trades: { label: 'Trades', icon: '\u{1F91D}' },
  draftPicks: { label: 'Draft', icon: '\u{1F3AF}' },
  playerMap: { label: 'Players', icon: '\u{1F3C8}' },
  history: { label: 'History', icon: '\u{1F4C5}' },
}

export default function DataFreshnessBanner({ dataQuality }: { dataQuality: DataQuality }) {
  const [expanded, setExpanded] = useState(false)
  const [freshness, setFreshness] = useState(timeAgoShort(dataQuality.fetchedAt))

  useEffect(() => {
    setFreshness(timeAgoShort(dataQuality.fetchedAt))
    const interval = setInterval(() => setFreshness(timeAgoShort(dataQuality.fetchedAt)), 30000)
    return () => clearInterval(interval)
  }, [dataQuality.fetchedAt])

  const tierConfig = {
    FULL: { label: 'Full Data', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/20' },
    PARTIAL: { label: 'Partial Data', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', dot: 'bg-amber-400', glow: 'shadow-amber-500/20' },
    MINIMAL: { label: 'Limited Data', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', dot: 'bg-red-400', glow: 'shadow-red-500/20' },
  }

  const tier = tierConfig[dataQuality.tier]

  return (
    <div className="w-full">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cx(
          'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-all',
          'glass-card hover:bg-white/[0.04]'
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cx('w-2 h-2 rounded-full shrink-0 animate-rival-pulse shadow-sm', tier.dot, tier.glow)} />
          <span className="text-[11px] text-white/50 font-medium truncate">
            Updated from Sleeper <span className="text-white/70 font-semibold">{freshness}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={cx('text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', tier.color, tier.bg, tier.border)}>
            {tier.label}
          </span>
          <span className={cx('text-[11px] font-black tabular-nums', tier.color)}>
            {dataQuality.completenessScore}%
          </span>
          <svg className={cx('w-3 h-3 text-white/20 transition-transform duration-200', expanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 rounded-xl glass-card p-3 space-y-3 animate-slide-up">
          <div>
            <div className="text-[11px] font-bold text-white/25 uppercase tracking-wider mb-2">Source Coverage</div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
              {Object.entries(dataQuality.sources).map(([key, available]) => {
                const source = SOURCE_LABELS[key]
                if (!source) return null
                return (
                  <div key={key} className={cx(
                    'flex flex-col items-center gap-1 py-1.5 px-1 rounded-lg text-center',
                    available ? 'bg-emerald-500/[0.06] border border-emerald-500/10' : 'bg-red-500/[0.04] border border-red-500/10'
                  )}>
                    <span className="text-[11px]">{source.icon}</span>
                    <span className={cx('text-[11px] font-semibold', available ? 'text-emerald-400/70' : 'text-red-400/60')}>
                      {source.label}
                    </span>
                    <span className={cx('text-[11px]', available ? 'text-emerald-400/40' : 'text-red-400/40')}>
                      {available ? '\u2713' : '\u2717'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[11px] text-white/25 uppercase font-semibold mb-1">Roster Coverage</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cx('h-full rounded-full',
                      dataQuality.rosterCoverage >= 80 ? 'bg-emerald-500' : dataQuality.rosterCoverage >= 50 ? 'bg-amber-500' : 'bg-red-500'
                    )}
                    style={{ width: `${dataQuality.rosterCoverage}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-white/40 tabular-nums">{dataQuality.rosterCoverage}%</span>
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[11px] text-white/25 uppercase font-semibold mb-1">Matchup Weeks</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cx('h-full rounded-full',
                      dataQuality.matchupWeeksCovered >= 14 ? 'bg-emerald-500' : dataQuality.matchupWeeksCovered >= 8 ? 'bg-amber-500' : 'bg-red-500'
                    )}
                    style={{ width: `${Math.min((dataQuality.matchupWeeksCovered / 17) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-white/40 tabular-nums">{dataQuality.matchupWeeksCovered}/17</span>
              </div>
            </div>
          </div>

          {dataQuality.confidencePenalty > 0 && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
              <span className="text-[11px] mt-0.5">{'\u26A0\uFE0F'}</span>
              <div>
                <span className="text-[11px] font-bold text-amber-400/80">Confidence Adjusted</span>
                <p className="text-[11px] text-amber-400/50 leading-relaxed mt-0.5">
                  AI confidence scores reduced by {dataQuality.confidencePenalty}% due to incomplete data coverage.
                </p>
              </div>
            </div>
          )}

          {dataQuality.signals.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-white/20 uppercase tracking-wider mb-1.5">Data Gaps</div>
              <div className="flex flex-wrap gap-1">
                {dataQuality.signals.map((signal, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-white/35 font-medium">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
