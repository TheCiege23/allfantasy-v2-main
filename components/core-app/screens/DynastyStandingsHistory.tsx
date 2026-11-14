'use client'

import { useMemo, useState } from 'react'
import { Crown, Trophy } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { dynastyStandingsMessages } from '@/lib/core-app/messages/dynastyStandings'
import {
  sortFranchises,
  type DynastyFranchiseRow,
  type DynastySortKey,
  type DynastyStandingsHistory as History,
} from '@/lib/core-app/dynastyStandingsHistory'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import '@/components/core-app/af-standings-dynasty.css'

/**
 * Dynasty history on /core's Standings — drawn only for a dynasty league (the page passes `dynasty`
 * only when `coreShellDynasty` says so, the same rule as the shell's stamp). Two blocks:
 *   - the era band with the championship rafters (`loadChampionHistory`, the pennants /core's Home
 *     draws), dark in every mode like Home's band;
 *   - the Dynasty table: each franchise's all-time record across the seasons on file
 *     (`buildDynastyStandingsHistory`), ordered by titles then all-time win %, re-sortable.
 * Every line under the table says what is NOT counted and why; the builder decides, this only draws.
 */

/** More titles than this draw as one trophy and a count — a row of nine icons says nothing a number does not. */
const MAX_TROPHIES = 4

const SORTS: DynastySortKey[] = ['titles', 'winPct', 'wins', 'pointsFor', 'seasons']

function pct(v: number | null): string {
  if (v == null) return '—'
  return v >= 1 ? '1.000' : v.toFixed(3).replace(/^0/, '')
}

function pts(v: number): string {
  return v.toLocaleString(getAppIntlLocale(), { maximumFractionDigits: 0 })
}

function record(f: DynastyFranchiseRow): string {
  return `${f.wins}-${f.losses}${f.ties > 0 ? `-${f.ties}` : ''}`
}

function Trophies({ f }: { f: DynastyFranchiseRow }) {
  const m = useMessages(dynastyStandingsMessages)
  if (f.titles === 0) {
    return (
      <span className="af-st-dy-trophies" data-none="true" aria-label={m.titlesAria(0, [])}>
        0
      </span>
    )
  }
  const many = f.titles > MAX_TROPHIES
  return (
    <span className="af-st-dy-trophies" aria-label={m.titlesAria(f.titles, f.titleSeasons)} title={f.titleSeasons.join(', ')}>
      <span className="af-st-dy-cups" aria-hidden>
        {Array.from({ length: many ? 1 : f.titles }, (_, i) => (
          <Trophy key={i} size={15} strokeWidth={2.2} />
        ))}
        {many ? <span className="af-st-dy-cupcount">×{f.titles}</span> : null}
      </span>
      <span className="af-st-dy-cupyears" aria-hidden>
        {f.titleSeasons.map((s) => `’${String(s).slice(-2)}`).join(' ')}
      </span>
    </span>
  )
}

export function DynastyStandingsHistory({ history }: { history: History }) {
  const m = useMessages(dynastyStandingsMessages)
  const [sort, setSort] = useState<DynastySortKey>('titles')
  const rows = useMemo(() => sortFranchises(history.franchises, sort), [history.franchises, sort])
  const { rafters, recordSeasons, status } = history
  const first = recordSeasons[0]
  const last = recordSeasons[recordSeasons.length - 1]
  const showPf = rows.some((r) => r.pointsFor != null)
  const pfPartial = showPf && rows.some((r) => r.seasons.length > 0 && r.pointsFor == null)
  const sortLabel: Record<DynastySortKey, string> = {
    titles: m.sortTitles,
    winPct: m.sortWinPct,
    wins: m.sortWins,
    pointsFor: m.sortPointsFor,
    seasons: m.sortSeasons,
  }
  const sorts = SORTS.filter((s) => s !== 'pointsFor' || showPf)
  const ariaSort = (key: DynastySortKey) => (sort === key ? ('descending' as const) : undefined)

  const notes: string[] = []
  if (status === 'records') {
    if (history.inProgressSeason != null) notes.push(m.inProgress(history.inProgressSeason))
    if (history.titleOnlySeasons.length > 0) notes.push(m.titleOnlySeasons(history.titleOnlySeasons))
    if (history.hasRunnerUps) notes.push(m.runnerUpNote)
    if (history.hasPlayoffs) notes.push(m.playoffsNote)
    else notes.push(m.noPlayoffs)
    if (pfPartial) notes.push(m.pfPartial)
  }
  if (history.unattributedTitles.length > 0) {
    notes.push(m.unattributed(history.unattributedTitles.length, history.unattributedTitles.map((t) => t.season)))
  }
  if (history.unmatchedRows > 0) notes.push(m.unmatched(history.unmatchedRows))
  if (status !== 'empty') notes.push(m.identityNote)

  return (
    <section className="af-st-dy" aria-label={m.sectionLabel} data-testid="dynasty-standings-history">
      <div className="af-st-dy-band">
        <div className="af-st-dy-era">
          <span className="af-st-dy-crest" aria-hidden>
            <Crown size={22} strokeWidth={1.8} />
          </span>
          <div className="af-st-dy-era-text">
            <p className="af-st-dy-eyebrow">{m.eyebrow}</p>
            <h2 className="af-st-dy-title">{m.bandTitle}</h2>
            <p className="af-st-dy-tagline">
              {first != null && last != null ? m.seasonsOnFile(first, last, recordSeasons.length) : m.bandTagline}
            </p>
          </div>
        </div>
        {rafters ? (
          <div className="af-st-dy-rafters" data-testid="dynasty-standings-rafters">
            <span className="af-st-dy-label">{m.rafters}</span>
            <ol className="af-st-dy-pennants">
              {rafters.pennants.map((p) => {
                const name = p.mine ? m.you : p.label ?? m.unnamed
                return (
                  <li key={p.season} className="af-st-dy-pennant" data-mine={p.mine || undefined} aria-label={m.pennantAria(p.season, name)}>
                    <span className="af-st-dy-pennant-year">{p.season}</span>
                    <span className="af-st-dy-pennant-name">{name}</span>
                  </li>
                )
              })}
              {rafters.openSeason != null ? (
                <li className="af-st-dy-pennant" data-open="true" aria-label={m.openAria(rafters.openSeason)}>
                  <span className="af-st-dy-pennant-year">{rafters.openSeason}</span>
                  <span className="af-st-dy-pennant-name">{m.open}</span>
                </li>
              ) : null}
            </ol>
            <span className="af-st-dy-mine" data-mine={rafters.myTitles > 0 || undefined}>
              <Trophy size={14} aria-hidden />
              {rafters.myTitles > 0 ? m.myTitles(rafters.myTitles) : m.noTitlesYet}
            </span>
          </div>
        ) : null}
      </div>

      <section className="af-st-dy-card" aria-labelledby="af-st-dy-table-title" data-testid="dynasty-standings-table" data-status={status}>
        <header className="af-st-dy-card-head">
          <h3 id="af-st-dy-table-title">{status === 'titles-only' ? m.titlesHead : m.tableTitle}</h3>
          {status === 'records' ? (
            <div className="af-st-dy-sorts" role="group" aria-label={m.sortBy}>
              {sorts.map((s) => (
                <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)}>
                  {sortLabel[s]}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        {status === 'records' ? (
          <>
            <div className="af-st-dy-scroll" role="region" aria-label={m.tableLabel} tabIndex={0}>
              <table className="af-st-dy-table">
                <caption className="af-sr">
                  {m.tableLabel}. {m.sortedBy(sortLabel[sort])}.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="af-st-dy-c-rank">{m.colRank}</th>
                    <th scope="col" className="af-st-dy-c-name">{m.colFranchise}</th>
                    <th scope="col" aria-sort={ariaSort('titles')}>{m.colTitles}</th>
                    <th scope="col" aria-sort={ariaSort('wins')}>{m.colRecord}</th>
                    <th scope="col" aria-sort={ariaSort('winPct')}>{m.colWinPct}</th>
                    {showPf ? <th scope="col" aria-sort={ariaSort('pointsFor')}>{m.colPointsFor}</th> : null}
                    {history.hasRunnerUps ? <th scope="col">{m.colRunnerUp}</th> : null}
                    {history.hasPlayoffs ? <th scope="col">{m.colPlayoffs}</th> : null}
                    <th scope="col" aria-sort={ariaSort('seasons')}>{m.colSeasons}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f, i) => (
                    <tr key={f.key} data-you={f.isYou || undefined} data-champ={f.titles > 0 || undefined}>
                      <td className="af-st-dy-c-rank af-num">{i + 1}</td>
                      <th scope="row" className="af-st-dy-c-name">
                        <span className="af-st-dy-name">
                          {f.name}
                          {f.isYou ? <span className="af-st-dy-you">{m.youTag}</span> : null}
                        </span>
                        {f.manager ? <span className="af-st-dy-manager">{f.manager}</span> : null}
                      </th>
                      <td><Trophies f={f} /></td>
                      <td className="af-num">{f.seasons.length > 0 ? record(f) : '—'}</td>
                      <td className="af-num af-st-dy-pct">{f.seasons.length > 0 ? pct(f.winPct) : '—'}</td>
                      {showPf ? <td className="af-num">{f.pointsFor != null ? pts(f.pointsFor) : m.noPoints}</td> : null}
                      {history.hasRunnerUps ? <td className="af-num">{f.runnerUps ?? '—'}</td> : null}
                      {history.hasPlayoffs ? <td className="af-num">{f.playoffs ?? '—'}</td> : null}
                      <td className="af-num">{m.seasonsCount(f.seasons.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : status === 'titles-only' ? (
          <>
            <p className="af-st-dy-why">{m.titlesOnlyWhy}</p>
            {rows.some((f) => f.titles > 0) ? (
              <ul className="af-st-dy-titlelist">
                {rows
                  .filter((f) => f.titles > 0)
                  .map((f) => (
                    <li key={f.key} data-you={f.isYou || undefined}>
                      <span className="af-st-dy-name">
                        {f.name}
                        {f.isYou ? <span className="af-st-dy-you">{m.youTag}</span> : null}
                      </span>
                      <Trophies f={f} />
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="af-st-dy-why">{m.emptyWhy}</p>
        )}

        {notes.length > 0 ? (
          <ul className="af-st-dy-notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  )
}

