'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  GitCompare,
  LayoutGrid,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlayerComparisonTabId } from '@/lib/player-comparison-ui/types'
import type { PlayerComparisonPremiumSnapshot } from '@/lib/player-comparison-ui/types'
import type { DeterministicStatComparisonRow } from '@/lib/player-comparison-lab/types'
import PlayerHeadshot from '@/components/league/PlayerHeadshot'

const TABS: { id: PlayerComparisonTabId; label: string; icon: typeof Zap }[] = [
  { id: 'weekly', label: 'Weekly', icon: Zap },
  { id: 'ros', label: 'ROS', icon: TrendingUp },
  { id: 'dynasty', label: 'Dynasty', icon: Shield },
  { id: 'draft', label: 'Draft', icon: LayoutGrid },
  { id: 'waiver', label: 'Waiver', icon: Users },
  { id: 'trade_fit', label: 'Trade fit', icon: GitCompare },
]

const TAB_BLURB: Record<PlayerComparisonTabId, string> = {
  weekly: 'This week’s expected points, matchup, and health — what matters for the lineup lock.',
  ros: 'Rest-of-season outlook: trend + role stability vs volatility for the stretch run.',
  dynasty: 'Long-term value: ADP / value signals and aging curve context (same data, dynasty lens).',
  draft: 'Board context: rank vs ADP and positional scarcity for draft-day decisions.',
  waiver: 'Pickup lens: usage momentum and injury clearance vs roster risk.',
  trade_fit: 'Asset fit: how each profile helps a balanced roster build (win-now vs depth).',
}

function tabFiltersRow(
  tab: PlayerComparisonTabId,
  rows: DeterministicStatComparisonRow[]
): DeterministicStatComparisonRow[] {
  const id = (r: DeterministicStatComparisonRow) => (r.metricId + r.label).toLowerCase()
  const pick = (pred: (r: DeterministicStatComparisonRow) => boolean) => rows.filter(pred).slice(0, 6)

  switch (tab) {
    case 'weekly':
      return pick((r) =>
        /projection|rank|trend|injury|volatility|schedule|dynasty|fp|game/i.test(id(r))
      )
    case 'ros':
      return pick((r) => /trend|projection|rank|volatility|season|fp/i.test(id(r)))
    case 'dynasty':
      return pick((r) => /dynasty|adp|value|rank/i.test(id(r)))
    case 'draft':
      return pick((r) => /adp|rank|dynasty|value/i.test(id(r)))
    case 'waiver':
      return pick((r) => /trend|injury|volatility|projection/i.test(id(r)))
    case 'trade_fit':
      return rows.slice(0, 8)
    default:
      return rows.slice(0, 8)
  }
}

function barSplit(row: DeterministicStatComparisonRow): number {
  if (row.winner === 'tie' || row.winner === 'none') return 50
  if (row.winner === 'playerA') return Math.min(78, 52 + Math.min(26, Math.abs(row.edgeScore ?? 0) * 120))
  return Math.max(22, 48 - Math.min(26, Math.abs(row.edgeScore ?? 0) * 120))
}

function ConfidenceRing({ pct }: { pct: number }) {
  const p = Math.max(8, Math.min(100, pct))
  const r = 36
  const c = 2 * Math.PI * r
  const dash = (p / 100) * c
  return (
    <div className="relative h-24 w-24 shrink-0" data-testid="pc-confidence-ring">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#pcRing)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
        <defs>
          <linearGradient id="pcRing" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(34, 211, 238)" />
            <stop offset="100%" stopColor="rgb(56, 189, 248)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold text-white">{p}%</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">conf.</span>
      </div>
    </div>
  )
}

export type PlayerComparisonPremiumViewProps = {
  data: PlayerComparisonPremiumSnapshot
  leagueId?: string | null
  className?: string
  compact?: boolean
}

export function PlayerComparisonPremiumView({ data, leagueId, className, compact }: PlayerComparisonPremiumViewProps) {
  const [tab, setTab] = useState<PlayerComparisonTabId>('weekly')
  const a = data.playerA
  const b = data.playerB
  const det = data.deterministic
  const coach = data.coach_lens
  const conf = coach?.confidence_pct ?? det.confidencePct

  const rows = useMemo(() => {
    const f = tabFiltersRow(tab, det.statComparisons)
    return f.length > 0 ? f : det.statComparisons.slice(0, 8)
  }, [tab, det.statComparisons])
  const winnerSide = det.recommendedSide
  const winnerName =
    winnerSide === 'playerA' ? a.name : winnerSide === 'playerB' ? b.name : null

  const whatChanges = useMemo(() => {
    const lines: string[] = []
    if (data.start_vs_extras?.missing_data?.length) {
      lines.push(...data.start_vs_extras.missing_data.slice(0, 4))
    }
    if (data.start_vs_extras?.risk_flags?.length) {
      lines.push(...data.start_vs_extras.risk_flags.slice(0, 3))
    }
    lines.push('Projection updates, injury status, inactive designations, and opponent game script.')
    lines.push('Weather for outdoor games can shift passing and kicking — check forecast before lock.')
    return [...new Set(lines)].slice(0, 6)
  }, [data.start_vs_extras])

  const leagueBase = leagueId ? `/app/league/${encodeURIComponent(leagueId)}` : null

  return (
    <div
      className={cn(
        'flex flex-col gap-4 text-white',
        compact ? 'max-h-[min(92vh,900px)] overflow-y-auto' : '',
        className
      )}
      data-testid="player-comparison-premium-view"
    >
      {/* Winner banner */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-gradient-to-r from-cyan-500/15 via-[#0a1228] to-violet-500/10 px-4 py-3 sm:px-5'
        )}
        data-testid="pc-winner-banner"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-300" aria-hidden />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200/80">Edge</p>
              <p className="text-base font-bold text-white sm:text-lg">
                {winnerName ? (
                  <>
                    Lean <span className="text-cyan-200">{winnerName}</span>
                  </>
                ) : (
                  'Too close — either start is viable'
                )}
              </p>
            </div>
          </div>
          <ConfidenceRing pct={conf} />
        </div>
      </div>

      {/* Side-by-side cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PlayerCard
          label="Player A"
          name={a.name}
          team={a.team}
          position={a.position}
          highlight={winnerSide === 'playerA'}
          headshotUrl={null}
        />
        <PlayerCard
          label="Player B"
          name={b.name}
          team={b.team}
          position={b.position}
          highlight={winnerSide === 'playerB'}
          headshotUrl={null}
        />
      </div>

      {/* Floor / ceiling chips */}
      {coach ? (
        <div className="flex flex-wrap gap-2" data-testid="pc-floor-ceiling-chips">
          <Chip label="Median" value={coach.median_play.player_name ?? 'Toss-up'} />
          <Chip label="Floor" value={coach.safer_play.player_name ?? 'Toss-up'} variant="floor" />
          <Chip label="Ceiling" value={coach.higher_ceiling_play.player_name ?? 'Toss-up'} variant="ceiling" />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="rounded-xl border border-white/10 bg-[#070b18]/90 p-1">
        <div
          className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-thin"
          role="tablist"
          aria-label="Comparison lens"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition',
                tab === t.id
                  ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-500/35'
                  : 'text-white/45 hover:bg-white/[0.06] hover:text-white/75'
              )}
              data-testid={`pc-tab-${t.id}`}
            >
              <t.icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
        <p className="border-t border-white/5 px-3 py-2 text-xs leading-relaxed text-white/55">{TAB_BLURB[tab]}</p>
      </div>

      {/* Edge score bars */}
      <div className="space-y-2" data-testid="pc-edge-bars">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Factor edges</p>
        {rows.length === 0 ? (
          <p className="text-sm text-white/45">No factor rows for this lens — showing full set.</p>
        ) : null}
        {(rows.length ? rows : det.statComparisons.slice(0, 8)).map((row) => (
          <EdgeBar key={row.metricId + row.label} row={row} playerAName={a.name} playerBName={b.name} />
        ))}
      </div>

      {/* AI summary */}
      <div
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm"
        data-testid="pc-ai-summary"
      >
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-300" />
          <p className="text-sm font-semibold text-white">Chimmy&apos;s summary</p>
          {data.explanation?.source === 'ai' ? (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-200">
              AI
            </span>
          ) : (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/50">Deterministic</span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-white/80">{data.explanation?.text || det.summary}</p>
        {coach?.concise_explanation ? (
          <p className="mt-3 border-t border-white/10 pt-3 text-sm text-cyan-100/90">{coach.concise_explanation}</p>
        ) : null}
      </div>

      {/* What changes */}
      <div data-testid="pc-what-changes">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-200/80">What changes the answer?</p>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-white/65">
          {whatChanges.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {/* Workflow actions */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pc-workflow-actions">
        <WorkflowButton
          href={data.start_vs_extras?.actions?.set_lineup.href ?? (leagueBase ? `${leagueBase}` : '/dashboard')}
          label="Lineup"
          sub="Set starters"
        />
        <WorkflowButton
          href={
            data.start_vs_extras?.actions?.ask_chimmy.href ??
            `/chimmy/chat?prompt=${encodeURIComponent(`Compare ${a.name} vs ${b.name}`)}&sport=${encodeURIComponent(data.sport)}${leagueId ? `&leagueId=${encodeURIComponent(leagueId)}` : ''}`
          }
          label="Chat with Chimmy"
          sub="Ask Chimmy"
        />
        <WorkflowButton
          href={leagueId ? `${leagueBase}/draft` : '/mock-draft'}
          label="Draft"
          sub={leagueId ? 'League draft' : 'Mock draft'}
        />
        <WorkflowButton
          href={leagueId ? `/waiver-ai?leagueId=${encodeURIComponent(leagueId)}` : '/waiver-ai'}
          label="Waiver"
          sub="Wire adds"
        />
      </div>
      <div className="flex justify-center">
        <Link
          href={`/trade-evaluator?sport=${encodeURIComponent(data.sport)}`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/80 transition hover:border-cyan-500/30 hover:text-white"
          data-testid="pc-trade-workflow"
        >
          Open trade analyzer
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}

function PlayerCard({
  label,
  name,
  team,
  position,
  highlight,
  headshotUrl,
}: {
  label: string
  name: string
  team: string | null
  position: string | null
  highlight: boolean
  headshotUrl: string | null
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-4 transition',
        highlight ? 'border-cyan-400/35 bg-cyan-500/[0.08]' : 'border-white/10 bg-[#0a1228]/80'
      )}
      data-testid="pc-player-card"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <PlayerHeadshot src={headshotUrl} alt={name} size={52} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{name}</p>
          <p className="text-xs text-white/50">
            {position ?? '—'} · {team ?? '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

function Chip({
  label,
  value,
  variant,
}: {
  label: string
  value: string
  variant?: 'floor' | 'ceiling'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
        variant === 'floor'
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
          : variant === 'ceiling'
            ? 'border-violet-500/35 bg-violet-500/10 text-violet-100'
            : 'border-white/12 bg-white/[0.05] text-white/85'
      )}
    >
      <span className="text-white/45">{label}</span>
      {value}
    </span>
  )
}

function EdgeBar({
  row,
  playerAName,
  playerBName,
}: {
  row: DeterministicStatComparisonRow
  playerAName: string
  playerBName: string
}) {
  const w = barSplit(row)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-white/55">
        <span className="truncate font-medium text-white/75">{row.label}</span>
        <span className="shrink-0 text-white/40">
          {row.winner === 'tie' || row.winner === 'none'
            ? 'Even'
            : row.winner === 'playerA'
              ? playerAName.split(' ').pop()
              : playerBName.split(' ').pop()}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-cyan-600/80 to-cyan-400/90 transition-all"
          style={{ width: `${w}%` }}
        />
        <div className="h-full flex-1 bg-violet-600/35" />
      </div>
    </div>
  )
}

function WorkflowButton({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-[#0a1228]/90 px-2 py-3 text-center transition hover:border-cyan-500/25 hover:bg-white/[0.04]"
      data-testid={`pc-workflow-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <span className="text-xs font-semibold text-white">{label}</span>
      <span className="mt-0.5 text-[11px] text-white/45">{sub}</span>
    </Link>
  )
}
