import Link from 'next/link'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * Today's priorities — the ranked "do this now" cards.
 *
 * Built from signals that exist rather than from the mockup's numbers. The
 * handoff shows three cards carrying live countdowns, point deltas ("worth about
 * 11 points") and standings context ("you are 19 behind"). None of that is on
 * this database: `LeagueTeam` carries a result on 0 of 893 rows, so there is no
 * score to be behind by and no projection to value a slot against.
 *
 * What IS real:
 *   - `firstLock` — the next lock, its countdown and which slots are unfilled.
 *     This is the one genuinely time-critical card and it leads.
 *   - the ranked league list — an unavailable starter or a draft in progress.
 *   - `next24` — dated items inside the day.
 *
 * ⚠ ONLY ONE CARD CARRIES THE SOLID ACCENT CTA. That is the handoff's rule and
 * it is load-bearing: if every card shouts, the ranking conveys nothing. The
 * lead card gets the fill; everything below it gets a neutral chip.
 */

const MAX_CARDS = 3

function rankLabel(index: number): string {
  return String(index + 1).padStart(2, '0')
}

export function Priorities({ data }: { data: Dash34Data | null }) {
  const firstLock = data?.firstLock ?? null
  const actionable = (data?.leagues ?? []).filter(
    (l) => l.priority === 'urgent' || l.priority === 'draft',
  )

  const cards: Array<{
    key: string
    badge: string
    tone: 'bad' | 'warn'
    timer: string | null
    headline: string
    body: string | null
    league: string | null
    href: string
    cta: string
  }> = []

  if (firstLock) {
    cards.push({
      key: 'first-lock',
      badge: 'ACT NOW',
      tone: 'bad',
      // Null when the countdown cannot be computed — the label is not invented.
      timer: firstLock.countdownLabel ?? firstLock.kickoffLabel ?? null,
      headline: firstLock.headline,
      body:
        firstLock.slots.length > 0
          ? `${firstLock.slots.map((s) => s.label).join(', ')} — unfilled with the lock approaching.`
          : null,
      league: null,
      href: firstLock.openHref,
      cta: firstLock.openLabel,
    })
  }

  for (const league of actionable) {
    if (cards.length >= MAX_CARDS) break
    if (firstLock && cards.length === 1 && league.href === firstLock.openHref) continue
    cards.push({
      key: league.id,
      badge: league.priority === 'draft' ? 'DRAFTING' : 'NEEDS YOU',
      tone: league.priority === 'draft' ? 'warn' : 'bad',
      timer: null,
      headline: headlineFor(league),
      body: league.matchupNote ?? null,
      league: [league.platform, league.formatLabel].filter(Boolean).join(' · ') || null,
      href: league.href,
      // actionLabel is optional on the league row; "Open league" is the same
      // wording the loader falls back to, so the two surfaces stay consistent.
      cta: league.actionLabel ?? 'Open league',
    })
  }

  if (cards.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          {(data?.totalLeagues ?? 0) === 0
            ? 'No leagues connected yet — import one to see what needs you.'
            : 'Nothing needs a decision right now. Every connected league has been checked for an unavailable starter and a live draft.'}
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-prio">
      {cards.map((card, index) => (
        <article
          key={card.key}
          className={`af-d2-prio-card af-d2-prio-card--${card.tone}`}
        >
          <div className="af-d2-prio-top">
            <span className="af-d2-prio-rank af-num">{rankLabel(index)}</span>
            <span className={`af-d2-prio-badge af-num af-d2-prio-badge--${card.tone}`}>
              {card.badge}
            </span>
            {card.timer ? <span className="af-d2-prio-timer af-num">{card.timer}</span> : null}
          </div>

          <h3 className="af-d2-prio-headline">{card.headline}</h3>
          {card.body ? <p className="af-d2-prio-body">{card.body}</p> : null}
          {card.league ? <p className="af-d2-prio-league af-num">{card.league}</p> : null}

          {/* Solid accent on the lead card only — see the note at the top. */}
          <Link
            href={card.href}
            className={index === 0 ? 'af-d2-prio-cta is-primary' : 'af-d2-prio-cta'}
          >
            {card.cta}
          </Link>
        </article>
      ))}
    </div>
  )
}

function headlineFor(league: Dash34League): string {
  if (league.priority === 'draft') return `${league.name} is drafting`
  return `${league.name} needs a starter`
}

export default Priorities
