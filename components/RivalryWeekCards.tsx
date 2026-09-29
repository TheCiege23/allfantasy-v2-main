'use client'

import React, { useState, useEffect } from 'react'
import type { RivalryWeekData, RivalryPair, RivalryEvidence } from '@/lib/rivalry-engine'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

const EVIDENCE_ICONS: Record<string, string> = {
  h2h: '\u{1F4CA}',
  trade: '\u{1F91D}',
  record: '\u{1F3C6}',
  matchup: '\u{26A1}',
  streak: '\u{1F525}',
}

const EVIDENCE_CHIP_COLORS: Record<string, string> = {
  h2h: 'bg-blue-500/10 text-blue-300 border-blue-500/15',
  trade: 'bg-pink-500/10 text-pink-300 border-pink-500/15',
  record: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/15',
  matchup: 'bg-amber-500/10 text-amber-300 border-amber-500/15',
  streak: 'bg-red-500/10 text-red-300 border-red-500/15',
}

function EvidenceChips({ evidence }: { evidence: RivalryEvidence[] }) {
  if (!evidence || evidence.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {evidence.map((e, i) => (
        <span
          key={i}
          className={cx(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[11px] font-medium',
            EVIDENCE_CHIP_COLORS[e.type] || 'bg-white/5 text-white/40 border-white/10'
          )}
          title={e.detail}
        >
          <span className="text-[11px]">{EVIDENCE_ICONS[e.type] || '\u{1F4CC}'}</span>
          {e.label}
        </span>
      ))}
    </div>
  )
}

function Avatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  if (src) {
    return <img src={src} alt={name} className="rounded-full object-cover ring-1 ring-white/10" style={{ width: size, height: size }} />
  }
  return (
    <div className="rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center font-bold text-white/60 ring-1 ring-white/10" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function GlowingScore({ score, color }: { score: number; color: string }) {
  return (
    <span className={cx('text-lg font-black tabular-nums animate-score-glow', color)}>
      {score}
    </span>
  )
}

function ScoreBadge({ score, label, color }: { score: number; label: string; color?: string }) {
  const autoColor = score >= 70 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-blue-400'
  return (
    <div className="text-center space-y-1">
      <div className="relative">
        <div className={cx('text-base font-black tabular-nums', color || autoColor)}>{score}</div>
        {score >= 70 && <div className={cx('absolute inset-0 rounded-full blur-md opacity-30', score >= 70 ? 'bg-red-500' : '')} />}
      </div>
      <div className="text-[11px] text-white/25 uppercase tracking-wider font-semibold">{label}</div>
    </div>
  )
}

function NeonVs() {
  return (
    <div className="flex flex-col items-center px-3 py-1">
      <div className="text-[11px] font-black bg-gradient-to-b from-red-500 to-orange-500 bg-clip-text text-transparent uppercase tracking-wider animate-rival-pulse">VS</div>
      <div className="w-px h-3 bg-gradient-to-b from-red-500/40 to-transparent mt-0.5" />
    </div>
  )
}

function VsBlock({ pair, compact }: { pair: RivalryPair; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Avatar src={pair.team1.avatar} name={pair.team1.displayName} size={compact ? 28 : 36} />
        <div className="min-w-0">
          <div className={cx('font-bold text-white truncate', compact ? 'text-xs' : 'text-sm')}>{pair.team1.displayName}</div>
          <div className="text-[11px] text-white/35 tabular-nums">{pair.team1.wins}-{pair.team1.losses}</div>
        </div>
      </div>
      <NeonVs />
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <div className="min-w-0 text-right">
          <div className={cx('font-bold text-white truncate', compact ? 'text-xs' : 'text-sm')}>{pair.team2.displayName}</div>
          <div className="text-[11px] text-white/35 tabular-nums">{pair.team2.wins}-{pair.team2.losses}</div>
        </div>
        <Avatar src={pair.team2.avatar} name={pair.team2.displayName} size={compact ? 28 : 36} />
      </div>
    </div>
  )
}

function RivalryOfTheWeekCard({ pair, narrative }: { pair: RivalryPair; narrative?: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="relative rounded-2xl glass-card-vivid neon-glow-amber overflow-hidden animate-slide-up">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.06] to-orange-500/[0.02] pointer-events-none rounded-2xl" />
      <button onClick={() => setExpanded(!expanded)} className="relative w-full text-left p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg animate-rival-pulse">{'\u{1F525}'}</span>
            <span className="text-xs font-black text-amber-400/90 uppercase tracking-wider">Rivalry of the Week</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center gap-1.5">
              <GlowingScore score={pair.totalScore} color="text-amber-400" />
            </div>
            <svg className={cx('w-3.5 h-3.5 text-white/30 transition-transform duration-300', expanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>

        <VsBlock pair={pair} />

        <div className="flex items-center justify-center gap-3">
          <span className="text-[11px] text-white/20 tabular-nums">H2H: {pair.h2hRecord.wins1}-{pair.h2hRecord.wins2}</span>
          {pair.tradeFriction > 0 && (
            <>
              <span className="w-0.5 h-0.5 rounded-full bg-white/15" />
              <span className="text-[11px] text-white/20 tabular-nums">{pair.tradeFriction} trade{pair.tradeFriction > 1 ? 's' : ''} between</span>
            </>
          )}
        </div>

        {narrative && (
          <p className="text-[11px] text-white/45 leading-relaxed italic text-center">{narrative}</p>
        )}

        <EvidenceChips evidence={pair.evidence} />
      </button>

      {expanded && (
        <div className="relative px-4 pb-4 space-y-3 border-t border-white/[0.04]">
          <div className="grid grid-cols-3 gap-3 pt-3">
            <ScoreBadge score={pair.matchupImpact} label="Matchup Impact" />
            <ScoreBadge score={pair.recordProximity} label="Record Proximity" />
            <ScoreBadge score={Math.min(pair.tradeFriction * 20, 100)} label="Trade Friction" />
          </div>

          {pair.lastMatchup && (
            <div className="rounded-xl glass-card p-3">
              <div className="text-[11px] text-white/25 uppercase tracking-wider font-semibold mb-1.5">Last Meeting (Week {pair.lastMatchup.week})</div>
              <div className="flex items-center justify-between text-xs">
                <span className={cx('font-bold tabular-nums', pair.lastMatchup.winner === pair.team1.rosterId ? 'text-emerald-400' : 'text-white/40')}>
                  {pair.lastMatchup.pts1.toFixed(1)} pts
                </span>
                <div className="w-8 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                <span className={cx('font-bold tabular-nums', pair.lastMatchup.winner === pair.team2.rosterId ? 'text-emerald-400' : 'text-white/40')}>
                  {pair.lastMatchup.pts2.toFixed(1)} pts
                </span>
              </div>
            </div>
          )}

          {pair.streakHolder && (
            <div className="text-[11px] text-amber-400/50 text-center flex items-center justify-center gap-1.5">
              <span className="animate-rival-pulse">{'\u{1F525}'}</span>
              {pair.streakHolder.rosterId === pair.team1.rosterId ? pair.team1.displayName : pair.team2.displayName} on a {pair.streakHolder.streak}-game win streak
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RevengeGameCard({ pair, narrative }: { pair: RivalryPair; narrative?: string }) {
  if (pair.recentLoser === null || !pair.lastMatchup || pair.lastMatchup.winner === 0) return null
  const loser = pair.recentLoser === pair.team1.rosterId ? pair.team1 : pair.team2
  const winner = pair.recentLoser === pair.team1.rosterId ? pair.team2 : pair.team1

  return (
    <div className="relative rounded-2xl glass-card-vivid neon-glow-red p-4 space-y-3 animate-slide-up" style={{ animationDelay: '100ms' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-red-500/[0.06] to-rose-500/[0.02] pointer-events-none rounded-2xl" />
      <div className="relative space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg animate-rival-pulse">{'\u{2694}\uFE0F'}</span>
          <span className="text-xs font-black text-red-400/90 uppercase tracking-wider">Revenge Game</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar src={loser.avatar} name={loser.displayName} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{loser.displayName}</div>
            <div className="text-[11px] text-red-400/60 font-medium">seeking revenge vs {winner.displayName}</div>
          </div>
        </div>

        {pair.lastMatchup && (
          <div className="rounded-xl glass-card p-2.5 text-[11px]">
            <span className="text-white/25 font-medium">Lost Week {pair.lastMatchup.week}: </span>
            <span className="text-red-400/70 font-bold tabular-nums">
              {pair.lastMatchup.winner === pair.team1.rosterId ? pair.lastMatchup.pts2.toFixed(1) : pair.lastMatchup.pts1.toFixed(1)}
            </span>
            <span className="text-white/15 mx-1">{'\u2014'}</span>
            <span className="text-emerald-400/70 font-bold tabular-nums">
              {pair.lastMatchup.winner === pair.team1.rosterId ? pair.lastMatchup.pts1.toFixed(1) : pair.lastMatchup.pts2.toFixed(1)}
            </span>
          </div>
        )}

        {pair.streakHolder && pair.streakHolder.rosterId !== loser.rosterId && (
          <div className="text-[11px] text-red-400/40 text-center font-medium">
            {winner.displayName} has won {pair.streakHolder.streak} straight meetings
          </div>
        )}
        <EvidenceChips evidence={pair.evidence} />

        {narrative && (
          <p className="text-[11px] text-white/40 leading-relaxed italic">{narrative}</p>
        )}
      </div>
    </div>
  )
}

function TradeTensionCard({ data, narrative }: { data: NonNullable<RivalryWeekData['tradeTensionIndex']>; narrative?: string }) {
  const { pair, tensionScore, tradeCount } = data
  const barWidth = Math.max(tensionScore, 5)
  const barColor = tensionScore >= 70 ? 'bg-gradient-to-r from-red-500 to-orange-500' : tensionScore >= 40 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'
  const label = tensionScore >= 70 ? 'Volatile' : tensionScore >= 40 ? 'Heating Up' : 'Simmering'
  const glowClass = tensionScore >= 70 ? 'neon-glow-red' : tensionScore >= 40 ? 'neon-glow-amber' : 'neon-glow-cyan'

  return (
    <div className={cx('relative rounded-2xl glass-card-vivid p-4 space-y-3 animate-slide-up', glowClass)} style={{ animationDelay: '150ms' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/[0.06] to-violet-500/[0.02] pointer-events-none rounded-2xl" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{'\u{1F4CA}'}</span>
            <span className="text-xs font-black text-purple-400/90 uppercase tracking-wider">Trade Tension</span>
          </div>
          <span className={cx('text-[11px] font-black px-2.5 py-1 rounded-full border',
            tensionScore >= 70 ? 'bg-red-500/10 text-red-400 border-red-500/20'
            : tensionScore >= 40 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          )}>{label}</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-white/30 font-medium">Tension Level</span>
            <span className="text-white/60 font-black tabular-nums animate-score-glow">{tensionScore}/100</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-white/[0.04] overflow-hidden">
            <div className={cx('h-full rounded-full transition-all shadow-sm', barColor)} style={{ width: `${barWidth}%` }} />
          </div>
        </div>

        <VsBlock pair={pair} compact />

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl glass-card p-2.5 text-center">
            <div className="text-base font-black text-purple-400 tabular-nums animate-score-glow">{tradeCount}</div>
            <div className="text-[11px] text-white/20 uppercase tracking-wider font-semibold">Trades Between</div>
          </div>
          <div className="rounded-xl glass-card p-2.5 text-center">
            <div className="text-base font-black text-purple-400 tabular-nums">{pair.h2hRecord.wins1 + pair.h2hRecord.wins2}</div>
            <div className="text-[11px] text-white/20 uppercase tracking-wider font-semibold">H2H Meetings</div>
          </div>
        </div>

        <EvidenceChips evidence={pair.evidence} />

        {narrative && (
          <p className="text-[11px] text-white/40 leading-relaxed italic">{narrative}</p>
        )}
      </div>
    </div>
  )
}

interface RivalryNarratives {
  rivalryOfTheWeek?: string
  revengeGame?: string
  tradeTension?: string
}

export default function RivalryWeekCards({ data, narratives }: { data: RivalryWeekData; narratives?: RivalryNarratives }) {
  if (!data.rivalryOfTheWeek && !data.revengeGame && !data.tradeTensionIndex) return null

  return (
    <div className="w-full space-y-5">
      <div className="text-center space-y-1.5">
        <h3 className="text-base sm:text-lg font-black text-white flex items-center justify-center gap-2">
          <span className="animate-rival-pulse">{'\u{1F3C6}'}</span>
          <span>Rivalry <span className="bg-gradient-to-r from-amber-400 to-red-400 bg-clip-text text-transparent">Week Mode</span></span>
        </h3>
        <p className="text-[11px] text-white/30 font-medium">AI-generated weekly narrative cards from your league data</p>
      </div>

      <div className="grid gap-4">
        {data.rivalryOfTheWeek && (
          <RivalryOfTheWeekCard pair={data.rivalryOfTheWeek} narrative={narratives?.rivalryOfTheWeek} />
        )}

        <div className={cx('grid gap-4', data.revengeGame && data.tradeTensionIndex ? 'sm:grid-cols-2' : '')}>
          {data.revengeGame && (
            <RevengeGameCard pair={data.revengeGame} narrative={narratives?.revengeGame} />
          )}
          {data.tradeTensionIndex && (
            <TradeTensionCard data={data.tradeTensionIndex} narrative={narratives?.tradeTension} />
          )}
        </div>
      </div>

      {data.topRivalries.length > 1 && (
        <div className="rounded-xl glass-card p-3 space-y-2 animate-slide-up" style={{ animationDelay: '200ms' }}>
          <div className="text-[11px] font-bold text-white/25 uppercase tracking-widest">Top Rivalries Ranked</div>
          {data.topRivalries.map((r, i) => (
            <div key={`${r.team1.rosterId}-${r.team2.rosterId}`} className="flex items-center gap-3 py-1.5">
              <span className={cx('text-xs font-black w-5 text-center tabular-nums',
                i === 0 ? 'text-amber-400 animate-score-glow' : i === 1 ? 'text-white/35' : 'text-white/20'
              )}>#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Avatar src={r.team1.avatar} name={r.team1.displayName} size={20} />
                  <span className="text-[11px] text-white/45 truncate font-medium">{r.team1.displayName}</span>
                  <span className="text-[11px] text-white/15 font-bold">VS</span>
                  <span className="text-[11px] text-white/45 truncate font-medium">{r.team2.displayName}</span>
                  <Avatar src={r.team2.avatar} name={r.team2.displayName} size={20} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/20 tabular-nums">{r.h2hRecord.wins1}-{r.h2hRecord.wins2}</span>
                <span className={cx('text-[11px] font-black tabular-nums px-2 py-0.5 rounded-full',
                  i === 0 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-white/[0.03] text-white/30'
                )}>{r.totalScore}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
