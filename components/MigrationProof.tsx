'use client'

import React, { useEffect, useRef, useState } from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

interface Manager {
  rosterId: number
  displayName: string
  username: string
  avatar: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: string
  rosterSize: number
}

interface TradeSide {
  rosterId: number
  username: string
  avatar: string | null
  receives: { players: { id: string; name: string; pos: string; team: string }[]; picks: number }
}

interface RecentTrade {
  id: string
  created: number
  teamsInvolved: number
  sides: TradeSide[]
}

interface StorylineEvidence {
  type: string
  label: string
  detail: string
}

interface Storyline {
  title: string
  description: string
  type: string
  confidence?: number
  evidence?: StorylineEvidence[]
  nextTrigger?: string
}

interface TransferPreview {
  league: {
    id: string
    name: string
    sport: string
    season: string
    type: string
    status: string
    teamCount: number
    playoffTeams: number
    avatar: string | null
    settings: { ppr: number; superflex: boolean; tep: boolean }
    scoringSettings: Record<string, number>
  }
  managers: Manager[]
  stats: {
    totalSeasons: number
    totalTrades: number
    totalDraftPicks: number
    totalMatchups: number
    previousSeasons: string[]
  }
  recentTrades: RecentTrade[]
  storylines: Storyline[]
}

const STORYLINE_ICONS: Record<string, string> = {
  rivalry: '\u{2694}\uFE0F',
  redemption: '\u{1F525}',
  contender: '\u{1F3C6}',
  underdog: '\u{1F43A}',
  dynasty: '\u{1F451}',
  trade_war: '\u{1F4B0}',
  sleeper: '\u{1F4A4}',
}

const STORYLINE_CARD_STYLES: Record<string, { border: string; bg: string; glow: string; accent: string; label: string }> = {
  rivalry:   { border: 'border-red-500/25', bg: 'from-red-500/[0.08] via-red-900/[0.04] to-transparent', glow: 'neon-glow-red', accent: 'text-red-400', label: 'text-red-400/60' },
  contender: { border: 'border-amber-500/25', bg: 'from-amber-500/[0.08] via-amber-900/[0.04] to-transparent', glow: 'neon-glow-amber', accent: 'text-amber-400', label: 'text-amber-400/60' },
  underdog:  { border: 'border-cyan-500/25', bg: 'from-cyan-500/[0.08] via-cyan-900/[0.04] to-transparent', glow: 'neon-glow-cyan', accent: 'text-cyan-400', label: 'text-cyan-400/60' },
  dynasty:   { border: 'border-purple-500/25', bg: 'from-purple-500/[0.08] via-purple-900/[0.04] to-transparent', glow: 'neon-glow-purple', accent: 'text-purple-400', label: 'text-purple-400/60' },
  redemption:{ border: 'border-orange-500/25', bg: 'from-orange-500/[0.08] via-orange-900/[0.04] to-transparent', glow: 'neon-glow-amber', accent: 'text-orange-400', label: 'text-orange-400/60' },
  trade_war: { border: 'border-pink-500/25', bg: 'from-pink-500/[0.08] via-pink-900/[0.04] to-transparent', glow: 'neon-glow-red', accent: 'text-pink-400', label: 'text-pink-400/60' },
  sleeper:   { border: 'border-slate-500/25', bg: 'from-slate-500/[0.06] via-slate-900/[0.03] to-transparent', glow: '', accent: 'text-slate-400', label: 'text-slate-400/60' },
}

const EVIDENCE_ICONS: Record<string, string> = {
  record: '\u{1F4CA}',
  trade: '\u{1F91D}',
  manager: '\u{1F464}',
  matchup: '\u{26A1}',
  trend: '\u{1F4C8}',
}

const EVIDENCE_COLORS: Record<string, string> = {
  record: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  trade: 'bg-pink-500/15 text-pink-300 border-pink-500/20',
  manager: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  matchup: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  trend: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
}

function TickUpNumber({ value, suffix }: { value: string | number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <span ref={ref} className={cx('inline-block tabular-nums', visible ? 'animate-tick-up' : 'opacity-0')}>
      {value}{suffix}
    </span>
  )
}

function AIFoundTag({ label, delay }: { label: string; delay?: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShow(true), delay || 200); return () => clearTimeout(t) }, [delay])
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/20 text-[11px] font-semibold text-cyan-300 animate-ai-found">
      <span className="w-1 h-1 rounded-full bg-cyan-400 animate-rival-pulse" />
      AI found: {label}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-400'
  const glowColor = value >= 80 ? 'shadow-emerald-500/30' : value >= 50 ? 'shadow-amber-500/30' : 'shadow-red-500/30'
  const label = value >= 80 ? 'High' : value >= 50 ? 'Medium' : 'Low'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cx('h-full rounded-full transition-all shadow-sm', color, glowColor)} style={{ width: `${Math.max(value, 3)}%` }} />
      </div>
      <span className={cx('text-[11px] font-bold tabular-nums',
        value >= 80 ? 'text-emerald-400' : value >= 50 ? 'text-amber-400' : 'text-red-400'
      )}>{value}%</span>
      <span className={cx('text-[11px] uppercase font-semibold tracking-wider',
        value >= 80 ? 'text-emerald-400/50' : value >= 50 ? 'text-amber-400/50' : 'text-red-400/50'
      )}>{label}</span>
    </div>
  )
}

function deriveRivalryWeek(managers: Manager[]): { team1: string; team2: string; narrative: string } | null {
  if (managers.length < 2) return null
  const sorted = [...managers].sort((a, b) => b.wins - a.wins || parseFloat(b.pointsFor) - parseFloat(a.pointsFor))
  const t1 = sorted[0]
  const t2 = sorted[1]
  const t1Pts = parseFloat(t1.pointsFor)
  const t2Pts = parseFloat(t2.pointsFor)
  const diff = Math.abs(t1Pts - t2Pts).toFixed(1)
  return {
    team1: t1.displayName,
    team2: t2.displayName,
    narrative: `${t1.displayName} (${t1.wins}-${t1.losses}) vs ${t2.displayName} (${t2.wins}-${t2.losses}) \u2014 separated by just ${diff} points.`,
  }
}

function deriveTradeOpportunities(managers: Manager[]): { buyer: string; seller: string; reason: string }[] {
  if (managers.length < 4) return []
  const sorted = [...managers].sort((a, b) => b.wins - a.wins || parseFloat(b.pointsFor) - parseFloat(a.pointsFor))
  const contenders = sorted.slice(0, Math.ceil(sorted.length / 3))
  const rebuilders = sorted.slice(-Math.ceil(sorted.length / 3))
  const opps: { buyer: string; seller: string; reason: string }[] = []
  if (contenders[0] && rebuilders[0]) {
    opps.push({ buyer: contenders[0].displayName, seller: rebuilders[0].displayName, reason: `${contenders[0].displayName} is contending (${contenders[0].wins}W) and could acquire depth from ${rebuilders[0].displayName} (${rebuilders[0].wins}W) who should sell for future picks.` })
  }
  if (contenders.length > 1 && rebuilders.length > 1) {
    opps.push({ buyer: contenders[1].displayName, seller: rebuilders[1].displayName, reason: `${contenders[1].displayName} needs a push for playoffs while ${rebuilders[1].displayName} could flip assets for long-term value.` })
  }
  return opps
}

function deriveWaiverPriorities(managers: Manager[]): { team: string; priority: string; reason: string }[] {
  const priorities: { team: string; priority: string; reason: string }[] = []
  const sorted = [...managers].sort((a, b) => parseFloat(a.pointsFor) - parseFloat(b.pointsFor))
  const weakest = sorted[0]
  if (weakest) priorities.push({ team: weakest.displayName, priority: 'High-upside RB/WR handcuff', reason: `Lowest scorer (${weakest.pointsFor} pts) \u2014 needs ceiling plays to close the gap.` })
  const middleTier = sorted[Math.floor(sorted.length / 2)]
  if (middleTier) priorities.push({ team: middleTier.displayName, priority: 'Streaming QB/TE', reason: `Mid-pack team (${middleTier.wins}-${middleTier.losses}) \u2014 matchup-based streaming could swing a playoff berth.` })
  const topTeam = sorted[sorted.length - 1]
  if (topTeam && topTeam !== weakest) priorities.push({ team: topTeam.displayName, priority: 'Depth stash', reason: `Top scorer (${topTeam.pointsFor} pts) \u2014 should lock in handcuffs to protect the championship run.` })
  return priorities
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

export default function MigrationProof({ preview }: { preview: TransferPreview }) {
  const managers = preview?.managers || []
  const league = preview?.league || { id: '', name: 'League', sport: 'NFL', season: '', type: 'Redraft', status: '', teamCount: 0, playoffTeams: 0, avatar: null, settings: { ppr: 0, superflex: false, tep: false }, scoringSettings: {} }
  const stats = preview?.stats || { totalSeasons: 0, totalTrades: 0, totalDraftPicks: 0, totalMatchups: 0, previousSeasons: [] }
  const recentTrades = preview?.recentTrades || []
  const sorted = [...managers].sort((a, b) => b.wins - a.wins || parseFloat(b.pointsFor || '0') - parseFloat(a.pointsFor || '0'))
  const rivalry = managers.length >= 2 ? deriveRivalryWeek(managers) : null
  const tradeOpps = deriveTradeOpportunities(managers)
  const waiverPriorities = deriveWaiverPriorities(managers)
  const storylines = preview?.storylines || []

  if (managers.length === 0) return null

  return (
    <div className="w-full space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-lg sm:text-xl font-bold text-white">
          Same Data, <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Better Intelligence</span>
        </h2>
        <p className="text-xs text-white/40 max-w-lg mx-auto">
          Your Sleeper league data on the left. What AllFantasy does with it on the right.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* LEFT: Sleeper Snapshot */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#1a1a2e] flex items-center justify-center text-[11px] font-bold text-[#00c2ff]">S</div>
            <span className="text-xs font-semibold text-white/60">Sleeper Snapshot</span>
            <span className="ml-auto text-[11px] text-white/20 uppercase tracking-widest font-medium">Raw Data</span>
          </div>

          <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
            <div>
              <div className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-2">League Settings</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'Format', value: league.type },
                  { label: 'Scoring', value: league.settings?.ppr === 1 ? 'PPR' : league.settings?.ppr === 0.5 ? 'Half PPR' : 'Standard' },
                  { label: 'Teams', value: String(league.teamCount) },
                  { label: 'Superflex', value: league.settings?.superflex ? 'Yes' : 'No' },
                  { label: 'Playoff Teams', value: String(league.playoffTeams) },
                  { label: 'Season', value: league.season },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center px-2 py-1.5 rounded-lg bg-white/[0.03] text-[11px]">
                    <span className="text-white/30">{s.label}</span>
                    <span className="text-white/60 font-medium">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-2">Standings</div>
              <div className="space-y-1">
                {sorted.map((m, idx) => (
                  <div key={m.rosterId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03]">
                    <span className="w-4 text-[11px] font-bold text-white/25 text-center tabular-nums">{idx + 1}</span>
                    {m.avatar ? (
                      <img src={m.avatar} alt="" className="w-5 h-5 rounded-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-bold text-white/40">{m.displayName.charAt(0).toUpperCase()}</div>
                    )}
                    <span className="text-[11px] text-white/60 flex-1 truncate">{m.displayName}</span>
                    <span className="text-[11px] text-white/40 tabular-nums">{m.wins}-{m.losses}{m.ties ? `-${m.ties}` : ''}</span>
                    <span className="text-[11px] text-white/20 tabular-nums w-12 text-right">{m.pointsFor}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-2">
                Recent Trades ({stats.totalTrades} total)
              </div>
              {recentTrades.length === 0 ? (
                <div className="text-[11px] text-white/20 text-center py-3">No trades recorded</div>
              ) : (
                <div className="space-y-2">
                  {recentTrades.slice(0, 3).map(trade => (
                    <div key={trade.id} className="rounded-lg bg-white/[0.03] p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/25">{timeAgo(trade.created)}</span>
                        <span className="text-[11px] text-white/15">{trade.teamsInvolved} teams</span>
                      </div>
                      {trade.sides.map(side => (
                        <div key={side.rosterId} className="flex items-start gap-1.5">
                          <span className="text-[11px] text-white/40 shrink-0 mt-0.5">{side.username} gets:</span>
                          <div className="flex flex-wrap gap-1">
                            {side.receives.players.map(p => (
                              <span key={p.id} className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/50">{p.name} <span className="text-white/20">{p.pos}</span></span>
                            ))}
                            {side.receives.picks > 0 && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/50">+{side.receives.picks} pick{side.receives.picks > 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Seasons', value: stats.totalSeasons },
                { label: 'Draft Picks', value: stats.totalDraftPicks },
                { label: 'Matchups', value: stats.totalMatchups },
              ].map(s => (
                <div key={s.label} className="text-center py-2 rounded-lg bg-white/[0.03]">
                  <div className="text-sm font-bold text-white/40 tabular-nums">{s.value}</div>
                  <div className="text-[11px] text-white/20 uppercase">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: AF Enhanced View */}
        <div className="glass-card-vivid rounded-2xl overflow-hidden neon-glow-cyan animate-neon-border">
          <div className="px-4 py-3 border-b border-cyan-500/10 bg-gradient-to-r from-cyan-500/[0.08] to-purple-500/[0.06] flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-[11px] font-bold text-white shadow-lg shadow-cyan-500/20">AF</div>
            <div>
              <span className="text-xs font-bold bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent">AllFantasy Enhanced</span>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-rival-pulse" />
                <span className="text-[11px] text-emerald-400/60 font-medium">AI-Powered</span>
              </div>
            </div>
            <span className="ml-auto text-[11px] text-cyan-400/40 uppercase tracking-widest font-medium">Enhanced</span>
          </div>

          <div className="p-4 space-y-5 max-h-[600px] overflow-y-auto">
            {/* Rivalry Week */}
            {rivalry && (
              <div className="rounded-xl glass-card neon-glow-red p-3 space-y-2 animate-slide-up">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm animate-rival-pulse">{'\u{2694}\uFE0F'}</span>
                    <span className="text-[11px] font-bold text-red-300 uppercase tracking-wider">Rivalry Matchup</span>
                  </div>
                  <AIFoundTag label="rivalry" delay={300} />
                </div>
                <div className="flex items-center justify-center gap-4 py-1">
                  <span className="text-xs font-bold text-white">{rivalry.team1}</span>
                  <span className="text-xs font-black bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent animate-score-glow">VS</span>
                  <span className="text-xs font-bold text-white">{rivalry.team2}</span>
                </div>
                <p className="text-[11px] text-white/45 text-center leading-relaxed">{rivalry.narrative}</p>
              </div>
            )}

            {/* AI Storylines v2 */}
            {storylines.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: '100ms' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{'\u{1F4DD}'}</span>
                    <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Season Arc Timeline</span>
                  </div>
                  <AIFoundTag label={`${storylines.length} storylines`} delay={500} />
                </div>
                <div className="space-y-3 stagger-children">
                  {storylines.slice(0, 5).map((s, i) => {
                    const style = STORYLINE_CARD_STYLES[s.type] || STORYLINE_CARD_STYLES.sleeper
                    return (
                      <div key={i} className={cx('relative rounded-xl glass-card p-3.5 space-y-2.5 animate-slide-up', style.border, style.glow)}>
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-br opacity-100 pointer-events-none -z-10" />
                        <div className={cx('absolute inset-0 rounded-xl bg-gradient-to-br pointer-events-none -z-10', style.bg)} />
                        <div className="relative">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{STORYLINE_ICONS[s.type] || '\u{1F4A1}'}</span>
                              <span className="text-[11px] font-bold text-white">{s.title}</span>
                            </div>
                            <span className={cx('text-[11px] uppercase tracking-widest font-bold', style.label)}>{s.type.replace('_', ' ')}</span>
                          </div>
                          <p className="text-[11px] text-white/50 leading-relaxed mt-1">{s.description}</p>

                          {typeof s.confidence === 'number' && (
                            <div className="mt-2">
                              <ConfidenceBar value={s.confidence} />
                            </div>
                          )}

                          {s.evidence && s.evidence.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {s.evidence.map((e, j) => (
                                <span
                                  key={j}
                                  className={cx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[11px] font-medium backdrop-blur-sm',
                                    EVIDENCE_COLORS[e.type] || 'bg-white/10 text-white/50 border-white/10'
                                  )}
                                  title={e.detail}
                                >
                                  <span className="text-[11px]">{EVIDENCE_ICONS[e.type] || '\u{1F4CC}'}</span>
                                  {e.label}
                                </span>
                              ))}
                            </div>
                          )}

                          {s.nextTrigger && (
                            <div className="flex items-start gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
                              <span className="text-[11px] mt-0.5 text-white/15">{'\u{1F514}'}</span>
                              <span className="text-[11px] text-white/25 leading-relaxed italic">{s.nextTrigger}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Trade Opportunities */}
            {tradeOpps.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{'\u{1F4B1}'}</span>
                    <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Trade Opportunities</span>
                  </div>
                  <AIFoundTag label={`${tradeOpps.length} matches`} delay={700} />
                </div>
                <div className="space-y-2">
                  {tradeOpps.map((opp, i) => (
                    <div key={i} className="rounded-xl glass-card neon-glow-emerald p-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 font-bold border border-cyan-500/20">{opp.buyer}</span>
                        <span className="text-cyan-400/40">{'\u2192'}</span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 font-bold border border-amber-500/20">{opp.seller}</span>
                      </div>
                      <p className="text-[11px] text-white/40 leading-relaxed">{opp.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Waiver Priorities */}
            {waiverPriorities.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: '300ms' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{'\u{1F3AF}'}</span>
                    <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Waiver Priorities</span>
                  </div>
                  <AIFoundTag label="priorities" delay={900} />
                </div>
                <div className="space-y-1.5">
                  {waiverPriorities.map((wp, i) => (
                    <div key={i} className="rounded-xl glass-card neon-glow-purple p-3 flex items-start gap-2.5">
                      <span className="text-[11px] font-black text-purple-400 shrink-0 mt-0.5 animate-score-glow">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-white">{wp.team}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300 font-semibold border border-purple-500/20">{wp.priority}</span>
                        </div>
                        <p className="text-[11px] text-white/35 leading-relaxed mt-0.5">{wp.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Power Rankings Teaser */}
            <div className="rounded-xl glass-card-vivid neon-glow-cyan p-3 space-y-2 animate-slide-up" style={{ animationDelay: '400ms' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{'\u{1F4CA}'}</span>
                  <span className="text-[11px] font-bold bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent uppercase tracking-wider">AI Power Rankings</span>
                </div>
                <AIFoundTag label="rankings" delay={1100} />
              </div>
              <div className="space-y-1">
                {sorted.slice(0, 5).map((m, idx) => {
                  const composite = Math.round(90 - idx * 8 + (parseFloat(m.pointsFor) % 7))
                  const tier = composite >= 85 ? 'Contender' : composite >= 70 ? 'Frisky' : composite >= 55 ? 'Mid-Pack' : 'Rebuilding'
                  const tierColor = composite >= 85 ? 'text-amber-300 bg-amber-500/15 border-amber-500/20' : composite >= 70 ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/20' : composite >= 55 ? 'text-orange-300 bg-orange-500/15 border-orange-500/20' : 'text-red-300 bg-red-500/15 border-red-500/20'
                  return (
                    <div key={m.rosterId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03]">
                      <span className={cx(
                        'w-5 h-5 flex items-center justify-center rounded-md text-[11px] font-black',
                        idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-sm shadow-amber-500/30' :
                        idx === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-black' :
                        idx === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-black' :
                        'bg-white/10 text-white/40',
                      )}>{idx + 1}</span>
                      <span className="text-[11px] text-white/60 flex-1 truncate">{m.displayName}</span>
                      <span className="text-[11px] font-black text-white tabular-nums"><TickUpNumber value={composite} /></span>
                      <span className={cx('text-[11px] px-1.5 py-0.5 rounded-full font-bold border', tierColor)}>{tier}</span>
                    </div>
                  )
                })}
              </div>
              <div className="text-center pt-1">
                <span className="text-[11px] bg-gradient-to-r from-cyan-400/40 to-purple-400/40 bg-clip-text text-transparent font-medium">Full rankings with 5-score breakdown available after import</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
