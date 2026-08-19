'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { OverviewReportCard } from '@/components/legacy/OverviewReportCard'
import { OverviewInsights }   from '@/components/legacy/OverviewInsights'
import { OverviewLanes }      from '@/components/legacy/OverviewLanes'

// ─── TYPES ───────────────────────────────────────────────────────

interface PlayerRank {
  careerTier:       number
  careerTierName:   string
  careerLevel:      number
  careerXp:         bigint | number
  aiReportGrade:    string    // A+, A, A-, B+, etc.
  aiScore:          number    // 0-100
  aiInsight:        string
  winRate:          number
  playoffRate:      number
  championshipCount: number
  seasonsPlayed:    number
  importedAt:       string | null
}

interface ImportState {
  platform:  'sleeper' | 'yahoo' | 'mfl' | 'fantrax' | 'espn'
  username:  string
  loading:   boolean
  error:     string | null
  success:   boolean
}

// ─── TIER CONFIG ─────────────────────────────────────────────────
// 10 tiers — players are proud of each one, each has real meaning

const TIERS = [
  { tier: 10, name: 'Practice Squad',   color: '#94a3b8', glow: 'rgba(148,163,184,0.3)',  badge: '🎮', desc: 'Everyone starts here. Get your reps in.' },
  { tier: 9,  name: 'Undrafted Free Agent', color: '#a78bfa', glow: 'rgba(167,139,250,0.3)', badge: '📋', desc: 'You know the game. Time to prove it.' },
  { tier: 8,  name: 'Camp Invite',      color: '#818cf8', glow: 'rgba(129,140,248,0.3)',  badge: '⛺', desc: 'Competing for a roster spot.' },
  { tier: 7,  name: 'Rookie',           color: '#60a5fa', glow: 'rgba(96,165,250,0.3)',   badge: '🐣', desc: 'First taste of real competition.' },
  { tier: 6,  name: 'Starter',          color: '#34d399', glow: 'rgba(52,211,153,0.3)',   badge: '▶️', desc: 'A reliable presence in any league.' },
  { tier: 5,  name: 'Veteran',          color: '#fbbf24', glow: 'rgba(251,191,36,0.3)',   badge: '🎖️', desc: 'Experience that shows up when it counts.' },
  { tier: 4,  name: 'All-Pro',          color: '#f59e0b', glow: 'rgba(245,158,11,0.3)',   badge: '⭐', desc: 'Elite across formats and platforms.' },
  { tier: 3,  name: 'Playoff Performer', color: '#ef4444', glow: 'rgba(239,68,68,0.3)',   badge: '🔥', desc: 'Built for the moment. Wins when it matters.' },
  { tier: 2,  name: 'Champion',         color: '#06b6d4', glow: 'rgba(6,182,212,0.3)',    badge: '🏆', desc: 'Titles. Rings. Respect.' },
  { tier: 1,  name: 'Dynasty',          color: '#c084fc', glow: 'rgba(192,132,252,0.4)',  badge: '👑', desc: 'Generational. The standard everyone chases.' },
]

const PLATFORMS = [
  { id: 'sleeper', label: 'Sleeper', emoji: '🌙', active: true  },
  { id: 'yahoo',   label: 'Yahoo',   emoji: '🏈', active: true  },
  { id: 'mfl',     label: 'MFL',     emoji: '🏆', active: true  },
  { id: 'fantrax', label: 'Fantrax', emoji: '📊', active: true  },
  { id: 'espn',    label: 'ESPN',    emoji: '🔴', active: false },
] as const

function getTierConfig(tier: number) {
  return TIERS.find(t => t.tier === tier) ?? TIERS[TIERS.length - 1]
}

// ─── RANK BADGE ──────────────────────────────────────────────────

function RankBadge({ rank, size = 'md' }: { rank: PlayerRank; size?: 'sm' | 'md' | 'lg' }) {
  const cfg   = getTierConfig(rank.careerTier)
  const sizes = {
    sm: { outer: 'w-16 h-16', inner: 'w-12 h-12', emoji: 'text-2xl', tier: 'text-[10px]' },
    md: { outer: 'w-24 h-24', inner: 'w-20 h-20', emoji: 'text-4xl', tier: 'text-xs'    },
    lg: { outer: 'w-36 h-36', inner: 'w-32 h-32', emoji: 'text-6xl', tier: 'text-sm'    },
  }[size]

  return (
    <div className={`relative flex items-center justify-center ${sizes.outer}`}>
      {/* Glow ring */}
      <div
        className="absolute inset-0 rounded-full animate-pulse"
        style={{ boxShadow: `0 0 32px 8px ${cfg.glow}`, background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)` }}
      />
      {/* Badge ring */}
      <div
        className={`relative ${sizes.inner} rounded-full flex flex-col items-center justify-center border-2`}
        style={{
          borderColor: cfg.color,
          background:  `radial-gradient(circle at 35% 35%, ${cfg.glow}, rgba(10,10,30,0.95))`,
          boxShadow:   `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 0 1px rgba(255,255,255,0.04)`,
        }}
      >
        <span className={sizes.emoji}>{cfg.badge}</span>
        <span className={`${sizes.tier} font-bold mt-0.5`} style={{ color: cfg.color }}>
          TIER {rank.careerTier}
        </span>
      </div>
    </div>
  )
}

// ─── TIER LADDER ─────────────────────────────────────────────────

function TierLadder({ currentTier }: { currentTier: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Ranking Ladder</p>
      <div className="space-y-1.5">
        {TIERS.map(t => {
          const isActive = t.tier === currentTier
          const isPassed = t.tier > currentTier
          return (
            <div
              key={t.tier}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all ${
                isActive  ? 'ring-1 ring-inset' : ''
              }`}
              style={isActive ? { background: `${t.glow}`, ringColor: t.color } : {}}
            >
              <span className={`text-base ${isPassed ? 'opacity-30' : ''}`}>{t.badge}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold truncate ${isPassed ? 'text-white/25' : 'text-white/80'}`}
                     style={isActive ? { color: t.color } : {}}>
                  {t.name}
                </div>
              </div>
              <span className={`text-[10px] font-bold ${isPassed ? 'text-white/20' : 'text-white/30'}`}
                    style={isActive ? { color: t.color } : {}}>
                T{t.tier}
              </span>
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: t.color }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── IMPORT PANEL ────────────────────────────────────────────────

function ImportPanel({ onImportSuccess }: { onImportSuccess: () => void }) {
  const [state, setState] = useState<ImportState>({
    platform: 'sleeper',
    username: '',
    loading:  false,
    error:    null,
    success:  false,
  })

  const handleImport = useCallback(async () => {
    if (!state.username.trim()) return
    setState(s => ({ ...s, loading: true, error: null }))

    try {
      const res = await fetch('/api/import-sleeper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: state.username, platform: state.platform }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setState(s => ({ ...s, loading: false, success: true }))
      onImportSuccess()
    } catch (err: unknown) {
      setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Import failed' }))
    }
  }, [state.username, state.platform, onImportSuccess])

  return (
    <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-[#12082a] to-[#0a0a1e] p-6 shadow-2xl">
      {/* Header */}
      <div className="mb-5">
        <h3 className="text-lg font-bold text-white">Build Your Legacy Profile</h3>
        <p className="text-sm text-white/50 mt-0.5">
          Connect your fantasy platform to calculate your official AllFantasy Rank.
        </p>
      </div>

      {/* Platform picker */}
      <div className="grid grid-cols-5 gap-2 mb-5">
        {PLATFORMS.map(p => (
          <button
            key={p.id}
            onClick={() => p.active && setState(s => ({ ...s, platform: p.id as ImportState['platform'] }))}
            disabled={!p.active}
            className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border transition-all text-xs font-semibold ${
              !p.active
                ? 'border-white/5 text-white/20 cursor-not-allowed opacity-40'
                : state.platform === p.id
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                  : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white'
            }`}
          >
            <span className="text-xl">{p.emoji}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Username input */}
      <div className="mb-4">
        <label className="text-[11px] font-semibold text-white/40 uppercase tracking-widest mb-2 block">
          Platform Username or League ID
        </label>
        <input
          type="text"
          value={state.username}
          onChange={e => setState(s => ({ ...s, username: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && handleImport()}
          placeholder="your_username"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
        />
        <p className="text-[11px] text-white/30 mt-2">
          We only read public league history. No passwords. No posting. Ever.
        </p>
      </div>

      {/* Error */}
      {state.error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleImport}
        disabled={state.loading || !state.username.trim()}
        className="w-full rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
          boxShadow:  state.loading ? 'none' : '0 4px 24px rgba(124,58,237,0.4)',
        }}
      >
        {state.loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
            </svg>
            Importing...
          </span>
        ) : (
          '🔥 Build My Legacy Profile'
        )}
      </button>

      <p className="text-center text-[11px] text-white/25 mt-3">
        Takes ~1 minute · Free · No signup required
      </p>

      {/* Steps */}
      <div className="mt-5 pt-4 border-t border-white/8">
        <p className="text-[11px] text-white/30 text-center uppercase tracking-wider mb-3">What happens next</p>
        <div className="flex items-center justify-center gap-2">
          {[['1','Connect'],['2','Import'],['3','AI Report']].map(([num, label], i) => (
            <div key={num} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                     style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}>
                  {num}
                </div>
                <span className="text-[10px] text-white/40">{label}</span>
              </div>
              {i < 2 && <div className="w-8 h-px bg-white/15 mb-4" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── CAREER STATS ────────────────────────────────────────────────

function CareerStats({ rank }: { rank: PlayerRank }) {
  const cfg = getTierConfig(rank.careerTier)

  const stats = [
    { label: 'Win Rate',           value: `${(rank.winRate * 100).toFixed(1)}%`,  sub: 'career average'      },
    { label: 'Playoff Rate',       value: `${(rank.playoffRate * 100).toFixed(0)}%`, sub: 'seasons qualified' },
    { label: 'Championships',      value: String(rank.championshipCount),          sub: 'total titles'        },
    { label: 'Seasons Played',     value: String(rank.seasonsPlayed),              sub: 'career length'       },
  ]

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Career Stats</p>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-white/6 bg-white/3 p-3">
            <div className="text-xl font-bold text-white" style={{ color: cfg.color }}>{s.value}</div>
            <div className="text-[11px] font-semibold text-white/70 mt-0.5">{s.label}</div>
            <div className="text-[10px] text-white/30">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── LEAGUE ACCESS RULE CARD ─────────────────────────────────────

function LeagueAccessRules({ rank }: { rank: PlayerRank }) {
  const cfg     = getTierConfig(rank.careerTier)
  const tierUp  = getTierConfig(Math.max(1, rank.careerTier - 1))
  const tierDn  = getTierConfig(Math.min(10, rank.careerTier + 1))

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: `${cfg.color}30`, background: `radial-gradient(ellipse at top left, ${cfg.glow}, #0d0d1f)` }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: cfg.glow, border: `1px solid ${cfg.color}` }}>
          🔒
        </div>
        <p className="text-xs font-bold text-white/60 uppercase tracking-widest">League Access</p>
      </div>

      <div className="space-y-2.5">
        {/* Can join */}
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3">
          <div className="text-[11px] font-bold text-green-400 uppercase tracking-wide mb-1.5">✓ You Can Request to Join</div>
          <div className="flex flex-wrap gap-1.5">
            {[tierUp, cfg, tierDn].map(t => (
              <span key={t.tier} className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                    style={{ background: `${t.glow}`, color: t.color, border: `1px solid ${t.color}40` }}>
                {t.badge} {t.name}
              </span>
            ))}
          </div>
        </div>

        {/* Can be invited to any */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wide mb-1">⚡ Invitations</div>
          <p className="text-xs text-white/50">
            Any manager can invite you to any tier league. You decide whether to accept.
          </p>
        </div>

        {/* Locked tiers */}
        <div className="rounded-xl border border-white/5 bg-white/2 p-3">
          <div className="text-[11px] font-bold text-white/30 uppercase tracking-wide mb-1">🔒 Rank Up to Access Higher Leagues</div>
          <p className="text-xs text-white/30">
            Leagues 2+ tiers above yours require you to level up first. Earn XP by competing and winning.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── RANK HERO ───────────────────────────────────────────────────

function RankHero({ rank, username }: { rank: PlayerRank; username: string }) {
  const cfg = getTierConfig(rank.careerTier)
  const xp  = Number(rank.careerXp)

  // XP needed per tier (rough progression)
  const xpThresholds = [0, 500, 1500, 3500, 7000, 12000, 20000, 32000, 50000, 75000, 100000]
  const currentThreshold = xpThresholds[10 - rank.careerTier] ?? 0
  const nextThreshold    = xpThresholds[Math.max(0, 10 - rank.careerTier - 1)] ?? currentThreshold
  const xpProgress = nextThreshold > currentThreshold
    ? Math.min(100, ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
    : 100

  return (
    <div className="relative rounded-3xl overflow-hidden border border-white/8"
         style={{ background: `radial-gradient(ellipse at 30% 0%, ${cfg.glow}, #07071a 60%)` }}>
      {/* Decorative top gradient line */}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${cfg.color}, transparent)` }} />

      <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        {/* Badge */}
        <RankBadge rank={rank} size="lg" />

        {/* Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: cfg.color }}>
            Your AllFantasy Rank
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white leading-none mb-1">
            {cfg.name}
          </h1>
          <p className="text-sm text-white/50 mb-1">@{username}</p>
          <p className="text-sm text-white/60 italic mb-4">{cfg.desc}</p>

          {/* XP bar */}
          <div className="max-w-xs sm:max-w-sm mx-auto sm:mx-0">
            <div className="flex justify-between text-[11px] text-white/40 mb-1.5">
              <span>Level {rank.careerLevel}</span>
              <span>{xp.toLocaleString()} XP</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width:      `${xpProgress}%`,
                  background: `linear-gradient(90deg, ${cfg.color}80, ${cfg.color})`,
                  boxShadow:  `0 0 8px ${cfg.color}`,
                }}
              />
            </div>
            <div className="text-[10px] text-white/30 mt-1 text-right">
              {rank.careerTier > 1 ? `${(nextThreshold - xp).toLocaleString()} XP to ${getTierConfig(rank.careerTier - 1).name}` : 'Max Tier Achieved'}
            </div>
          </div>
        </div>

        {/* Grade pill */}
        <div className="flex flex-col items-center gap-1">
          <div className="rounded-2xl px-5 py-4 text-center border"
               style={{ background: `${cfg.glow}`, borderColor: `${cfg.color}40` }}>
            <div className="text-3xl font-black" style={{ color: cfg.color }}>{rank.aiReportGrade}</div>
            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-0.5">AI Grade</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">{rank.aiScore}</div>
            <div className="text-[10px] text-white/30">/ 100</div>
          </div>
        </div>
      </div>

      {/* AI Insight strip */}
      <div className="border-t border-white/6 px-6 sm:px-8 py-3 flex items-start gap-3">
        <span className="text-cyan-400 text-xs font-bold mt-0.5 shrink-0">AI</span>
        <p className="text-xs text-white/60 italic leading-relaxed">"{rank.aiInsight}"</p>
      </div>
    </div>
  )
}

// ─── EMPTY STATE (no import yet) ─────────────────────────────────

function EmptyRankState({ onImported }: { onImported: () => void }) {
  return (
    <div className="space-y-6">
      {/* Hero teaser */}
      <div className="relative rounded-3xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#12082a] to-[#07071a] p-8 text-center">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(124,58,237,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(6,182,212,0.3) 0%, transparent 50%)',
        }} />
        <div className="relative">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">
            Turn your fantasy history into a{' '}
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Legacy Profile
            </span>
          </h2>
          <p className="text-white/50 text-sm max-w-md mx-auto mb-2">
            Import your career data and earn your official AllFantasy Rank — a badge you display, defend, and level up.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-4 text-sm">
            {['🟢 Career rank & trends', '🟢 Playoff & championship context', '🟢 AI coaching insights'].map(item => (
              <span key={item} className="rounded-full bg-white/5 border border-white/10 px-3 py-1 text-white/60 text-xs">{item}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Import panel */}
        <ImportPanel onImportSuccess={onImported} />

        {/* Tier ladder preview */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">The Ranking System</p>
            <div className="space-y-1.5">
              {TIERS.map(t => (
                <div key={t.tier} className="flex items-center gap-3 rounded-xl px-3 py-2">
                  <span className="text-base">{t.badge}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white/70 truncate">{t.name}</div>
                    <div className="text-[10px] text-white/30 truncate">{t.desc}</div>
                  </div>
                  <span className="text-[10px] font-bold text-white/20">T{t.tier}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* League access preview */}
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        <div className="flex items-start gap-4">
          <div className="text-3xl">🔒</div>
          <div>
            <h3 className="font-bold text-white mb-1">Ranking Controls League Access</h3>
            <p className="text-sm text-white/60">
              Your rank determines which leagues you can request to join — within 1 tier of your current rank.
              Earn your way up. Anyone can invite you to any league, but joining higher-tier leagues requires leveling up.
              Your rank is something to defend, something to display, something to be proud of.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── FULL RANK VIEW (imported) ────────────────────────────────────

function FullRankView({ rank, username, onReimport }: { rank: PlayerRank; username: string; onReimport: () => void }) {
  return (
    <div className="space-y-6">
      {/* Rank hero */}
      <RankHero rank={rank} username={username} />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: career stats + access rules */}
        <div className="space-y-4">
          <CareerStats rank={rank} />
          <LeagueAccessRules rank={rank} />
        </div>

        {/* Center: AI report card + insights */}
        <div className="lg:col-span-2 space-y-4">
          {/* Report card from af-legacy components */}
          <OverviewReportCard />
          <OverviewInsights />

          {/* Reimport CTA */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">Update your profile</p>
              <p className="text-xs text-white/40">Reimport to recalculate your rank with latest season data</p>
            </div>
            <button
              onClick={onReimport}
              className="shrink-0 rounded-xl px-4 py-2 text-xs font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-all"
            >
              Reimport
            </button>
          </div>
        </div>
      </div>

      {/* Tier ladder */}
      <TierLadder currentTier={rank.careerTier} />
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────

export default function MyRankingsPage() {
  const { data: session } = useSession()
  const router            = useRouter()
  const [rank,       setRank]        = useState<PlayerRank | null>(null)
  const [loading,    setLoading]     = useState(true)
  const [showImport, setShowImport]  = useState(false)

  const loadRank = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/user/rank')
      const data = await res.json()
      if (res.ok && data.rank) {
        setRank(data.rank)
      } else {
        setRank(null)
      }
    } catch {
      setRank(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRank() }, [loadRank])

  const username = session?.user?.name ?? session?.user?.email?.split('@')[0] ?? 'manager'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-violet-500/40 border-t-violet-500 animate-spin" />
          <p className="text-sm text-white/40">Loading your rank...</p>
        </div>
      </div>
    )
  }

  if (!rank || showImport) {
    return (
      <EmptyRankState
        onImported={() => {
          setShowImport(false)
          loadRank()
        }}
      />
    )
  }

  return (
    <FullRankView
      rank={rank}
      username={username}
      onReimport={() => setShowImport(true)}
    />
  )
}
