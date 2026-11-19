'use client'

import '@/components/league/league-type-skin.css'

/**
 * "The rafters" on the league page's history (components/decide/LegacyHome.tsx): one pennant per
 * season's champion, an open pennant for a season still being played, and whether the viewer has a
 * banner up there. The same treatment /core's Dynasty deck gives champions
 * (components/core-app/screens/DynastyHomeDeck.tsx), in the league type's colours
 * (`--lsk-*`, components/league/league-type-skin.css).
 *
 * Built only from what the history payload already says: a season with no synced champion gets no
 * pennant rather than a guessed one.
 */
export type RafterSeason = {
  season: string
  champion: string | null
  /** The champion is the viewer. */
  mine: boolean
  /** The season is still being played. */
  open: boolean
}

/** At most this many pennants; a long chain keeps its most recent seasons. */
const MAX_PENNANTS = 8

export function LeagueRafters({ seasons, leagueName }: { seasons: RafterSeason[]; leagueName: string }) {
  const shown = [...seasons]
    .filter((s) => s.open || s.champion)
    .sort((a, b) => Number(a.season) - Number(b.season))
    .slice(-MAX_PENNANTS)
  if (shown.length === 0) return null
  const myTitles = shown.filter((s) => s.mine).length
  const first = shown[0]?.season

  return (
    <section className="af-lsk-rafters" aria-label="The rafters: league champions by season" data-testid="league-rafters">
      <div className="af-lsk-rafters-copy">
        <span className="af-lsk-hero-kicker">Record book</span>
        <h2 className="af-lsk-rafters-title">
          League history{first ? <span className="af-lsk-hero-sub"> · since {first}</span> : null}
        </h2>
        <p className="af-lsk-hero-line">Every champion {leagueName} has crowned.</p>
      </div>
      <div className="af-lsk-rafters-wall">
        <span className="af-lsk-rafters-label">The rafters</span>
        <ol className="af-lsk-rafters-pennants">
          {shown.map((s) => (
            <li
              key={s.season}
              className="af-lsk-pennant"
              data-open={s.open ? '1' : undefined}
              data-mine={s.mine ? '1' : undefined}
              aria-label={s.open ? `${s.season}: title still open` : `${s.season} champion: ${s.champion}${s.mine ? ' (you)' : ''}`}
            >
              <span className="af-lsk-pennant-year">{s.season}</span>
              <span className="af-lsk-pennant-name">{s.open ? 'Open' : s.mine ? 'You' : s.champion}</span>
            </li>
          ))}
        </ol>
        <span className="af-lsk-rafters-titles">
          {myTitles > 0 ? (myTitles === 1 ? '1 banner is yours' : `${myTitles} banners are yours`) : 'No banner of yours yet'}
        </span>
      </div>
    </section>
  )
}
