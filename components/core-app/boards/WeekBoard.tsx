import Link from 'next/link'

import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import type { WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
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

type Row = {
  m: WeekMatchup
  margin: number
  /** Simulated playoff % for this league, or null when it was not modelled. */
  playoffPct: number | null
}

function pctLabel(pct: number | null): string {
  return pct == null ? '—' : `${Math.round(pct)}%`
}

function MatchRow({ row, i, ahead }: { row: Row; i: number; ahead: boolean }) {
  const { m } = row
  const abs = Math.abs(row.margin).toFixed(1)
  return (
    <li>
      <Link className="af-bd-row" href={m.href}>
        <span className="af-bd-rank" aria-hidden>
          {String(i + 1).padStart(2, '0')}
        </span>
        <LeagueCrest name={m.leagueName} platform={m.platform} size="sm" />
        <span className="af-bd-league">
          <span className="af-bd-name">{m.leagueName}</span>
          <span className="af-bd-sub">
            {/*
              ⚠ AN UNNAMED OPPONENT STAYS UNNAMED. `WeekOpponent.name` is null
              when no LeagueTeam row names that roster — borrowing the league's
              own name here would invent a manager.
            */}
            {m.opponent.name ? `vs ${m.opponent.name}` : 'opponent not named'}
            {m.elimination ? ' · lowest score is eliminated' : ''}
          </span>
        </span>
        <span className="af-bd-mid">
          <span className="af-bd-tag" data-sev={ahead ? 'good' : 'bad'}>
            {ahead ? '+' : '−'}
            {abs}
            <span className="af-bd-tag-detail"> projected margin</span>
          </span>
        </span>
        <span className="af-bd-stat af-bd-stat--narrow">
          {Math.round(m.projection ? m.projection.winProbability * 100 : 0)}% to win
        </span>
        <span
          className="af-bd-stat af-bd-stat--narrow"
          data-sev={
            row.playoffPct == null ? undefined : row.playoffPct >= 50 ? 'good' : 'warn'
          }
          title="Simulated playoff probability over the remaining season"
        >
          {pctLabel(row.playoffPct)} PO
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
      <SectionHead label={label} />
      {rows.length > 0 ? (
        <ul className="af-bd-rows">
          {rows.map((r, i) => (
            <MatchRow key={r.m.leagueId} row={r} i={i} ahead={ahead} />
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
   * ordered BY margin would rank it against a number it does not have. It is
   * counted in the note instead.
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

  const shown = leading.length + trailing.length
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

      <p className="af-bd-note">
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
          ? ` The PO column is a simulated playoff probability over the remaining schedule; a league below ${DEAD_PATH_PCT}% is left out of the trailing column.`
          : ' The playoff filter did not run this time, so the trailing column is every league you are behind in — not only the ones still live.'}
      </p>

      {/*
        ⚠ EVERYTHING THE COLUMNS DID NOT SHOW IS ACCOUNTED FOR BY REASON. Four
        different absences — no schedule, no projection, no playoff path, simply
        below the cut — and collapsing them into one number is how a board stops
        being trustworthy at sixty leagues.
      */}
      {dead > 0 || board.unprojected.length > 0 || board.withoutSchedule > 0 ? (
        <p className="af-bd-note">
          {dead > 0 ? (
            <>
              <strong>
                {dead} {dead === 1 ? 'league is' : 'leagues are'} behind with no realistic
                playoff path
              </strong>{' '}
              and are left out of the trailing column.{' '}
            </>
          ) : null}
          {board.unprojected.length > 0
            ? `${board.unprojected.length} could not be projected — too few completed weeks on one side or the other. `
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
