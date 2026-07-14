'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Crown,
  TrendingUp,
  Flame,
  Trophy,
  AlertTriangle,
  ThumbsUp,
} from 'lucide-react'
import { positionColor } from '@/lib/draft/positions'

/**
 * Homepage-only preview modules. All data here is illustrative/sample (clearly
 * a marketing snapshot, not a live feed) — this page has no session-scoped
 * league data to show a logged-out visitor. Position colors come from the real
 * `positionColor()` used in Draft Room/Waivers so these previews look like the
 * actual product, not an invented palette.
 *
 * Motion here is CSS-transition/interval driven (no framer-motion — matches
 * the rest of the app, which is 0% framer-motion). Every interval/animate-in
 * effect checks `prefers-reduced-motion` and degrades to a static, still-useful
 * state rather than skipping content.
 */

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export type FantasyModulesCopy = {
  eyebrow: string
  title: string
  subtitle: string
  stages: { draft: string; gameday: string; waivers: string; trade: string; playoffs: string }
  draftBoard: { label: string; onClock: string; bestAvailable: string }
  lineup: { label: string; start: string; bench: string; recommended: string }
  matchup: { label: string; live: string; proj: string; rivalry: string }
  waivers: { label: string; add: string; trending: string; faab: string; priority: string }
  trade: { label: string; fairness: string; accept: string }
  standings: { label: string; playoffLine: string; champOdds: string }
  commissioner: { label: string; pending: string; viewLeague: string; healthy: string }
  intelligence: { eyebrow: string; title: string; subtitle: string; health: string; fairness: string; trends: string }
}

type SamplePlayer = {
  initials: string
  name: string
  pos: string
  team: string
  proj: string
  bye?: number
  opp?: string
  trend?: 'up' | 'down'
  tag?: { label: string; tone: 'warn' | 'good' | 'neutral' }
}

const DRAFT_ROWS: (SamplePlayer & { pick: string; adp?: string })[] = [
  { pick: '1.03', initials: 'JC', name: 'Ja’Marr Chase', pos: 'WR', team: 'CIN', proj: '19.8', adp: '+2' },
  { pick: '1.04', initials: 'BR', name: 'Bijan Robinson', pos: 'RB', team: 'ATL', proj: '18.2', adp: '-1' },
  { pick: '1.05', initials: 'CM', name: 'CeeDee Lamb', pos: 'WR', team: 'DAL', proj: '17.9', adp: '+4' },
]

const WAIVER_ROWS: SamplePlayer[] = [
  { initials: 'RS', name: 'Rome Odunze', pos: 'WR', team: 'CHI', proj: '11.4', bye: 7, trend: 'up', tag: { label: 'Trending Up', tone: 'good' } },
  { initials: 'TA', name: 'Tyjae Spears', pos: 'RB', team: 'TEN', proj: '9.8', bye: 5, tag: { label: 'Questionable', tone: 'warn' } },
  { initials: 'JF', name: 'Jaylen Warren', pos: 'RB', team: 'PIT', proj: '10.1', bye: 9, trend: 'up' },
]

const TICKER_ITEMS = [
  { icon: AlertTriangle, tone: 'warn' as const, text: 'Puka Nacua listed Questionable (ankle)' },
  { icon: TrendingUp, tone: 'good' as const, text: 'Waiver suggestion: add Rome Odunze — 62% rostered' },
  { icon: ArrowUpRight, tone: 'neutral' as const, text: 'Trade alert: Taylor for Smith proposed in Dynasty Dragons' },
  { icon: Crown, tone: 'neutral' as const, text: 'Commissioner note: Week 9 waivers process tonight at 3am ET' },
]

function toneColor(tone: 'warn' | 'good' | 'neutral') {
  return tone === 'warn' ? 'var(--accent-amber)' : tone === 'good' ? 'var(--accent-emerald)' : 'var(--accent-cyan)'
}

function Avatar({ initials, pos }: { initials: string; pos: string }) {
  const color = positionColor(pos)
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      style={{
        background: `color-mix(in srgb, ${color} 22%, var(--panel2))`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      {initials}
    </span>
  )
}

function TeamBadge({ team }: { team: string }) {
  return (
    <span
      className="inline-flex h-5 items-center justify-center rounded px-1.5 text-[9px] font-bold"
      style={{ background: 'var(--panel2)', color: 'var(--muted)' }}
    >
      {team}
    </span>
  )
}

function PositionBadge({ pos }: { pos: string }) {
  const color = positionColor(pos)
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      {pos}
    </span>
  )
}

function TrendArrow({ trend }: { trend: 'up' | 'down' }) {
  const Icon = trend === 'up' ? ArrowUp : ArrowDown
  const color = trend === 'up' ? 'var(--accent-emerald)' : 'var(--accent-red)'
  return <Icon className="h-3 w-3 shrink-0" style={{ color }} aria-hidden="true" />
}

function Tag({ tag }: { tag: NonNullable<SamplePlayer['tag']> }) {
  const toneVar = toneColor(tag.tone)
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `color-mix(in srgb, ${toneVar} 16%, transparent)`, color: toneVar }}
    >
      {tag.label}
    </span>
  )
}

/** Every module card shares this shell: consistent sizing + a subtle hover lift (premium, not flashy). */
function ModuleShell({
  label,
  eyebrow,
  children,
}: {
  label: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <article
      className="card-premium landing-card-hover flex h-full flex-col rounded-2xl border p-4 sm:p-5"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      {eyebrow && (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent-cyan-strong)' }}>
          {eyebrow}
        </p>
      )}
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
      {children}
    </article>
  )
}

/** Rotating one-line league activity feed — hero-only, degrades to a static first item under reduced motion. */
export function ActivityTicker() {
  const [index, setIndex] = useState(0)
  const reduced = useRef(prefersReducedMotion())

  useEffect(() => {
    if (reduced.current) return
    const id = setInterval(() => setIndex((i) => (i + 1) % TICKER_ITEMS.length), 4200)
    return () => clearInterval(id)
  }, [])

  const item = TICKER_ITEMS[index]
  const Icon = item.icon
  return (
    <div
      className="flex items-center gap-2 rounded-xl border px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 60%, transparent)' }}
      aria-live="polite"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: toneColor(item.tone) }} aria-hidden="true" />
      <span key={index} className="landing-ticker-fade truncate text-[11px] font-medium" style={{ color: 'var(--text)' }}>
        {item.text}
      </span>
    </div>
  )
}

export function MatchupCard({ copy }: { copy: FantasyModulesCopy['matchup'] }) {
  const [animateIn, setAnimateIn] = useState(prefersReducedMotion())
  useEffect(() => {
    if (animateIn) return
    const id = requestAnimationFrame(() => setAnimateIn(true))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ModuleShell label={copy.label}>
      <div className="mb-3 flex items-center justify-between">
        <span
          className="landing-live-dot rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: 'color-mix(in srgb, var(--accent-red) 16%, transparent)', color: 'var(--accent-red)' }}
        >
          {copy.live}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
          style={{ background: 'color-mix(in srgb, var(--accent-amber) 14%, transparent)', color: 'var(--accent-amber-strong)' }}
        >
          <Flame className="h-2.5 w-2.5" aria-hidden="true" />
          {copy.rivalry}
        </span>
      </div>
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2 text-left">
          <TeamBadge team="DYN" />
          <div>
            <p className="truncate text-[12px] font-bold" style={{ color: 'var(--text)' }}>Dynasty Dragons</p>
            <p className="landing-score-pulse text-xl font-black" style={{ color: 'var(--accent-cyan)' }}>108.4</p>
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{copy.proj} 121.2</p>
          </div>
        </div>
        <span className="text-[11px] font-bold" style={{ color: 'var(--muted2)' }}>VS</span>
        <div className="flex items-center justify-end gap-2 text-right">
          <div>
            <p className="truncate text-[12px] font-bold" style={{ color: 'var(--text)' }}>Gridiron Gang</p>
            <p className="text-xl font-black" style={{ color: 'var(--text)' }}>96.1</p>
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{copy.proj} 104.8</p>
          </div>
          <TeamBadge team="GRG" />
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--panel2)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-out"
          style={{ width: animateIn ? '64%' : '0%', background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-emerald))' }}
        />
      </div>
    </ModuleShell>
  )
}

export function DraftBoardCard({ copy }: { copy: FantasyModulesCopy['draftBoard'] }) {
  return (
    <ModuleShell label={copy.label} eyebrow={copy.bestAvailable}>
      <ul className="flex-1 space-y-2">
        {DRAFT_ROWS.map((row, i) => (
          <li
            key={row.pick}
            className="flex items-center gap-2.5 rounded-xl border p-2"
            style={{
              borderColor: i === 0 ? 'color-mix(in srgb, var(--accent-cyan) 35%, var(--border))' : 'var(--border)',
              background: i === 0 ? 'color-mix(in srgb, var(--accent-cyan) 8%, transparent)' : 'transparent',
            }}
          >
            <span className="w-8 shrink-0 text-[10px] font-bold tabular-nums" style={{ color: 'var(--muted2)' }}>
              {row.pick}
            </span>
            <Avatar initials={row.initials} pos={row.pos} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{row.name}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <PositionBadge pos={row.pos} />
                <TeamBadge team={row.team} />
                {row.adp && (
                  <span className="text-[9px] font-bold" style={{ color: row.adp.startsWith('+') ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
                    ADP {row.adp}
                  </span>
                )}
              </div>
            </div>
            {i === 0 && (
              <span
                className="landing-onclock-pulse shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                style={{ background: 'var(--accent-cyan)', color: 'var(--on-accent-bg)' }}
              >
                {copy.onClock}
              </span>
            )}
          </li>
        ))}
      </ul>
    </ModuleShell>
  )
}

/** Game Day stage: a start/sit lineup call, distinct from the hero's live matchup. */
export function LineupDecisionCard({ copy }: { copy: FantasyModulesCopy['lineup'] }) {
  return (
    <ModuleShell label={copy.label}>
      <div className="flex-1 space-y-2">
        <div
          className="flex items-center gap-2.5 rounded-xl border p-2"
          style={{ borderColor: 'color-mix(in srgb, var(--accent-emerald) 35%, var(--border))', background: 'color-mix(in srgb, var(--accent-emerald) 8%, transparent)' }}
        >
          <Avatar initials="NC" pos="WR" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold" style={{ color: 'var(--text)' }}>Nico Collins</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <PositionBadge pos="WR" />
              <TeamBadge team="HOU" />
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>vs JAX</span>
            </div>
          </div>
          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--accent-emerald)', color: 'var(--on-accent-bg)' }}>
            {copy.start}
          </span>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border p-2" style={{ borderColor: 'var(--border)' }}>
          <Avatar initials="MP" pos="WR" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold" style={{ color: 'var(--text)' }}>Michael Pittman Jr.</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <PositionBadge pos="WR" />
              <TeamBadge team="IND" />
              <Tag tag={{ label: 'Questionable', tone: 'warn' }} />
            </div>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            {copy.bench}
          </span>
        </div>
      </div>
      <p className="mt-3 text-[10px] leading-4" style={{ color: 'var(--accent-emerald-strong)' }}>
        {copy.recommended}
      </p>
    </ModuleShell>
  )
}

export function WaiverWireCard({ copy }: { copy: FantasyModulesCopy['waivers'] }) {
  return (
    <ModuleShell label={copy.label}>
      <ul className="flex-1 space-y-2">
        {WAIVER_ROWS.map((row) => (
          <li key={row.name} className="flex items-center gap-2.5 rounded-xl border p-2" style={{ borderColor: 'var(--border)' }}>
            <Avatar initials={row.initials} pos={row.pos} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="truncate text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{row.name}</p>
                {row.trend && <TrendArrow trend={row.trend} />}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <PositionBadge pos={row.pos} />
                <TeamBadge team={row.team} />
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{row.proj} pts · Bye {row.bye}</span>
              </div>
            </div>
            {row.tag && <Tag tag={row.tag} />}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{copy.priority}: #3</span>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
          style={{ background: 'color-mix(in srgb, var(--accent-emerald) 16%, transparent)', color: 'var(--accent-emerald-strong)' }}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          {copy.faab}: $14
        </button>
      </div>
    </ModuleShell>
  )
}

export function TradeCenterCard({ copy }: { copy: FantasyModulesCopy['trade'] }) {
  return (
    <ModuleShell label={copy.label}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
          <p className="mb-1.5 text-[10px] font-bold uppercase" style={{ color: 'var(--muted)' }}>You Send</p>
          <div className="flex items-center gap-2">
            <Avatar initials="JT" pos="RB" />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>Jonathan Taylor</span>
          </div>
        </div>
        <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
          <p className="mb-1.5 text-[10px] font-bold uppercase" style={{ color: 'var(--muted)' }}>You Get</p>
          <div className="flex items-center gap-2">
            <Avatar initials="DM" pos="WR" />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>DeVonta Smith</span>
          </div>
        </div>
      </div>
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
          <span>{copy.fairness}</span>
          <span style={{ color: 'var(--accent-emerald-strong)' }}>96/100</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--panel2)' }}>
          <div className="h-full rounded-full" style={{ width: '96%', background: 'var(--accent-emerald)' }} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
          style={{ background: 'color-mix(in srgb, var(--accent-cyan) 16%, transparent)', color: 'var(--accent-cyan-strong)' }}
        >
          {copy.accept}
          <ArrowUpRight className="h-3 w-3" />
        </span>
        <span className="inline-flex items-center gap-2 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-0.5"><Flame className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />3</span>
          <span className="inline-flex items-center gap-0.5"><ThumbsUp className="h-3 w-3" style={{ color: 'var(--accent-emerald)' }} />5</span>
        </span>
      </div>
    </ModuleShell>
  )
}

export function StandingsCard({ copy }: { copy: FantasyModulesCopy['standings'] }) {
  const rows = [
    { rank: 1, name: 'Dynasty Dragons', record: '7-1', streak: '+3' },
    { rank: 2, name: 'Gridiron Gang', record: '6-2', streak: '+1' },
    { rank: 3, name: 'End Zone Elite', record: '6-2', streak: '-1' },
  ]
  return (
    <ModuleShell label={copy.label}>
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--accent-amber-strong)' }}>
          <Trophy className="h-3 w-3" aria-hidden="true" />
          {copy.champOdds}
        </span>
        <span className="text-[11px] font-black" style={{ color: 'var(--accent-amber-strong)' }}>34%</span>
      </div>
      <ul className="flex-1 space-y-1.5">
        {rows.map((row) => (
          <li key={row.rank} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" style={{ background: row.rank === 1 ? 'color-mix(in srgb, var(--accent-amber) 8%, transparent)' : undefined }}>
            <span className="w-4 text-[11px] font-bold tabular-nums" style={{ color: row.rank === 1 ? 'var(--accent-amber-strong)' : 'var(--muted)' }}>
              {row.rank}
            </span>
            <span className="flex-1 truncate text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{row.name}</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{row.record}</span>
            <span
              className="text-[10px] font-bold tabular-nums"
              style={{ color: row.streak.startsWith('+') ? 'var(--accent-emerald-strong)' : 'var(--accent-red)' }}
            >
              {row.streak}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        <span className="h-px flex-1" style={{ background: 'color-mix(in srgb, var(--accent-amber) 40%, transparent)' }} />
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent-amber-strong)' }}>{copy.playoffLine}</span>
        <span className="h-px flex-1" style={{ background: 'color-mix(in srgb, var(--accent-amber) 40%, transparent)' }} />
      </div>
    </ModuleShell>
  )
}

export function CommissionerCard({ copy }: { copy: FantasyModulesCopy['commissioner'] }) {
  return (
    <ModuleShell label={copy.label}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'color-mix(in srgb, var(--accent-amber) 16%, transparent)', color: 'var(--accent-amber-strong)' }}
        >
          <Crown className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Dynasty Dragons League</p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--accent-emerald-strong)' }}>{copy.healthy}</p>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>{copy.pending}</p>
          <p className="mt-0.5 text-lg font-black" style={{ color: 'var(--text)' }}>2</p>
        </div>
        <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Teams</p>
          <p className="mt-0.5 text-lg font-black" style={{ color: 'var(--text)' }}>12/12</p>
        </div>
      </div>
      <span
        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold"
        style={{ background: 'color-mix(in srgb, var(--accent-amber) 16%, transparent)', color: 'var(--accent-amber-strong)' }}
      >
        {copy.viewLeague}
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </ModuleShell>
  )
}

/** The "Decision OS" moment — kept, just positioned after the emotional/season-journey content. */
export function IntelligenceStrip({ copy }: { copy: FantasyModulesCopy['intelligence'] }) {
  const chips = [
    { label: copy.health, value: '91', tone: 'good' as const },
    { label: copy.fairness, value: '96', tone: 'neutral' as const },
    { label: copy.trends, value: '+12', tone: 'good' as const },
  ]
  return (
    <div className="mx-auto max-w-4xl text-center">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent-cyan-strong)' }}>{copy.eyebrow}</p>
      <h2 className="mb-2 text-[20px] font-black sm:text-[24px]" style={{ color: 'var(--text)' }}>{copy.title}</h2>
      <p className="mx-auto mb-6 max-w-lg text-[13px]" style={{ color: 'var(--muted)' }}>{copy.subtitle}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className="flex items-center gap-2 rounded-full border px-3.5 py-1.5"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
          >
            <span className="text-[13px] font-black" style={{ color: chip.tone === 'good' ? 'var(--accent-emerald-strong)' : 'var(--accent-cyan-strong)' }}>
              {chip.value}
            </span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>{chip.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
