'use client'

import { TopicTip } from '@/components/core-app/TopicTip'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { describeRemaining, nextStripState, type MatchupStrip } from '@/lib/live/matchupStrip'
import type { RailStanding } from '@/lib/core-app/railMatchups'

/**
 * You vs your opponent for the league held on the live screen, refreshed on the slate's cadence.
 *
 * A final matchup stops polling. A tab in the background does not poll, and refreshes the moment it
 * returns. A failed poll keeps the last good strip and says it is out of date.
 */
export function LiveMatchupStrip({
  strip: initial,
  leagueId,
  pollMs,
  standing = null,
  eliminated = false,
}: {
  strip: MatchupStrip | null
  leagueId: string
  pollMs: number
  /**
   * Where you sit in a league with no opponent this week — the shell rail's own read, refreshed with
   * the route. Without it an elimination league drew only "there is no single opponent" and stopped,
   * which told a guillotine manager nothing about the one thing they open the page for: the cut.
   */
  standing?: RailStanding | null
  /** Your team is out of this elimination league. */
  eliminated?: boolean
}) {
  const [{ strip, stale }, setState] = useState(() => nextStripState(null, initial))
  const seqRef = useRef(0)
  /* An unavailable strip never becomes a scored one mid-week, so polling it only repeats the reason. */
  const showsStanding = strip?.kind === 'unavailable' && (standing != null || eliminated)
  const done = (strip?.kind === 'scored' && strip.isFinal) || showsStanding

  useEffect(() => {
    setState(nextStripState(null, initial))
  }, [initial, leagueId])

  useEffect(() => {
    if (done) return
    const load = async () => {
      if (document.hidden) return
      const seq = ++seqRef.current
      let result: MatchupStrip | null | 'error' = 'error'
      try {
        const res = await fetch(`/api/dashboard/live-scores?view=matchup&league=${encodeURIComponent(leagueId)}`, {
          cache: 'no-store',
        })
        if (res.ok) result = ((await res.json()) as { strip: MatchupStrip | null }).strip
      } catch {
        /* keep the last good strip */
      }
      if (seq === seqRef.current) setState((prev) => nextStripState(prev.strip, result))
    }
    const id = window.setInterval(() => void load(), pollMs)
    const onVisible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [leagueId, pollMs, done])

  if (!strip) return null
  const href = `/core/matchup?league=${encodeURIComponent(leagueId)}`
  if (strip.kind === 'failed') {
    return (
      <section className="af-live-matchup" aria-label="Your matchup" data-state="failed">
        <p className="af-live-matchup-note">We could not read your matchup right now.</p>
      </section>
    )
  }
  if (strip.kind === 'unavailable' && eliminated) {
    return (
      <section className="af-live-matchup" aria-label="Your standing" data-state="out">
        <p className="af-live-matchup-note">You were chopped from this league — these scores no longer count for you.</p>
      </section>
    )
  }
  if (strip.kind === 'unavailable' && standing) {
    return <StandingStrip standing={standing} leagueId={leagueId} />
  }
  if (strip.kind === 'unavailable') {
    return (
      <section className="af-live-matchup" aria-label="Your matchup" data-state="unavailable">
        <p className="af-live-matchup-note">{strip.reason}</p>
      </section>
    )
  }
  if (strip.kind === 'scheduled') {
    return (
      <section className="af-live-matchup" aria-label="Your matchup" data-state="scheduled">
        <p className="af-live-matchup-note">
          {strip.you} vs {strip.opponent} — nothing scored yet this week.{' '}
          <Link href={href}>Open matchup</Link>
        </p>
      </section>
    )
  }
  const lead = strip.margin > 0 ? 'lead' : strip.margin < 0 ? 'trail' : 'tied'
  return (
    <section className="af-live-matchup" aria-label="Your matchup" data-state="scored" data-lead={lead}>
      <div className="af-live-matchup-row">
        <span className="af-live-matchup-team">{strip.you.name}</span>
        {/* `data-side`, not position: the CSS used `:nth-of-type`, which counts every span in the row. */}
        <span className="af-live-matchup-score af-num" data-side="you">{strip.you.points.toFixed(1)}</span>
        <span className="af-live-matchup-vs" aria-hidden>
          –
        </span>
        <span className="af-live-matchup-score af-num" data-side="them">{strip.opponent.points.toFixed(1)}</span>
        <span className="af-live-matchup-team">{strip.opponent.name}</span>
      </div>
      <p className="af-live-matchup-meta">
        {strip.isFinal ? 'Final' : lead === 'tied' ? 'Tied' : `You ${lead} by ${Math.abs(strip.margin).toFixed(1)}`}
        {strip.pWin != null && !strip.isFinal ? ` · ${Math.round(strip.pWin * 100)}% to win` : ''}
        {strip.pWin != null && !strip.isFinal ? (
          <>
            {' '}
            <TopicTip topic="matchupWinProbability" />
          </>
        ) : null}
        {strip.remaining && !strip.isFinal
          ? ` · You: ${describeRemaining(strip.remaining.you)} · ${strip.opponent.name}: ${describeRemaining(strip.remaining.opponent)}`
          : ''}
        {' · '}
        <Link href={href}>Open matchup</Link>
        {stale ? ' · could not refresh, showing the last reading' : ''}
      </p>
    </section>
  )
}

function ordinal(n: number): string {
  const teens = n % 100
  if (teens >= 11 && teens <= 13) return `${n}th`
  const unit = n % 10
  return `${n}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`
}

/**
 * Your place against the whole field, for a league with no head-to-head this week.
 *
 * Same wording rules as the rail's `RailStanding`: say what the rank is measured from (before most of
 * the field has played it is the projection, not points), and say "on the block" in words rather than
 * printing a zero margin.
 */
function StandingStrip({ standing: s, leagueId }: { standing: RailStanding; leagueId: string }) {
  const atCut = s.overCut == null || (s.elimination && s.placesAboveCut === 0)
  const lead = atCut ? 'trail' : s.elimination && s.placesAboveCut <= 2 ? 'tied' : 'lead'
  const cutWord = s.elimination ? 'the cut' : 'last place'
  return (
    <section className="af-live-matchup" aria-label="Your standing" data-state="standing" data-lead={lead}>
      <div className="af-live-matchup-row">
        <span className="af-live-matchup-score af-num" data-side="you">
          {ordinal(s.rank)}
        </span>
        <span className="af-live-matchup-team">of {s.outOf}</span>
        <span className="af-live-matchup-team af-live-matchup-cut af-num">
          {s.overCut == null
            ? s.elimination
              ? 'On the block'
              : 'Last place'
            : `+${s.overCut.toFixed(1)} over ${cutWord}`}
        </span>
      </div>
      <p className="af-live-matchup-meta">
        {s.placesAboveCut === 0
          ? s.elimination
            ? 'You are in the cut position'
            : 'Bottom of the league this week'
          : `${s.placesAboveCut} ${s.placesAboveCut === 1 ? 'place' : 'places'} clear of ${cutWord}`}
        {` · cut line ${s.cutLine.toFixed(1)}`}
        {s.basis === 'best_ball'
          ? s.provisional ? ' · ranked on projected best-ball finals until the last game is final' : ' · ranked on final best-ball points'
          : s.basis === 'projected' ? ' · ranked on projection until most of the field has played' : ' · ranked on points'}
        {' · '}
        <Link href={`/core/standings?league=${encodeURIComponent(leagueId)}`}>See the field</Link>
      </p>
    </section>
  )
}
