'use client'

import React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Skull, Settings } from 'lucide-react'
import { GuillotineChopAnimation } from './GuillotineChopAnimation'
import { GuillotineAIPanel } from './GuillotineAIPanel'
import { shareCardImage } from '@/components/decide/shareCard'
import { GuillotineChopExtras } from './GuillotineSpecialtyHome'
import { GuillySurvivalBoard, type BoardAction, type BoardWeekPicker } from './GuillySurvivalBoard'
import { GuillotineSurvivalHistory } from './GuillotineSurvivalHistory'
import { GuillotineNextChopPick } from './GuillotineNextChopPick'
import type { NextChopPickState } from '@/lib/guillotine/nextChopPickStore'
import type { GuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'
import type { ChopListOrder } from '@/lib/guillotine/chopListOrder'
import type { TeamOutlook } from '@/lib/guillotine/survivalOutlook'
import { RELEASE_OPTIONS } from '@/lib/guillotine/guillotineRules'
import { boardFromHistoryWeek, boardFromNativeSummary, historyWeeks } from '@/lib/guillotine/survivalBoardModel'
import { guillotineRuleRows, guillotineWeekLabel } from './guillotineHomeModel'
import './guillotine-identity.css'

/**
 * The Chop page of a Guilly league hosted here: the league's ONE page for "who is getting chopped".
 *
 * It used to be a hub: a hero, a chop line that stayed empty until the week had scores, a "your survival"
 * card, a tiebreak card, a feed, a row of quick links, a history card and two folds — with the list that
 * answered the question on a second sub-tab. Owner's decision, 2026-11-25 ("one list … too many tabs … cluttered"):
 *
 *   1. the survival board (GuillySurvivalBoard): your gap to the chop line, the clock, and every team in one list,
 *      full all week (projected before anyone scores), with the weeks already chopped one step back;
 *   2. the latest chop's moment, and the graveyard, inside that board;
 *   3. only what is true for this viewer: their escape to share, their "who's next" pick once chopped;
 *   4. three closed rows for reference: the season so far, Guilly Chimmy, the rules.
 *
 * Every number is the engine's, from /api/leagues/[leagueId]/guillotine/summary.
 */

function leagueQueryPath(leagueId: string, params: Record<string, string>) {
  const q = new URLSearchParams(params)
  return `/league/${encodeURIComponent(leagueId)}?${q.toString()}`
}

type Summary = {
  leagueId: string
  weekOrPeriod: number
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  dangerTiers?: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number; immune?: boolean }[]
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
  /** Your escapes from chops that happened, newest first (shareable moments, 2026-09-14). */
  myEscapes?: { weekOrPeriod: number; myPoints: number; chopLine: number; margin: number; choppedCount: number }[]
  assets: { leagueImage: string; introVideo: string }
  /** The viewer's roster, so the list can say "you". */
  myRosterId?: string | null
  /** Counts, chopped teams, next chop time, last chop, the season's history. Null when unavailable. */
  home?: GuillotineHomeExtras | null
  /** The teams alive when there is no chop line yet (lib/guillotine/guillotineField.ts). */
  field?: { rosterId: string; displayName: string }[] | null
  /** This week's live chop line, by the chop's own rules (lib/guillotine/chopWatch.ts). */
  chopWatch?: { live: true; week: number; chopCount: number; chopLine: number | null } | null
  /** Players and games left and the projection for them, per team (`?outlook=1`). */
  outlook?: Record<string, TeamOutlook> | null
  /** "Who's next?" for chopped managers (lib/guillotine/nextChopPick.ts). */
  nextChopPick?: NextChopPickState | null
  config?: {
    eliminationStartWeek: number
    eliminationEndWeek: number | null
    teamsPerChop: number
    tiebreakerOrder: string[]
    dangerMarginPoints: number | null
    rosterReleaseTiming: string
    /** Which end of the list the chop zone sits at (lib/guillotine/chopListOrder.ts). */
    chopListOrder?: ChopListOrder | null
  } | null
}

interface GuillotineHomeProps {
  leagueId: string
  /** Passed to the Chimmy panel's links (tab availability varies by sport). */
  sport: string
  leagueName?: string | null
}

export function GuillotineHome({ leagueId }: GuillotineHomeProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replayChop, setReplayChop] = useState<{ play: boolean; name?: string }>({ play: false })
  // null = the week being played; a number = a week already chopped, replayed from the season's history.
  const [pastWeek, setPastWeek] = useState<number | null>(null)
  const [escapeShare, setEscapeShare] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // `outlook=1`: players and games left and the projection for them, which fill the list before anyone scores.
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary?outlook=1`, { cache: 'no-store' })
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
  }, [leagueId])

  useEffect(() => {
    setPastWeek(null)
    load()
  }, [load])

  const liveBoard = useMemo(() => (summary ? boardFromNativeSummary(summary) : null), [summary])
  const liveWeek = liveBoard?.week ?? summary?.weekOrPeriod ?? null
  const history = summary?.home?.history ?? null
  // Weeks the chop has already scored, oldest first, then the week being played.
  const weeks = useMemo(() => {
    const past = historyWeeks(history).filter((w) => liveWeek == null || w < liveWeek)
    return liveWeek != null ? [...past, liveWeek] : past
  }, [history, liveWeek])
  const board = useMemo(() => {
    if (pastWeek == null || !summary) return liveBoard
    return (
      boardFromHistoryWeek(history, pastWeek, {
        myRosterId: summary.myRosterId,
        order: liveBoard?.order,
        dangerMargin: summary.config?.dangerMarginPoints ?? null,
      }) ?? liveBoard
    )
  }, [pastWeek, summary, history, liveBoard])

  const myEscape = summary?.myEscapes?.[0] ?? null
  // The chop moment above already shows that week's scores and the cut, so the banner then keeps only the share.
  const escapeShownInChop = myEscape != null && summary?.home?.lastChop?.week === myEscape.weekOrPeriod
  const releaseLabel = summary?.config?.rosterReleaseTiming
    ? (RELEASE_OPTIONS.find((o) => o.value === summary.config?.rosterReleaseTiming)?.label ??
      summary.config.rosterReleaseTiming.replace(/_/g, ' '))
    : null

  if (loading && !summary) {
    return (
      <div className="gl gl-card flex min-h-[200px] items-center justify-center rounded-xl border p-8">
        <p className="gl-text2 text-sm">Loading Guilly League…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="gl gl-card-warn rounded-xl border p-4">
        <p className="text-sm">{error}</p>
        <button
          type="button"
          onClick={() => load()}
          className="gl-accent-text mt-2 text-xs hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  const endWeek = summary?.config?.eliminationEndWeek
  const shownWeek = pastWeek ?? liveWeek
  const weekPicker: BoardWeekPicker | null =
    shownWeek != null && weeks.length > 1
      ? { weeks, selected: shownWeek, label: guillotineWeekLabel(shownWeek, endWeek), onSelect: (w) => setPastWeek(w === liveWeek ? null : w) }
      : null
  // A chopped manager has no roster to set and cannot bid, and a member with no team has neither: no buttons.
  const playing = liveBoard != null && liveBoard.status !== 'chopped' && liveBoard.status !== 'spectator'
  const actions: BoardAction[] = playing && pastWeek == null
    ? [
        { label: 'Set lineup', href: leagueQueryPath(leagueId, { view: 'team' }), primary: true },
        { label: 'Waivers', href: leagueQueryPath(leagueId, { view: 'players' }) },
      ]
    : []
  const hasHistory = (history?.weeks ?? []).some((w) => w.chopLine != null) || (summary?.recentChopEvents?.length ?? 0) > 0

  return (
    <div className="gl space-y-6">
      <GuillotineChopAnimation
        play={replayChop.play}
        displayName={replayChop.name}
        onComplete={() => setReplayChop({ play: false })}
      />

      <GuillySurvivalBoard
        board={board}
        actions={actions}
        weekLabel={shownWeek != null ? guillotineWeekLabel(shownWeek, endWeek) : null}
        chopAt={pastWeek == null ? summary?.home?.nextChopAt ?? null : null}
        weekPicker={weekPicker}
        // The latest chop's moment sits with this week's list, not with a replayed one.
        extra={pastWeek == null ? <GuillotineChopExtras leagueId={leagueId} home={summary?.home} /> : null}
      />

      {/*
        Your latest escape — from a chop that HAPPENED, never the live projection — with a share button
        that builds the card image (shareable moments, 2026-09-14). Nothing renders without one.
      */}
      {myEscape ? (
        <section
          className="gl-card-good flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          data-testid="guillotine-my-escape"
        >
          <p className="text-sm">
            <span className="gl-good font-semibold">You survived week {myEscape.weekOrPeriod}&rsquo;s chop</span>{' '}
            {escapeShownInChop ? null : (
              <>
                {myEscape.margin === 0 ? 'on the tiebreaker' : `by ${myEscape.margin.toFixed(1)} pts`} ·{' '}
                <span className="tabular-nums">
                  {myEscape.myPoints.toFixed(1)} vs {myEscape.chopLine.toFixed(1)}
                </span>
              </>
            )}
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
            className="gl-btn-good min-h-[36px] rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
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

      {summary?.nextChopPick ? <GuillotineNextChopPick leagueId={leagueId} state={summary.nextChopPick} /> : null}

      {/* The season so far: each chop and every team's path (lib/guillotine/survivalHistory.ts). A closed row, and
          absent until a chop has happened — it was an open card reading "No chops yet" on every visit before one. */}
      {hasHistory ? (
        <details id="guillotine-history" data-testid="guillotine-history" className="gl-fold gl-card rounded-2xl border p-4 sm:p-6">
          <summary className="gl-fold-summary">
            <h2 className="gl-text flex items-center gap-2 text-lg font-semibold">
              <Skull className="gl-bad h-5 w-5" />
              The season so far
            </h2>
          </summary>
          <div className="mt-4">
            {history ? (
              <GuillotineSurvivalHistory
                history={history}
                myRosterId={summary?.myRosterId}
                closeCallMargin={summary?.config?.dangerMarginPoints ?? 10}
                onReplay={(week) => setReplayChop({ play: true, name: `Week ${week}` })}
              />
            ) : (
              <ul className="space-y-2">
                {(summary?.recentChopEvents ?? []).map((ev) => (
                  <li
                    key={`${ev.weekOrPeriod}-${ev.choppedRosterIds.join(',')}`}
                    className="gl-well flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="gl-text text-sm">Week {ev.weekOrPeriod}</span>
                    <span className="gl-text2 text-sm">
                      {ev.choppedRosterIds.length} team(s) chopped
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplayChop({ play: true, name: `Week ${ev.weekOrPeriod}` })}
                      className="gl-accent-text text-xs hover:underline"
                    >
                      Replay animation
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ) : null}

      {/* Guilly Chimmy: deterministic data first, then the gated strategy. A closed row. */}
      <div id="guillotine-ai">
      <GuillotineAIPanel
        leagueId={leagueId}
        weekOrPeriod={summary?.weekOrPeriod ?? 1}
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

      {/* Settings / Rules */}
      {/* Closed until asked for (2026-11-24): the rules are reference, read once, and open they were ~480px
          at the foot of every visit. "Format rules FAQ" in the header carries them too. */}
      <details data-testid="guillotine-rules" className="gl-fold gl-card rounded-2xl border p-4 sm:p-6">
        <summary className="gl-fold-summary">
          <h2 className="gl-text flex items-center gap-2 text-lg font-semibold">
            <Settings className="gl-muted h-5 w-5" />
            Rules & Settings
          </h2>
        </summary>
        <div className="mt-4">
        {summary?.config ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {guillotineRuleRows(summary.config).map((row) => (
              <div key={row.label} className={Array.isArray(row.value) ? 'sm:col-span-2' : undefined}>
                <dt className="gl-muted">{row.label}</dt>
                <dd className="gl-text">
                  {Array.isArray(row.value) ? (
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                      {row.value.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ol>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="gl-muted text-sm">No config loaded.</p>
        )}
        {/* Said once, here — it used to sit in a Waiver & FAAB card of its own as well. */}
        {releaseLabel ? (
          <p className="gl-text2 mt-3 text-sm" data-testid="guillotine-release-timing">
            Chopped players are released: {releaseLabel}
          </p>
        ) : null}
        <Link
          href={leagueQueryPath(leagueId, { view: 'settings' })}
          className="gl-accent-text mt-3 inline-block text-sm hover:underline"
          data-testid="guillotine-league-settings"
        >
          League Settings
        </Link>
        </div>
      </details>
    </div>
  )
}
