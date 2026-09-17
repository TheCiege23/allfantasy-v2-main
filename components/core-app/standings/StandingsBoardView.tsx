'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  explainOrder,
  formatRecord,
  type BoardTeam,
  type StandingsBoard,
  type Zone,
} from '@/lib/core-app/standingsModel'
import {
  serializeStandingsView,
  STANDINGS_VIEW_PARAMS,
  type StandingsLayout,
  type StandingsViewKey,
  type StandingsViewState,
} from '@/lib/core-app/standingsView'
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

function OfficialTable({ board, groups, plain }: { board: StandingsBoard; groups: Group[]; plain: boolean }) {
  const hasDiv = board.divisions.length > 0
  const hasProj = board.teams.some((t) => t.projected)
  const h2h = board.hasHeadToHead
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const byes = Math.min(board.rules.byes, field)
  const cols = 3 + (h2h ? 5 : 1) + (hasDiv ? 1 : 0) + (hasProj ? 2 : 0) + 1

  return (
    <div className="af-stb-scroll" role="region" aria-label="League table" tabIndex={0}>
      <table className="af-stb-table">
        <caption className="af-sr">
          Official standings: {board.orderBasis} {board.recordBasis}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="af-stb-sticky af-stb-sticky-rank">
              <abbr title="Position">#</abbr>
            </th>
            <th scope="col" className="af-stb-sticky af-stb-sticky-team">
              Team
            </th>
            <th scope="col">Status</th>
            {h2h ? (
              <>
                <th scope="col" className="af-stb-n">
                  <abbr title="Wins-losses-ties">W-L</abbr>
                </th>
                <th scope="col" className="af-stb-n">
                  Pct
                </th>
                <th scope="col" className="af-stb-n">
                  <abbr title={`Games behind the last playoff spot (${ordinal(field)}); + means ahead of it`}>GB</abbr>
                </th>
              </>
            ) : null}
            <th scope="col" className="af-stb-n">
              <abbr title="Points for">PF</abbr>
            </th>
            {h2h ? (
              <th scope="col" className="af-stb-n">
                <abbr title="Points against">PA</abbr>
              </th>
            ) : null}
            <th scope="col" className="af-stb-n">
              Move
            </th>
            {h2h ? <th scope="col">Last 5</th> : null}
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
                <th scope="col" className="af-stb-n af-stb-proj">
                  <span className="af-stb-projtag">Model</span> Proj. #
                </th>
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
                        <td className="af-stb-n af-num">{pct(t.winPct)}</td>
                        <td className="af-stb-n af-num">{gamesBackText(t.gamesBack)}</td>
                      </>
                    ) : null}
                    <td className="af-stb-n af-num">{pts(t.pointsFor)}</td>
                    {h2h ? <td className="af-stb-n af-num">{pts(t.pointsAgainst)}</td> : null}
                    <td className="af-stb-n">
                      <Move value={t.seedMove} />
                    </td>
                    {h2h ? (
                      <td>
                        <Form form={t.form} />
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

function Cards({ board, groups, view }: { board: StandingsBoard; groups: Group[]; view: StandingsViewKey }) {
  const h2h = board.hasHeadToHead
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
  board,
  initial,
}: {
  board: StandingsBoard
  initial: StandingsViewState
}) {
  const [view, setView] = useState<StandingsViewKey>(initial.view)
  const [division, setDivision] = useState<string>(
    initial.division === 'all' || initial.division === 'group' || board.divisions.some((d) => d.key === initial.division)
      ? initial.division
      : 'all',
  )
  const [layout, setLayout] = useState<StandingsLayout>(initial.layout)

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
      for (const [k, v] of serializeStandingsView({ view, division, layout })) url.searchParams.set(k, v)
      const next = `${url.pathname}${url.search}${url.hash}`
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', next)
      }
    } catch {
      /* a URL we cannot write is not worth breaking the board over */
    }
  }, [view, division, layout])

  function chooseLayout(next: StandingsLayout) {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const sorted = useMemo(
    () => (view === 'power' ? [...board.teams].sort((a, b) => a.powerRank - b.powerRank) : board.teams),
    [board.teams, view],
  )
  const groups = groupTeams(sorted, board, division)
  const plain = view === 'official' && groups.length === 1 && groups[0].key === 'all'
  const focusIds =
    division !== 'all' && division !== 'group' ? new Set(board.teams.filter((t) => t.division?.key === division).map((t) => t.rosterId)) : null
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const byes = Math.min(board.rules.byes, field)
  const withheld = board.projectionWithheld

  return (
    <div className="af-stb">
      <div className="af-stb-controls" role="group" aria-label="Standings view">
        <div className="af-stb-seg" role="radiogroup" aria-label="Which table">
          <button type="button" role="radio" aria-checked={view === 'official'} onClick={() => setView('official')}>
            League table
          </button>
          <button type="button" role="radio" aria-checked={view === 'power'} onClick={() => setView('power')}>
            AF Power
          </button>
        </div>
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

      {board.pendingWeeks.length > 0 ? (
        <p className="af-stb-pending" role="note">
          Week {board.pendingWeeks.join(', ')} {board.pendingWeeks.length === 1 ? 'is' : 'are'} still being played. The table counts results
          through week {board.throughWeek}, the last week {board.rules.platformLabel} has made final; those games are still counted as left to
          play.
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

      {layout === 'cards' ? (
        <Cards board={board} groups={groups} view={view} />
      ) : view === 'official' ? (
        <>
          <p className="af-stb-cue">Scroll sideways for every column — rank and team stay in place.</p>
          <OfficialTable board={board} groups={groups} plain={plain} />
        </>
      ) : (
        <>
          <p className="af-stb-cue">Scroll sideways for every column — rank and team stay in place.</p>
          <PowerTable board={board} groups={groups} />
        </>
      )}

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
