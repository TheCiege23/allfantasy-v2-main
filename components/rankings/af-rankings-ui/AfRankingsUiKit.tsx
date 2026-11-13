'use client'

import { Sparkles } from 'lucide-react'
import type { TierTheme } from '@/lib/rank/tier-theme'
import { getAiScoreDescriptor } from '@/lib/rank/tier-theme'

export function RankPrestigeEmblem({
  theme,
  level,
  emoji,
  className = '',
}: {
  theme: TierTheme
  level: number
  emoji: string
  className?: string
}) {
  return (
    <div
      className={`relative flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center sm:h-[5.25rem] sm:w-[5.25rem] ${className}`}
    >
      <div
        className="absolute inset-0 rounded-2xl opacity-90 blur-md"
        style={{ background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)` }}
        aria-hidden
      />
      <div
        className="relative flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 bg-[#0a1020]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        style={{
          borderColor: theme.borderGlow,
          boxShadow: `0 0 24px ${theme.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}
      >
        <span className="text-3xl leading-none sm:text-[2rem]" aria-hidden>
          {emoji}
        </span>
        <span
          className="mt-0.5 text-[11px] font-black uppercase tracking-[0.2em] text-white/50"
          style={{ color: theme.accent }}
        >
          Lv {level}
        </span>
      </div>
    </div>
  )
}

export function AIGradeRing({
  grade,
  score,
  theme,
  compact,
}: {
  grade: string
  score: number | null
  theme: TierTheme
  compact?: boolean
}) {
  const size = compact ? 72 : 88
  const r = compact ? 28 : 32
  const c = 2 * Math.PI * r
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0
  const off = c - (pct / 100) * c
  const descriptor = score != null ? getAiScoreDescriptor(score) : '—'
  const gradId = `af-grade-grad-${theme.key}-${compact ? 's' : 'm'}`

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={score != null ? off : c}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
            style={{
              filter: score != null ? `drop-shadow(0 0 6px ${theme.glow})` : undefined,
            }}
          />
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={theme.barFrom} />
              <stop offset="100%" stopColor={theme.barTo} />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={`font-black leading-none text-white ${compact ? 'text-lg' : 'text-xl sm:text-2xl'}`}>
            {grade}
          </span>
          <span className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-white/35">Grade</span>
        </div>
      </div>
      {score != null ? (
        <div className="text-center">
          <p className="text-sm font-bold tabular-nums text-white/90">
            {score}
            <span className="text-[11px] font-semibold text-white/35">/100</span>
          </p>
          <p className="max-w-[9rem] text-[11px] font-medium leading-tight text-white/50">{descriptor}</p>
        </div>
      ) : null}
      <div className="flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-200/90">
        <Sparkles className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
        Chimmy Grade
      </div>
    </div>
  )
}

/** Segmented XP bar: 7 segments = tier groups for visual rhythm (not separate data series). */
export function XpProgressPremium({
  xpIntoLevel,
  xpForLevel,
  progressPct,
  xpTotal,
  nextLevelName,
  xpToNext,
  theme,
  helperText,
}: {
  xpIntoLevel: number
  xpForLevel: number
  progressPct: number
  xpTotal: number
  nextLevelName: string | null
  xpToNext: number
  theme: TierTheme
  helperText?: string
}) {
  const pct = Math.min(100, Math.max(0, progressPct))
  const segments = 7
  const filledSeg = Math.round((pct / 100) * segments)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2 text-[11px]">
        <span className="font-semibold text-white/55">
          <span className="tabular-nums text-white/80">{xpIntoLevel.toLocaleString()}</span>
          <span className="text-white/35"> / </span>
          <span className="tabular-nums text-white/55">{xpForLevel.toLocaleString()}</span>
          <span className="ml-1 text-white/35">XP in level</span>
        </span>
        <span className="font-bold tabular-nums text-cyan-200/90">{pct}%</span>
      </div>

      <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.06]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${theme.barFrom}, ${theme.barTo})`,
            boxShadow: `0 0 16px ${theme.glow}, inset 0 1px 0 rgba(255,255,255,0.15)`,
          }}
        />
        <div className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: segments }).map((_, i) => (
            <div key={i} className="h-full flex-1 border-r border-white/[0.06] last:border-r-0" />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/40">
        <span>
          {nextLevelName ? (
            <>
              <span className="text-emerald-200/80">{xpToNext.toLocaleString()} XP</span> to{' '}
              <span className="font-semibold text-white/70">{nextLevelName}</span>
            </>
          ) : (
            'Max level'
          )}
        </span>
        <span className="tabular-nums">{(xpTotal ?? 0).toLocaleString()} total XP</span>
      </div>

      {helperText ? <p className="text-[11px] leading-relaxed text-white/35">{helperText}</p> : null}
    </div>
  )
}

export function RankInsightBanner({ text }: { text: string }) {
  if (!text?.trim()) return null
  return (
    <div className="flex gap-2 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-2.5">
      <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-cyan-400/90">Chimmy</span>
      <p className="text-[12px] leading-relaxed text-white/70">{text}</p>
    </div>
  )
}

