'use client'

/**
 * [NEW] Big Brother league home: HOH, nominees, veto, countdowns, jury, eliminated, timeline. PROMPT 4.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Home, Calendar, Vote, Users, Settings, MessageSquare, Sparkles, ChevronDown } from 'lucide-react'
import type { BigBrotherView } from './types'
import { BigBrotherStatusBadge } from './BigBrotherStatusBadge'
import { BigBrotherCeremonyCenter } from './BigBrotherCeremonyCenter'
import { BigBrotherVotingBallot } from './BigBrotherVotingBallot'
import { BigBrotherJuryCenter } from './BigBrotherJuryCenter'
import { BigBrotherCommissionerPanel } from './BigBrotherCommissionerPanel'
import { BigBrotherTwistsPanel } from './BigBrotherTwistsPanel'
import { BigBrotherHistoryPanel } from './BigBrotherHistoryPanel'
import { useUserTimezone } from '@/hooks/useUserTimezone'
import { BigBrotherSpecialtyHome, type BigBrotherSpecialtySummary } from './BigBrotherSpecialtyHome'

const VIEW_LABELS: Record<BigBrotherView, string> = {
  house: 'House',
  hoh: 'HOH',
  veto: 'Veto',
  twists: 'Twists',
  history: 'History',
  ceremony: 'Ceremony Center',
  voting: 'Voting',
  jury: 'Jury',
  commissioner: 'Commissioner',
}

export interface BigBrotherHomeProps {
  leagueId: string
  isCommissioner?: boolean
  /** When set from league shell tabs, opens this lens directly. */
  initialView?: BigBrotherView
}

export function BigBrotherHome({ leagueId, isCommissioner, initialView = 'house' }: BigBrotherHomeProps) {
  const { formatInTimezone } = useUserTimezone()
  const [summary, setSummary] = useState<BigBrotherSpecialtySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<BigBrotherView>(initialView)

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/summary`, { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setError('Failed to load Big Brother')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !summary) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm text-white/60">Loading Big Brother…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
        <button type="button" onClick={() => load()} className="mt-2 text-xs text-cyan-400 hover:underline">
          Retry
        </button>
      </div>
    )
  }

  const names = summary?.rosterDisplayNames ?? {}
  const cycle = summary?.cycle
  const phase = cycle?.phase ?? '—'

  const viewOptions = (Object.keys(VIEW_LABELS) as BigBrotherView[]).filter(
    (v) => v !== 'commissioner' || isCommissioner,
  )

  return (
    <div className="relative space-y-6 overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-[#0c1428]/95 via-[#070b18] to-[#040915] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-amber-500/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-0 h-48 w-48 rounded-full bg-cyan-500/[0.06] blur-3xl" />
      {/* The house view opens with the specialty-league home (2026-10-18), which carries the title and your status. */}
      {view === 'house' && summary ? (
        <BigBrotherSpecialtyHome leagueId={leagueId} summary={summary} onChanged={load} />
      ) : null}
      {view !== 'house' ? (
      <header className="relative flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4 backdrop-blur-sm sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-950/50 to-[#0a1228] shadow-[0_0_24px_rgba(245,158,11,0.12)] sm:h-16 sm:w-16">
            <Home className="h-7 w-7 text-amber-300 sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">Big Brother</h1>
            <p className="text-sm text-white/60">
              HOH · Block · Veto · Eviction · Jury
            </p>
          </div>
        </div>
        {summary?.myStatus && (
          <BigBrotherStatusBadge status={summary.myStatus} />
        )}
      </header>
      ) : null}

      {summary?.sportCalendar?.scoringWindowDisclaimer ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3 text-sm text-amber-200/90">
          <p className="font-medium text-amber-200/95">Scoring window note</p>
          <p className="mt-1 text-amber-200/80">{summary.sportCalendar.scoringWindowDisclaimer}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/league/${leagueId}?tab=Chat`}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
        >
          <MessageSquare className="h-4 w-4" /> League Chat
        </Link>
        <Link href={`/league/${leagueId}?tab=Settings`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10">
          <Settings className="h-4 w-4" /> Settings
        </Link>
        <Link href={`/league/${leagueId}?tab=Intelligence`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10">
          <Sparkles className="h-4 w-4" /> Chimmy Host
        </Link>
        {isCommissioner ? (
          <Link
            href={`/big-brother/${leagueId}/command`}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-2 text-sm text-amber-100 hover:bg-amber-950/40"
            data-testid="bb-open-command"
          >
            <Sparkles className="h-4 w-4" /> Command
          </Link>
        ) : null}
      </div>

      {/* View switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/50 sm:hidden">View:</span>
        <div className="relative sm:hidden">
          <select
            value={view}
            onChange={(e) => setView(e.target.value as BigBrotherView)}
            className="rounded-xl border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {viewOptions.map((v) => (
              <option key={v} value={v}>{VIEW_LABELS[v]}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
        </div>
        <div className="hidden flex-wrap gap-1 sm:flex">
          {viewOptions.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-amber-500/20 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.15)]' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {view === 'house' && summary && (
        <div className="space-y-4">
          {!cycle && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
              <h3 className="text-sm font-medium text-amber-200">No active week</h3>
              <p className="mt-1 text-sm text-amber-200/80">
                Week 1 is usually created automatically on league setup. If you still see this, open{' '}
                <strong>Commissioner</strong> and run <strong>Start week 1</strong> from the admin tools.
              </p>
            </div>
          )}
          {/* Competition engine (deterministic; AI themes only) */}
          {summary.config.challengeMode ? (
            <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-950/30 to-[#0a1228]/80 p-4 shadow-[0_8px_32px_rgba(14,165,233,0.08)]">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-200/85">Competition engine</h3>
              <p className="mt-2 text-sm text-white/85">
                Mode:{' '}
                <span className="font-medium text-sky-100">
                  {summary.config.challengeMode === 'hybrid'
                    ? 'Hybrid (fantasy scoring + themed challenges)'
                    : summary.config.challengeMode === 'deterministic_score'
                      ? 'Fantasy scoring'
                      : summary.config.challengeMode === 'ai_theme'
                        ? 'Themed challenges (engine-resolved)'
                        : summary.config.challengeMode}
                </span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                HOH and Veto winners are computed by the league engine (lineups, seeds, or configured rules). Chimmy and AI
                only narrate — they never pick the winner.
              </p>
            </div>
          ) : null}

          {/* Countdowns */}
          {summary.ballot && !summary.ballot.closed && summary.ballot.voteDeadlineAt && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-xs font-medium uppercase text-white/50">Vote deadline</h3>
              <p className="mt-1 text-sm text-white/80">{formatInTimezone(summary.ballot.voteDeadlineAt)}</p>
            </div>
          )}

        </div>
      )}

      {view === 'hoh' && summary && (
        <div className="relative space-y-4">
          <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-950/40 to-[#0a1228]/90 p-5 shadow-[0_12px_40px_rgba(180,80,0,0.12)]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/85">Head of Household</h3>
            {cycle?.hohRosterId ? (
              <p className="mt-2 text-2xl font-bold text-amber-100">{names[cycle.hohRosterId] ?? cycle.hohRosterId}</p>
            ) : (
              <p className="mt-2 text-sm text-amber-200/75">HOH not set for this week yet.</p>
            )}
            <p className="mt-2 text-[12px] text-white/45">Phase: {phase}</p>
          </div>
          {summary.eligibility?.canCompeteHOH?.length ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h4 className="text-xs font-medium uppercase text-white/45">Eligible to compete</h4>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm text-white/75">
                {summary.eligibility.canCompeteHOH.map((id) => (
                  <li key={id} className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">
                    {names[id] ?? id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {view === 'veto' && summary && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/25 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/85">Veto</h3>
            {cycle?.vetoWinnerRosterId ? (
              <p className="mt-2 text-lg font-semibold text-cyan-100">
                Winner: {names[cycle.vetoWinnerRosterId] ?? cycle.vetoWinnerRosterId}
              </p>
            ) : (
              <p className="mt-2 text-sm text-cyan-200/70">Veto not awarded yet.</p>
            )}
            {cycle?.vetoParticipantRosterIds && cycle.vetoParticipantRosterIds.length > 0 ? (
              <ul className="mt-3 text-sm text-white/65">
                {cycle.vetoParticipantRosterIds.map((id) => (
                  <li key={id}>• {names[id] ?? id}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}

      {view === 'twists' && <BigBrotherTwistsPanel leagueId={leagueId} />}

      {view === 'history' && <BigBrotherHistoryPanel leagueId={leagueId} />}

      {view === 'ceremony' && summary && (
        <BigBrotherCeremonyCenter leagueId={leagueId} summary={summary} />
      )}

      {view === 'voting' && summary && (
        <BigBrotherVotingBallot leagueId={leagueId} summary={summary} onVoted={load} />
      )}

      {view === 'jury' && summary && (
        <BigBrotherJuryCenter leagueId={leagueId} summary={summary} />
      )}

      {view === 'commissioner' && isCommissioner && summary && (
        <BigBrotherCommissionerPanel leagueId={leagueId} onAction={load} nominees={summary.finalNomineeRosterIds.map(id => ({id, name: summary.rosterDisplayNames[id] ?? `Houseguest ${id.slice(0,8)}`}))} />
      )}

      {view === 'commissioner' && !isCommissioner && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Commissioner only.
        </div>
      )}
    </div>
  )
}
