'use client'

import { TopicTip } from '@/components/core-app/TopicTip'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { describeRemaining, nextStripState, type MatchupStrip } from '@/lib/live/matchupStrip'
import type { RailStanding } from '@/lib/core-app/railMatchups'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { liveScoresCopy as lsc } from '@/lib/core-app/liveScoresCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { liveScoresMessages } from '@/lib/core-app/messages/liveScores'

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
  const { language } = useOptionalLanguage()
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
  /*
   * Redraft design board (LiveScores): an eyebrow with a LIVE chip while a starter on either side is on
   * the field, and the win chance drawn as a bar. Both read only what the strip already carries — no
   * chip when the lineups could not be tallied, no bar without a model probability or on a final week —
   * and both are shown under the redraft stamp only (af-core-redraft-live.css).
   */
  const anyLive = !strip.isFinal && ((strip.remaining?.you?.live ?? 0) > 0 || (strip.remaining?.opponent?.live ?? 0) > 0)
  const winPct = strip.pWin != null && !strip.isFinal ? Math.round(strip.pWin * 100) : null
  return (
    <section className="af-live-matchup" aria-label="Your matchup" data-state="scored" data-lead={lead}>
      <span className="af-live-matchup-eyebrow">
        <span>{lsc('Your matchup', language)}</span>
        {anyLive ? <span className="af-live-matchup-live">{lsc('LIVE', language)}</span> : null}
      </span>
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
      {winPct != null ? (
        <span className="af-live-matchup-wp" aria-hidden data-testid="live-matchup-wp">
          <span className="af-live-matchup-wp-you" style={{ width: `${winPct}%` }} />
        </span>
      ) : null}
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

/**
 * Your place against the whole field, for a league with no head-to-head this week.
 *
 * Same wording rules as the rail's `RailStanding`: say what the rank is measured from (before most of
 * the field has played it is the projection, not points), and say "on the block" in words rather than
 * printing a zero margin.
 *
 * ⚠ EVERY WORD COMES FROM `liveScoresMessages`. This line was hard-coded English until 2026-11-07, so a
 * Spanish reader got an English sentence in the middle of a translated screen.
 */
function StandingStrip({ standing: s, leagueId }: { standing: RailStanding; leagueId: string }) {
  const { language } = useOptionalLanguage()
  const m = messagesFor(liveScoresMessages, language)
  const atCut = s.overCut == null || (s.elimination && s.placesAboveCut === 0)
  const lead = atCut ? 'trail' : s.elimination && s.placesAboveCut <= 2 ? 'tied' : 'lead'
  return (
    <section className="af-live-matchup" aria-label={m.standingAria} data-state="standing" data-lead={lead}>
      <div className="af-live-matchup-row">
        <span className="af-live-matchup-score af-num" data-side="you">
          {m.standingRank(s.rank)}
        </span>
        <span className="af-live-matchup-team">{m.standingOf(s.outOf)}</span>
        <span className="af-live-matchup-team af-live-matchup-cut af-num">
          {s.overCut == null ? m.standingAtBottom(s.elimination) : m.standingOverCut(s.overCut.toFixed(1), s.elimination)}
        </span>
      </div>
      <p className="af-live-matchup-meta">
        {s.placesAboveCut === 0 ? m.standingInCut(s.elimination) : m.standingPlacesClear(s.placesAboveCut, s.elimination)}
        {m.standingCutLine(s.cutLine.toFixed(1))}
        {m.standingBasis(s.basis, s.provisional === true)}
        {' · '}
        <Link className="af-live-matchup-field" href={`/core/standings?league=${encodeURIComponent(leagueId)}`}>{m.standingSeeField}</Link>
      </p>
    </section>
  )
}
