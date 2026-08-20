import type { Metadata } from 'next'
import { LineupOptimizerExperience } from '@/components/lineup-optimizer'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Lineup Optimizer | AllFantasy',
  description:
    'The official AllFantasy lineup optimizer. Optimal starters, FLEX decision, injury risk, matchup upside, and safe-floor lineups grounded in your league context.',
  alternates: { canonical: 'https://allfantasy.ai/lineup-optimizer' },
}

type StatusTone = 'available' | 'context' | 'manual' | 'recommend' | 'soon'

const STATUS_PILLS: { label: string; tone: StatusTone }[] = [
  { label: 'Available', tone: 'available' },
  { label: 'Requires league', tone: 'soon' },
  { label: 'Uses roster context', tone: 'context' },
  { label: 'Recommendation only', tone: 'recommend' },
]

const TONE_CLASS: Record<StatusTone, string> = {
  available: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200',
  context: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200',
  manual: 'border-violet-400/35 bg-violet-500/10 text-violet-200',
  recommend: 'border-amber-400/35 bg-amber-500/10 text-amber-200',
  soon: 'border-white/10 bg-white/[0.04] text-white/55',
}

const MODES = [
  {
    id: 'optimize',
    title: 'Optimize Starters',
    blurb: 'Build the best starting lineup from your full roster using projections and matchup context.',
    badge: 'Uses roster context',
  },
  {
    id: 'start-sit',
    title: 'Start / Sit',
    blurb: 'Side-by-side player decisions with reasoning, confidence, and volatility scores.',
    badge: 'Uses roster context',
  },
  {
    id: 'flex',
    title: 'FLEX Decision',
    blurb: 'Pick the best FLEX (or SUPERFLEX) using projection edge and floor vs ceiling.',
    badge: 'Uses roster context',
  },
  {
    id: 'injury',
    title: 'Injury Risk',
    blurb: 'Surface questionable, doubtful, and game-time-decision starters with auto-sub coverage.',
    badge: 'Uses roster context',
  },
  {
    id: 'upside',
    title: 'Matchup Upside',
    blurb: 'Lean into ceiling plays and favorable matchups when your team is the underdog.',
    badge: 'Uses roster context',
  },
  {
    id: 'floor',
    title: 'Safe Floor',
    blurb: 'Lock in the highest-floor starters when you are the projected favorite.',
    badge: 'Uses roster context',
  },
] as const

export default function CanonicalLineupOptimizerPage({
  searchParams,
}: {
  searchParams?: { leagueId?: string | string[] }
}) {
  const rawLeagueId = searchParams?.leagueId
  const leagueIdFromQuery = Array.isArray(rawLeagueId) ? rawLeagueId[0] : rawLeagueId
  return (
    <>
      <LandingToolVisitTracker path="/lineup-optimizer" toolName="Lineup Optimizer" />
      <EngagementEventTracker
        eventType="lineup_optimizer"
        oncePerDayKey="tool_lineup_optimizer"
        meta={{ product: 'canonical' }}
      />

      <section
        aria-label="Lineup Optimizer overview"
        className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10"
        data-testid="lineup-optimizer-status-hero"
      >
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/10 via-violet-500/10 to-transparent p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Lineup Optimizer</h1>
            {STATUS_PILLS.map((pill) => (
              <span
                key={pill.label}
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${TONE_CLASS[pill.tone]}`}
              >
                {pill.label}
              </span>
            ))}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-snug text-white/65 sm:text-base">
            The official AllFantasy start/sit and lineup optimization tool. Connect a league to load your real
            roster, scoring rules, and starting slots &mdash; the optimizer suggests starters, FLEX, and bench
            swaps with confidence, volatility, and injury context. We never invent players and we don&apos;t
            hardcode rankings; recommendations are grounded in your league data and projections. Lineup changes
            are recommendations only &mdash; apply them in your league platform.
          </p>
          <ul
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="lineup-optimizer-modes"
          >
            {MODES.map((mode) => (
              <li
                key={mode.id}
                data-testid={`lineup-optimizer-mode-${mode.id}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{mode.title}</p>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                    {mode.badge}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-snug text-white/55">{mode.blurb}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
        <LineupOptimizerExperience leagueIdFromQuery={leagueIdFromQuery} />
      </div>
    </>
  )
}
