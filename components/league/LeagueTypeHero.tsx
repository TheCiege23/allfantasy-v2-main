'use client'

import { LEAGUE_SKIN_COPY, type LeagueSkin } from '@/lib/league/leagueTypeSkin'

/**
 * The block on a league's first tab that only its league type has: the type's name, where the
 * season stands, and one line on what makes the format different — in that type's colours
 * (components/league/league-type-skin.css). It states only facts the league row already carries;
 * per-type boards (draft capital, cut line, cap space…) are separate work and read their own data.
 */
export function LeagueTypeHero({
  skin,
  sportLabel,
  season,
  week,
  teamCount,
}: {
  skin: LeagueSkin
  sportLabel: string
  season: number | null
  week: number | null
  teamCount: number | null
}) {
  const copy = LEAGUE_SKIN_COPY[skin]
  const kicker = skin === 'redraft' ? `${copy.label} · ${sportLabel}` : copy.label
  const title = week != null ? `Week ${week}` : season != null ? `${season} season` : copy.label
  const sub = [
    week != null && season != null ? `${season} season` : null,
    teamCount ? `${teamCount} teams` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="af-lsk-hero" aria-label={`${copy.label} league overview`} data-testid="league-type-hero">
      <div className="af-lsk-hero-copy">
        <span className="af-lsk-hero-kicker">{kicker}</span>
        <h2 className="af-lsk-hero-title">
          {title}
          {sub ? <span className="af-lsk-hero-sub"> · {sub}</span> : null}
        </h2>
        <p className="af-lsk-hero-line">{copy.tagline}</p>
      </div>
      <svg className="af-lsk-hero-crest" viewBox="0 0 56 64" aria-hidden="true">
        <path d="M28 2 L53 11 V32 C53 47 42 57 28 62 C14 57 3 47 3 32 V11 Z" strokeWidth="2" />
        <text x="28" y="40" textAnchor="middle" fontSize="22" fontWeight="800">
          {copy.mark}
        </text>
      </svg>
    </section>
  )
}
