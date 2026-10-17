'use client'

import Link from 'next/link'
import { matchupCloseness } from '@/lib/core-app/weeklyBlueprint'
import { FormatWeekCards } from '@/components/core-app/FormatWeekCards'
import { WeekDateRange } from '@/components/core-app/WeekDateRange'

import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import type { WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WeekLineups } from '@/lib/core-app/weekLineups'
import { WeekLineupLine } from '@/components/core-app/screens/WeekLineupLine'
/*
 * ⚠ THE THRESHOLD, FROM THE SHARED RULES MODULE — NOT FROM `weekBoard.ts`.
 * That loader is `server-only`; importing a VALUE from it pulls prisma into the
 * bundle and takes the whole /core catch-all down at build time. The type import
 * above is fine because types are erased. See weekBoardRules.ts's header, which
 * exists for precisely this trap.
 */
import { MIN_WEEKS_FOR_PROJECTION } from '@/lib/core-app/weekBoardRules'
import { rosterLabel } from '@/lib/core-app/managerName'
// Client-safe: eliminationSettle.ts has no runtime imports (its one import is a type).
import { settleBadge } from '@/lib/core-app/eliminationSettle'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  SectionHead,
  columnsTooUneven,
  NoLeaguesYet,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/** Universal weekly priorities, then unitless matchup closeness. No playoff-odds exclusion. */

export type WeekBoardProps = {
  priorityLeagueIds?: string[]
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
  /** This week's AF and API lineup projections — the rail's read. Optional; absent draws none. */
  lineups?: WeekLineups | null
}

/** Label a long shot without asserting mathematical elimination. */
const LONG_SHOT_PCT = 5

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
  return pct == null ? '—' : pct > 0 && pct < 1 ? '<1%' : pct > 99 && pct < 100 ? '>99%' : `${Math.round(pct)}%`
}

/*
 * 2026-09-13 handoff: one compact row per matchup — crest, league over
 * "vs opponent · N% playoff odds", and the historical scoring estimate as the single value
 * on the right.
 *
 * ⚠ NOTHING THE OLD ROW SAID IS GONE, IT MOVED. The rank numeral is dropped (the
 * section label already states the order); the playoff % moved into the sub
 * line; "% to win" sits under the margin; and "historical scoring estimate" is the value's
 * accessible name, because a bare "+38.2" beside a league reads as a score.
 */
function MatchRow({ row, ahead, lineups }: { row: Row; ahead: boolean; lineups?: WeekLineups | null }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const { m } = row
  const abs = Math.abs(row.margin).toFixed(1)
  const win = Math.round(m.projection ? m.projection.winProbability * 100 : 0)
  const sign = abs === '0.0' ? '' : ahead ? '+' : '−'
  /*
   * A scored week says what happened; it no longer carries the pre-week probability, which
   * describes a game that has since been played. See `WeekMatchup.live`.
   */
  const live = m.live
  const result = live?.final ? (live.margin > 0 ? 'won' : live.margin < 0 ? 'lost' : 'tied') : null
  const valueSub = live ? coreUiCopy(result ?? 'so far', language) : es ? `${win}% de ganar` : `${win}% to win`
  const valueLabel = es
    ? live ? `${sign}${abs} en el marcador, ${live.you.toFixed(1)} a ${live.them.toFixed(1)}${result ? ` — ${coreUiCopy(result, language)}` : ' hasta ahora'}` : `${sign}${abs} de diferencia histórica estimada, ${win}% de ganar según el historial`
    : live ? `${sign}${abs} on the scoreboard, ${live.you.toFixed(1)} to ${live.them.toFixed(1)}${result ? ` — you ${result}` : ' so far'}` : `${sign}${abs} historical scoring estimate, ${win}% to win`
  return (
    <li>
      <Link className="af-bd-row" href={m.href}>
        {/* Already a loadable URL (the loader ran it through `leagueArtUrl`); null draws the monogram. */}
        <LeagueCrest imageUrl={m.leagueImageUrl} name={m.leagueName} platform={m.platform} size="sm" />
        <span className="af-bd-league">
          <span className="af-bd-name">{m.leagueName}</span>
          <span className="af-bd-sub">{m.season} · {es ? 'Período' : 'Period'} {m.week}</span>
          <span className="af-bd-sub">
            {/*
              ⚠ NEVER AN INVENTED MANAGER. `WeekOpponent.name` is null when no
              real name is stored (the importer writes "Unknown" for an unowned
              roster); borrowing the league's name would invent one. The roster
              is then "Team N" — the platform's own label, and the same one the
              home and Matchup board print (`rosterLabel`).
            */}
            {`${coreUiCopy('vs', language)} ${rosterLabel([m.opponent.name], m.opponent.rosterId)}`}
            {row.playoffPct != null ? es ? ` · ${pctLabel(row.playoffPct)} de entrar en playoffs${row.playoffPct > 0 && row.playoffPct < LONG_SHOT_PCT ? ' · pocas probabilidades' : ''}` : ` · ${pctLabel(row.playoffPct)} playoff odds${row.playoffPct > 0 && row.playoffPct < LONG_SHOT_PCT ? ' · long shot' : ''}` : ''}
            {m.elimination ? es ? ' · se elimina la puntuación más baja' : ' · lowest score is eliminated' : ''}
          </span>
          <WeekLineupLine lineups={lineups} leagueId={m.leagueId} season={m.season} week={m.week} />
        </span>
        <span
          className="af-bd-val"
          data-sev={ahead ? 'good' : 'bad'}
          aria-label={valueLabel}
          title={coreUiCopy(live ? 'Scored margin this week' : 'Historical scoring estimate this period', language)}
        >
          <span aria-hidden>
            {sign}
            {abs}
          </span>
          <span className="af-bd-val-sub" aria-hidden>
            {valueSub}
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
  lineups,
}: {
  label: string
  rows: Row[]
  ahead: boolean
  quiet: string
  lineups?: WeekLineups | null
}) {
  return (
    <section className="af-bd-sec">
      <SectionHead label={label} tone={ahead ? 'good' : 'bad'} />
      {rows.length > 0 ? (
        <ul className="af-bd-rows af-bd-rows--compact">
          {rows.map((r) => (
            <MatchRow key={r.m.leagueId} row={r} ahead={ahead} lineups={lineups} />
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
  lineups,
  priorityLeagueIds = [],
}: WeekBoardProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const pctByLeague = new Map<string, number>()
  if (outlook) {
    for (const l of outlook.leagues) {
      if (l.you?.modelled) pctByLeague.set(l.leagueId, l.you.playoffPct)
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
  /*
   * 🛑 ONCE THE WEEK HAS POINTS, THE COLUMNS RANK ON THEM. See `WeekMatchup.live`: on a Monday this
   * board said "+29.6 · 78% to win" for a league /core/matchup had at +68.0 on the scoreboard.
   * A league with a score but too little history for a projection joins the columns too — it has a
   * real margin now, which is exactly what it lacked.
   */
  const projected: Row[] = [...board.coinFlips, ...board.leaning, ...board.unprojected]
    .filter((m) => m.live != null || m.projection != null)
    .map((m) => ({
      m,
      margin: m.live ? m.live.margin : m.projection!.margin,
      playoffPct: pctByLeague.has(m.leagueId) ? (pctByLeague.get(m.leagueId) as number) : null,
    }))
  /* The "not enough history" section keeps only the matchups that still have nothing to rank on. */
  const unprojected = board.unprojected.filter((m) => m.live == null)

  const priorityIndex = (id: string) => { const i = priorityLeagueIds.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
  const byAttention = (a: Row, b: Row) => priorityIndex(a.m.leagueId) - priorityIndex(b.m.leagueId)
    || matchupCloseness(a.m) - matchupCloseness(b.m) || a.m.leagueName.localeCompare(b.m.leagueName)
  const leading = projected.filter(r => r.margin > 0).sort(byAttention).slice(0, 5)
  const behind = projected.filter(r => r.margin <= 0)
  const trailing = [...behind].sort(byAttention).slice(0, 5)

  /*
   * ⚠ THE THIRD SECTION COUNTS TOWARDS `shown`, OR THE FOOTER LIES. `FooterSummary`
   * prints `considered − shown` as "N more sit between these two columns"; leaving
   * the listed unprojectable rows out would count ten leagues as hidden while they
   * are on screen, immediately above the sentence saying so.
   */
  const shown =
    leading.length +
    trailing.length +
    Math.min(unprojected.length, UNPROJECTED_SHOWN) +
    /*
     * ⚠ THE FOURTH SECTION TOO, FOR THE REASON DIRECTLY ABOVE — and it is listed in
     * full rather than capped, so the whole length counts. These leagues used to be
     * invisible here AND absent from every term of this sum, so the footer's
     * "N more sit between these two columns" quietly absorbed them.
     */
    board.eliminationWeeks.length + (board.formatWeeks?.length ?? 0)
  const considered = Math.max(
    totalLeagues,
    board.coinFlips.length +
      board.leaning.length +
      board.unprojected.length +
      board.eliminationWeeks.length +
      board.withoutSchedule,
  )

  /* No leagues on this account yet: say so and offer a way forward (BoardKit NoLeaguesYet). */
  if (totalLeagues === 0) {
    return (
      <div className="af-bd">
        <div className="af-label" style={{ marginBottom: 8 }}><WeekDateRange /></div>
        <BoardHead eyebrow={copy('Core · Your week')} title={copy('Your week')} blurb={es ? 'Tus prioridades primero; después, enfrentamientos ajustados dentro de la puntuación de cada liga. Todas las ligas siguen disponibles.' : 'Your priorities first, then close matchups within each league’s scoring. Every league stays available.'} />
        <NoLeaguesYet what={copy("Once one is, this board shows the leagues you lead and trail in this week's matchups.")} language={language} />
      </div>
    )
  }

  return (
    <div className="af-bd">
      <div className="af-label" style={{ marginBottom: 8 }}><WeekDateRange /></div>
      <BoardHead
        eyebrow={copy('Core · Your week')}
        title={copy('Your week')}
        blurb={es ? 'Tus prioridades primero; después, enfrentamientos ajustados dentro de la puntuación de cada liga. Todas las ligas siguen disponibles.' : 'Your priorities first, then close matchups within each league’s scoring. Every league stays available.'}
      />

      <div
        className="af-bd-split"
        data-stack={columnsTooUneven(leading.length, trailing.length) || undefined}
      >
        <Column
          label={es ? 'Por delante · primeras 5' : 'Leading · first 5'}
          rows={leading}
          ahead
          quiet={es ? 'Ninguna liga está por delante en el marcador o la estimación histórica disponible.' : 'No league is ahead on its available scoreboard or historical estimate.'}
          lineups={lineups}
        />
        <Column
          label={es ? 'Por detrás · primeras 5' : 'Trailing · first 5'}
          rows={trailing}
          ahead={false}
          lineups={lineups}
          quiet={es ? 'Ninguna liga está por detrás en sus datos disponibles.' : 'No league is behind on its available data.'}
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
        THAT SHAPES THIS. Those columns require a live score or historical estimate and an
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
      {unprojected.length > 0 ? (
        <section className="af-bd-sec">
          <SectionHead
            label={copy('On the schedule · not enough history to call')}
            count={
              unprojected.length > UNPROJECTED_SHOWN
                ? es ? `${UNPROJECTED_SHOWN} de ${unprojected.length}` : `${UNPROJECTED_SHOWN} of ${unprojected.length}`
                : `${unprojected.length}`
            }
          />
          <ul className="af-bd-rows af-bd-rows--compact">
            {unprojected.slice(0, UNPROJECTED_SHOWN).map((m) => (
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
                    <span className="af-bd-sub">{m.season} · {es ? 'Período' : 'Period'} {m.week}</span>
                    <span className="af-bd-sub">
                      {/* Same rule as MatchRow: a real name, else the roster's own "Team N". */}
                      {`${copy('vs')} ${rosterLabel([m.opponent.name], m.opponent.rosterId)}`}
                      {m.elimination ? es ? ' · se elimina la puntuación más baja' : ' · lowest score is eliminated' : ''}
                      {/*
                        The averages behind the value column, so the number is
                        readable rather than asserted. Only when form exists —
                        see the value column below for why the two cases differ.
                      */}
                      {m.form
                        ? es ? ` · ${m.form.you.toFixed(1)} a ${m.form.them.toFixed(1)} por semana` : ` · ${m.form.you.toFixed(1)} to ${m.form.them.toFixed(1)} per week`
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
                      aria-label={es ? `Promedias ${m.form.you.toFixed(1)} puntos por semana frente a ${m.form.them.toFixed(1)} de tu rival, durante ${m.form.weeks} semanas puntuadas; es una tendencia, no una proyección` : `You have averaged ${m.form.you.toFixed(1)} points a week to their ${m.form.them.toFixed(1)}, over ${m.form.weeks} scored ${m.form.weeks === 1 ? 'week' : 'weeks'} — form so far, not a projection`}
                    >
                      <span className="af-num" aria-hidden>
                        {m.form.margin >= 0 ? '+' : '−'}
                        {Math.abs(m.form.margin).toFixed(1)}
                      </span>
                      <span className="af-bd-val-sub" aria-hidden>
                        {copy('so far')} · {m.form.weeks}{es ? ' sem.' : 'wk'}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="af-bd-val af-bd-val--seed"
                      aria-label={es ? `${m.yourSampleWeeks} de ${MIN_WEEKS_FOR_PROJECTION} semanas completas necesarias para pronosticar este enfrentamiento` : `${m.yourSampleWeeks} of ${MIN_WEEKS_FOR_PROJECTION} completed weeks needed to project this matchup`}
                    >
                      <span aria-hidden>
                        {m.yourSampleWeeks}/{MIN_WEEKS_FOR_PROJECTION}
                      </span>
                      <span className="af-bd-val-sub" aria-hidden>
                        {copy('weeks on file')}
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        ── Leagues with no opponent ─────────────────────────────────────────

        🛑 NOT A TIER OF THE TWO COLUMNS ABOVE, AND IT CANNOT BE. "Leading" and
        "trailing" are head-to-head readings; a guillotine league has no opponent
        to lead, so these leagues reached neither column and — because
        `pairRows` never built a card for them at all — reached no section
        either. They were absent from this board while carrying a full set of
        scored rows. See `buildEliminationWeeks`.

        The value column is points clear of the cut line, which is the same
        question "margin" asks in a head-to-head: how much room do you have.
      */}
      {board.eliminationWeeks.length > 0 ? (
        <section className="af-bd-sec">
          <SectionHead
            label={copy('No opponent · lowest score is out')}
            count={`${board.eliminationWeeks.length}`}
          />
          <ul className="af-bd-rows af-bd-rows--compact">
            {board.eliminationWeeks.map((e) => (
              <li key={e.leagueId}>
                <Link className="af-bd-row" href={e.href}>
                  <LeagueCrest
                    imageUrl={e.leagueImageUrl}
                    name={e.leagueName}
                    platform={e.platform}
                    size="sm"
                  />
                  <span className="af-bd-league">
                    <span className="af-bd-name">{e.leagueName}</span>
                    <span className="af-bd-sub">{e.season} · {es ? 'Período' : 'Period'} {e.week}</span>
                    <span className="af-bd-sub">
                      {e.fieldSize === 0
                        ? copy('no scores in yet this week')
                        : es
                          ? `${e.rank != null ? `${e.rank}.º de ${e.fieldSize}` : `${e.fieldSize} con puntos`}${e.cutLine != null ? ` · corte ${e.cutLine.toFixed(1)}` : ''}`
                          : `${e.rank != null ? `${e.rank} of ${e.fieldSize}` : `${e.fieldSize} scored`}${e.cutLine != null ? ` · cut line ${e.cutLine.toFixed(1)}` : ''}`}
                    </span>
                  </span>
                  {/*
                    ⚠ THREE STATES. A week with nothing scored is neither "clear"
                    nor "out", and rendering it as +0.0 would read as safe by a
                    hair when in fact nobody has played — the same refusal the
                    form column above makes for a matchup with no scored week.
                  */}
                  {e.margin == null ? (
                    <span
                      className="af-bd-val af-bd-val--seed"
                      aria-label={copy('No scores are in for this week yet, so there is no cut line')}
                    >
                      <span aria-hidden>—</span>
                      <span className="af-bd-val-sub" aria-hidden>
                        {copy('not started')}
                      </span>
                    </span>
                  ) : (() => {
                    /*
                      A settled week says so: "SAFE · decided" rather than "+41.2 clear" for
                      a user who cannot be chopped, and "N to play" while it is still open.
                    */
                    const badge = settleBadge(e.settle)
                    const settle = e.settle
                    const spanishBadge = es && settle ? (() => {
                      switch (settle.verdict) {
                        case 'safe': return { sub: 'decidido', aria: 'A salvo esta semana: tus titulares y suficientes equipos por debajo ya terminaron' }
                        case 'chopped': return { sub: 'decidido', aria: 'Todos los equipos terminaron y el tuyo quedó eliminado esta semana' }
                        case 'no_chop': return { sub: 'sin eliminación esta semana', aria: 'Nadie queda eliminado esta semana' }
                        case 'open': {
                          const pending = settle.yourUpcoming + settle.yourLive
                          if (pending > 0) return { sub: `${pending} por jugar`, aria: `${pending} de tus titulares aún deben terminar` }
                          if (settle.cutLinePending) return { sub: 'el último equipo sigue jugando', aria: `Tus titulares terminaron; al equipo más bajo le faltan ${settle.cutLinePending} por terminar` }
                          return null
                        }
                      }
                    })() : null
                    const margin = e.margin ?? 0 // non-null on this branch; closures lose the narrowing
                    return (
                      <span
                        className="af-bd-val af-bd-val--form"
                        data-tone={badge?.tone ?? (e.onTheBlock ? 'down' : 'up')}
                        data-settled={badge?.sub === 'decided' ? 'true' : undefined}
                        aria-label={
                          (es
                            ? e.onTheBlock ? `Tus ${e.yourScore?.toFixed(1)} puntos son la puntuación más baja entre ${e.fieldSize} equipos; por ahora quedas eliminado` : `Tus ${e.yourScore?.toFixed(1)} puntos están ${margin.toFixed(1)} por encima del corte de ${e.cutLine?.toFixed(1)}`
                            : e.onTheBlock ? `Your ${e.yourScore?.toFixed(1)} is the lowest score in a field of ${e.fieldSize} — you are the one eliminated as it stands` : `Your ${e.yourScore?.toFixed(1)} is ${margin.toFixed(1)} points clear of the cut line of ${e.cutLine?.toFixed(1)}`) +
                          (badge ? `. ${spanishBadge?.aria ?? badge.aria}` : '')
                        }
                      >
                        <span className="af-num" aria-hidden>
                          {badge?.label ? copy(badge.label) : e.onTheBlock ? copy('OUT') : `+${margin.toFixed(1)}`}
                        </span>
                        <span className="af-bd-val-sub" aria-hidden>
                          {spanishBadge?.sub ?? copy(badge?.sub ?? (e.onTheBlock ? 'on the block' : 'clear'))}
                        </span>
                      </span>
                    )
                  })()}
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
          ? /* `basis` is whole sentences, so the sample is its own sentence too — splicing it in as
               a clause read "…completed weeks — Projected from … A heuristic, not a simulation., fitted
               on 40,396 roster-weeks." on production, 2026-09-28. */
            `${copy(board.model.basis)} ${es ? 'Modelo ajustado con' : 'Fitted on'} ${board.model.sampleSize.toLocaleString()} ${es ? 'semanas de equipos.' : 'roster-weeks.'}`
          : copy(board.model.basis)}{' '}
        {/* Said once, here, because the rows no longer say "projected" once a week has points. */}
        {copy("Once a league's week has points on the board, its margin is the actual score, not a projection.")}{' '}
        {es ? ' Las probabilidades bajas no ocultan ligas ni prueban una eliminación matemática. Los márgenes de deportes distintos no se comparan entre sí.' : ' Low playoff odds never hide leagues or prove mathematical elimination. Point margins from different sports are not compared with each other.'}
      </p>

      {/*
        ⚠ EVERYTHING THE COLUMNS DID NOT SHOW IS ACCOUNTED FOR BY REASON. Four
        different absences — no schedule, no projection, no playoff path, simply
        below the cut — and collapsing them into one number is how a board stops
        being trustworthy at sixty leagues.
      */}
      {unprojected.length > UNPROJECTED_SHOWN || board.withoutSchedule > 0 ? (
        <p className="af-bd-note af-bd-note--plain">
          {/*
            ⚠ THE SENTENCE HAD TO CHANGE WHEN THE SECTION ABOVE STARTED LISTING
            THEM. "47 could not be projected" over a list of ten of those very
            matchups reads as a second, larger population the board is still
            hiding. The count is now explicitly the REMAINDER, and disappears
            when the section showed all of them.
          */}
          {unprojected.length > UNPROJECTED_SHOWN
            ? es ? `${unprojected.length - UNPROJECTED_SHOWN} más no tienen pronóstico porque faltan semanas completas de uno o ambos equipos. ` : `${unprojected.length - UNPROJECTED_SHOWN} more could not be projected either — too few completed weeks on one side or the other. `
            : ''}
          {board.withoutSchedule > 0
            ? es ? `${board.withoutSchedule} no tienen calendario esta semana.` : `${board.withoutSchedule} carry no schedule for this week at all.`
            : ''}
        </p>
      ) : null}

      <FormatWeekCards weeks={board.formatWeeks ?? []} />
      <div className="af-bd-foot">
        <p className="af-bd-foot-text">
          {copy("All-time head-to-head against this week's opponents.")}
        </p>
        <Link className="af-bd-foot-cta" href={rivalriesHref}>
          {copy('Rivalry radar')} &rarr;
        </Link>
      </div>

      <FooterSummary
        hidden={Math.max(0, considered - shown)}
        total={considered}
        href={allHref}
        quiet={copy('sit between these two columns, or have no game we can project this week.')}
        language={language}
      />
    </div>
  )
}

export default WeekBoard
