'use client'

/**
 * [NEW] Big Brother league home: HOH, nominees, veto, countdowns, jury, eliminated, timeline. PROMPT 4.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Home, Settings, MessageSquare, Sparkles, ChevronDown } from 'lucide-react'
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
import { bigBrotherPhaseLabel } from './bigBrotherCopy'
import { VetoDecisionCard } from '@/app/big-brother/components/chimmy/VetoDecisionCard'

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

interface BigBrotherHomeProps {
  leagueId: string
  isCommissioner?: boolean
  /** When set from league shell tabs, opens this lens directly. */
  initialView?: BigBrotherView
  /**
   * Rendered inside the league workspace, whose sidebar (desktop) and Section picker (phone) already list House, HOH,
   * Veto, Voting, Jury, Twists, History and Command, and link League chat, Settings and Chimmy. In that case the
   * "Big Brother" header card, the four-button row and the in-page tab row / View menu are a third and fourth way to
   * navigate — about 250px on a phone before any content (2026-11-07, Big Brother audit item 3). They are replaced by
   * one slim bar: the view's name, your status, and links to the two views the sidebar does not list (Ceremony, and
   * Admin tools for the commissioner). Without it (the Overview embed) the full chrome stays: it is the only nav there.
   */
  shellNav?: boolean
}

/** Views the league sidebar does not list, so `shellNav` must still offer them. */
const OFF_SIDEBAR_VIEWS: readonly BigBrotherView[] = ['ceremony', 'commissioner']

export function BigBrotherHome({ leagueId, isCommissioner, initialView = 'house', shellNav = false }: BigBrotherHomeProps) {
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
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-[var(--line)] bg-white/[0.03] p-8">
        <p className="text-sm text-[var(--text2)]">Loading Big Brother…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4">
        <p className="text-sm text-[var(--warn)]">{error}</p>
        <button type="button" onClick={() => load()} className="mt-2 text-xs text-[var(--accent)] hover:underline">
          Retry
        </button>
      </div>
    )
  }

  const names = summary?.rosterDisplayNames ?? {}
  // A roster with no name reads as a houseguest, as on the house view — never as its id.
  const nameOf = (id: string) => names[id] ?? 'A houseguest'
  const cycle = summary?.cycle
  const phase = bigBrotherPhaseLabel(cycle?.phase)
  const vetoDecisionOpen = summary?.myStatus === 'VETO_WINNER' && cycle?.phase === 'VETO_DECISION_OPEN'

  const viewOptions = (Object.keys(VIEW_LABELS) as BigBrotherView[]).filter(
    (v) => v !== 'commissioner' || isCommissioner,
  )

  return (
    // Follows the app's mode (2026-11-23): Big Brother joined the specialty shell's light tokens and these views read
    // /core tokens, so the always-dark af-draft-dark opt-out (2026-11-09) is gone.
    <div className="relative space-y-6 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-amber-500/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-0 h-48 w-48 rounded-full bg-cyan-500/[0.06] blur-3xl" />
      {/* The house view opens with the specialty-league home (2026-10-18), which carries the title and your status. */}
      {view === 'house' && summary ? (
        <BigBrotherSpecialtyHome leagueId={leagueId} summary={summary} onChanged={load} />
      ) : null}
      {/* "You hold the Veto" came with no use / don't-use choice on this page (2026-11-23). */}
      {(view === 'house' || view === 'veto') && vetoDecisionOpen && summary ? (
        <VetoDecisionCard leagueId={leagueId} summary={summary} onDone={load} />
      ) : null}
      {shellNav ? (
        <div
          className={`relative flex flex-wrap items-center justify-between gap-2 ${view !== 'house' ? '!mt-0' : ''}`}
          data-testid="bb-view-bar"
        >
          {view !== 'house' ? (
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-[var(--text)]">{VIEW_LABELS[view]}</h2>
              {summary?.myStatus ? <BigBrotherStatusBadge status={summary.myStatus} /> : null}
            </div>
          ) : (
            <span />
          )}
          <nav aria-label="More Big Brother views" className="flex flex-wrap gap-1">
            {OFF_SIDEBAR_VIEWS.filter((v) => viewOptions.includes(v)).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(view === v ? initialView : v)}
                aria-pressed={view === v}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--chip)] text-[var(--text2)] hover:bg-[var(--chip)]'}`}
              >
                {v === 'commissioner' ? 'Admin tools' : 'Ceremony'}
              </button>
            ))}
          </nav>
        </div>
      ) : null}
      {view !== 'house' && !shellNav ? (
      <header className="relative flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[var(--surface)] p-4 backdrop-blur-sm sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--line2)] bg-[var(--surface2)] sm:h-16 sm:w-16">
            <Home className="h-7 w-7 text-[var(--warn)] sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text)] sm:text-2xl">Big Brother</h1>
            <p className="text-sm text-[var(--text2)]">
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
        <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
          <p className="font-medium text-[var(--warn)]">Scoring window note</p>
          <p className="mt-1 text-[var(--warn)]">{summary.sportCalendar.scoringWindowDisclaimer}</p>
        </div>
      ) : null}

      {!shellNav ? (
        <>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/league/${leagueId}?tab=Chat`}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] px-4 py-2 text-sm text-[var(--warn)] hover:bg-[var(--warn-soft)]"
          >
            <MessageSquare className="h-4 w-4" /> League Chat
          </Link>
          <Link href={`/league/${leagueId}?tab=Settings`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--chip)]">
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <Link href={`/league/${leagueId}?tab=Intelligence`} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--chip)]">
            <Sparkles className="h-4 w-4" /> Chimmy Host
          </Link>
          {isCommissioner ? (
            <Link
              href={`/big-brother/${leagueId}/command`}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] px-4 py-2 text-sm text-[var(--warn)] hover:bg-[var(--warn-soft)]"
              data-testid="bb-open-command"
            >
              <Sparkles className="h-4 w-4" /> Command
            </Link>
          ) : null}
        </div>

        {/* View switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--muted)] sm:hidden">View:</span>
          <div className="relative sm:hidden">
            <select
              value={view}
              onChange={(e) => setView(e.target.value as BigBrotherView)}
              className="rounded-xl border border-[var(--line)] bg-[var(--chip)] py-2 pl-3 pr-8 text-sm text-[var(--text)] appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              {viewOptions.map((v) => (
                <option key={v} value={v}>{VIEW_LABELS[v]}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          </div>
          <div className="hidden flex-wrap gap-1 sm:flex">
            {viewOptions.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--chip)] text-[var(--text2)] hover:bg-[var(--chip)]'}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
        </>
      ) : null}

      {view === 'house' && summary && (
        <div className="space-y-4">
          {!cycle && isCommissioner ? (
            <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4">
              <h3 className="text-sm font-medium text-[var(--warn)]">Week 1 hasn’t started</h3>
              <p className="mt-1 text-sm text-[var(--warn)]">
                It usually starts on its own. If it doesn’t, open <strong>Admin tools</strong> and start week 1.
              </p>
            </div>
          ) : null}
          {/* How winners are decided (it read "Competition engine… Chimmy and Chimmy only narrate"). */}
          {summary.config.challengeMode ? (
            <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--surface2)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">How winners are decided</h3>
              <p className="mt-2 text-sm text-[var(--text)]">
                Mode:{' '}
                <span className="font-medium text-[var(--accent)]">
                  {summary.config.challengeMode === 'hybrid'
                    ? 'Hybrid (fantasy scoring + themed challenges)'
                    : summary.config.challengeMode === 'deterministic_score'
                      ? 'Fantasy scoring'
                      : summary.config.challengeMode === 'ai_theme'
                        ? 'Themed challenges'
                        : summary.config.challengeMode}
                </span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
                HOH and Veto winners come from your lineups and the league’s rules. Chimmy only tells the story — it never picks a winner.
              </p>
            </div>
          ) : null}

          {/* Countdowns */}
          {summary.ballot && !summary.ballot.closed && summary.ballot.voteDeadlineAt && (
            <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
              <h3 className="text-xs font-medium uppercase text-[var(--muted)]">Vote deadline</h3>
              <p className="mt-1 text-sm text-[var(--text)]">{formatInTimezone(summary.ballot.voteDeadlineAt)}</p>
            </div>
          )}

        </div>
      )}

      {view === 'hoh' && summary && (
        <div className="relative space-y-4">
          <div className="rounded-2xl border border-[var(--line2)] bg-[var(--surface2)] p-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--warn)]">Head of Household</h3>
            {cycle?.hohRosterId ? (
              <p className="mt-2 text-2xl font-bold text-[var(--warn)]">{nameOf(cycle.hohRosterId)}</p>
            ) : (
              <p className="mt-2 text-sm text-[var(--warn)]">HOH not set for this week yet.</p>
            )}
            {cycle ? <p className="mt-2 text-[12px] text-[var(--muted)]">Now: {phase}</p> : null}
          </div>
          {!cycle?.hohRosterId && summary.eligibility?.canCompeteHOH?.length ? (
            <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
              <h4 className="text-xs font-medium uppercase text-[var(--muted)]">Eligible to compete</h4>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--text2)]">
                {summary.eligibility.canCompeteHOH.map((id) => (
                  <li key={id} className="rounded-lg border border-white/[0.06] bg-[var(--surface2)] px-2 py-1">
                    {nameOf(id)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {view === 'veto' && summary && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Veto</h3>
            {cycle?.vetoWinnerRosterId ? (
              <p className="mt-2 text-lg font-semibold text-[var(--accent)]">
                Winner: {nameOf(cycle.vetoWinnerRosterId)}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--accent)]">Veto not awarded yet.</p>
            )}
            {summary.finalNomineeRosterIds.length ? (
              <p className="mt-3 text-sm text-[var(--text2)]">
                On the block: <strong>{summary.finalNomineeRosterIds.map(nameOf).join(' and ')}</strong>
              </p>
            ) : null}
            {cycle?.vetoParticipantRosterIds && cycle.vetoParticipantRosterIds.length > 0 ? (
              <>
                <h4 className="mt-3 text-xs font-medium uppercase text-[var(--muted)]">Playing for the Veto</h4>
                <ul className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--text2)]">
                  {cycle.vetoParticipantRosterIds.map((id) => (
                    <li key={id} className="rounded-lg border border-white/[0.06] bg-[var(--surface2)] px-2 py-1">
                      {nameOf(id)}
                      {summary.finalNomineeRosterIds.includes(id) ? ' · nominee' : id === cycle.hohRosterId ? ' · HOH' : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      )}

      {view === 'twists' && <BigBrotherTwistsPanel leagueId={leagueId} />}

      {view === 'history' && <BigBrotherHistoryPanel leagueId={leagueId} names={names} />}

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
        <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
          Commissioner only.
        </div>
      )}
    </div>
  )
}
