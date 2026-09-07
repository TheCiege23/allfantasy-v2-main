import Link from 'next/link'

import type { OutlookLeague, SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  SectionHead,
  columnsTooUneven,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/standings` with no league held — where you sit in every league at once.
 *
 * 2026-09-07 handoff (`AF Core Standings.dc.html`).
 *
 * ⚠ RANKED BY SEED, NOT BY POINTS FOR, AND THAT IS THE WHOLE DESIGN. The old
 * empty state said it in as many words: points-for only means something inside
 * one league, because two leagues with different scoring settings produce
 * numbers that cannot be compared. A seed is comparable — "#1 of 12" means the
 * same thing everywhere — so the board ranks on it and prints the field size
 * beside it so a #3 of 10 is not read as a #3 of 32.
 *
 * ⚠ AND THE ODDS ARE SIMULATED, NOT INFERRED FROM THE TABLE. `playoffPct` comes
 * out of `getSeasonOutlook`'s season simulation over the real remaining
 * schedule. The board says so in its blurb, because a percentage with no stated
 * basis reads as a fact rather than as a model output.
 *
 * ⚠ A LEAGUE WHOSE TEAM WE COULD NOT IDENTIFY IS EXCLUDED AND COUNTED, never
 * rendered with a blank seed. `OutlookLeague.you` is null exactly then, and a
 * row that says "#— of 12" is a row claiming we looked and found nothing.
 */

export type StandingsBoardProps = {
  outlook: SeasonOutlook
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT THE SIMULATION'S OWN COUNT. `outlook.leagues` holds only the leagues
   * the simulation could run for; on an account whose season has not started
   * that is zero, and the footer — the only remaining route to the league
   * picker — then offered "View all 0". Found by rendering it, 2026-09-07.
   */
  totalLeagues: number
}

type Ranked = OutlookLeague & { you: NonNullable<OutlookLeague['you']> }

/** Above this, the field is all but locked in. Below the lower one, all but gone. */
const SAFE_PCT = 60
const LONG_SHOT_PCT = 25

function sevOf(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= SAFE_PCT) return 'good'
  if (pct >= LONG_SHOT_PCT) return 'warn'
  return 'bad'
}

function Row({ league, i }: { league: Ranked; i: number }) {
  const you = league.you
  const pct = Math.round(you.playoffPct)
  const sev = sevOf(you.playoffPct)
  const record = you.wins === 0 && you.losses === 0 ? null : `${you.wins}-${you.losses}`

  return (
    <li>
      <Link className="af-bd-row" href={league.href}>
        <span className="af-bd-rank" aria-hidden>
          {String(i + 1).padStart(2, '0')}
        </span>
        <LeagueCrest name={league.leagueName} platform={league.platform} size="sm" />
        <span className="af-bd-league">
          <span className="af-bd-name">{league.leagueName}</span>
          <span className="af-bd-sub">
            <span className="af-bd-plat" data-platform={league.platform}>
              {league.platform.toUpperCase()}
            </span>
            {' · '}
            {/*
              ⚠ AN ABSENT RECORD IS NOT 0-0. A freshly synced league carries a
              whole season of unplayed rows; printing "0-0" states a result.
            */}
            {record ?? 'no games played yet'}
          </span>
        </span>
        <span className="af-bd-mid">
          {/*
            The condition in words. `whatDecidesIt` is deliberately specific —
            "win once in three", not "in contention" — so it is printed rather
            than collapsed into a status word.
          */}
          <span className="af-bd-tag" data-sev={sev}>
            {you.seed <= league.playoffTeams ? 'IN' : 'OUT'}
            <span className="af-bd-tag-detail"> {league.whatDecidesIt}</span>
          </span>
        </span>
        <span className="af-bd-stat af-bd-stat--narrow">
          #{you.seed} of {league.teams.length}
        </span>
        <span className="af-bd-stat af-bd-stat--narrow" data-sev={sev}>
          {/*
            ⚠ `modelled: false` MEANS TOO FEW WEEKS TO MODEL, so the percentage
            behind it is the simulation's prior rather than a read on this team.
            It is marked rather than hidden — the seed beside it is still real.
          */}
          {pct}%{you.modelled ? '' : '*'}
        </span>
      </Link>
    </li>
  )
}

function Column({
  label,
  rows,
  quiet,
  offset,
}: {
  label: string
  rows: Ranked[]
  quiet: string
  offset: number
}) {
  return (
    <section className="af-bd-sec">
      <SectionHead label={label} />
      {rows.length > 0 ? (
        <ul className="af-bd-rows">
          {rows.map((l, i) => (
            <Row key={l.leagueId} league={l} i={i + offset} />
          ))}
        </ul>
      ) : (
        <p className="af-bd-note">{quiet}</p>
      )}
    </section>
  )
}

export function StandingsBoard({ outlook, allHref, totalLeagues }: StandingsBoardProps) {
  const ranked = outlook.leagues.filter((l): l is Ranked => l.you != null)
  const unidentified = outlook.leagues.length - ranked.length
  const total = Math.max(totalLeagues, outlook.leagues.length + outlook.withheld.length)

  /*
   * ⚠ TWO DIFFERENT SORTS, AND THE SECOND IS NOT THE REVERSE OF THE FIRST.
   * Strongest is "best position", which is seed first and odds as the
   * tiebreak — a #1 of 12 is a stronger claim than a #2 of 10 with better odds.
   * The bubble is "closest to missing", which is odds ascending, because a #7
   * of 10 with a soft run-in is in better shape than a #6 of 12 with a hard
   * one. Ranking the bubble by seed would put the wrong five in front of you.
   */
  const strongest = [...ranked]
    .sort((a, b) => a.you.seed - b.you.seed || b.you.playoffPct - a.you.playoffPct)
    .slice(0, 5)

  const strongestIds = new Set(strongest.map((l) => l.leagueId))
  const bubble = [...ranked]
    .filter((l) => !strongestIds.has(l.leagueId))
    .sort((a, b) => a.you.playoffPct - b.you.playoffPct)
    .slice(0, 5)
    /* Displayed best-first so the column reads downhill, like the design. */
    .reverse()

  const shown = strongest.length + bubble.length
  const anyUnmodelled = [...strongest, ...bubble].some((l) => !l.you.modelled)

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Standings"
        title="Standings"
        blurb="Points-for cannot be compared across leagues, so this ranks on seed instead — your strongest positions against the ones on the bubble."
      />

      {ranked.length > 0 ? (
        <>
          <div
            className="af-bd-split"
            data-stack={columnsTooUneven(strongest.length, bubble.length) || undefined}
          >
            <Column
              label="Strongest seeds · top 5"
              rows={strongest}
              offset={0}
              quiet="No league has a seed we can read yet."
            />
            <Column
              label="On the bubble · bottom 5"
              rows={bubble}
              offset={strongest.length}
              quiet="Nothing else is close enough to call a bubble."
            />
          </div>

          <p className="af-bd-note">
            Playoff odds are simulated over each league&apos;s real remaining schedule —{' '}
            {outlook.basis}
            {anyUnmodelled
              ? '. A percentage marked * comes from too few completed weeks to model that team, so read the seed beside it rather than the number.'
              : '.'}
          </p>
        </>
      ) : (
        <p className="af-bd-note">
          {outlook.leagues.length > 0
            ? 'We could not identify your own team in any league with a simulated season, so there is no seed to rank.'
            : 'No league of yours has enough of a season on file to simulate yet.'}
        </p>
      )}

      {/*
        ⚠ WITHHELD LEAGUES ARE NAMED WITH THEIR REASON, not folded into the
        footer's count. "We chose not to model this and here is why" is a
        different fact from "nothing is happening there".
      */}
      {outlook.withheld.length > 0 || unidentified > 0 ? (
        <p className="af-bd-note">
          {unidentified > 0 ? (
            <>
              <strong>
                {unidentified} {unidentified === 1 ? 'league' : 'leagues'} could not be ranked
              </strong>{' '}
              because we could not tell which team is yours.{' '}
            </>
          ) : null}
          {outlook.withheld.length > 0 ? (
            <>
              Withheld: {outlook.withheld.slice(0, 4).map((w) => `${w.leagueName} (${w.reason})`).join('; ')}
              {outlook.withheld.length > 4 ? `; and ${outlook.withheld.length - 4} more` : ''}.
            </>
          ) : null}
        </p>
      ) : null}

      <FooterSummary
        hidden={Math.max(0, total - shown)}
        total={total}
        href={allHref}
        quiet="sit between these two columns or have no seed to read."
      />
    </div>
  )
}

export default StandingsBoard
