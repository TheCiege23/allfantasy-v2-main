import Link from 'next/link'

import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import {
  TIER_LABEL,
  TIER_ORDER,
  buildStandingsPortfolio,
  type Spotlight,
  type StandingsPortfolio,
} from '@/lib/core-app/standingsPortfolio'
import { BoardHead } from '@/components/core-app/boards/BoardKit'
import { StandingsExplorer } from '@/components/core-app/boards/StandingsExplorer'
import '@/components/core-app/af-core-boards.css'
import '@/components/core-app/af-standings-board.css'

/**
 * `/core/standings` with no league held — where you sit in every league at once.
 *
 * 2026-10-01 redesign. The 2026-09-07 board showed ten leagues in two columns and accounted for the
 * rest with one footer line; on a 65-league account that was 55 leagues behind a link. It now leads
 * with the whole portfolio (how many seats you hold, how many #1 seeds, the berths the simulation
 * expects), spotlights the handful of leagues worth a look, and lists EVERY league behind a tier filter,
 * a sort and a search. The maths is `lib/core-app/standingsPortfolio.ts`; the interactive list is
 * `StandingsExplorer`.
 *
 * ⚠ RANKED BY SEED AND ODDS, NEVER BY POINTS FOR, AND THAT IS STILL THE WHOLE DESIGN. Points-for only
 * means something inside one league. A seed is comparable — "#1 of 12" means the same thing everywhere —
 * so every row prints the field size beside it and draws the field as a track.
 *
 * ⚠ AND THE ODDS ARE SIMULATED, NOT INFERRED FROM THE TABLE. `playoffPct` comes out of
 * `getSeasonOutlook`'s season simulation over the real remaining schedule, and the board says so.
 *
 * ⚠ A LEAGUE WHOSE TEAM WE COULD NOT IDENTIFY IS EXCLUDED AND COUNTED, never rendered with a blank
 * seed. A row that says "#— of 12" is a row claiming we looked and found nothing.
 */

export type StandingsBoardProps = {
  outlook: SeasonOutlook
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT THE SIMULATION'S OWN COUNT. On an account whose season has not started `outlook.leagues` is
   * zero, and the footer — the only remaining route to the league picker — then offered "View all 0".
   */
  totalLeagues: number
}

const TIER_SEV = {
  clinched: 'good',
  control: 'good',
  bubble: 'warn',
  longshot: 'bad',
  out: 'muted',
} as const

function Hero({ p }: { p: StandingsPortfolio }) {
  const { stats } = p
  const played = stats.wins + stats.losses
  const winPct = played > 0 ? Math.round((stats.wins / played) * 100) : null
  return (
    <section className="af-sb-hero" aria-label="Your standings across every league">
      <p className="af-sb-headline">{p.headline}</p>
      <div className="af-sb-tiles">
        <Tile
          v={`${stats.inFieldNow}`}
          of={`/${stats.leagues}`}
          k="In a playoff spot"
          sev="good"
        />
        <Tile v={`${stats.topSeeds}`} k={stats.topSeeds === 1 ? '#1 seed' : '#1 seeds'} sev="accent" />
        <Tile
          v={`~${stats.expectedBerths.toFixed(1)}`}
          k="Playoff trips expected"
          hint="The simulation's playoff odds, summed across every league."
        />
        <Tile
          v={played > 0 ? `${stats.wins}-${stats.losses}` : '—'}
          k={winPct != null ? `Combined · ${winPct}% wins` : 'Combined record'}
        />
      </div>

      {/*
        The whole portfolio as one bar. Proportional by league count, so the bar answers "how is my
        season going" before a single row is read.
      */}
      {stats.leagues > 0 ? (
        <div className="af-sb-tierbar">
          <div className="af-sb-tierbar-track" role="img" aria-label={tierAria(p)}>
            {TIER_ORDER.filter((t) => p.tierCounts[t] > 0).map((t) => (
              <span
                key={t}
                className="af-sb-tierbar-seg"
                data-sev={TIER_SEV[t]}
                style={{ flexGrow: p.tierCounts[t] }}
              />
            ))}
          </div>
          <ul className="af-sb-tierbar-key">
            {TIER_ORDER.filter((t) => p.tierCounts[t] > 0).map((t) => (
              <li key={t} data-sev={TIER_SEV[t]}>
                <span className="af-sb-dot" aria-hidden />
                {TIER_LABEL[t]} <strong>{p.tierCounts[t]}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function tierAria(p: StandingsPortfolio): string {
  return TIER_ORDER.filter((t) => p.tierCounts[t] > 0)
    .map((t) => `${p.tierCounts[t]} ${TIER_LABEL[t].toLowerCase()}`)
    .join(', ')
}

function Tile({
  v,
  of,
  k,
  sev,
  hint,
}: {
  v: string
  of?: string
  k: string
  sev?: 'good' | 'accent'
  hint?: string
}) {
  return (
    <div className="af-sb-tile" title={hint}>
      <span className="af-sb-tile-v" data-sev={sev}>
        {v}
        {of ? <span className="af-sb-tile-of">{of}</span> : null}
      </span>
      <span className="af-sb-tile-k">{k}</span>
    </div>
  )
}

function Spotlights({ items }: { items: Spotlight[] }) {
  if (items.length === 0) return null
  return (
    <section className="af-sb-spot" aria-label="Spotlight">
      <ul className="af-sb-spot-row">
        {items.map((s) => (
          <li key={s.key}>
            <Link className="af-sb-card" href={s.href} data-tone={s.tone}>
              <span className="af-sb-card-k">{s.label}</span>
              <span className="af-sb-card-v">{s.value}</span>
              <span className="af-sb-card-league">{s.league}</span>
              <span className="af-sb-card-d">{s.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function StandingsBoard({ outlook, allHref, totalLeagues }: StandingsBoardProps) {
  const p = buildStandingsPortfolio(outlook)
  const total = Math.max(totalLeagues, outlook.leagues.length + (outlook.withheld?.length ?? 0))
  const withheldCount = p.withheld.reduce((s, g) => s + g.leagues.length, 0)

  return (
    <div className="af-bd af-sb">
      <BoardHead
        eyebrow="Core · Standings"
        title="Standings"
        blurb="Where you sit in every league at once. Points-for cannot be compared across leagues, so this ranks on seed and simulated playoff odds instead."
      />

      {p.rows.length > 0 ? (
        <>
          <Hero p={p} />
          <Spotlights items={p.spotlights} />
          <StandingsExplorer rows={p.rows} tierCounts={p.tierCounts} />

          <p className="af-bd-note af-bd-note--plain">
            Playoff odds are simulated over each league&apos;s real remaining schedule — {outlook.basis}
            {/* `basis` is whole sentences ending in a period; appending one read "…how uncertain they are..". */}
            {p.anyUnmodelled
              ? ' A percentage marked * comes from too few completed weeks to model that team, so read the seed beside it rather than the number.'
              : null}{' '}
            Luck is your record against the wins your weekly scores would have earned playing the whole league.
          </p>
        </>
      ) : (
        <p className="af-bd-note">
          {outlook.leagues.length > 0
            ? 'We could not identify your own team in any league with a simulated season, so there is no seed to rank.'
            : 'No league of yours has enough of a season on file to simulate yet.'}
        </p>
      )}

      {p.unidentified > 0 ? (
        <p className="af-bd-note">
          <strong>
            {p.unidentified} {p.unidentified === 1 ? 'league' : 'leagues'} could not be ranked
          </strong>{' '}
          because we could not tell which team is yours.
        </p>
      ) : null}

      {/*
        ⚠ WITHHELD LEAGUES ARE NAMED WITH THEIR REASON, not folded into the footer's count — "we chose not
        to model this and here is why" is a different fact from "nothing is happening there". Grouped by
        reason and collapsed, because one repeated reason printed per league was a wall of text.
      */}
      {withheldCount > 0 ? (
        <details className="af-sb-withheld">
          <summary>
            <span>
              <strong>
                {withheldCount} {withheldCount === 1 ? 'league' : 'leagues'} withheld
              </strong>{' '}
              from the simulation
            </span>
            <span className="af-sb-withheld-cue" aria-hidden>
              Why?
            </span>
          </summary>
          <ul className="af-sb-withheld-list">
            {p.withheld.map((g) => (
              <li key={g.reason}>
                <p className="af-sb-withheld-reason">{g.reason}</p>
                <p className="af-sb-withheld-names">{g.leagues.join(' · ')}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="af-bd-foot">
        <p className="af-bd-foot-text">
          Open any league for its full table, power ranking and points picture.
        </p>
        <Link className="af-bd-foot-cta" href={allHref}>
          All {total.toLocaleString()} leagues &rarr;
        </Link>
      </div>
    </div>
  )
}

export default StandingsBoard
