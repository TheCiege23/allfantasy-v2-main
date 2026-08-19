'use client'

import {
  BarChart3,
  Brackets,
  CalendarDays,
  Crown,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react'
import { RANK_LEVELS, getLevelFromXp, getLevelIcon } from '@/lib/rank/levels'
import { getTierTheme } from '@/lib/rank/tier-theme'
import type { RankLevelApiPayload } from '@/lib/rank/rank-level-payload'
import {
  AIGradeRing,
  RankInsightBanner,
  RankPrestigeEmblem,
  XpProgressPremium,
} from '@/components/rankings/af-rankings-ui/AfRankingsUiKit'

export type PlayerRankLite = {
  careerTier: number
  careerTierName: string
  careerLevel: number
  careerXp: string
  aiReportGrade: string | null
  aiScore: number | null
  aiInsight: string
  winRate: number | null
  playoffRate: number | null
  championshipCount: number
  seasonsPlayed: number
  totalWins?: number
  totalLosses?: number
  totalTies?: number
  playoffAppearances?: number
}

const TIER_STEPS = [
  { group: 1, label: 'Rookie', range: 'Lv 1–4' },
  { group: 2, label: 'Starter', range: 'Lv 5–8' },
  { group: 3, label: 'Veteran', range: 'Lv 9–12' },
  { group: 4, label: 'All-Pro', range: 'Lv 13–17' },
  { group: 5, label: 'Playoff', range: 'Lv 18–21' },
  { group: 6, label: 'Champion', range: 'Lv 22–24' },
  { group: 7, label: 'Dynasty', range: 'Lv 25' },
]

export function AfRankingsTierLadder({ currentLevel }: { currentLevel: number }) {
  const lv = Math.min(25, Math.max(1, Math.round(currentLevel)))
  const row = RANK_LEVELS.find((r) => r.level === lv) ?? RANK_LEVELS[0]
  const activeG = row.tierGroup

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#0c1224]/90 to-[#070a14] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/80">Tier track</p>
          <h2 className="mt-1 text-lg font-black text-white sm:text-xl">Where you sit on the ladder</h2>
        </div>
        <p className="text-[11px] text-white/45">
          Next up:{' '}
          <span className="font-semibold text-white/75">
            {RANK_LEVELS.find((r) => r.level === lv + 1)?.name ?? 'Max level'}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TIER_STEPS.map((step) => {
          const theme = getTierTheme(step.group)
          const active = step.group === activeG
          return (
            <div
              key={step.group}
              className={`relative min-w-[calc(50%-0.25rem)] flex-1 rounded-2xl border px-3 py-3 sm:min-w-[8.5rem] ${
                active
                  ? 'border-white/20 shadow-[0_0_24px_rgba(34,211,238,0.08)]'
                  : 'border-white/[0.06] bg-white/[0.02]'
              }`}
              style={
                active
                  ? {
                      borderColor: `${theme.borderGlow}`,
                      background: `linear-gradient(145deg, rgba(12,18,36,0.95), ${theme.chipBg})`,
                      boxShadow: `0 0 28px ${theme.glow}`,
                    }
                  : undefined
              }
            >
              {active ? (
                <span className="absolute -top-2 left-3 rounded-full border border-cyan-400/40 bg-cyan-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-cyan-100">
                  You
                </span>
              ) : null}
              <div className="mb-1 text-lg" aria-hidden>
                {getLevelIcon(step.group)}
              </div>
              <p className="text-[11px] font-bold text-white/90">{step.label}</p>
              <p className="text-[10px] text-white/40">{step.range}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function AfRankingsXpBreakdown({ id }: { id?: string }) {
  const rows = [
    { icon: <Trophy className="h-4 w-4 text-amber-300/90" />, t: 'Wins & results', d: 'Matchups and seasons that finish in the win column.' },
    { icon: <Crown className="h-4 w-4 text-violet-300/90" />, t: 'Titles & finals', d: 'Championships and deep playoff runs weighted heavily.' },
    { icon: <Brackets className="h-4 w-4 text-cyan-300/90" />, t: 'Playoff appearances', d: 'Consistent contention across imported leagues.' },
    { icon: <CalendarDays className="h-4 w-4 text-emerald-300/90" />, t: 'Seasons & activity', d: 'Longevity and participation across years.' },
    { icon: <Zap className="h-4 w-4 text-amber-200/90" />, t: 'Imports & sync', d: 'Connected history from Sleeper and other providers.' },
  ]
  return (
    <section id={id} className="rounded-3xl border border-white/[0.08] bg-[#0a0f1c] p-5 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">XP breakdown</p>
      <h2 className="mt-1 text-lg font-black text-white sm:text-xl">What fuels your rank</h2>
      <p className="mt-2 max-w-2xl text-sm text-white/50">
        Earn XP through wins, titles, playoff appearances, activity, and league success. Imports pull in historical seasons so
        your profile reflects real fantasy work—not guesses.
      </p>
      <ul className="mt-5 space-y-3">
        {rows.map((r) => (
          <li
            key={r.t}
            className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
          >
            <div className="mt-0.5 shrink-0 rounded-lg border border-white/10 bg-black/30 p-2">{r.icon}</div>
            <div>
              <p className="text-sm font-bold text-white/90">{r.t}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">{r.d}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AfRankingsAiPanel({ rank }: { rank: PlayerRankLite }) {
  const strengths: string[] = []
  const gaps: string[] = []
  // A null rate means no games on record, which is NOT a low rate. Reading it as
  // a number would both crash on .toFixed and, once defaulted, describe someone
  // who has never played as a poor performer.
  if (rank.winRate != null && rank.winRate >= 52)
    strengths.push(`Strong ${rank.winRate.toFixed(0)}% career win rate`)
  else if (
    rank.winRate != null &&
    rank.totalWins != null &&
    rank.totalLosses != null &&
    rank.totalWins + rank.totalLosses > 0
  )
    gaps.push('Push win rate with smarter starts and trades')

  if (rank.playoffRate != null && rank.playoffRate >= 45)
    strengths.push(`Playoff rate ${rank.playoffRate.toFixed(0)}% — consistent contention`)
  else if (rank.playoffRate != null && rank.seasonsPlayed > 0)
    gaps.push('More playoff seasons will accelerate XP')

  if (rank.championshipCount > 0) strengths.push(`${rank.championshipCount} title(s) on record`)
  else if (rank.seasonsPlayed > 2) gaps.push('Titles and deep runs are the fastest way to jump tiers')

  return (
    <section className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-950/40 to-[#0a0f1c] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-violet-300" aria-hidden />
        <h2 className="text-lg font-black text-white sm:text-xl">AI insights</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/70">{rank.aiInsight}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">Strengths</p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-white/75">
            {strengths.length ? (
              strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" aria-hidden />
                  {s}
                </li>
              ))
            ) : (
              <li className="text-white/45">Keep playing — strengths emerge as your sample grows.</li>
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200/90">Focus next</p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-white/75">
            {gaps.length ? (
              gaps.map((s) => (
                <li key={s} className="flex gap-2">
                  <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" aria-hidden />
                  {s}
                </li>
              ))
            ) : (
              <li className="text-white/45">You’re balanced — chase titles and playoff depth for the next tier.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function AfRankingsPerformanceSummary({ rank }: { rank: PlayerRankLite }) {
  const wins = rank.totalWins ?? 0
  const losses = rank.totalLosses ?? 0
  const ties = rank.totalTies ?? 0
  const games = wins + losses + ties
  const winPct = games > 0 ? (wins / games) * 100 : null

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-[#0a0f1c] p-5 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Performance</p>
      <h2 className="mt-1 text-lg font-black text-white sm:text-xl">Career snapshot</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            icon: <BarChart3 className="h-4 w-4" />,
            label: 'Record',
            value: games > 0 ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : 'No games yet',
          },
          {
            icon: <Trophy className="h-4 w-4" />,
            label: 'Championships',
            value: rank.championshipCount > 0 ? String(rank.championshipCount) : 'No titles yet',
          },
          {
            icon: <Brackets className="h-4 w-4" />,
            label: 'Playoff apps',
            value:
              rank.playoffAppearances != null && rank.playoffAppearances > 0
                ? String(rank.playoffAppearances)
                : 'No playoff runs yet',
          },
          {
            icon: <CalendarDays className="h-4 w-4" />,
            label: 'Seasons',
            value: rank.seasonsPlayed > 0 ? String(rank.seasonsPlayed) : 'First season',
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-left sm:px-4 sm:py-4"
          >
            <div className="flex items-center gap-2 text-white/40">
              {c.icon}
              <span className="text-[10px] font-bold uppercase tracking-wide">{c.label}</span>
            </div>
            <p className="mt-2 text-lg font-black text-white/95">{c.value}</p>
          </div>
        ))}
      </div>
      {winPct != null ? (
        <p className="mt-4 text-[13px] text-white/50">
          Career win %: <span className="font-bold text-cyan-200/90">{winPct.toFixed(1)}%</span>
        </p>
      ) : null}
    </section>
  )
}

export function AfRankingsHistoryPlaceholder() {
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-[#0a0f1c] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Momentum & history</p>
          <h2 className="mt-1 text-lg font-black text-white">Rank trend</h2>
        </div>
        <span className="shrink-0 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
          Unlocks with history
        </span>
      </div>
      <div className="space-y-2">
        {[
          { label: 'Season win streak', color: 'text-amber-300/70' },
          { label: 'Win rate trend', color: 'text-emerald-300/70' },
          { label: 'XP earned this season', color: 'text-cyan-300/70' },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
            <span className="text-xs text-white/40">{row.label}</span>
            <span className={`text-sm font-bold ${row.color}`}>—</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-white/30">
        Season-over-season rank charts appear as you accumulate more imported history and active seasons.
      </p>
    </section>
  )
}

export function AfRankingsLeaderboardPlaceholder() {
  const previewRows = [
    { pos: 1, level: 25, glow: '#f59e0b' },
    { pos: 2, level: 20, glow: '#8b5cf6' },
    { pos: 3, level: 15, glow: '#06b6d4' },
  ]
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-[#0a0f1c] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Leaderboard</p>
          <h2 className="mt-1 text-lg font-black text-white sm:text-xl">Global ranks</h2>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-white/35">
          Coming soon
        </span>
      </div>
      <div className="space-y-2 opacity-40 blur-[1px] pointer-events-none select-none">
        {previewRows.map((row) => (
          <div key={row.pos} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
            <span className="w-5 shrink-0 text-center text-xs font-bold text-white/40">#{row.pos}</span>
            <div className="h-6 w-6 rounded-full shrink-0" style={{ background: `${row.glow}44`, border: `1px solid ${row.glow}40` }} />
            <span className="flex-1 text-xs text-white/50">Fantasy Manager</span>
            <span className="text-xs font-bold" style={{ color: row.glow }}>Lv {row.level}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-white/50">
        A public AF leaderboard is on the roadmap. Your tier and XP are tracked against the full 25-level ladder on this page.
      </p>
    </section>
  )
}

export function RankSnapshotCardPremium({ payload }: { payload: RankLevelApiPayload }) {
  const lv = getLevelFromXp(payload.xpTotal)
  const theme = getTierTheme(payload.tierGroup)
  const nextRow = RANK_LEVELS.find((r) => r.level === payload.level + 1)
  const xpToNext = nextRow ? Math.max(0, nextRow.minXp - payload.xpTotal) : 0
  const emoji = getLevelIcon(payload.tierGroup)

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-5 sm:p-6 ${theme.shimmerClass ?? ''}`}
      style={{
        borderColor: `${theme.borderGlow}`,
        background: `linear-gradient(155deg, #0a1020 0%, #070a12 55%, ${theme.chipBg})`,
        boxShadow: `0 0 40px ${theme.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}
      data-testid="import-rank-snapshot-card"
    >
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: theme.glow }} />

      <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <RankPrestigeEmblem theme={theme} level={payload.level} emoji={emoji} />
        <div className="text-center sm:text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em]" style={{ color: theme.accent }}>
            {payload.tier}
          </p>
          <p className="mt-1 text-4xl font-black tabular-nums text-white sm:text-5xl">{payload.level}</p>
          <p className="mt-1 text-xl font-bold text-white/90">{payload.levelName}</p>
          <p className="mt-2 text-sm text-white/50">Career XP: {payload.xpTotal.toLocaleString()}</p>
        </div>
      </div>

      <div className="relative mt-6 border-t border-white/[0.08] pt-5">
        <XpProgressPremium
          xpIntoLevel={payload.xpIntoLevel}
          xpForLevel={payload.xpForLevel}
          progressPct={lv.progressPct}
          xpTotal={payload.xpTotal}
          nextLevelName={payload.nextLevelName ?? nextRow?.name ?? null}
          xpToNext={xpToNext}
          theme={theme}
          helperText="Earn XP through wins, titles, playoff appearances, activity, and league success."
        />
      </div>
    </div>
  )
}

export function AfRankingsHeroPremium({ rank, username }: { rank: PlayerRankLite; username: string }) {
  const xp = Number(rank.careerXp) || 0
  const lv = getLevelFromXp(xp)
  const theme = getTierTheme(rank.careerTier || lv.tierGroup)
  const emoji = getLevelIcon(rank.careerTier || lv.tierGroup)

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/[0.1] shadow-[0_0_60px_rgba(0,0,0,0.45)]"
      style={{
        background: `radial-gradient(ellipse 80% 60% at 20% 0%, ${theme.glow}, #07071a 55%)`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative p-5 sm:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 flex-col items-center gap-6 sm:flex-row sm:items-start">
            <RankPrestigeEmblem theme={theme} level={rank.careerLevel} emoji={emoji} />
            <div className="max-w-xl text-center sm:text-left">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/45">Your AllFantasy rank</p>
              <h1 className="mt-2 text-3xl font-black leading-tight text-white sm:text-4xl">
                {rank.careerTierName}
                <span className="ml-2 text-lg font-bold text-white/40 sm:text-xl">@{username}</span>
              </h1>
              <p className="mt-2 text-sm font-semibold" style={{ color: theme.accent }}>
                {lv.tier} tier · Level {rank.careerLevel}
              </p>
              <p className="mt-1 text-xs text-white/40">Career XP: {xp.toLocaleString()}</p>
              <div className="mt-4">
                <RankInsightBanner text={rank.aiInsight} />
              </div>
            </div>
          </div>
          <div className="flex justify-center lg:shrink-0">
            <AIGradeRing grade={rank.aiReportGrade ?? '—'} score={rank.aiScore} theme={theme} />
          </div>
        </div>
      </div>
    </div>
  )
}
