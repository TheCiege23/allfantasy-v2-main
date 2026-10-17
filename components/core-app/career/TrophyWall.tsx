import Link from 'next/link'
import { TIER_LABEL } from '@/lib/core-app/careerAwards'
import { careerHref, type CareerFilter } from '@/lib/core-app/careerModel'
import type { HallLayout, Medal, Plaque, TrophyWallData } from '@/lib/core-app/trophyWall'

/**
 * The trophy wall — Hall of Fame as a gallery (see lib/core-app/trophyWall.ts).
 *
 * Shown on its own on a landscape touch tablet, where the list's single column wastes the width
 * and the person is most likely holding the screen up to look at it; everywhere else the list
 * stays the default and the wall is one tap away. The choice lives in the URL (`?layout=`), so a
 * wall is a link someone can send.
 */

function RingGlyph() {
  return (
    <svg className="af-tw-ring" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <circle cx="24" cy="28" r="14" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M16 12 L24 4 L32 12 L24 20 Z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

function MedalGlyph({ tier }: { tier: Medal['tier'] }) {
  return (
    <svg className="af-tw-medal" data-tier={tier} viewBox="0 0 40 48" width="34" height="40" aria-hidden="true">
      <path d="M10 0 L20 16 L30 0" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.6" />
      <circle cx="20" cy="30" r="14" fill="currentColor" />
      <circle cx="20" cy="30" r="9" fill="none" stroke="var(--bg)" strokeWidth="2" opacity="0.5" />
    </svg>
  )
}

function PlaqueCard({ p }: { p: Plaque }) {
  return (
    <li className="af-tw-plaque" data-latest={p.latest ? '' : undefined}>
      <RingGlyph />
      <span className="af-tw-year">{p.season}</span>
      <span className="af-tw-league">{p.leagueName}</span>
      <span className="af-tw-meta">
        <span className="af-crl-plat">{p.platform}</span>
        {p.record ? <span>{p.record} regular season</span> : null}
      </span>
      {p.settingsLabel ? <span className="af-tw-settings">{p.settingsLabel}</span> : null}
      {p.streak > 1 ? (
        <span className="af-tw-streak">{p.streak === 2 ? 'Back-to-back' : `${p.streak} straight`}</span>
      ) : null}
    </li>
  )
}

export function HallLayoutToggle({ filter, layout }: { filter: CareerFilter; layout: HallLayout }) {
  return (
    <nav className="af-tw-toggle" aria-label="Hall of Fame layout">
      <Link
        href={careerHref(filter, { view: 'hall', layout: 'wall' })}
        aria-current={layout === 'wall' ? 'page' : undefined}
        className="af-tw-toggle-opt"
      >
        Trophy wall
      </Link>
      <Link
        href={careerHref(filter, { view: 'hall', layout: 'list' })}
        aria-current={layout === 'list' ? 'page' : undefined}
        className="af-tw-toggle-opt"
      >
        List
      </Link>
    </nav>
  )
}

export function TrophyWall({ wall }: { wall: TrophyWallData }) {
  const { plaques, openSlot, medals, counts } = wall
  return (
    <div className="af-tw">
      <dl className="af-tw-counts">
        <div>
          <dt>Titles</dt>
          <dd className="af-tw-gold">{counts.titles}</dd>
        </div>
        <div>
          <dt>Title games</dt>
          <dd>{counts.finals ?? '—'}</dd>
        </div>
        <div>
          <dt>Playoff berths</dt>
          <dd>{counts.playoffs}</dd>
        </div>
        <div>
          <dt>Awards</dt>
          <dd>{counts.awards}</dd>
        </div>
      </dl>

      <section aria-label="Championship rings">
        <p className="af-crl-head">The rings</p>
        {plaques.length === 0 && !openSlot ? (
          <p className="af-crl-foot">
            No championship on file yet. The wall fills from finished seasons where a league recorded you as champion.
          </p>
        ) : (
          <ul className="af-tw-plaques">
            {openSlot ? (
              <li className="af-tw-plaque af-tw-plaque--open">
                <span className="af-crl-tag">IF YOU WIN</span>
                <span className="af-tw-year">#{openSlot.ringNumber}</span>
                <span className="af-tw-league">{openSlot.title}</span>
                <span className="af-tw-meta">
                  <span className="af-crl-plat">{openSlot.platform}</span>
                  {openSlot.record ? <span>{openSlot.record} so far</span> : null}
                </span>
              </li>
            ) : null}
            {plaques.map((p) => (
              <PlaqueCard key={p.key} p={p} />
            ))}
          </ul>
        )}
      </section>

      {medals.length > 0 ? (
        <section aria-label="Awards cabinet">
          <p className="af-crl-head">The cabinet</p>
          <ul className="af-tw-medals">
            {medals.map((m) => (
              <li key={m.key} className="af-tw-medalcard">
                <MedalGlyph tier={m.tier} />
                <span className="af-tw-medalname">{m.name}</span>
                <span className="af-tw-medaltier" data-tier={m.tier}>
                  {TIER_LABEL[m.tier]} · {m.earnedSeason}
                </span>
                <span className="af-tw-medalev">{m.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="af-crl-foot">
        Each ring shows that season&apos;s regular-season record — no championship box score is stored, so none is shown.
      </p>
    </div>
  )
}
