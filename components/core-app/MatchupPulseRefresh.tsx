'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps "Where you stand" current while games are being played.
 *
 * The handoff asks for this board to update live during games, at the same
 * cadence as the live-scores feed. It was the one requirement the screen did not
 * meet: the pulse is server-rendered once and then sits there, so a margin read
 * "+62.9" for as long as the tab stayed open, whatever the score did.
 *
 * ⚠ IT REFRESHES THE ROUTE RATHER THAN FETCHING AN ENDPOINT, AND THAT IS A
 * DELIBERATE TRADE. A dedicated `/api/dashboard/matchup-pulse` would be the
 * obvious shape and it costs a ROUTE — this repo counts 1924 route/page files
 * against a production-adjusted GREEN limit of 1900 in
 * `__tests__/route-budget.test.ts`, and the whole `/core/[[...screen]]` catch-all
 * exists because that ceiling is real. `router.refresh()` re-runs the server
 * component that already computes the pulse, so there is no second data path to
 * keep in step with the first and no serialisation contract to drift. If this
 * board ever needs to update without the rest of the screen, that is the moment
 * to spend the route, not before.
 *
 * ⚠ THE CADENCE IS GATED ON WHETHER ANYTHING CAN ACTUALLY CHANGE. Polling a
 * board whose every row is a pre-kickoff projection re-reads every claimed team
 * across the whole portfolio to redraw numbers that cannot move. `inPlay` is
 * false then, and the slow interval is what notices kickoff has happened.
 */

/** Matches lib/live's own split — see LiveScores.tsx. */
const LIVE_POLL_MS = 20_000
const IDLE_POLL_MS = 120_000

export type MatchupPulseRefreshProps = {
  /**
   * At least one ranked row is scored and still has starters to play, so the
   * numbers on screen can move. Computed server-side in MatchupPulseBoard.
   */
  inPlay: boolean
}

export function MatchupPulseRefresh({ inPlay }: MatchupPulseRefreshProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  /*
   * ⚠ BOTH START NULL AND ARE SET IN AN EFFECT. `Date.now()` in an initialiser
   * runs on the server too, so the first client render would disagree with the
   * markup it is hydrating and React would discard it. This is the same shape
   * `LiveScores` uses for its own age label, for the same reason.
   */
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number | null>(null)

  const wasPending = useRef(false)
  /*
   * ⚠ A REFRESH CAN OUTLAST THE INTERVAL THAT SCHEDULED IT. Measured on this
   * account in dev: one `router.refresh()` over a 65-league portfolio took
   * 13-20 seconds against a 20-second live cadence, so the next tick can land on
   * a refresh still in flight and start a second read of the same data. Mirrored
   * into a ref because the interval closure would otherwise capture a stale
   * `pending`, and re-creating the interval on every state change would reset
   * the cadence each time.
   */
  const pendingRef = useRef(false)
  pendingRef.current = pending

  useEffect(() => {
    setRefreshedAt(Date.now())
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  /*
   * Stamped when the refresh COMPLETES, not when it is requested. Stamping on
   * request would reset the age to zero on a refresh that then failed, which is
   * the one thing the age is there to prevent.
   */
  useEffect(() => {
    if (wasPending.current && !pending) setRefreshedAt(Date.now())
    wasPending.current = pending
  }, [pending])

  const refresh = useCallback(() => {
    startTransition(() => router.refresh())
  }, [router])

  useEffect(() => {
    const period = inPlay ? LIVE_POLL_MS : IDLE_POLL_MS

    const tick = () => {
      /*
       * ⚠ A HIDDEN TAB DOES NOT POLL. This re-runs a read across every claimed
       * team in the portfolio; doing that every twenty seconds for a tab nobody
       * is looking at is the expensive half of this feature and buys nothing.
       * The listener below catches up on return.
       *
       * ⚠ AND THE AGE LABEL DOES NOT KEEP CLIMBING WHILE HIDDEN — this comment
       * used to claim it did. Browsers throttle `setInterval` in a background
       * tab, so the one-second clock below stops resolving and the label
       * advances in coarse jumps instead. Measured: it read "3s ago" across
       * three samples eight seconds apart while hidden, then jumped straight to
       * "1m ago". It self-corrects within a second of the tab becoming visible,
       * which is the only moment anybody is reading it — but "it keeps climbing"
       * was not true and is not what the label is doing.
       */
      if (document.visibilityState !== 'visible') return
      if (pendingRef.current) return
      refresh()
    }

    const id = window.setInterval(tick, period)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Only if the data is already older than one period, so flicking between
      // tabs does not fire a portfolio read every time.
      if (pendingRef.current) return
      if (refreshedAt != null && Date.now() - refreshedAt < period) return
      refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [inPlay, refresh, refreshedAt])

  /*
   * Server render and first paint show nothing rather than "0s ago", which
   * would be a claim about freshness made before the clock has been read.
   */
  const age =
    now != null && refreshedAt != null ? Math.max(0, Math.round((now - refreshedAt) / 1000)) : null

  return (
    <span className="af-mp-live" data-inplay={inPlay} data-pending={pending || undefined}>
      <span className="af-mp-live-dot" aria-hidden />
      <span className="af-mp-live-text af-num">
        {pending
          ? 'updating'
          : age == null
            ? inPlay
              ? 'live'
              : 'not started'
            : age < 60
              ? `${age}s ago`
              : `${Math.floor(age / 60)}m ago`}
      </span>
      {/*
        The manual control is not decoration. The automatic cadence is two
        minutes before kickoff, and somebody watching a Thursday game start
        should not have to reload the page to see the board notice.
      */}
      <button
        type="button"
        className="af-mp-live-btn"
        onClick={refresh}
        disabled={pending}
        aria-label="Refresh where you stand"
      >
        ↻
      </button>
    </span>
  )
}

export default MatchupPulseRefresh
