'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  explainOrder,
  formatRecord,
  type BoardTeam,
  type StandingsBoard,
  type Zone,
} from '@/lib/core-app/standingsModel'
import {
  DEFAULT_STANDINGS_SORT,
  serializeStandingsView,
  SORT_DEFAULT_DIR,
  STANDINGS_VIEW_PARAMS,
  type StandingsLayout,
  type StandingsSort,
  type StandingsSortKey,
  type StandingsViewKey,
  type StandingsViewState,
} from '@/lib/core-app/standingsView'
import { sortTeams } from '@/lib/core-app/standingsSort'
import { formatOdds, type StandingsOdds } from '@/lib/core-app/standingsOdds'
import { StandingsHistoryChart } from './StandingsHistoryChart'
import { StandingsPointsChart } from './StandingsPointsChart'

/**
 * The league table, two ways — items 1–8 and 10 of the 2026-09-17 standings brief.
 *
 * ⚠ OFFICIAL AND POWER ARE DIFFERENT QUESTIONS AND LOOK DIFFERENT. The official table carries the
 * playoff line and the tiebreaks; the power table carries all-play and expected wins and says, in its own
 * header, that it is our analysis. Projected records appear only in the official table, hatched and
 * labelled as a model, so a projection is never read as a result.
 *
 * ⚠ THE CARD LAYOUT IS THE SAME DATA, NOT A SUMMARY. Someone who cannot use a dense table loses nothing
 * by switching: every column is a labelled line on the card.
 */

const ZONE: Record<Zone, { label: string; icon: string }> = {
  bye: { label: 'Bye', icon: '★' },
  playoff: { label: 'Playoffs', icon: '●' },
  bubble: { label: 'Bubble', icon: '◐' },
  out: { label: 'Out', icon: '○' },
  eliminated: { label: 'Eliminated', icon: '✕' },
}

const LAYOUT_STORAGE_KEY = 'af-standings-layout'

function pts(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function pct(v: number | null): string {
  return v == null ? '—' : v.toFixed(3).replace(/^0/, '')
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function gamesBackText(gb: number | null): string {
  if (gb == null) return '—'
  if (gb === 0) return '–'
  const abs = Math.abs(gb)
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return gb < 0 ? `+${text}` : text
}

function ZoneChip({ team }: { team: BoardTeam }) {
  const zone = ZONE[team.zone]
  const clinched = team.clinched === 'bye' ? 'Clinched bye' : team.clinched === 'playoff' ? 'Clinched' : null
  return (
    <span className="af-stb-zone" data-zone={team.zone} data-clinched={clinched ? 'true' : undefined}>
      <span aria-hidden>{clinched ? '✓' : zone.icon}</span>
      {clinched ?? zone.label}
    </span>
  )
}

export function Move({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="af-stb-move" data-dir="none">
        <span aria-hidden>—</span>
        <span className="af-sr">no earlier week</span>
      </span>
    )
  }
  if (value === 0) {
    return (
      <span className="af-stb-move" data-dir="flat">
        <span aria-hidden>–</span>
        <span className="af-sr">no change</span>
      </span>
    )
  }
  const up = value > 0
  return (
    <span className="af-stb-move" data-dir={up ? 'up' : 'down'}>
      <span aria-hidden>
        {up ? '▲' : '▼'}
        {Math.abs(value)}
      </span>
      <span className="af-sr">
        {up ? 'up' : 'down'} {Math.abs(value)} {Math.abs(value) === 1 ? 'place' : 'places'}
      </span>
    </span>
  )
}

function Form({ form }: { form: BoardTeam['form'] }) {
  if (form.length === 0) return <span className="af-stb-muted">—</span>
  return (
    <span className="af-stb-form" aria-label={`Last ${form.length}: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <i key={i} data-r={r} aria-hidden>
          {r}
        </i>
      ))}
    </span>
  )
}

function TeamCell({ team, showTiebreak }: { team: BoardTeam; showTiebreak: boolean }) {
  return (
    <span className="af-stb-team">
      {team.avatarUrl ? (
        // Provider avatars come from arbitrary CDNs; a plain image keeps them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.avatarUrl} alt="" loading="lazy" />
      ) : (
        <span className="af-stb-avatar" aria-hidden>
          {team.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="af-stb-teamtext">
        <span className="af-stb-teamname">{team.name}</span>
        {team.isYou ? <span className="af-stb-you">You</span> : null}
        {showTiebreak && team.tiebreak ? (
          <details className="af-stb-tb">
            <summary>Tiebreak</summary>
            <p>{team.tiebreak}</p>
          </details>
        ) : null}
      </span>
    </span>
  )
}

/** This table's own certainty — never the simulation's, which does not model median games. */
function boardStatus(t: BoardTeam): 'clinched' | 'eliminated' | null {
  if (t.clinched) return 'clinched'
  return t.zone === 'eliminated' ? 'eliminated' : null
}

/** The same thresholds the cross-league standings board colours its odds by. */
function oddsTone(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= 60) return 'good'
  if (pct >= 25) return 'warn'
  return 'bad'
}

function OddsCell({ team, odds }: { team: BoardTeam; odds: StandingsOdds }) {
  const o = odds.byRoster[team.rosterId]
  if (!o) return <span className="af-stb-muted">—</span>
  const status = boardStatus(team)
  const fill = status === 'clinched' ? 100 : status === 'eliminated' ? 0 : Math.max(0, Math.min(100, o.playoffPct))
  const tone = status === 'clinched' ? 'good' : status === 'eliminated' ? 'bad' : oddsTone(o.playoffPct)
  return (
    <span className="af-stb-odds" data-tone={tone}>
      <span className="af-stb-oddsbar" aria-hidden>
        <i style={{ width: `${fill.toFixed(1)}%` }} />
      </span>
      <span className="af-num">
        {formatOdds(o.playoffPct, status)}
        {!o.modelled && !status ? (
          <abbr title="Too few completed weeks to model this team — read the record, not the number">*</abbr>
        ) : null}
      </span>
    </span>
  )
}

function sosTone(rank: number, of: number): 'hard' | 'easy' | undefined {
  if (of < 3) return undefined
  if (rank <= Math.ceil(of / 3)) return 'hard'
  if (rank > of - Math.ceil(of / 3)) return 'easy'
  return undefined
}

function sosTitle(o: StandingsOdds['byRoster'][string], odds: StandingsOdds): string {
  if (o.sosRank == null) return 'No modelled opponents left to rank'
  const avg =
    o.sosOpponentMu != null && odds.leagueMu != null
      ? ` Opponents left average ${o.sosOpponentMu.toFixed(1)} a week; the league averages ${odds.leagueMu.toFixed(1)}.`
      : ''
  return `${ordinal(o.sosRank)}-hardest remaining schedule of ${odds.sosRanked}.${avg}`
}

function SosCell({ team, odds }: { team: BoardTeam; odds: StandingsOdds }) {
  const o = odds.byRoster[team.rosterId]
  if (!o || o.sosRank == null) return <span className="af-stb-muted">—</span>
  return (
    <span className="af-stb-sos af-num" data-tone={sosTone(o.sosRank, odds.sosRanked)} title={sosTitle(o, odds)}>
      {ordinal(o.sosRank)}
      <span className="af-sr"> hardest of {odds.sosRanked}</span>
    </span>
  )
}

function NextCell({ team, seedOf }: { team: BoardTeam; seedOf: Map<string, number> }) {
  const n = team.next
  if (!n) return <span className="af-stb-muted">—</span>
  const seed = seedOf.get(n.opponentId)
  return (
    <span className="af-stb-next">
      {n.inProgress ? <span className="af-stb-live">Live</span> : <span className="af-stb-muted af-num">Wk {n.week}</span>}
      <span className="af-stb-nextname" title={n.opponentName}>
        {seed != null ? <span className="af-stb-muted af-num">#{seed} </span> : null}
        {n.opponentName}
      </span>
    </span>
  )
}

/**
 * "C 6 · E 2" — more wins that clinch, more losses that eliminate.
 *
 * ⚠ A HALF THAT DOES NOT EXIST IS LEFT OUT, NOT DASHED. Early in a season no number of losses guarantees
 * elimination on its own, and a column of "E —" reads as missing data rather than as "not yet".
 */
function PathCell({ team }: { team: BoardTeam }) {
  const { winsToClinch: w, lossesToElimination: l, gamesLeft } = team.path
  if (w === 0) return <span className="af-stb-muted">Clinched</span>
  if (l === 0) return <span className="af-stb-muted">Eliminated</span>
  if (w == null && l == null) {
    return (
      <span className="af-stb-muted" title="Not settled by this team's own results yet — it depends on games elsewhere">
        —
      </span>
    )
  }
  return (
    <span className="af-stb-path">
      {w != null ? (
        <span
          data-k="clinch"
          title={
            w === gamesLeft
              ? 'Winning out guarantees a playoff spot, whatever else happens'
              : `${w} more ${w === 1 ? 'win' : 'wins'} of ${gamesLeft} guarantee a playoff spot, whatever else happens`
          }
        >
          <span aria-hidden>C </span>
          <span className="af-sr">Wins to clinch: </span>
          <span className="af-num">{w}</span>
        </span>
      ) : null}
      {l != null ? (
        <span
          data-k="elim"
          title={`${l} more ${l === 1 ? 'loss' : 'losses'} of ${gamesLeft} eliminate this team, whatever else happens`}
        >
          <span aria-hidden>E </span>
          <span className="af-sr">Losses to elimination: </span>
          <span className="af-num">{l}</span>
        </span>
      ) : null}
    </span>
  )
}

type Group = { key: string; title: string | null; teams: BoardTeam[] }

function groupTeams(teams: BoardTeam[], board: StandingsBoard, division: string): Group[] {
  if (division === 'group' && board.divisions.length > 0) {
    return board.divisions.map((d) => ({
      key: d.key,
      title: d.name,
      teams: teams.filter((t) => t.division?.key === d.key),
    }))
  }
  if (division !== 'all' && board.divisions.some((d) => d.key === division)) {
    const d = board.divisions.find((x) => x.key === division)!
    return [{ key: d.key, title: d.name, teams: teams.filter((t) => t.division?.key === division) }]
  }
  return [{ key: 'all', title: null, teams }]
}

/** "W3" — a streak in the form the Last 5 column already speaks. */
function StreakCell({ team }: { team: BoardTeam }) {
  const s = team.streak
  if (!s) return <span className="af-stb-muted">—</span>
  const word = s.result === 'W' ? 'won' : s.result === 'L' ? 'lost' : 'tied'
  return (
    <span className="af-stb-streak af-num" data-r={s.result} title={`${word.charAt(0).toUpperCase()}${word.slice(1)} the last ${s.length}`}>
      {s.result}
      {s.length}
      <span className="af-sr"> — {word} the last {s.length}</span>
    </span>
  )
}

/**
 * A sortable column header.
 *
 * ⚠ THE BUTTON CARRIES THE NAME, `aria-sort` CARRIES THE STATE. A screen reader announces "PF, sorted
 * descending" from the header itself, and the button says what pressing it will do next.
 */
function SortTh({
  sortKey,
  sort,
  onSort,
  label,
  title,
  className,
  children,
}: {
  sortKey: StandingsSortKey
  sort: StandingsSort
  onSort: (key: StandingsSortKey) => void
  label: string
  title?: string
  className?: string
  children: React.ReactNode
}) {
  const active = sort.key === sortKey
  const nextDir = active ? (sort.dir === 'asc' ? 'desc' : 'asc') : SORT_DEFAULT_DIR[sortKey]
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className="af-stb-sortbtn"
        data-active={active || undefined}
        title={title}
        onClick={() => onSort(sortKey)}
        aria-label={`${label}: sort ${nextDir === 'asc' ? 'ascending' : 'descending'}`}
      >
        {children}
        <span className="af-stb-sortmark" aria-hidden>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

function OfficialTable({
  board,
  groups,
  plain,
  odds,
  sort,
  onSort,
}: {
  board: StandingsBoard
  groups: Group[]
  plain: boolean
  odds: StandingsOdds | null
  sort: StandingsSort
  onSort: (key: StandingsSortKey) => void
}) {
  const hasDiv = board.divisions.length > 0
  const hasProj = board.teams.some((t) => t.projected)
  const h2h = board.hasHeadToHead
  const hasNext = board.teams.some((t) => t.next)
  const hasPath = board.showPaths
  /* `split` is read defensively: a board cached before it existed has no key at all. */
  const hasSplit = h2h && board.medianGames && board.teams.some((t) => t.split)
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const byes = Math.min(board.rules.byes, field)
  const seedOf = new Map(board.teams.map((t) => [t.rosterId, t.seed]))
  /* W-L, Pct, GB, PA, Last 5 and Streak come with head-to-head; PF and Move are always there. */
  const cols =
    3 +
    (h2h ? 6 : 0) +
    (hasSplit ? 2 : 0) +
    (odds ? 2 : 0) +
    (hasNext ? 1 : 0) +
    (hasPath ? 1 : 0) +
    (hasDiv ? 1 : 0) +
    (hasProj ? 2 : 0) +
    2
  const th = { sort, onSort }

  return (
    <div className="af-stb-scroll" role="region" aria-label="League table" tabIndex={0}>
      <table className="af-stb-table">
        <caption className="af-sr">
          Official standings: {board.orderBasis} {board.recordBasis}
        </caption>
        <thead>
          <tr>
            <SortTh {...th} sortKey="seed" label="Position" className="af-stb-sticky af-stb-sticky-rank">
              <abbr title="Position">#</abbr>
            </SortTh>
            <th scope="col" className="af-stb-sticky af-stb-sticky-team">
              Team
            </th>
            <th scope="col">Status</th>
            {h2h ? (
              <>
                <th scope="col" className="af-stb-n">
                  <abbr title="Wins-losses-ties">W-L</abbr>
                </th>
                {hasSplit ? (
                  <>
                    <th scope="col" className="af-stb-n">
                      <abbr title="Head-to-head games only">H2H</abbr>
                    </th>
                    <th scope="col" className="af-stb-n">
                      <abbr title="Median games only: a win for finishing in the top half of the week">Median</abbr>
                    </th>
                  </>
                ) : null}
                <SortTh {...th} sortKey="pct" label="Winning percentage" className="af-stb-n">
                  Pct
                </SortTh>
                <th scope="col" className="af-stb-n">
                  <abbr title={`Games behind the last playoff spot (${ordinal(field)}); + means ahead of it`}>GB</abbr>
                </th>
              </>
            ) : null}
            {hasPath ? (
              <th scope="col" className="af-stb-n">
                <abbr title="C: more wins that guarantee a playoff spot. E: more losses that end the chase. Both hold whatever every other game does.">
                  Magic #
                </abbr>
              </th>
            ) : null}
            {odds ? (
              <SortTh
                {...th}
                sortKey="odds"
                label="Playoff odds"
                title="Chance of making the playoffs, from Season Outlook's simulation of the rest of the season"
                className="af-stb-n af-stb-sim"
              >
                Playoff %
              </SortTh>
            ) : null}
            <SortTh {...th} sortKey="pf" label="Points for" title="Points for" className="af-stb-n">
              PF
            </SortTh>
            {h2h ? (
              <SortTh {...th} sortKey="pa" label="Points against" title="Points against" className="af-stb-n">
                PA
              </SortTh>
            ) : null}
            <th scope="col" className="af-stb-n">
              Move
            </th>
            {h2h ? (
              <>
                <th scope="col">Last 5</th>
                <SortTh {...th} sortKey="streak" label="Streak" title="The current run of identical results" className="af-stb-n">
                  Strk
                </SortTh>
              </>
            ) : null}
            {hasNext ? <th scope="col">Next</th> : null}
            {odds ? (
              <SortTh
                {...th}
                sortKey="sos"
                label="Schedule left"
                title="Strength of the schedule still to play: 1st is the hardest in the league, judged by each opponent's average weekly score"
                className="af-stb-n"
              >
                SOS left
              </SortTh>
            ) : null}
            {hasDiv ? (
              <th scope="col" className="af-stb-n">
                Div
              </th>
            ) : null}
            {hasProj ? (
              <>
                <th scope="col" className="af-stb-n af-stb-proj">
                  <span className="af-stb-projtag">Model</span> Proj. W-L
                </th>
                <SortTh {...th} sortKey="proj" label="Projected position" className="af-stb-n af-stb-proj">
                  <span className="af-stb-projtag">Model</span> Proj. #
                </SortTh>
              </>
            ) : null}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {g.title ? (
              <tr className="af-stb-grouprow">
                <th scope="colgroup" colSpan={cols}>
                  {g.title}
                </th>
              </tr>
            ) : null}
            {g.teams.map((t, i) => {
              const next = g.teams[i + 1]
              const line =
                plain && next
                  ? t.seed === byes && byes > 0
                    ? 'bye'
                    : t.seed === field
                      ? 'playoff'
                      : null
                  : null
              return (
                <FragmentRows key={t.rosterId} line={line} cols={cols} board={board} byes={byes} field={field}>
                  <tr data-you={t.isYou ? 'true' : undefined} data-zone={t.zone}>
                    <td className="af-stb-sticky af-stb-sticky-rank af-num">{t.seed}</td>
                    <th scope="row" className="af-stb-sticky af-stb-sticky-team">
                      <TeamCell team={t} showTiebreak />
                    </th>
                    <td>
                      <ZoneChip team={t} />
                    </td>
                    {h2h ? (
                      <>
                        <td className="af-stb-n af-num">{formatRecord(t.record)}</td>
                        {hasSplit ? (
                          <>
                            <td className="af-stb-n af-num">{t.split ? formatRecord(t.split.headToHead) : '—'}</td>
                            <td className="af-stb-n af-num">{t.split ? formatRecord(t.split.median) : '—'}</td>
                          </>
                        ) : null}
                        <td className="af-stb-n af-num">{pct(t.winPct)}</td>
                        <td className="af-stb-n af-num">{gamesBackText(t.gamesBack)}</td>
                      </>
                    ) : null}
                    {hasPath ? (
                      <td className="af-stb-n">
                        <PathCell team={t} />
                      </td>
                    ) : null}
                    {odds ? (
                      <td className="af-stb-n af-stb-sim">
                        <OddsCell team={t} odds={odds} />
                      </td>
                    ) : null}
                    <td className="af-stb-n af-num">{pts(t.pointsFor)}</td>
                    {h2h ? <td className="af-stb-n af-num">{pts(t.pointsAgainst)}</td> : null}
                    <td className="af-stb-n">
                      <Move value={t.seedMove} />
                    </td>
                    {h2h ? (
                      <>
                        <td>
                          <Form form={t.form} />
                        </td>
                        <td className="af-stb-n">
                          <StreakCell team={t} />
                        </td>
                      </>
                    ) : null}
                    {hasNext ? (
                      <td>
                        <NextCell team={t} seedOf={seedOf} />
                      </td>
                    ) : null}
                    {odds ? (
                      <td className="af-stb-n">
                        <SosCell team={t} odds={odds} />
                      </td>
                    ) : null}
                    {hasDiv ? <td className="af-stb-n af-num">{t.divisionRank ?? '—'}</td> : null}
                    {hasProj ? (
                      <>
                        <td className="af-stb-n af-num af-stb-proj">{t.projected ? formatRecord(t.projected) : '—'}</td>
                        <td className="af-stb-n af-num af-stb-proj">{t.projected ? t.projected.seed : '—'}</td>
                      </>
                    ) : null}
                  </tr>
                </FragmentRows>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

/** A row followed, when it is the last team above a line, by the line itself. */
function FragmentRows({
  children,
  line,
  cols,
  board,
  byes,
  field,
}: {
  children: React.ReactNode
  line: 'bye' | 'playoff' | null
  cols: number
  board: StandingsBoard
  byes: number
  field: number
}) {
  return (
    <>
      {children}
      {line ? (
        <tr className="af-stb-line" data-line={line}>
          <td colSpan={cols}>
            <span className="af-stb-linetext">
              {line === 'bye'
                ? `First-round bye line — top ${byes}`
                : `Playoff line — top ${field} make it${board.rules.playoffTeamsSource === 'assumed' ? ' (assumed: the league does not report its playoff size)' : ''}`}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function PowerTable({ board, groups }: { board: StandingsBoard; groups: Group[] }) {
  const h2h = board.hasHeadToHead
  const cols = 9 + (h2h ? 3 : 0)
  return (
    <div className="af-stb-scroll" role="region" aria-label="AF Power rankings" tabIndex={0}>
      <table className="af-stb-table" data-view="power">
        <caption className="af-sr">AF Power rankings. {board.powerBasis}</caption>
        <thead>
          <tr>
            <th scope="col" className="af-stb-sticky af-stb-sticky-rank">
              <abbr title="AF Power rank">#</abbr>
            </th>
            <th scope="col" className="af-stb-sticky af-stb-sticky-team">
              Team
            </th>
            <th scope="col" className="af-stb-n">
              Score
            </th>
            <th scope="col" className="af-stb-n">
              Move
            </th>
            <th scope="col" className="af-stb-n">
              <abbr title="Record against every team, every week">All-play</abbr>
            </th>
            {h2h ? (
              <>
                <th scope="col" className="af-stb-n">
                  <abbr title="Head-to-head wins">Wins</abbr>
                </th>
                <th scope="col" className="af-stb-n">
                  <abbr title="Wins the scoring earned, from all-play">xW</abbr>
                </th>
                <th scope="col" className="af-stb-n">
                  <abbr title="Wins minus expected wins">Luck</abbr>
                </th>
              </>
            ) : null}
            <th scope="col" className="af-stb-n">
              <abbr title="Points for">PF</abbr>
            </th>
            <th scope="col" className="af-stb-n">
              Per wk
            </th>
            <th scope="col" className="af-stb-n">
              <abbr title="Rank by points for">PF #</abbr>
            </th>
            <th scope="col" className="af-stb-n">
              <abbr title="Position in the official table">Table #</abbr>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {g.title ? (
              <tr className="af-stb-grouprow">
                <th scope="colgroup" colSpan={cols}>
                  {g.title}
                </th>
              </tr>
            ) : null}
            {g.teams.map((t) => {
              const actual = t.headToHeadWins
              return (
                <tr key={t.rosterId} data-you={t.isYou ? 'true' : undefined}>
                  <td className="af-stb-sticky af-stb-sticky-rank af-num">{t.powerRank}</td>
                  <th scope="row" className="af-stb-sticky af-stb-sticky-team">
                    <TeamCell team={t} showTiebreak={false} />
                  </th>
                  <td className="af-stb-n af-num">{t.powerScore.toFixed(1)}</td>
                  <td className="af-stb-n">
                    <Move value={t.powerMove} />
                  </td>
                  <td className="af-stb-n af-num">{formatRecord(t.allPlay)}</td>
                  {h2h ? (
                    <>
                      <td className="af-stb-n af-num">{Number.isInteger(actual) ? actual : actual.toFixed(1)}</td>
                      <td className="af-stb-n af-num">{t.expectedWins.toFixed(1)}</td>
                      <td className="af-stb-n af-num" data-sign={t.luck > 0.05 ? 'pos' : t.luck < -0.05 ? 'neg' : undefined}>
                        {t.luck > 0 ? '+' : t.luck < 0 ? '−' : ''}
                        {Math.abs(t.luck).toFixed(1)}
                      </td>
                    </>
                  ) : null}
                  <td className="af-stb-n af-num">{pts(t.pointsFor)}</td>
                  <td className="af-stb-n af-num">{pts(t.average)}</td>
                  <td className="af-stb-n af-num">{t.pfRank}</td>
                  <td className="af-stb-n af-num">{t.seed}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Cards({
  board,
  groups,
  view,
  odds,
}: {
  board: StandingsBoard
  groups: Group[]
  view: StandingsViewKey
  odds: StandingsOdds | null
}) {
  const h2h = board.hasHeadToHead
  const hasPath = board.showPaths
  const seedOf = new Map(board.teams.map((t) => [t.rosterId, t.seed]))
  return (
    <div className="af-stb-cardwrap">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title ?? (view === 'power' ? 'AF Power rankings' : 'League table')}>
          {g.title ? <h3 className="af-stb-grouptitle">{g.title}</h3> : null}
          <ol className="af-stb-cards">
            {g.teams.map((t) => {
              const rank = view === 'power' ? t.powerRank : t.seed
              const headingId = `af-stb-card-${view}-${t.rosterId}`
              return (
                <li key={t.rosterId}>
                  <article className="af-stb-card" data-you={t.isYou ? 'true' : undefined} data-zone={t.zone} aria-labelledby={headingId}>
                    <header className="af-stb-cardhead">
                      <span className="af-stb-cardrank af-num" aria-hidden>
                        {rank}
                      </span>
                      <h4 id={headingId}>
                        <span className="af-sr">
                          {view === 'power' ? 'AF Power' : 'Position'} {rank}:{' '}
                        </span>
                        {t.name}
                      </h4>
                      {t.isYou ? <span className="af-stb-you">You</span> : null}
                    </header>
                    <ZoneChip team={t} />
                    <dl className="af-stb-carddl">
                      {h2h ? (
                        <div>
                          <dt>Record</dt>
                          <dd className="af-num">
                            {formatRecord(t.record)} <span className="af-stb-muted">({pct(t.winPct)})</span>
                          </dd>
                        </div>
                      ) : null}
                      {h2h && t.split ? (
                        <div>
                          <dt>Head-to-head · median</dt>
                          <dd className="af-num">
                            {formatRecord(t.split.headToHead)} · {formatRecord(t.split.median)}
                          </dd>
                        </div>
                      ) : null}
                      {h2h && t.streak ? (
                        <div>
                          <dt>Streak</dt>
                          <dd>
                            <StreakCell team={t} />
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Points for</dt>
                        <dd className="af-num">{pts(t.pointsFor)}</dd>
                      </div>
                      {h2h ? (
                        <div>
                          <dt>Points against</dt>
                          <dd className="af-num">{pts(t.pointsAgainst)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Since last week</dt>
                        <dd>
                          <Move value={view === 'power' ? t.powerMove : t.seedMove} />
                        </dd>
                      </div>
                      {view === 'power' ? (
                        <>
                          <div>
                            <dt>Power score</dt>
                            <dd className="af-num">{t.powerScore.toFixed(1)}</dd>
                          </div>
                          <div>
                            <dt>All-play</dt>
                            <dd className="af-num">{formatRecord(t.allPlay)}</dd>
                          </div>
                          {h2h ? (
                            <div>
                              <dt>Expected wins</dt>
                              <dd className="af-num">
                                {t.expectedWins.toFixed(1)}{' '}
                                <span className="af-stb-muted">
                                  (luck {t.luck > 0 ? '+' : t.luck < 0 ? '−' : ''}
                                  {Math.abs(t.luck).toFixed(1)})
                                </span>
                              </dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>Table position</dt>
                            <dd className="af-num">{t.seed}</dd>
                          </div>
                        </>
                      ) : (
                        <>
                          {h2h ? (
                            <div>
                              <dt>Games behind the line</dt>
                              <dd className="af-num">{gamesBackText(t.gamesBack)}</dd>
                            </div>
                          ) : null}
                          {hasPath ? (
                            <div>
                              <dt>Magic number</dt>
                              <dd>
                                <PathCell team={t} />
                              </dd>
                            </div>
                          ) : null}
                          {odds ? (
                            <div>
                              <dt>Playoff odds</dt>
                              <dd>
                                <OddsCell team={t} odds={odds} />
                              </dd>
                            </div>
                          ) : null}
                          {t.next ? (
                            <div>
                              <dt>Next</dt>
                              <dd>
                                <NextCell team={t} seedOf={seedOf} />
                              </dd>
                            </div>
                          ) : null}
                          {odds && odds.byRoster[t.rosterId]?.sosRank != null ? (
                            <div>
                              <dt>Schedule left</dt>
                              <dd>
                                <SosCell team={t} odds={odds} /> <span className="af-stb-muted">hardest of {odds.sosRanked}</span>
                              </dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>AF Power</dt>
                            <dd className="af-num">{t.powerRank}</dd>
                          </div>
                        </>
                      )}
                      {t.division ? (
                        <div>
                          <dt>{t.division.name}</dt>
                          <dd className="af-num">{t.divisionRank != null ? ordinal(t.divisionRank) : '—'}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {view === 'official' && t.tiebreak ? <p className="af-stb-cardnote">{t.tiebreak}</p> : null}
                    {view === 'official' && t.projected ? (
                      <p className="af-stb-cardproj">
                        <span className="af-stb-projtag">Model</span> Projected finish {formatRecord(t.projected)}, {ordinal(t.projected.seed)} — an
                        expectation, not a result.
                      </p>
                    ) : null}
                  </article>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

/**
 * Every team's record against every other, in table order. Read across: a row's record against the
 * column team.
 *
 * ⚠ FROM `board.h2h`, THE SAME RESULTS THE TIEBREAK READS. A cell is head-to-head games only — median
 * games have no opponent — so a row here need not add up to the W-L column in a median league.
 */
function HeadToHeadGrid({ board }: { board: StandingsBoard }) {
  const teams = board.teams
  const met = teams.some((a) => teams.some((b) => (board.h2h[a.rosterId]?.[b.rosterId] ?? null) != null))
  if (!met) return null
  return (
    <section className="af-stb-section" aria-labelledby="af-stb-h2h-title">
      <h3 id="af-stb-h2h-title" className="af-label">
        Head to head
      </h3>
      <p className="af-stb-small">
        Read across: each row’s record against the team in that column. Head-to-head games only{board.medianGames ? ' — median games have no opponent' : ''}.
      </p>
      <div className="af-stb-scroll" role="region" aria-label="Head-to-head records" tabIndex={0}>
        <table className="af-stb-table af-stb-h2h">
          <thead>
            <tr>
              <th scope="col" className="af-stb-sticky af-stb-sticky-rank">
                <abbr title="Position">#</abbr>
              </th>
              <th scope="col" className="af-stb-sticky af-stb-sticky-team">
                Team
              </th>
              {teams.map((c) => (
                <th key={c.rosterId} scope="col" className="af-stb-h2h-col" data-you={c.isYou ? 'true' : undefined}>
                  <abbr title={c.name}>#{c.seed}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((r) => (
              <tr key={r.rosterId} data-you={r.isYou ? 'true' : undefined}>
                <td className="af-stb-sticky af-stb-sticky-rank af-num">{r.seed}</td>
                <th scope="row" className="af-stb-sticky af-stb-sticky-team">
                  <span className="af-stb-teamname">{r.name}</span>
                </th>
                {teams.map((c) => {
                  if (c.rosterId === r.rosterId) {
                    return (
                      <td key={c.rosterId} className="af-stb-h2h-cell" data-self="true">
                        <span aria-hidden>·</span>
                      </td>
                    )
                  }
                  const rec = board.h2h[r.rosterId]?.[c.rosterId] ?? null
                  const res = !rec ? undefined : rec.wins > rec.losses ? 'w' : rec.wins < rec.losses ? 'l' : 'even'
                  return (
                    <td key={c.rosterId} className="af-stb-h2h-cell af-num" data-res={res}>
                      {rec ? formatRecord(rec) : <span className="af-stb-muted">–</span>}
                      <span className="af-sr">{rec ? ` against ${c.name}` : ` — has not played ${c.name}`}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Your row, kept in reach: a bar that sits at the bottom of the screen while the table is on screen and
 * your own row is not, with a button that scrolls back to it.
 *
 * ⚠ A STICKY BAR, NOT A STICKY ROW. The table scrolls sideways inside its own container, which makes that
 * container the sticky ancestor of every cell — so a sticky `<tr>` would pin to the container, never to
 * the page. The bar is a sibling of the table instead, sticky against the page.
 *
 * Hidden until IntersectionObserver says otherwise, so a browser without it (and the server render)
 * simply shows the table as before.
 */
function PinnedYou({
  team,
  view,
  odds,
  containerRef,
}: {
  team: BoardTeam
  view: StandingsViewKey
  odds: StandingsOdds | null
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const root = containerRef.current
    const row = root?.querySelector<HTMLElement>('table tr[data-you="true"]')
    if (!root || !row || typeof IntersectionObserver === 'undefined') return
    let rowVisible = true
    let tableVisible = false
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === row) rowVisible = e.isIntersecting
        else tableVisible = e.isIntersecting
      }
      setShow(!rowVisible && tableVisible)
    })
    io.observe(row)
    io.observe(root)
    return () => io.disconnect()
  }, [containerRef, team.rosterId, view])

  if (!show) return null
  const o = odds?.byRoster[team.rosterId]
  return (
    <div className="af-stb-pinned" role="status">
      <span className="af-stb-pinned-rank af-num">{view === 'power' ? team.powerRank : team.seed}</span>
      <span className="af-stb-pinned-name">{team.name}</span>
      <span className="af-stb-pinned-stats af-num">
        {formatRecord(team.record)} · {pts(team.pointsFor)} PF
        {view === 'official' && o ? ` · ${formatOdds(o.playoffPct, boardStatus(team))} playoffs` : ''}
      </span>
      <button
        type="button"
        onClick={() => containerRef.current?.querySelector('table tr[data-you="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      >
        Show my row
      </button>
    </div>
  )
}

function WhyAbove({ board, view }: { board: StandingsBoard; view: StandingsViewKey }) {
  const teams = board.teams
  const you = teams.find((t) => t.isYou) ?? null
  const defaults = (() => {
    const order = view === 'power' ? [...teams].sort((a, b) => a.powerRank - b.powerRank) : teams
    if (you) {
      const i = order.findIndex((t) => t.rosterId === you.rosterId)
      const other = order[i - 1] ?? order[i + 1]
      return [you.rosterId, other?.rosterId ?? you.rosterId]
    }
    return [order[0]?.rosterId ?? '', order[1]?.rosterId ?? '']
  })()
  const [a, setA] = useState(defaults[0])
  const [b, setB] = useState(defaults[1])
  if (teams.length < 2) return null
  const ta = teams.find((t) => t.rosterId === a)
  const tb = teams.find((t) => t.rosterId === b)
  let answer = 'Pick two different teams.'
  if (ta && tb && ta.rosterId !== tb.rosterId) {
    if (view === 'power') {
      const [up, low] = ta.powerRank < tb.powerRank ? [ta, tb] : [tb, ta]
      answer =
        up.powerScore !== low.powerScore
          ? `${up.name} scores ${up.powerScore.toFixed(1)} to ${low.powerScore.toFixed(1)}: all-play ${formatRecord(up.allPlay)} against ${formatRecord(low.allPlay)}${
              board.weeks.length >= 4 ? ', with the last three weeks weighted' : ''
            }.`
          : `${up.name} and ${low.name} have the same power score; ${up.name} is ahead on points for (${pts(up.pointsFor)} to ${pts(low.pointsFor)}).`
    } else {
      const [up, low] = ta.seed < tb.seed ? [ta, tb] : [tb, ta]
      answer = `${up.name} is ${ordinal(up.seed)}, ${low.name} ${ordinal(low.seed)}. ${explainOrder(up, low, {
        h2h: board.h2h,
        hasHeadToHead: board.hasHeadToHead,
        tiebreakers: board.rules.tiebreakers,
        tiebreakerSource: board.rules.tiebreakerSource,
        platformLabel: board.rules.platformLabel,
        platformOrder: board.platformOrder,
      })}`
    }
  }
  return (
    <section className="af-stb-why" aria-labelledby="af-stb-why-title">
      <h3 id="af-stb-why-title" className="af-label">
        Why is one team above another?
      </h3>
      <div className="af-stb-why-row">
        <label>
          <span className="af-sr">First team</span>
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {teams.map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden>vs</span>
        <label>
          <span className="af-sr">Second team</span>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {teams.map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="af-stb-why-answer" aria-live="polite">
        {answer}
      </p>
    </section>
  )
}

export function StandingsBoardView({
  board: finalBoard,
  initial,
  odds: finalOdds = null,
  live = null,
}: {
  board: StandingsBoard
  initial: StandingsViewState
  /** Season Outlook's simulation for this league. Absent draws no odds or schedule columns. */
  odds?: StandingsOdds | null
  /**
   * The same league with the week in progress counted at its current scores. Present only while a week
   * is being played; it adds an "If scores held" switch and nothing else.
   */
  live?: StandingsBoard | null
}) {
  const [view, setView] = useState<StandingsViewKey>(initial.view)
  const [division, setDivision] = useState<string>(
    initial.division === 'all' || initial.division === 'group' || finalBoard.divisions.some((d) => d.key === initial.division)
      ? initial.division
      : 'all',
  )
  const [layout, setLayout] = useState<StandingsLayout>(initial.layout)
  const [sort, setSort] = useState<StandingsSort>(initial.sort ?? DEFAULT_STANDINGS_SORT)
  const [asIf, setAsIf] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  /*
   * ⚠ THE LIVE BOARD DROPS THE ODDS. Season Outlook simulates from FINAL results, so its percentages
   * describe the table you get by switching back, not this one — printed side by side they would read
   * as a forecast of the hypothetical. The switch says so.
   */
  const board = asIf && live ? live : finalBoard
  const odds = asIf && live ? null : finalOdds

  // A remembered layout applies only when the URL did not choose one.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has(STANDINGS_VIEW_PARAMS.layout) && window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'cards') {
        setLayout('cards')
      }
    } catch {
      /* storage can be unavailable; the table is the default */
    }
  }, [])

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      for (const p of Object.values(STANDINGS_VIEW_PARAMS)) url.searchParams.delete(p)
      for (const [k, v] of serializeStandingsView({ view, division, layout, sort })) url.searchParams.set(k, v)
      const next = `${url.pathname}${url.search}${url.hash}`
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', next)
      }
    } catch {
      /* a URL we cannot write is not worth breaking the board over */
    }
  }, [view, division, layout, sort])

  function chooseLayout(next: StandingsLayout) {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  /* The same header flips direction; a new header starts at its natural first order. */
  function chooseSort(key: StandingsSortKey) {
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: SORT_DEFAULT_DIR[key] },
    )
  }

  /*
   * A sort on a column that is not on screen falls back to the table's order: a URL saying `st_sort=odds`
   * on a league the simulation withheld must not order rows by a column nobody can see.
   */
  const sortable =
    (sort.key !== 'odds' && sort.key !== 'sos') || odds != null
      ? sort.key !== 'proj' || board.teams.some((t) => t.projected)
        ? sort
        : DEFAULT_STANDINGS_SORT
      : DEFAULT_STANDINGS_SORT
  const resorted = view === 'official' && (sortable.key !== 'seed' || sortable.dir !== 'asc')

  const sorted = useMemo(
    () =>
      view === 'power'
        ? [...board.teams].sort((a, b) => a.powerRank - b.powerRank)
        : sortTeams(board.teams, sortable, odds),
    [board.teams, view, sortable, odds],
  )
  const groups = groupTeams(sorted, board, division)
  /* The bye and playoff lines only mean something between rows in table order. */
  const plain = view === 'official' && !resorted && groups.length === 1 && groups[0].key === 'all'
  const focusIds =
    division !== 'all' && division !== 'group' ? new Set(board.teams.filter((t) => t.division?.key === division).map((t) => t.rosterId)) : null
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const byes = Math.min(board.rules.byes, field)
  const withheld = board.projectionWithheld
  const you = board.teams.find((t) => t.isYou) ?? null
  const SORT_LABEL: Record<StandingsSortKey, string> = {
    seed: 'position',
    pct: 'winning percentage',
    pf: 'points for',
    pa: 'points against',
    streak: 'streak',
    odds: 'playoff odds',
    sos: 'schedule left',
    proj: 'projected position',
  }

  return (
    <div className="af-stb" ref={containerRef}>
      <div className="af-stb-controls" role="group" aria-label="Standings view">
        <div className="af-stb-seg" role="radiogroup" aria-label="Which table">
          <button type="button" role="radio" aria-checked={view === 'official'} onClick={() => setView('official')}>
            League table
          </button>
          <button type="button" role="radio" aria-checked={view === 'power'} onClick={() => setView('power')}>
            AF Power
          </button>
        </div>
        {live ? (
          <div className="af-stb-seg" role="radiogroup" aria-label="Which results">
            <button type="button" role="radio" aria-checked={!asIf} onClick={() => setAsIf(false)}>
              Final results
            </button>
            <button type="button" role="radio" aria-checked={asIf} onClick={() => setAsIf(true)}>
              If scores held
            </button>
          </div>
        ) : null}
        {board.divisions.length > 0 ? (
          <label className="af-stb-select">
            <span>Divisions</span>
            <select value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="all">Whole league</option>
              <option value="group">Grouped by division</option>
              {board.divisions.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name} only
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="af-stb-seg" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={layout === 'table'} onClick={() => chooseLayout('table')}>
            Table
          </button>
          <button type="button" role="radio" aria-checked={layout === 'cards'} onClick={() => chooseLayout('cards')}>
            Cards
          </button>
        </div>
      </div>

      <div className="af-stb-kind" data-view={view}>
        {view === 'official' ? (
          <p>
            <strong>{board.rules.platformLabel === 'the platform' ? 'The league table.' : `${board.rules.platformLabel}’s table.`}</strong>{' '}
            {board.hasHeadToHead ? 'Record decides the order; this is what seeds the playoffs.' : board.recordBasis}
          </p>
        ) : (
          <p>
            <strong>AllFantasy analysis — not the league table.</strong> {board.powerBasis}
          </p>
        )}
      </div>

      {asIf && live ? (
        <p className="af-stb-asif" role="note">
          <strong>If the scores on the board held.</strong> Week {finalBoard.pendingWeeks.join(', ')} is counted as it stands right now —
          not results, and {finalBoard.rules.platformLabel} has not made it final. Movement is against last week’s final table. Playoff odds
          are left out here because they are simulated from final results.
        </p>
      ) : finalBoard.pendingWeeks.length > 0 ? (
        <p className="af-stb-pending" role="note">
          Week {finalBoard.pendingWeeks.join(', ')} {finalBoard.pendingWeeks.length === 1 ? 'is' : 'are'} still being played. The table counts
          results through week {finalBoard.throughWeek}, the last week {finalBoard.rules.platformLabel} has made final; those games are still
          counted as left to play.{live ? ' Switch to “If scores held” to see the table as it would stand now.' : ''}
        </p>
      ) : null}

      {view === 'official' ? (
        <ul className="af-stb-legend" aria-label="Status key">
          {byes > 0 ? (
            <li data-zone="bye">
              <span aria-hidden>★</span> Bye — top {byes}
            </li>
          ) : null}
          <li data-zone="playoff">
            <span aria-hidden>●</span> Playoffs — top {field}
          </li>
          <li data-zone="bubble">
            <span aria-hidden>◐</span> Bubble — within a win of the line
          </li>
          <li data-zone="eliminated">
            <span aria-hidden>✕</span> Eliminated — cannot reach the line
          </li>
          <li data-zone="clinched">
            <span aria-hidden>✓</span> Clinched — no result can knock them out
          </li>
          {board.teams.some((t) => t.projected) ? (
            <li data-zone="model">
              <span className="af-stb-projtag">Model</span> Projection, not a result
            </li>
          ) : null}
        </ul>
      ) : null}

      {resorted ? (
        <p className="af-stb-sorted" role="status">
          Sorted by {SORT_LABEL[sortable.key]}
          {sortable.key === 'seed' ? ', last first' : ''}. The playoff line shows only in table order.{' '}
          <button type="button" onClick={() => setSort(DEFAULT_STANDINGS_SORT)}>
            Back to table order
          </button>
        </p>
      ) : null}

      {layout === 'cards' ? (
        <Cards board={board} groups={groups} view={view} odds={odds} />
      ) : view === 'official' ? (
        <>
          <p className="af-stb-cue">Scroll sideways for every column — rank and team stay in place. Tap a column heading to sort.</p>
          <OfficialTable board={board} groups={groups} plain={plain} odds={odds} sort={sortable} onSort={chooseSort} />
        </>
      ) : (
        <>
          <p className="af-stb-cue">Scroll sideways for every column — rank and team stay in place.</p>
          <PowerTable board={board} groups={groups} />
        </>
      )}

      {layout === 'table' && you ? <PinnedYou team={you} view={view} odds={odds} containerRef={containerRef} /> : null}

      <div className="af-stb-notes">
        {view === 'official' ? (
          <>
            <p>{board.recordBasis}</p>
            <p>{board.orderBasis}</p>
            <p>
              {board.rules.playoffTeamsSource === 'league'
                ? `Top ${field} make the playoffs, per the league's settings${byes > 0 ? `; the top ${byes} get a first-round bye` : ''}.`
                : `The league does not report its playoff size, so the line assumes ${field}.`}{' '}
              Clinched and eliminated are certainties: a level record counts against the team, because a points tiebreak can still move.
            </p>
            {board.showPaths ? (
              <p>
                Magic numbers: <strong>C</strong> is how many more wins guarantee a playoff spot, <strong>E</strong> how many more
                losses end the chase — each whatever every other game does, so help from elsewhere can only lower them.
              </p>
            ) : null}
            {odds ? (
              <p>
                Playoff % and schedule strength come from{' '}
                <Link href={odds.href}>Season Outlook</Link>’s simulation of the rest of the season ({odds.iterations.toLocaleString('en-US')}{' '}
                runs), which seeds on wins then points for. “In” and “Out” are printed only where this table’s own arithmetic has
                settled it.
              </p>
            ) : null}
            <p className="af-stb-projnote">
              <span className="af-stb-projtag">Model</span> {withheld ?? board.projectionBasis}
            </p>
          </>
        ) : (
          <p>
            Expected wins count, each week, the share of the league a team outscored. Luck is actual head-to-head wins minus expected
            wins{board.medianGames ? ' (median games are not part of it)' : ''}.
          </p>
        )}
      </div>

      {board.hasHeadToHead && board.teams.length > 1 ? <WhyAbove board={board} view={view} /> : null}

      {board.hasHeadToHead && board.teams.length > 2 ? <HeadToHeadGrid board={board} /> : null}

      <section className="af-stb-section" aria-labelledby="af-stb-history-title">
        <h3 id="af-stb-history-title" className="af-label">
          {view === 'power' ? 'AF Power by week' : 'Standings by week'}
        </h3>
        <StandingsHistoryChart board={board} metric={view === 'power' ? 'powerRank' : 'seed'} focusIds={focusIds} />
        <p className="af-stb-small">{board.historyBasis}</p>
      </section>

      <section className="af-stb-section" aria-labelledby="af-stb-points-title">
        <h3 id="af-stb-points-title" className="af-label">
          The points picture
        </h3>
        <StandingsPointsChart board={board} teams={board.teams} />
      </section>
    </div>
  )
}
