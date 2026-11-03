'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { LeagueTeam } from '@prisma/client'
import { AlertTriangle, ArrowRight, RefreshCw, Sparkles } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { useAICoachingPlan } from '@/hooks/useAICoachingPlan'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import type { StrategyLens } from '@/lib/ai/coaching/coachingPlanTypes'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { cn } from '@/lib/utils'
import { CoachingActionPlan } from '@/components/ai/coaching/CoachingActionPlan'
import { CoachingTimeline } from '@/components/ai/coaching/CoachingTimeline'
import { SimulationPanel } from '@/components/ai/sim/SimulationPanel'
import { CoreAssetsPanel } from '@/components/ai/coaching/CoreAssetsPanel'
import { FranchisePlanCard } from '@/components/ai/coaching/FranchisePlanCard'
import { FutureCapitalPanel } from '@/components/ai/coaching/FutureCapitalPanel'
import { RosterHealthPanel } from '@/components/ai/coaching/RosterHealthPanel'
import { WindowToWinCard } from '@/components/ai/coaching/WindowToWinCard'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import '@/app/league/[leagueId]/tabs/redraft-tailwind-tabs.css'

const TIMELINES = [2, 3, 4, 5] as const
const LENSES: { id: StrategyLens; label: string }[] = [
  { id: 'win_now', label: 'Win now' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'future_focused', label: 'Future focused' },
]

function modeHeroClass(mode: string): string {
  if (mode === 'contend') return 'rdt-good-line rdt-good-soft rdt-good'
  if (mode === 'rebuild') return 'rdt-bad-line rdt-bad-soft rdt-bad'
  return 'rdt-warn-line rdt-warn-soft rdt-warn'
}

function modeLabel(mode: string): string {
  if (mode === 'contend') return 'Contend'
  if (mode === 'rebuild') return 'Rebuild'
  return 'Retool'
}

function CoachingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-40 rounded-2xl rdt-skel" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl rdt-skel" />
        <div className="h-64 rounded-2xl rdt-skel" />
      </div>
      <div className="h-48 rounded-2xl rdt-skel" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-52 rounded-2xl rdt-skel" />
        <div className="h-52 rounded-2xl rdt-skel" />
        <div className="h-52 rounded-2xl rdt-skel" />
      </div>
    </div>
  )
}

export function AICoachingPage({
  league,
  userTeam,
  sport,
}: {
  league: UserLeague
  userTeam: LeagueTeam | null
  sport: string
}) {
  const [timelineYears, setTimelineYears] = useState<(typeof TIMELINES)[number]>(3)
  const [strategyLens, setStrategyLens] = useState<StrategyLens>('balanced')

  const { plan, loading, error, usedFallback, refetch, aiModel } = useAICoachingPlan({
    leagueId: league.id,
    timelineYears,
    strategyLens,
  })

  const resolvedSport = normalizeToSupportedSport(sport ?? league.sport) ?? 'NFL'
  const identity = resolveRedraftIdentity(league)

  const chimmyBase = useMemo(
    () => ({
      leagueId: league.id,
      leagueName: league.name,
      sport: resolvedSport,
      /** Matches `AIContextSource` in chimmy-chat/types — long-term / franchise coaching entry. */
      source: 'long_term_coaching' as const,
      teamId: userTeam?.id ?? undefined,
      teamName: userTeam?.teamName ?? null,
    }),
    [league.id, league.name, resolvedSport, userTeam?.id, userTeam?.teamName],
  )

  const franchiseSimBody = useMemo(() => {
    const roster = (plan?.coreAssets ?? []).map((a, i) => ({
      id: a.playerId,
      name: a.name,
      position: a.position || 'FLEX',
      projection: 10.5 + (i % 6) * 0.55,
      variance: 7,
    }))
    return {
      kind: 'franchise' as const,
      roster,
      years: Math.min(5, Math.max(2, timelineYears)),
      numTeams: Math.max(4, Math.min(32, league.teamCount || 12)),
      iterations: 140,
    }
  }, [plan?.coreAssets, timelineYears, league.teamCount])

  const chimmyHref = useMemo(() => {
    if (!plan) return getChimmyChatHrefWithPrompt('Help me interpret my coaching plan for this league.', chimmyBase)
    const body = [
      `League: ${league.name}. Team: ${userTeam?.teamName ?? 'my team'}.`,
      `Coaching plan — mode ${modeLabel(plan.mode)}, ${timelineYears}-year horizon, lens ${strategyLens.replace(/_/g, ' ')}.`,
      `Confidence ${plan.confidence}%. ${plan.summary}`,
      `Priority actions: ${plan.priorityActions.slice(0, 5).join(' | ')}`,
      `Why are you recommending this path? What should I sell or buy first?`,
    ].join('\n')
    return getChimmyChatHrefWithPrompt(body.slice(0, 2800), chimmyBase)
  }, [plan, league.name, userTeam?.teamName, timelineYears, strategyLens, chimmyBase])

  const teamInitials = (userTeam?.teamName ?? 'TM').slice(0, 2).toUpperCase()

  return (
    <div className="rdt space-y-6 pb-12" data-redraft={identity ? 'true' : undefined}>
      {/* Hero */}
      <section
        className="rdt-card relative overflow-hidden p-5 shadow-[inset_0_3px_0_var(--rdt-accent)] md:p-7"
        data-testid="ai-coaching-hero"
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full rdt-accent-soft blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full rdt-accent-soft blur-3xl" aria-hidden />

        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_minmax(0,0.85fr)] lg:items-start">
          <div className="flex flex-wrap items-start gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border rdt-line2 rdt-surface shadow-inner">
              {userTeam?.avatarUrl ? (
                <Image
                  src={userTeam.avatarUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-bold rdt-accent">{teamInitials}</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`rdt-eyebrow ${identity ? 'rdt-eyebrow-accent' : ''}`}>
                {identity
                  ? `Chimmy coaching · Redraft · ${identity.sportLabel}${typeof league.currentWeek === 'number' ? ` · Week ${league.currentWeek}` : ''}`
                  : 'Chimmy coaching'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight rdt-text md:text-2xl">{userTeam?.teamName ?? 'Your team'}</h1>
                <span className="rounded-full border rdt-line2 rdt-well px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rdt-muted">
                  {resolvedSport}
                </span>
                {plan?.formatBadges?.map((b) => (
                  <span
                    key={b}
                    className="rounded-full border rdt-accent-line rdt-accent-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rdt-accent"
                  >
                    {b}
                  </span>
                ))}
                {plan ? (
                  <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', modeHeroClass(plan.mode))}>
                    AI mode · {modeLabel(plan.mode)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm rdt-faint">{league.name}</p>
              {loading && !plan ? (
                <p className="mt-3 text-sm rdt-accent">Building your franchise dashboard…</p>
              ) : plan ? (
                <>
                  <p className="mt-3 max-w-prose text-[14px] leading-relaxed rdt-text2">{plan.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border rdt-accent-line rdt-accent-soft px-2.5 py-1 text-[11px] font-semibold rdt-accent">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      {plan.confidence}% model confidence
                    </span>
                    {usedFallback ? (
                      <span className="inline-flex items-center gap-1 rounded-full border rdt-warn-line rdt-warn-soft px-2.5 py-1 text-[11px] rdt-warn">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        Heuristic fallback
                      </span>
                    ) : null}
                    {aiModel ? (
                      <span className="text-[11px] rdt-faint">Model: {aiModel}</span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border rdt-line rdt-well p-4 backdrop-blur-sm">
            <p className="rdt-eyebrow">Controls</p>
            <div className="mt-3 space-y-3">
              <div>
                <p className="rdt-eyebrow">Timeline</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TIMELINES.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setTimelineYears(y)}
                      aria-pressed={timelineYears === y}
                      className="rdt-btn rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                    >
                      {y} yr{y > 1 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="rdt-eyebrow">Strategy lens</p>
                <select
                  value={strategyLens}
                  onChange={(e) => setStrategyLens(e.target.value as StrategyLens)}
                  className="rdt-input mt-1.5 w-full rounded-lg px-2 py-2 text-[12px]"
                >
                  {LENSES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={loading}
                className="rdt-fill inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[12px] font-bold transition disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
                {loading ? 'Refreshing…' : 'Refresh plan'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile sticky quick controls */}
      {plan ? (
        <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border rdt-line2 rdt-sticky p-2 backdrop-blur-md lg:hidden">
          <span className={cn('rounded-full border px-2 py-1 text-[11px] font-bold uppercase', modeHeroClass(plan.mode))}>
            {modeLabel(plan.mode)}
          </span>
          <div className="flex flex-wrap gap-1">
            {TIMELINES.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setTimelineYears(y)}
                aria-pressed={timelineYears === y}
                className="rdt-btn rounded-md px-2 py-1 text-[11px] font-semibold"
              >
                {y}y
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border rdt-bad-line rdt-bad-soft px-4 py-3 text-[13px] rdt-bad">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg border rdt-bad-line rdt-bad-soft px-3 py-1.5 text-[12px] font-semibold rdt-text"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading && !plan ? <CoachingSkeleton /> : null}

      {!loading && plan?.dataSparse ? (
        <div className="flex items-start gap-2 rounded-xl border rdt-warn-line rdt-warn-soft px-4 py-3 text-[13px] rdt-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Not enough league history yet — using roster and league settings only. Refresh after more games sync for richer signals.
          </span>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <FranchisePlanCard
                mode={plan.mode}
                confidence={plan.confidence}
                explanation={plan.summary}
                priorityActions={plan.priorityActions}
              />
              <RosterHealthPanel positionHealth={plan.positionHealth ?? []} />
              <CoachingActionPlan
                draftStrategy={plan.draftStrategy}
                tradeStrategy={plan.tradeStrategy}
                waiverStrategy={plan.waiverStrategy}
                devyStrategy={plan.devyStrategy}
                pickManagement={
                  plan.marketStrategy.length
                    ? plan.marketStrategy
                    : ['Treat first-round picks as franchise currency until you are a clear top-3 contender.']
                }
              />
            </div>
            <div className="space-y-4">
              <WindowToWinCard
                label={
                  plan.windowToWin?.label ??
                  (plan.mode === 'contend' ? 'Push while the roster is strongest' : 'Build toward a defined peak')
                }
                risk={plan.windowToWin?.risk ?? 'medium'}
                explanation={
                  plan.windowToWin?.explanation ??
                  'Window estimates combine projection strength, age curve, and pick capital — not guarantees.'
                }
              />
              <FutureCapitalPanel
                summary={plan.futureCapital?.summary ?? 'Future capital summary unavailable.'}
                picksByYear={plan.futureCapital?.picksByYear ?? {}}
              />
              <CoachingTimeline timelinePlan={plan.timelinePlan ?? []} horizonYears={timelineYears} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border rdt-good-line rdt-good-soft p-5">
              <h2 className="text-sm font-bold rdt-good">Roster strengths</h2>
              <ul className="mt-3 space-y-2 text-[12px] rdt-text2">
                {plan.rosterStrengths.length ? (
                  plan.rosterStrengths.map((s, i) => (
                    <li key={i} className="leading-snug">
                      {s}
                    </li>
                  ))
                ) : (
                  <li className="rdt-faint">No strengths listed — check back after data sync.</li>
                )}
              </ul>
            </section>
            <section className="rounded-2xl border rdt-bad-line rdt-bad-soft p-5">
              <h2 className="text-sm font-bold rdt-bad">Roster weaknesses</h2>
              <ul className="mt-3 space-y-2 text-[12px] rdt-text2">
                {plan.rosterWeaknesses.length ? (
                  plan.rosterWeaknesses.map((s, i) => (
                    <li key={i} className="leading-snug">
                      {s}
                    </li>
                  ))
                ) : (
                  <li className="rdt-faint">No critical gaps flagged.</li>
                )}
              </ul>
            </section>
          </div>

          <CoreAssetsPanel assets={plan.coreAssets ?? []} sport={resolvedSport} />

          {(plan.coreAssets?.length ?? 0) > 0 ? (
            <SimulationPanel
              title="Sim next few years"
              description={`Monte Carlo franchise outlook from your core assets (${timelineYears}-year horizon). Exploratory — not a guarantee.`}
              requestBody={franchiseSimBody}
            />
          ) : null}

          {/* Chimmy handoff */}
          <section className="rounded-2xl border rdt-accent-line rdt-accent-soft p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold rdt-text">Ask Chimmy about this plan</h2>
                <p className="mt-1 max-w-prose text-[12px] rdt-muted">
                  Opens your existing chat with Chimmy with this league, team, and coaching context preloaded — same Chimmy, richer prompt.
                </p>
              </div>
              <Link
                href={chimmyHref}
                className="inline-flex items-center gap-2 rounded-lg rdt-fill px-4 py-2 text-[12px] font-bold rdt-accent-ink transition"
              >
                Ask Chimmy
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                'Why are you recommending this mode for my roster?',
                'Who should I sell first given my window?',
                'Which rookie positions matter most for my next few drafts?',
              ].map((q) => (
                <Link
                  key={q}
                  href={getChimmyChatHrefWithPrompt(q, chimmyBase)}
                  className="rdt-btn inline-flex items-center rounded-full px-3 py-1.5 text-[11px]"
                >
                  {q}
                </Link>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap gap-3 text-[11px] rdt-faint">
            <Link className="rdt-link" href={`/trade-evaluator?leagueId=${encodeURIComponent(league.id)}`}>
              Trade evaluator
            </Link>
            <span aria-hidden>·</span>
            <Link className="rdt-link" href={`/league/${league.id}?view=draft`}>
              League draft
            </Link>
          </div>
        </>
      ) : null}
    </div>
  )
}
