import Link from 'next/link'

import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import type { WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
/*
 * ⚠ THE THRESHOLD, FROM THE SHARED RULES MODULE — NOT FROM `weekBoard.ts`.
 * That loader is `server-only`; importing a VALUE from it pulls prisma into the
 * bundle and takes the whole /core catch-all down at build time. The type import
 * above is fine because types are erased. See weekBoardRules.ts's header, which
 * exists for precisely this trap.
 */
import { MIN_WEEKS_FOR_PROJECTION } from '@/lib/core-app/weekBoardRules'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  SectionHead,
  columnsTooUneven,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/week` with no league held — the two-column week board.
 *
 * 2026-09-07 handoff (`AF Core Week.dc.html`): "top 5 leagues you're leading /
 * bottom 5 you're trailing but still have a playoff path — leagues with no
 * realistic path are excluded and noted."
 *
 * ── Two loaders, two different questions ────────────────────────────────────
 *
 * `getWeekBoard` answers "how is THIS WEEK going" — a projected margin per
 * matchup, from the real schedule. `getSeasonOutlook` answers "does it still
 * matter" — a simulated playoff percentage over the remaining season. The
 * design needs both: the margin orders the columns, the percentage decides
 * which leagues belong in the trailing one at all.
 *
 * ⚠ THE PLAYOFF FILTER IS THE POINT OF THE TRAILING COLUMN, so a league with no
 * odds is EXCLUDED from it rather than assumed alive. Being 20 points down in a
 * league you cannot reach the playoffs in is not something to spend a Sunday on,
 * and a board that lists it anyway is back to being the 47-tile grid this
 * replaced. The excluded count is stated under the columns — never dropped in
 * silence.
 *
 * ⚠ AND A LEAGUE THE SIMULATION DID NOT COVER IS NOT THE SAME AS ONE IT RULED
 * OUT. An unmodelled league keeps its place in the LEADING column (being ahead
 * is worth knowing regardless) and is named in the note under the board.
 */

export type WeekBoardProps = {
  board: WeekBoardData
  /**
   * Playoff odds per league. Null when the simulation could not run — the board
   * then says so and shows both columns unfiltered rather than silently
   * dropping every trailing row.
   */
  outlook: SeasonOutlook | null
  rivalriesHref: string
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT THE WEEK'S OWN COUNTS. Those cover leagues with a schedule row this
   * week; in the offseason that is zero, and the footer — the only remaining
   * route to the picker — then offered "View all 0".
   */
  totalLeagues: number
}

/** Below this the season is, for practical purposes, decided against you. */
const DEAD_PATH_PCT = 5

/**
 * How many unprojectable matchups the third section lists before it stops and
 * counts the rest.
 *
 * ⚠ TEN, TO MATCH THE TWO COLUMNS' OWN SCALE. The board's promise is "the five
 * you are furthest ahead in, against the five you are behind in"; a third
 * section that printed all forty-seven would be the tile grid this board exists
 * to replace, reached from the other direction.
 */
const UNPROJECTED_SHOWN = 10

type Row = {
  m: WeekMatchup
  margin: number
  /** Simulated playoff % for this league, or null when it was not modelled. */
  playoffPct: number | null
}

function pctLabel(pct: number | null): string {
  return pct == null ? '—' : `${Math.round(pct)}%`
}

/*
 * 2026-09-13 handoff: one compact row per matchup — crest, league over
 * "vs opponent · N% playoff odds", and the projected margin as the single value
 * on the right.
 *
 * ⚠ NOTHING THE OLD ROW SAID IS GONE, IT MOVED. The rank numeral is dropped (the
 * section label already states the order); the playoff % moved into the sub
 * line; "% to win" sits under the margin; and "projected margin" is the value's
 * accessible name, because a bare "+38.2" beside a league reads as a score.
 */
function MatchRow({ row, ahead }: { row: Row; ahead: boolean }) {
  const { m } = row
  const abs = Math.abs(row.margin).toFixed(1)
  const win = Math.round(m.projection ? m.projection.winProbability * 100 : 0)
  const sign = ahead ? '+' : '−'
  return (
    <li>
      <Link className="af-bd-row" href={m.href}>
        {/* Already a loadable URL (the loader ran it through `leagueArtUrl`); null draws the monogram. */}
        <LeagueCrest imageUrl={m.leagueImageUrl} name={m.leagueName} platform={m.platform} size="sm" />
        <span className="af-bd-league">
          <span className="af-bd-name">{m.leagueName}</span>
          <span className="af-bd-sub">
            {/*
              ⚠ AN UNNAMED OPPONENT STAYS UNNAMED. `WeekOpponent.name` is null
              when no LeagueTeam row names that roster — borrowing the league's
              own name here would invent a manager.
            */}
            {m.opponent.name ? `vs ${m.opponent.name}` : 'opponent not named'}
            {row.playoffPct != null ? ` · ${pctLabel(row.playoffPct)} playoff odds` : ''}
            {m.elimination ? ' · lowest score is eliminated' : ''}
          </span>
        </span>
        <span
          className="af-bd-val"
          data-sev={ahead ? 'good' : 'bad'}
          aria-label={`${sign}${abs} projected margin, ${win}% to win`}
          title="Projected margin this week"
        >
          <span aria-hidden>
            {sign}
            {abs}
          </span>
          <span className="af-bd-val-sub" aria-hidden>
            {win}% to win
          </span>
        </span>
      </Link>
    </li>
  )
}

function Column({
  label,
  rows,
  ahead,
  quiet,
}: {
  label: string
  rows: Row[]
  ahead: boolean
  quiet: string
}) {
  return (
    <section className="af-bd-sec">
      <SectionHead label={label} tone={ahead ? 'good' : 'bad'} />
      {rows.length > 0 ? (
        <ul className="af-bd-rows af-bd-rows--compact">
          {rows.map((r) => (
            <MatchRow key={r.m.leagueId} row={r} ahead={ahead} />
          ))}
        </ul>
      ) : (
        <p className="af-bd-note">{quiet}</p>
      )}
    </section>
  )
}

export function WeekBoard({
  board,
  outlook,
  rivalriesHref,
  allHref,
  totalLeagues,
}: WeekBoardProps) {
  const pctByLeague = new Map<string, number>()
  if (outlook) {
    for (const l of outlook.leagues) {
      if (l.you) pctByLeague.set(l.leagueId, l.you.playoffPct)
    }
  }

  /*
   * ⚠ `unprojected` IS DELIBERATELY NOT IN EITHER COLUMN. A matchup neither
   * side has enough history to project has no margin, so putting it in a list
   * ordered BY margin would rank it against a number it does not have.
   *
   * ⚠ IT IS NO LONGER *ONLY* COUNTED, WHICH IS WHAT THIS COMMENT USED TO SAY.
   * Being out of the two columns was right; being out of the board entirely was
   * not — on an account where 47 of 65 leagues land here that left one row on
   * screen. They get their own section below, with no margin and no probability.
   */
  const projected: Row[] = [...board.coinFlips, ...board.leaning]
    .filter((m): m is WeekMatchup & { projection: NonNullable<WeekMatchup['projection']> } =>
      m.projection != null,
    )
    .map((m) => ({
      m,
      margin: m.projection.margin,
      playoffPct: pctByLeague.has(m.leagueId) ? (pctByLeague.get(m.leagueId) as number) : null,
    }))

  const leading = projected
    .filter((r) => r.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 5)

  const behind = projected.filter((r) => r.margin <= 0)

  /*
   * The filter the design names. With no outlook we cannot apply it, and
   * excluding everything would be worse than showing an unfiltered column — so
   * a null percentage passes here and the note below says the filter did not run.
   */
  const alive = outlook
    ? behind.filter((r) => r.playoffPct == null || r.playoffPct >= DEAD_PATH_PCT)
    : behind
  const dead = behind.length - alive.length

  const trailing = alive
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 5)
    /* Closest-to-level last, so the column reads from worst to most winnable. */
    .reverse()

  /*
   * ⚠ THE THIRD SECTION COUNTS TOWARDS `shown`, OR THE FOOTER LIES. `FooterSummary`
   * prints `considered − shown` as "N more sit between these two columns"; leaving
   * the listed unprojectable rows out would count ten leagues as hidden while they
   * are on screen, immediately above the sentence saying so.
   */
  const shown =
    leading.length + trailing.length + Math.min(board.unprojected.length, UNPROJECTED_SHOWN)
  const considered = Math.max(
    totalLeagues,
    board.coinFlips.length +
      board.leaning.length +
      board.unprojected.length +
      board.withoutSchedule,
  )

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow={
          board.week != null ? `Core · Your week · week ${board.week}` : 'Core · Your week'
        }
        title="Your week"
        blurb="The five leagues you are furthest ahead in, against the five you are behind in that a playoff run still depends on."
      />

      <div
        className="af-bd-split"
        data-stack={columnsTooUneven(leading.length, trailing.length) || undefined}
      >
        <Column
          label="Leading · top 5"
          rows={leading}
          ahead
          quiet="You are not projected ahead in any league this week."
        />
        <Column
          label="Trailing · bottom 5, playoffs still live"
          rows={trailing}
          ahead={false}
          quiet={
            behind.length > 0
              ? 'Every league you are behind in this week is already out of playoff reach.'
              : 'You are not projected behind in any league this week.'
          }
        />
      </div>

      {/*
        ── 🛑 THE THIRD SECTION, AND WHY THE BOARD WAS EMPTY WITHOUT IT ────────

        Reported from a phone: "Your week should show the top leagues and bottom
        leagues because it is set to all leagues but gives no information."
        Measured from that screenshot — 65 leagues in scope, and the board
        rendered ONE row. 47 were unprojectable and 17 carried no schedule, so
        `projected` held a single matchup: it went to LEADING, `behind` was
        empty, and the trailing column printed "You are not projected behind in
        any league this week."

        Nothing was broken and every number on screen was true. The note already
        said "47 could not be projected" — accurately, and as a number the
        reader can do nothing with. Forty-seven real matchups, each with a named
        opponent and a working link, were reduced to a count.

        ⚠ AND THEY STILL DO NOT ENTER THE TWO COLUMNS, WHICH IS THE CONSTRAINT
        THAT SHAPES THIS. Those columns are ordered BY MARGIN and an
        unprojectable matchup has none; dropping one in would rank it against a
        number it does not have, and defaulting it to 50% would invent the
        projection the loader deliberately refused. So it gets its own section,
        with no margin column and no probability — the same treatment the
        full-screen `YourWeek` already gives this exact list under "Not enough
        history to call". This board was the surface that had the data and threw
        it away; the two now agree.

        The value column says how far short of the threshold each one is, which
        is the one genuinely useful thing about an unprojectable matchup: it
        tells a reader whether this is next week's problem or this season's.
      */}
      {board.unprojected.length > 0 ? (
        <section className="af-bd-sec">
          <SectionHead
            label="On the schedule · not enough history to call"
            count={
              board.unprojected.length > UNPROJECTED_SHOWN
                ? `${UNPROJECTED_SHOWN} of ${board.unprojected.length}`
                : `${board.unprojected.length}`
            }
          />
          <ul className="af-bd-rows af-bd-rows--compact">
            {board.unprojected.slice(0, UNPROJECTED_SHOWN).map((m) => (
              <li key={m.leagueId}>
                <Link className="af-bd-row" href={m.href}>
                  <LeagueCrest
                    imageUrl={m.leagueImageUrl}
                    name={m.leagueName}
                    platform={m.platform}
                    size="sm"
                  />
                  <span className="af-bd-league">
                    <span className="af-bd-name">{m.leagueName}</span>
                    <span className="af-bd-sub">
                      {/* Same rule as MatchRow: an unnamed roster stays unnamed. */}
                      {m.opponent.name ? `vs ${m.opponent.name}` : 'opponent not named'}
                      {m.elimination ? ' · lowest score is eliminated' : ''}
                      {/*
                        The averages behind the value column, so the number is
                        readable rather than asserted. Only when form exists —
                        see the value column below for why the two cases differ.
                      */}
                      {m.form
                        ? ` · ${m.form.you.toFixed(1)} to ${m.form.them.toFixed(1)} per week`
                        : ''}
                    </span>
                  </span>
                  {/*
                    ⚠ TWO DIFFERENT VALUE COLUMNS, BECAUSE THE TWO ROWS KNOW
                    DIFFERENT THINGS — and this section holds both.

                    With form: the signed scoring gap so far. It is NOT a margin
                    and NOT a probability, and the sub-label says "so far" rather
                    than "projected" for that reason — see `WeekMatchup.form`,
                    which withholds sigma precisely so this cannot drift into
                    being presented as a call.

                    Without form: a count of weeks, not a dash. The dash the
                    full-screen version uses is right there — it says "no
                    probability" on a row that also carries an opponent and a
                    score line. Here such a row has neither, so a dash would be
                    the only thing in the column and would say nothing at all.
                  */}
                  {m.form ? (
                    <span
                      className="af-bd-val af-bd-val--form"
                      data-tone={m.form.margin >= 0 ? 'up' : 'down'}
                      aria-label={`You have averaged ${m.form.you.toFixed(1)} points a week to their ${m.form.them.toFixed(1)}, over ${m.form.weeks} scored ${
                        m.form.weeks === 1 ? 'week' : 'weeks'
                      } — form so far, not a projection`}
                    >
                      <span className="af-num" aria-hidden>
                        {m.form.margin >= 0 ? '+' : '−'}
                        {Math.abs(m.form.margin).toFixed(1)}
                      </span>
                      <span className="af-bd-val-sub" aria-hidden>
                        so far · {m.form.weeks}wk
                      </span>
                    </span>
                  ) : (
                    <span
                      className="af-bd-val af-bd-val--seed"
                      aria-label={`${m.yourSampleWeeks} of ${MIN_WEEKS_FOR_PROJECTION} completed weeks needed to project this matchup`}
                    >
                      <span aria-hidden>
                        {m.yourSampleWeeks}/{MIN_WEEKS_FOR_PROJECTION}
                      </span>
                      <span className="af-bd-val-sub" aria-hidden>
                        weeks on file
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="af-bd-note af-bd-note--plain">
        {/*
          ⚠ `model.basis` IS A WHOLE SENTENCE WHEN THERE IS NOTHING TO FIT, and
          appending ", fitted on 0 roster-weeks" to it produced "…nothing here is
          projected., fitted on 0 roster-weeks." Found by rendering it. With no
          sample the basis stands alone; with one it is a clause.
        */}
        {board.model.sampleSize > 0
          ? `Margins are projected from each league's own completed weeks — ${board.model.basis}, fitted on ${board.model.sampleSize.toLocaleString()} roster-weeks.`
          : board.model.basis}{' '}
        {outlook
          ? ` Playoff odds are a simulated probability over the remaining schedule; a league below ${DEAD_PATH_PCT}% is left out of the trailing column.`
          : ' The playoff filter did not run this time, so the trailing column is every league you are behind in — not only the ones still live.'}
      </p>

      {/*
        ⚠ EVERYTHING THE COLUMNS DID NOT SHOW IS ACCOUNTED FOR BY REASON. Four
        different absences — no schedule, no projection, no playoff path, simply
        below the cut — and collapsing them into one number is how a board stops
        being trustworthy at sixty leagues.
      */}
      {dead > 0 || board.unprojected.length > UNPROJECTED_SHOWN || board.withoutSchedule > 0 ? (
        <p className="af-bd-note af-bd-note--plain">
          {dead > 0 ? (
            <>
              <strong>
                {dead} {dead === 1 ? 'league is' : 'leagues are'} behind with no realistic
                playoff path
              </strong>{' '}
              and are left out of the trailing column.{' '}
            </>
          ) : null}
          {/*
            ⚠ THE SENTENCE HAD TO CHANGE WHEN THE SECTION ABOVE STARTED LISTING
            THEM. "47 could not be projected" over a list of ten of those very
            matchups reads as a second, larger population the board is still
            hiding. The count is now explicitly the REMAINDER, and disappears
            when the section showed all of them.
          */}
          {board.unprojected.length > UNPROJECTED_SHOWN
            ? `${board.unprojected.length - UNPROJECTED_SHOWN} more could not be projected either — too few completed weeks on one side or the other. `
            : ''}
          {board.withoutSchedule > 0
            ? `${board.withoutSchedule} carry no schedule for this week at all.`
            : ''}
        </p>
      ) : null}

      <div className="af-bd-foot">
        <p className="af-bd-foot-text">
          All-time head-to-head against this week&apos;s opponents.
        </p>
        <Link className="af-bd-foot-cta" href={rivalriesHref}>
          Rivalry radar &rarr;
        </Link>
      </div>

      <FooterSummary
        hidden={Math.max(0, considered - shown)}
        total={considered}
        href={allHref}
        quiet="sit between these two columns, or have no game we can project this week."
      />
    </div>
  )
}

export default WeekBoard
