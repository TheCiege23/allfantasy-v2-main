import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-brief.css'
import type { BriefStanding, SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'

/**
 * "Since your last visit" — the top of the Core home.
 *
 * One line per kind of change, each linking to where the detail already lives:
 * trades to the league's trade history (the trade band below shows the cards),
 * alerts to the notifications screen. It is a summary of what moved, not a second
 * copy of the bands under it.
 *
 * Renders nothing when nothing changed — `getSinceLastVisit` returns null — so a
 * quiet day costs no space at the top of the page.
 *
 * ⚠ OPEN BY DEFAULT. A closed <details> hides its content from every visibility
 * check this repo runs, and a brief nobody expands is not a brief.
 */

function whenLabel(brief: SinceLastVisitBrief, now: Date): string {
  if (brief.firstVisit || brief.windowCapped) return 'last 7 days'
  const mins = Math.round((now.getTime() - new Date(brief.sinceAt).getTime()) / 60000)
  if (mins < 60) return `since ${Math.max(1, mins)}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `since ${hours}h ago`
  return `since ${Math.round(hours / 24)}d ago`
}

function statusText(status: string | null): string {
  return status ?? 'no designation'
}

function resultText(s: BriefStanding): string {
  const parts: string[] = []
  const games = s.won + s.lost + s.tied
  if (games > 0) {
    const tie = s.tied > 0 ? `–${s.tied}` : ''
    parts.push(`went ${s.won}–${s.lost}${tie}, now ${s.wins}–${s.losses}${s.ties > 0 ? `–${s.ties}` : ''}`)
  }
  if (s.rank != null && s.previousRank != null && s.rank !== s.previousRank) {
    parts.push(`${s.rank < s.previousRank ? 'up' : 'down'} to #${s.rank} (was #${s.previousRank})`)
  }
  return parts.join(', ')
}

export function DashSinceLastVisit({ brief, now }: { brief: SinceLastVisitBrief | null; now: Date }) {
  if (!brief) return null
  const { trades, injuries, standings, alerts } = brief

  return (
    <section className="af-core af-brief" aria-label="Since your last visit">
      <details open>
        <summary className="af-brief-head">
          <span className="af-label af-brief-kicker">Since your last visit</span>
          <span className="af-brief-when af-num">{whenLabel(brief, now)}</span>
        </summary>

        <ul className="af-brief-list">
          {trades.items.length > 0 ? (
            <li className="af-brief-row" data-kind="trades">
              <span className="af-brief-what">
                {trades.atLeast ? `${trades.items.length}+` : trades.items.length} new trade
                {trades.items.length === 1 && !trades.atLeast ? '' : 's'}
              </span>
              <ul className="af-brief-sub">
                {trades.items.map((t) => (
                  <li key={`${t.leagueId}:${t.acceptedAt}:${t.summary}`}>
                    <Link href={`/league/${t.leagueId}?view=legacy`} className="af-brief-link">
                      {t.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {t.summary}</span>
                    {t.handoff ? (
                      <>
                        {' '}
                        <a
                          className="af-brief-handoff"
                          href={t.handoff.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${t.handoff.label} · ${t.handoff.screen}`}
                        >
                          {t.handoff.label} <span aria-hidden>↗</span>
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {injuries.length > 0 ? (
            <li className="af-brief-row" data-kind="injuries">
              <span className="af-brief-what">
                {injuries.length} injury change{injuries.length === 1 ? '' : 's'}{' '}
                {injuries.some((i) => i.followed && i.leagues.length === 0)
                  ? 'on your rosters and players you follow'
                  : 'on your rosters'}
              </span>
              <ul className="af-brief-sub">
                {injuries.slice(0, 6).map((i) => (
                  <li key={i.playerId}>
                    <b>{i.name}</b>
                    {i.position ? <span className="af-brief-pos af-num"> {i.position}</span> : null}
                    <span className="af-brief-detail">
                      {' '}
                      {statusText(i.from)} → <b>{statusText(i.to)}</b> ·{' '}
                      {/* A followed player on none of your rosters has no league to name (2026-09-14). */}
                      {i.leagues.length === 0
                        ? 'Following'
                        : i.leagues.length === 1
                          ? i.leagues[0]
                          : `${i.leagues.length} of your leagues`}
                    </span>
                    {i.handoff ? (
                      <>
                        {' '}
                        <a
                          className="af-brief-handoff"
                          href={i.handoff.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${i.handoff.label} · ${i.handoff.screen}`}
                        >
                          {i.handoff.label} <span aria-hidden>↗</span>
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
                {injuries.length > 6 ? <li className="af-brief-more">+{injuries.length - 6} more</li> : null}
              </ul>
            </li>
          ) : null}

          {standings.length > 0 ? (
            <li className="af-brief-row" data-kind="standings">
              <span className="af-brief-what">
                Results in {standings.length} league{standings.length === 1 ? '' : 's'}
              </span>
              <ul className="af-brief-sub">
                {standings.map((s) => (
                  <li key={s.leagueId}>
                    <Link href={`/core/standings?league=${encodeURIComponent(s.leagueId)}`} className="af-brief-link">
                      {s.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {resultText(s)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {alerts.total > 0 ? (
            <li className="af-brief-row" data-kind="alerts">
              <span className="af-brief-what">
                {alerts.total} unread alert{alerts.total === 1 ? '' : 's'}
              </span>
              <span className="af-brief-detail">
                {' '}
                {alerts.groups
                  .slice(0, 4)
                  .map((g) => `${g.count} ${g.label}`)
                  .join(', ')}
              </span>{' '}
              <Link href="/core/notifications" className="af-brief-link">
                Open alerts
              </Link>
            </li>
          ) : null}
        </ul>

        {brief.comparisonPending ? (
          <p className="af-brief-note">
            Injury and standings changes appear from your next visit — this is the first time we have a picture to compare against.
          </p>
        ) : null}
      </details>
    </section>
  )
}
