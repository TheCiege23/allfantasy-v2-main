import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-brief.css'
import type { SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'
import { DashSinceLastVisitView, type BriefSpan } from '@/components/core-app/screens/DashSinceLastVisitView'

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

/** A span rounded the way the brief always has: minutes under an hour, hours under two days, else days. */
function spanOf(mins: number): BriefSpan {
  if (mins < 60) return { n: mins, unit: 'm' }
  const hours = Math.round(mins / 60)
  if (hours < 48) return { n: hours, unit: 'h' }
  return { n: Math.round(hours / 24), unit: 'd' }
}

function agoSpan(from: string, now: Date): BriefSpan {
  const mins = Math.round((now.getTime() - new Date(from).getTime()) / 60000)
  return spanOf(Math.max(1, mins))
}

/**
 * How much FURTHER back one instant is than another — a duration, not a point in time.
 *
 * 🛑 THE TRADE ROW'S NOTE IS A GAP FOR A REASON, AND TWO ABSOLUTE LABELS WERE TRIED FIRST. Both
 * failed the same way: any second label formatted from the same clock has to be compared against
 * the header's, and the comparison is where the bugs live. Printing `agoLabel` of the boundary
 * collided with the header ("since 2h ago (last 2h)"); printing it at a finer unit read SMALLER
 * than the header in 28% of the cases it fired — measured, e.g. "since 3d ago (last 2d 12h)" for a
 * boundary an hour FURTHER back, because `agoLabel` rounds the day division and the finer form
 * floored it. A gap cannot do either: it is monotone in the thing it describes, it is never
 * comparable to the header, and it needs no materiality constant to stay honest.
 */
function gapSpan(fromMs: number, toMs: number): BriefSpan | null {
  const mins = Math.round((toMs - fromMs) / 60000)
  if (mins < 1) return null
  return spanOf(mins)
}

/**
 * ⚠ THE HEADER DOES NOT DESCRIBE THE TRADE ROW WHEN THE TRADE BOUNDARY IS HELD. A trades read that
 * came back blind leaves its boundary further back than the visit window (see `tradesSeenAt` in
 * lib/core-app/sinceLastVisit), so the card would otherwise print "since 1h ago" over a trade that
 * landed five hours ago — and the rows carry no dates of their own to contradict it.
 *
 * Null whenever the two round to the same minute, which is the normal case: the boundary tracks
 * the visit window exactly unless a read came back blind.
 */
function tradeReach(brief: SinceLastVisitBrief): BriefSpan | null {
  /*
   * ⚠ GUARDED AGAINST A VALUE THE TYPE SAYS CANNOT HAPPEN — in two different ways, because they
   * are two different inputs. Tests are not typechecked in this repo, so a fixture built before
   * this field existed hands over `undefined`; and a stored brief could carry a string that does
   * not parse. Either would put NaN in the note rather than suppressing it.
   */
  if (typeof brief.tradesSinceAt !== 'string') return null
  const reach = new Date(brief.tradesSinceAt).getTime()
  // ⚠ BOTH ends checked. Guarding only `tradesSinceAt` left `reaches NaNd further back` reachable
  // through an unparseable `sinceAt`, because `reach >= NaN` is false and skips the early return.
  const since = new Date(brief.sinceAt).getTime()
  if (!Number.isFinite(reach) || !Number.isFinite(since) || reach >= since) return null
  // No `now`: a gap between two stored instants does not depend on when it is rendered.
  return gapSpan(reach, since)
}

export function DashSinceLastVisit({ brief, now }: { brief: SinceLastVisitBrief | null; now: Date }) {
  if (!brief) return null
  const { trades, injuries, standings, alerts } = brief

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This brief keeps the decisions — how far back
   * the window reaches against the server's `now`, every link — and DashSinceLastVisitView says them
   * in the reader's language.
   */
  return (
    <DashSinceLastVisitView
      when={brief.firstVisit || brief.windowCapped ? { kind: 'week' } : { kind: 'since', span: agoSpan(brief.sinceAt, now) }}
      tradeReach={tradeReach(brief)}
      trades={{
        count: trades.items.length,
        atLeast: trades.atLeast,
        items: trades.items.map((t) => ({
          key: `${t.leagueId}:${t.acceptedAt}:${t.summary}`,
          href: `/league/${t.leagueId}?view=trades`,
          leagueName: t.leagueName,
          summary: t.summary,
          parts: t.parts ?? null,
          handoff: t.handoff ?? null,
        })),
      }}
      injuries={injuries.slice(0, 6).map((i) => ({
        key: i.playerId,
        name: i.name,
        position: i.position,
        from: i.from,
        to: i.to,
        leagues: i.leagues,
        handoff: i.handoff ?? null,
      }))}
      injuryCount={injuries.length}
      anyFollowedOnly={injuries.some((i) => i.followed && i.leagues.length === 0)}
      standings={standings.map((s) => ({
        key: s.leagueId,
        href: `/core/standings?league=${encodeURIComponent(s.leagueId)}`,
        standing: s,
      }))}
      alerts={{ total: alerts.total, groups: alerts.groups.slice(0, 4).map((g) => ({ type: g.type, label: g.label, count: g.count })) }}
      comparisonPending={brief.comparisonPending}
    />
  )
}
