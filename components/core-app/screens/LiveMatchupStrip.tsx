import Link from 'next/link'
import type { MatchupStrip } from '@/lib/live/matchupStrip'

/** You vs your opponent for the league held on the live screen. Points are as of page load. */
export function LiveMatchupStrip({ strip, leagueId }: { strip: MatchupStrip | null; leagueId: string }) {
  if (!strip) return null
  const href = `/core/matchup?league=${encodeURIComponent(leagueId)}`
  if (strip.kind === 'failed') {
    return (
      <section className="af-live-matchup" aria-label="Your matchup" data-state="failed">
        <p className="af-live-matchup-note">We could not read your matchup right now.</p>
      </section>
    )
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
        <span className="af-live-matchup-score af-num">{strip.you.points.toFixed(1)}</span>
        <span className="af-live-matchup-vs" aria-hidden>
          –
        </span>
        <span className="af-live-matchup-score af-num">{strip.opponent.points.toFixed(1)}</span>
        <span className="af-live-matchup-team">{strip.opponent.name}</span>
      </div>
      <p className="af-live-matchup-meta">
        {strip.isFinal ? 'Final' : lead === 'tied' ? 'Tied' : `You ${lead} by ${Math.abs(strip.margin).toFixed(1)}`}
        {strip.pWin != null && !strip.isFinal ? ` · ${Math.round(strip.pWin * 100)}% to win` : ''}
        {strip.remaining && !strip.isFinal
          ? ` · ${strip.remaining.live} playing, ${strip.remaining.upcoming} yet to start`
          : ''}
        {' · '}
        <Link href={href}>Open matchup</Link>
      </p>
    </section>
  )
}
