'use client'

import { useEffect, useMemo, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'
import './league-standings.css'

type Row = { rosterId: string; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; rank: number | null; categoryWinsFor?: number | null; categoryLossesFor?: number | null; categoryTiesFor?: number | null; streak?: string | null; allPlay?: string | null }
type Data = { season: number; standings: Row[]; scoringMode: 'points' | 'h2h_category' | 'roto'; viewerRosterId: string | null; source: 'native' | 'imported'; sourcePlatform: string; scoredWeeks: number | null; cumulative?: boolean }
const points = (value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '\u2014'

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
        </tr></thead><tbody>{rows.map(r => <tr key={r.rosterId} data-viewer={data.viewerRosterId === r.rosterId || undefined}><td>{r.rank ?? '\u2014'}</td><th scope="row">{r.teamName}{data.viewerRosterId === r.rosterId && <span className="league-standings__you">You</span>}</th>
          {record && <td>{r.wins}-{r.losses}-{r.ties}</td>}{category && <td>{r.categoryWinsFor == null ? '\u2014' : `${r.categoryWinsFor}-${r.categoryLossesFor ?? 0}-${r.categoryTiesFor ?? 0}`}</td>}<td>{points(r.pointsFor)}</td>
          {record && <td>{points(r.pointsAgainst)}</td>}{nativePoints && <><td>{r.streak ?? '\u2014'}</td><td>{r.allPlay ?? '\u2014'}</td></>}
        </tr>)}</tbody></table></div>}
    </>}
  </section>
}
