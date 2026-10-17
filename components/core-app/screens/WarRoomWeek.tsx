'use client'

import Link from 'next/link'

import '@/components/core-app/af-wr-week.css'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import { lineupProjectionFor, type WeekLineups } from '@/lib/core-app/weekLineups'
import { WeekLineupLine } from '@/components/core-app/screens/WeekLineupLine'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "This week across your leagues" — the War Room's glance at every matchup, on the cross-league view.
 *
 * ⚠ NOT A SECOND MATCHUP BOARD. `/core/matchup` (no league) already ranks every matchup by win
 * probability, and that number has exactly one source (aa348bc48). This strip prints only what the
 * shell's rail read already holds — scores, and the lineup projections `WeekLineupLine` draws on Your
 * Week — and hands the ranking to that board. Game Plan's header names the trap: two screens
 * answering one question means one of them is redundant.
 *
 * ⚠ NO QUERY. `weekLineups` is the rail's `getRailMatchups` result, read once per render for the
 * shell and handed down (CoreScreenContext.weekLineups). A null here is a failed rail read, and the
 * strip says nothing rather than claiming a quiet week.
 *
 * Copies the rail's rules rather than inventing new ones: a dash, never 0.0, on an unplayed fixture;
 * "last import" when the row is a history fallback; and an elimination week shows your rank and the
 * cut, because there is no opponent.
 */

export type WarRoomWeekLeague = { id: string; name: string }

type Row = { league: WarRoomWeekLeague; m: RailMatchup; margin: number | null }

/**
 * You minus them: the live/final score once played, else the AF lineup projection, else the provider's.
 *
 * 🛑 PROJECTIONS ONLY FOR THIS ROW'S OWN WEEK, through `lineupProjectionFor`. This read the rail's
 * projections directly, and the rail's feed can hold a DIFFERENT week from a league's matchup — on the
 * live page (2026-10-03) a league already on week 5 was ranked by week-4 projections, sorted to the top
 * as the matchup you were losing worst, beside a "Not started" status. The helper refuses a total for
 * the wrong week; WeekLineupLine already used it, so the line and the sort now agree.
 */
function marginOf(m: RailMatchup, lineups: WeekLineups): number | null {
  if (m.unpaired) return null
  if (m.scored) return m.yourScore - m.opponentScore
  const v = lineupProjectionFor(lineups, m.leagueId, m.season, m.week)
  const pair = v?.af && v.af.you != null && v.af.them != null ? v.af : v?.api && v.api.you != null && v.api.them != null ? v.api : null
  return pair ? pair.you! - pair.them! : null
}

/** The week most of your leagues are on — leagues can number their weeks differently. */
function commonWeek(rows: ReadonlyArray<{ m: RailMatchup }>): number {
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.m.week, (counts.get(r.m.week) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]
}

const pts = (n: number) => n.toFixed(1)

/**
 * ⚠ A CLIENT COMPONENT, FOR THE LANGUAGE. It rendered on the server, where the switch (client state)
 * cannot be read, so the strip stayed English in Spanish mode (2026-10-03 audit). Its imports are all
 * client-safe — `WeekLineupLine`, which it already rendered, is a client component itself.
 */
function useEs(): boolean {
  return useOptionalLanguage().language === 'es'
}

function Status({ m, margin }: { m: RailMatchup; margin: number | null }) {
  const es = useEs()
  if (m.unpaired) {
    // Chopped: say so — "No head-to-head this week" read as a quiet week in a league you are out of.
    if (m.eliminated) return <span className="af-wrw-status">{es ? 'Te eliminaron' : 'You were chopped'}</span>
    const s = m.standing
    if (!s) return <span className="af-wrw-status">{es ? 'Sin enfrentamiento directo esta semana' : 'No head-to-head this week'}</span>
    return (
      <span className="af-wrw-status af-num" data-tone={s.elimination && s.overCut == null ? 'bad' : undefined}>
        {s.elimination ? (es ? 'Semana de eliminación · ' : 'Elimination week · ') : ''}#{s.rank} {es ? 'de' : 'of'} {s.outOf}
        {s.elimination
          ? s.overCut == null
            ? es
              ? ' · en el corte'
              : ' · at the cut'
            : es
              ? ` · ${pts(s.overCut)} por encima del corte`
              : ` · ${pts(s.overCut)} over the cut`
          : ''}
        {s.basis === 'projected' ? (es ? ' (proyectado)' : ' (projected)') : ''}
      </span>
    )
  }
  if (!m.scored) {
    return <span className="af-wrw-status">{es ? 'Sin empezar' : 'Not started'}</span>
  }
  const tone = margin == null || Math.abs(margin) < 0.05 ? undefined : margin > 0 ? 'good' : 'bad'
  return (
    <span className="af-wrw-status af-num" data-tone={tone}>
      <span className="af-wrw-score">
        {pts(m.yourScore)}–{pts(m.opponentScore)}
      </span>{' '}
      {margin == null || Math.abs(margin) < 0.05
        ? es
          ? 'empatados'
          : 'level'
        : margin > 0
          ? es
            ? `ganando por ${pts(margin)}`
            : `ahead by ${pts(margin)}`
          : es
            ? `perdiendo por ${pts(-margin)}`
            : `behind by ${pts(-margin)}`}
      {m.source === 'history_fallback' ? (es ? ' · última importación' : ' · last import') : ''}
    </span>
  )
}

export function WarRoomWeek({
  lineups,
  leagues,
  boardHref,
}: {
  lineups: WeekLineups | null
  leagues: WarRoomWeekLeague[]
  /** The all-leagues matchup board; a row links to it with `?league=`. */
  boardHref: string
}) {
  const es = useEs()
  if (!lineups) return null
  const rows: Row[] = leagues
    .flatMap((league) => {
      const m = lineups.byLeague[league.id]
      return m ? [{ league, m, margin: marginOf(m, lineups) }] : []
    })
    /*
     * Most behind first: this is the War Room, and the matchup you are losing is the one to look at.
     * A row with no margin (unpaired, or nothing priced) follows, then name order.
     */
    .sort((a, b) => {
      if (a.margin == null || b.margin == null) return a.margin == null ? (b.margin == null ? a.league.name.localeCompare(b.league.name) : 1) : -1
      return a.margin - b.margin
    })
  if (rows.length === 0) return null

  /*
   * 🛑 THE HEADER TOOK `rows[0].m.week` — whichever league sorted first. On the live page that printed
   * "Week 5 across your leagues" under Game Plan's "Week 4", with Your Week also saying week 4. It now
   * names the week most leagues are on, and a league on another week says so on its own row.
   */
  const week = commonWeek(rows)
  const otherWeek = rows.filter((r) => r.m.week !== week).length
  const behind = rows.filter((r) => r.margin != null && r.margin < -0.05).length
  const ahead = rows.filter((r) => r.margin != null && r.margin > 0.05).length
  /* The cut-line "?" only when a row actually prints a rank against the cut (Status above). */
  const showsCut = rows.some((r) => r.m.unpaired && !r.m.eliminated && r.m.standing?.elimination)

  return (
    <section className="af-wrw" aria-labelledby="af-wrw-h">
      <header className="af-wrw-head">
        {/*
          The "?" sits BESIDE the heading, not inside it: the heading names this section through
          aria-labelledby, and a button inside it would read into that name. Grouped so the head's
          space-between keeps the tip next to the words it explains.
        */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <h2 className="af-label" id="af-wrw-h">
            {es ? `Semana ${week} en tus ligas` : `Week ${week} across your leagues`}
          </h2>
          <TopicTip topic="warRoomWeekMargins" />
        </div>
        <span className="af-wrw-note af-num">
          {rows.length} {es ? (rows.length === 1 ? 'enfrentamiento' : 'enfrentamientos') : rows.length === 1 ? 'matchup' : 'matchups'}
          {ahead + behind > 0 ? (es ? ` · ganando en ${ahead}, perdiendo en ${behind}` : ` · ahead in ${ahead}, behind in ${behind}`) : ''}
          {otherWeek > 0 ? (es ? ` · ${otherWeek} en otra semana` : ` · ${otherWeek} on another week`) : ''}
          {showsCut ? (
            <>
              {' '}
              <TopicTip topic="eliminationCutLine" />
            </>
          ) : null}
        </span>
      </header>
      <ul className="af-wrw-list">
        {rows.map(({ league, m, margin }) => (
          <li key={league.id}>
            <Link className="af-wrw-row" href={`${boardHref}?league=${encodeURIComponent(league.id)}`}>
              <span className="af-wrw-league">
                {league.name}
                {m.week !== week ? <span className="af-wrw-weektag af-num"> · {es ? 'semana' : 'week'} {m.week}</span> : null}
              </span>
              <span className="af-wrw-vs">
                {m.unpaired
                  ? (m.yourTeam ?? (es ? 'Tu equipo' : 'Your team'))
                  : `${m.yourTeam ?? (es ? 'Tú' : 'You')} vs ${m.opponentTeam ?? (es ? 'un equipo sin nombre' : 'an unnamed team')}`}
              </span>
              <Status m={m} margin={margin} />
              <WeekLineupLine lineups={lineups} leagueId={league.id} season={m.season} week={m.week} />
            </Link>
          </li>
        ))}
      </ul>
      <Link className="af-wrw-board" href={boardHref}>
        {es ? 'Todos los enfrentamientos, por probabilidad de ganar' : 'Every matchup, ranked by win probability'} &rarr;
      </Link>
    </section>
  )
}

export default WarRoomWeek
