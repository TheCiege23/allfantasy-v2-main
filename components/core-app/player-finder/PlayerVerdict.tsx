import type { LeagueImpact } from '@/lib/core-app/playerImpact'

/**
 * The "Ask Chimmy" verdict card — computed, not generated.
 *
 * ⚠ NO LLM CALL, DELIBERATELY. The handoff draws this as a written paragraph,
 * which invites generating it on page load. That would bill a Chimmy request on
 * every player view — the exact per-visit cost that was stripped out of the home
 * screen in #433. Everything below is assembled from `impact`, which is already
 * computed for this screen, so the card costs nothing at rest and cannot say
 * something the data does not support. "Ask Chimmy" stays the click-through that
 * actually spends a token.
 *
 * ⚠ IT ONLY CLAIMS WHAT `impact` MEASURED. The handoff's headline is "He's
 * healthy and misplaced in two leagues. Two minutes of fixes for +13.0." The
 * second half of that sentence is NOT derivable from what we hold: `replacements`
 * answers "who should play INSTEAD of him", not "how many points does starting
 * him gain over your current starter". Those are different questions and the
 * inverse is not stored, so this states where he is sitting and what he is worth
 * under each league's own scoring, and stops there.
 *
 * ⚠ SLOT TRUTH BEATS PROJECTION — the handoff's rule and this screen's reason to
 * exist. A benched player with a good number is the headline, so the count of
 * leagues where he is NOT in the lineup leads.
 */

function fmt(n: number): string {
  return n.toFixed(1)
}

export function PlayerVerdict({
  playerName,
  impact,
}: {
  playerName: string
  impact: LeagueImpact[]
}) {
  if (impact.length === 0) return null

  const benched = impact.filter((i) => !i.isStarting)
  const starting = impact.filter((i) => i.isStarting)

  /*
   * Only leagues where we could actually price him under that league's scoring.
   * A benched league with no `afPoints` is still worth naming — it just cannot
   * carry a number, and inventing one is the failure this screen exists to avoid.
   */
  const pricedBenched = benched
    .map((i) => (i.afPoints.available ? { league: i, points: i.afPoints.data.points } : null))
    .filter((x): x is { league: LeagueImpact; points: number } => x !== null)
    .sort((a, b) => b.points - a.points)

  const best = pricedBenched[0] ?? null

  let headline: string
  if (benched.length === 0) {
    headline = `He is in your lineup in all ${starting.length} ${
      starting.length === 1 ? 'league' : 'leagues'
    } you roster him.`
  } else if (best) {
    headline = `He is on your bench in ${benched.length} of ${impact.length} ${
      impact.length === 1 ? 'league' : 'leagues'
    } — worth ${fmt(best.points)} in ${best.league.leagueName}.`
  } else {
    headline = `He is on your bench in ${benched.length} of ${impact.length} ${
      impact.length === 1 ? 'league' : 'leagues'
    }.`
  }

  return (
    <section className="af-card af-pf-verdict" aria-label="Chimmy verdict">
      <header className="af-pf-verdict-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="af-pf-verdict-mark"
          src="/af-robot-king.png"
          alt=""
          width={34}
          height={34}
        />
        <span className="af-pf-verdict-id">
          {/* The handoff's screenshot says CHIMMY INTELLIGENCE; its own open item
              says ship it as ASK CHIMMY to match the rest of the product. */}
          <span className="af-label">Ask Chimmy</span>
          <span className="af-pf-verdict-scope af-num">
            {impact.length} {impact.length === 1 ? 'LEAGUE' : 'LEAGUES'}
          </span>
        </span>
      </header>

      <p className="af-pf-verdict-headline">{headline}</p>

      {/*
        Per-league detail, because "the same player is a different asset per
        league" is the point of the screen. Each line carries the league's own
        scoring result, never a global number.
      */}
      <ul className="af-pf-verdict-list">
        {impact.map((i) => (
          <li key={i.leagueId} className="af-pf-verdict-row" data-starting={i.isStarting}>
            <span className="af-pf-verdict-league">{i.leagueName}</span>
            <span className="af-pf-verdict-slot af-num">{i.exactSlot ?? i.slot}</span>
            <span className="af-pf-verdict-pts af-num">
              {i.afPoints.available ? fmt(i.afPoints.data.points) : '—'}
            </span>
          </li>
        ))}
      </ul>

      {/*
        The read-only promise is stated, not implied — the handoff is explicit
        that this is a promise rather than a footnote.
      */}
      <p className="af-pf-verdict-readonly">
        AllFantasy is read-only. Every change happens on Sleeper, ESPN or Yahoo —
        we show you which league and which screen.
      </p>

      <a className="af-btn af-pf-verdict-cta" href={`/chimmy?q=${encodeURIComponent(playerName)}`}>
        Ask Chimmy about {playerName.split(' ').slice(-1)[0]}
      </a>
    </section>
  )
}

export default PlayerVerdict
