'use client'

import React from 'react'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Skull,
  MessageSquare,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react'
import { GuillotineChopAnimation } from './GuillotineChopAnimation'
import { GuillotineAIPanel } from './GuillotineAIPanel'
import { shareCardImage } from '@/components/decide/shareCard'
import { GuillotineSpecialtyHome } from './GuillotineSpecialtyHome'
import { GuillotineNextChopPick } from './GuillotineNextChopPick'
import type { NextChopPickState } from '@/lib/guillotine/nextChopPickStore'
import type { GuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'

function leagueQueryPath(leagueId: string, params: Record<string, string>) {
  const q = new URLSearchParams(params)
  return `/league/${encodeURIComponent(leagueId)}?${q.toString()}`
}

/** Deep-link target that exists in `LeagueShell` `view` / `tab` handling. */
function intelligenceViewForSport(sport: string): string {
  const s = sport.trim().toUpperCase()
  if (s === 'NFL' || s === 'NCAAF') return 'trend'
  return 'players'
}

type Summary = {
  leagueId: string
  weekOrPeriod: number
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  dangerTiers?: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number }[]
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
  /** Your escapes from chops that happened, newest first (shareable moments, 2026-09-14). */
  myEscapes?: { weekOrPeriod: number; myPoints: number; chopLine: number; margin: number; choppedCount: number }[]
  assets: { leagueImage: string; introVideo: string }
  /** The viewer's roster, so the chop line can say "you". */
  myRosterId?: string | null
  /** Specialty-home extras (counts, chopped chips, next chop time, last chop). Null when unavailable. */
  home?: GuillotineHomeExtras | null
  /** "Who's next?" for chopped managers (lib/guillotine/nextChopPick.ts). */
  nextChopPick?: NextChopPickState | null
  config?: {
    eliminationStartWeek: number
    eliminationEndWeek: number | null
    teamsPerChop: number
    tiebreakerOrder: string[]
    dangerMarginPoints: number | null
    rosterReleaseTiming: string
  } | null
}

export interface GuillotineHomeProps {
  leagueId: string
  /** Used for AI / intelligence deep links (tab availability varies by sport). */
  sport: string
  leagueName?: string | null
}

export function GuillotineHome({ leagueId, sport, leagueName }: GuillotineHomeProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replayChop, setReplayChop] = useState<{ play: boolean; name?: string }>({ play: false })
  // null = the current week, resolved by the summary route (it used to be a frozen 1).
  const [week] = useState<number | null>(null)
  const [escapeShare, setEscapeShare] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary${week != null ? `?week=${week}` : ''}`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setError('Failed to load Guilly summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, week])

  useEffect(() => {
    load()
  }, [load])

  const myEscape = summary?.myEscapes?.[0] ?? null

  if (loading && !summary) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm text-white/60">Loading Guilly League…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
        <button
          type="button"
          onClick={() => load()}
          className="mt-2 text-xs text-cyan-400 hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <GuillotineChopAnimation
        play={replayChop.play}
        displayName={replayChop.name}
        onComplete={() => setReplayChop({ play: false })}
      />

      {/* Specialty-league home: hero, chop line, rail, phone home, and the chop moment (2026-10-18). */}
      {summary ? (
        <GuillotineSpecialtyHome leagueId={leagueId} sport={sport} leagueName={leagueName} summary={summary} />
      ) : null}

      {/* Quick links: Chat, Settings, AI, Waivers */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={leagueQueryPath(leagueId, { openChat: 'league' })}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          data-testid="guillotine-quick-chat"
        >
          <MessageSquare className="h-4 w-4" /> Chat
        </Link>
        <Link
          href={leagueQueryPath(leagueId, { view: 'settings' })}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          title="League settings — everyone can view; only commissioner & co-commissioners can edit"
          data-testid="guillotine-quick-settings"
        >
          <Settings className="h-4 w-4" /> Settings
        </Link>
        <Link
          href={leagueQueryPath(leagueId, { view: intelligenceViewForSport(sport) })}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950/50"
          data-testid="guillotine-quick-ai"
        >
          <Sparkles className="h-4 w-4" /> AI Tools
        </Link>
        <Link
          href={leagueQueryPath(leagueId, { view: 'players' })}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
          data-testid="guillotine-quick-waivers"
        >
          <Zap className="h-4 w-4" /> Waivers
        </Link>
      </div>

      {/*
        Your latest escape — from a chop that HAPPENED, never the live projection — with a share button
        that builds the card image (shareable moments, 2026-09-14). Nothing renders without one.
      */}
      {myEscape ? (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4"
          data-testid="guillotine-my-escape"
        >
          <p className="text-sm text-emerald-100">
            <span className="font-semibold">You survived week {myEscape.weekOrPeriod}&rsquo;s chop</span>{' '}
            {myEscape.margin === 0 ? 'on the tiebreaker' : `by ${myEscape.margin.toFixed(1)} pts`} ·{' '}
            <span className="tabular-nums">
              {myEscape.myPoints.toFixed(1)} vs {myEscape.chopLine.toFixed(1)}
            </span>
          </p>
          <button
            type="button"
            disabled={escapeShare === 'working'}
            onClick={() => {
              setEscapeShare('working')
              void shareCardImage(
                `/api/share/rivalry-card?kind=escape&leagueId=${encodeURIComponent(leagueId)}&week=${myEscape.weekOrPeriod}`,
                `guillotine-escape-week-${myEscape.weekOrPeriod}.png`,
                `Survived week ${myEscape.weekOrPeriod}'s chop`,
              ).then(setEscapeShare)
            }}
            className="min-h-[36px] rounded-xl border border-emerald-400/40 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-60"
          >
            {escapeShare === 'working'
              ? 'Building card…'
              : escapeShare === 'downloaded'
                ? 'Card saved ✓'
                : escapeShare === 'shared'
                  ? 'Shared ✓'
                  : escapeShare === 'failed'
                    ? 'Retry share'
                    : 'Share escape card'}
          </button>
        </section>
      ) : null}

      {/* Chopped History */}
      <section id="guillotine-history" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Skull className="h-5 w-5 text-rose-400" />
          Chopped History
        </h2>
        {!summary?.recentChopEvents?.length ? (
          <p className="text-sm text-white/50">No eliminations yet.</p>
        ) : (
          <ul className="space-y-2">
            {summary.recentChopEvents.map((ev) => (
              <li
                key={`${ev.weekOrPeriod}-${ev.choppedRosterIds.join(',')}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2"
              >
                <span className="text-sm text-white/80">Week {ev.weekOrPeriod}</span>
                <span className="text-sm text-white/60">
                  {ev.choppedRosterIds.length} team(s) chopped
                </span>
                <button
                  type="button"
                  onClick={() => setReplayChop({ play: true, name: `Week ${ev.weekOrPeriod}` })}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  Replay animation
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary?.nextChopPick ? <GuillotineNextChopPick leagueId={leagueId} state={summary.nextChopPick} /> : null}

      {/* Waiver Fallout / Next release */}
      <section id="guillotine-waivers" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Zap className="h-5 w-5 text-amber-400" />
          Waiver & FAAB
        </h2>
        <p className="text-sm text-white/70">
          Released players from chopped rosters enter the waiver pool. Next processing per league settings.
        </p>
        {summary?.config?.rosterReleaseTiming && (
          <p className="mt-2 text-xs text-white/50">
            Release timing: {summary.config.rosterReleaseTiming.replace(/_/g, ' ')}
          </p>
        )}
        <Link
          href={leagueQueryPath(leagueId, { view: 'players' })}
          className="mt-3 inline-block text-sm text-cyan-400 hover:underline"
          data-testid="guillotine-open-waivers"
        >
          Open Waivers →
        </Link>
      </section>

      {/* Guillotine AI Panel: deterministic data first, then gated AI strategy */}
      <div id="guillotine-ai">
      <GuillotineAIPanel
        leagueId={leagueId}
        weekOrPeriod={summary?.weekOrPeriod ?? week ?? 1}
        deterministicSummary={
          summary
            ? {
                survivalStandings: summary.survivalStandings,
                dangerTiers: summary.dangerTiers,
                choppedThisWeek: summary.choppedThisWeek,
                recentChopEvents: summary.recentChopEvents,
              }
            : null
        }
        defaultType="survival"
      />
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <Link
          href={leagueQueryPath(leagueId, { view: intelligenceViewForSport(sport) })}
          className="text-sm text-cyan-400 hover:underline"
          data-testid="guillotine-more-ai-tools"
        >
          More research &amp; AI tools →
        </Link>
      </section>

      {/* Settings / Rules */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Settings className="h-5 w-5 text-white/60" />
          Rules & Settings
        </h2>
        {summary?.config ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-white/50">Elimination start</dt><dd className="text-white/80">Week {summary.config.eliminationStartWeek}</dd></div>
            <div><dt className="text-white/50">Elimination end</dt><dd className="text-white/80">{summary.config.eliminationEndWeek ?? '—'}</dd></div>
            <div><dt className="text-white/50">Teams per chop</dt><dd className="text-white/80">{summary.config.teamsPerChop}</dd></div>
            <div><dt className="text-white/50">Danger margin</dt><dd className="text-white/80">{summary.config.dangerMarginPoints ?? '—'} pts</dd></div>
            <div><dt className="text-white/50">Tiebreakers</dt><dd className="text-white/80">{summary.config.tiebreakerOrder?.join(' → ') ?? '—'}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-white/50">No config loaded.</p>
        )}
        <Link
          href={leagueQueryPath(leagueId, { view: 'settings' })}
          className="mt-3 inline-block text-sm text-cyan-400 hover:underline"
          data-testid="guillotine-league-settings"
        >
          League Settings
        </Link>
      </section>
    </div>
  )
}
