'use client'

import { useEffect, useMemo, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'
import './league-standings.css'
import { projectedSlotFor, useFuturePicks } from '@/components/league/useFuturePicks'
import { pickSlotLabel } from '@/lib/league/pickSlotLabel'

type Row = { rosterId: string; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number | null; rank: number | null; categoryWinsFor?: number | null; categoryLossesFor?: number | null; categoryTiesFor?: number | null; streak?: string | null; allPlay?: string | null }
type Data = { season: number; standings: Row[]; scoringMode: 'points' | 'h2h_category' | 'roto'; viewerRosterId: string | null; source: 'native' | 'imported'; sourcePlatform: string; scoredWeeks: number | null; cumulative?: boolean }
const points = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '\u2014'

export function LeagueStandings({ leagueId, initialSeason, title = 'Standings' }: { leagueId: string; initialSeason?: number; title?: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [season, setSeason] = useState(initialSeason)
  const [seasonDraft, setSeasonDraft] = useState<string | null>(initialSeason?.toString() ?? null)
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void fetch(`/api/leagues/${leagueId}/scoring/standings${season ? `?season=${season}` : ''}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null)
        throw new Error('Unable to load standings. Please retry.')
      }
      const next = await response.json() as Data
      if (!controller.signal.aborted) setData(next)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load standings.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [leagueId, season, refresh])
  const rows = useMemo(() => data?.standings.filter(r => r.teamName.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query])
  const roto = data?.scoringMode === 'roto'
  const category = data?.scoringMode === 'h2h_category'
  const record = !roto && !data?.cumulative
  const nativePoints = data?.source === 'native' && !roto && !category && !data.cumulative
  // Future picks + next season's projected rookie pick (owner's page review #5, #6). Only on the
  // season the projection is built from, never on a historical season.
  const picksView = useFuturePicks(leagueId)
  const picksSeason = picksView?.projection ? picksView.projection.draftSeason - 1 : null
  const showPicks = Boolean(picksView?.board) && data != null && (picksSeason == null || data.season === picksSeason)
  const showProjected = Boolean(picksView?.projection) && data != null && data.season === picksSeason
  const picksFor = (rowId: string) => {
    if (!picksView) return null
    const ids = picksView.ids.find((i) => i.teamId === rowId || i.rosterId === rowId) ?? null
    const team = ids ? picksView.board?.teams.find((t) => t.rosterId === ids.rosterId) ?? null : null
    const slot = picksView.projection ? projectedSlotFor(picksView, ids ?? { teamId: rowId, rosterId: rowId }) : null
    return { team, slot }
  }
  return <section className="af-core af-league-overview league-standings" aria-label="League standings" aria-busy={loading}>
    <header><div><p className="league-standings__eyebrow">{data?.season ?? initialSeason ?? 'Season'} {data?.sourcePlatform ? ` / ${data.sourcePlatform}` : ''}</p><h2>{title}</h2></div>
      <button type="button" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh standings</button></header>
    <div className="league-standings__controls"><label>Find a team<input type="search" aria-label="Find a team" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Season<input type="number" aria-label="Season" min={2000} max={2100} value={seasonDraft ?? season ?? data?.season ?? ''} onChange={e => { setSeasonDraft(e.target.value); const value = Number(e.target.value); if (Number.isInteger(value) && value >= 2000 && value <= 2100) { setData(null); setSeason(value) } }} /></label></div>
    {error && <p role="alert">{error}</p>}
    {loading && !data && <p role="status">Loading standings...</p>}
    {data && <>
      <p className="league-standings__note">{data.source === 'native' ? `Built from finalized AllFantasy results (${data.scoredWeeks ?? 0} scored weeks). Refresh after scoring corrections to see the updated totals.` : `Published records and points from ${data.sourcePlatform}. Sync this league to update them. Historical standings appear when that season is imported.`}</p>
      {!data.standings.length ? <p>No completed scoring results are available for this season yet.</p> : !rows.length ? <p>No teams match this search.</p> :
        <div className="league-standings__scroll" role="region" aria-label="Season standings table" tabIndex={0}><table><caption className="sr-only">Season {data.season} standings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th>
          {record && <th scope="col">W-L-T</th>}{category && <th scope="col">Categories W-L-T</th>}<th scope="col">{roto ? data.source === 'native' ? 'Roto rank points' : 'Published points' : 'Points for'}</th>
          {record && <th scope="col">Points against</th>}{nativePoints && <><th scope="col">Streak</th><th scope="col">All-play</th></>}
          {showPicks && <th scope="col">Future picks</th>}{showProjected && <th scope="col">Proj. {picksView?.projection?.draftSeason} pick</th>}
        </tr></thead><tbody>{rows.map(r => <tr key={r.rosterId} data-viewer={data.viewerRosterId === r.rosterId || undefined}><td>{r.rank ?? '\u2014'}</td><th scope="row">{r.teamName}{data.viewerRosterId === r.rosterId && <span className="league-standings__you">You</span>}</th>
          {record && <td>{r.wins}-{r.losses}-{r.ties}</td>}{category && <td>{r.categoryWinsFor == null ? '\u2014' : `${r.categoryWinsFor}-${r.categoryLossesFor ?? 0}-${r.categoryTiesFor ?? 0}`}</td>}<td>{points(r.pointsFor)}</td>
          {record && <td>{points(r.pointsAgainst)}</td>}{nativePoints && <><td>{r.streak ?? '\u2014'}</td><td>{r.allPlay ?? '\u2014'}</td></>}
          {(showPicks || showProjected) && (() => {
            const p = picksFor(r.rosterId)
            const mine = data.viewerRosterId === r.rosterId
            return <>
              {showPicks && <td data-testid="standings-future-picks">{p?.team ? <>{p.team.total}{p.team.firsts ? <span className="league-standings__firsts">{' \u00b7 '}{p.team.firsts === 1 ? '1 first' : `${p.team.firsts} firsts`}</span> : null}</> : '\u2014'}</td>}
              {showProjected && <td data-testid="standings-projected-pick" title={p?.slot?.reason ?? undefined}>
                {p?.slot ? <span className="league-standings__proj">{p.slot.status === 'locked' ? '' : 'proj. '}{pickSlotLabel(1, p.slot.slot)}</span> : '\u2014'}
                {mine && p?.slot?.reason ? <span className="league-standings__proj-why">{p.slot.reason}</span> : null}
              </td>}
            </>
          })()}
        </tr>)}</tbody></table></div>}
      {showProjected && picksView?.projection?.warnings.length ? <p className="league-standings__note">{picksView.projection.warnings[0]}</p> : null}
    </>}
  </section>
}
