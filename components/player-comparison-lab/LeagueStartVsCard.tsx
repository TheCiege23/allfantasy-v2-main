'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trophy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StartVsApiResponse } from '@/lib/player-comparison-lab'

/**
 * "In your league" — the league's start/sit read beside the Lab's comparison (2026-11-12).
 *
 * The Lab became the one player-comparison tool (owner's call); /player-compare redirects here. That
 * page's one thing the Lab lacked was this read, from the league's own scoring and roster:
 * POST /api/leagues/{id}/player-comparison/start-vs (league members only). It runs with
 * `includeAIExplanation: false`, so opening a comparison from a league never spends AI — the Lab's
 * own AI insight stays the opt-in, paid step it was.
 *
 * Two players only: a start/sit read is a choice between two.
 */
type LeagueRead = Pick<
  StartVsApiResponse,
  'short_verdict' | 'confidence_pct' | 'coach_lens' | 'risk_flags' | 'news_flags' | 'missing_data' | 'actions'
>

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; read: LeagueRead }
  | { kind: 'unavailable'; message: string }

export function LeagueStartVsCard({
  leagueId,
  playerA,
  playerB,
  sport,
}: {
  leagueId: string
  playerA: string
  playerB: string
  sport: string
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/player-comparison/start-vs`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerA,
            playerB,
            sport,
            teamId: null,
            weekOrPeriod: null,
            strategyMode: 'balanced',
            includeAIExplanation: false,
          }),
        })
        if (cancelled) return
        if (res.status === 401) {
          setState({ kind: 'unavailable', message: 'Sign in to see how these two fit your league.' })
          return
        }
        if (!res.ok) {
          setState({ kind: 'unavailable', message: 'Your league’s read is not available for these players right now.' })
          return
        }
        const read = (await res.json()) as LeagueRead
        if (!cancelled) setState({ kind: 'ready', read })
      } catch {
        if (!cancelled) setState({ kind: 'unavailable', message: 'Your league’s read is not available right now.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, playerA, playerB, sport])

  return (
    <Card className="border-cyan-400/25 bg-cyan-500/[0.06]" data-testid="league-start-vs-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <Trophy className="h-4 w-4 text-cyan-300" aria-hidden />
          In your league
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-white/80">
        {state.kind === 'loading' ? (
          <p className="flex items-center gap-2 text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading your league’s scoring and roster…
          </p>
        ) : null}

        {state.kind === 'unavailable' ? <p className="text-white/60">{state.message}</p> : null}

        {state.kind === 'ready' ? <LeagueReadBody read={state.read} /> : null}
      </CardContent>
    </Card>
  )
}

function LeagueReadBody({ read }: { read: LeagueRead }) {
  const coach = read.coach_lens
  const notes = [...new Set([...(read.risk_flags ?? []), ...(read.news_flags ?? []), ...(read.missing_data ?? [])])].slice(0, 6)
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-white" data-testid="league-start-vs-verdict">
          {read.short_verdict}
        </p>
        <span className="text-xs text-white/55">{Math.round(coach?.confidence_pct ?? read.confidence_pct)}% confidence</span>
      </div>

      {coach ? (
        <div className="flex flex-wrap gap-2" data-testid="league-start-vs-picks">
          <Pick label="Median" name={coach.median_play.player_name} />
          <Pick label="Floor" name={coach.safer_play.player_name} />
          <Pick label="Ceiling" name={coach.higher_ceiling_play.player_name} />
        </div>
      ) : null}

      {coach?.concise_explanation ? <p className="text-white/75">{coach.concise_explanation}</p> : null}
      {coach?.weather_note ? <p className="text-xs text-amber-200/80">{coach.weather_note}</p> : null}

      {notes.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 text-xs text-white/60">
          {notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {read.actions ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={read.actions.set_lineup.href}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white hover:border-cyan-400/40"
          >
            {read.actions.set_lineup.label}
          </Link>
          <Link
            href={read.actions.ask_chimmy.href}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white hover:border-cyan-400/40"
          >
            {read.actions.ask_chimmy.label}
          </Link>
        </div>
      ) : null}
    </>
  )
}

function Pick({ label, name }: { label: string; name: string | null }) {
  return (
    <span className="rounded-full border border-white/12 bg-black/25 px-3 py-1 text-xs text-white/80">
      <span className="text-white/50">{label}: </span>
      {name ?? 'Toss-up'}
    </span>
  )
}

