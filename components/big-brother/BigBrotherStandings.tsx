"use client"

import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'
import './big-brother-standings.css'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { BigBrotherStanding, BigBrotherStandings as StandingsData } from '@/lib/big-brother/standings'

const LABELS: Record<BigBrotherStanding['status'], string> = {
  HOH: 'Head of Household', NOMINATED: 'On the block', VETO_WINNER: 'Veto winner', VETO_PLAYER: 'Veto player',
  SAFE: 'In house', JURY: 'Jury', ELIMINATED: 'Evicted', WINNER: 'Winner', FINALIST: 'Finalist', AWAITING_START: 'Awaiting start',
}
type Filter = 'all' | 'active' | 'jury' | 'evicted'
type Sort = 'survival' | 'hoh' | 'veto' | 'points'

export function BigBrotherStandings({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<StandingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('survival')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    async function load() {
      try {
        const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/standings`, { signal: controller.signal, cache: 'no-store' })
        if (response.status === 401 || response.status === 403) { if (active) setData(null) }
        if (!response.ok) throw new Error(response.status === 403 ? 'You do not have access to this league.'
          : response.status === 401 ? 'Sign in again to view standings.' : 'Standings could not be loaded. Please retry.')
        const result: StandingsData = await response.json()
        if (result.leagueId !== leagueId || !Array.isArray(result.rows)) throw new Error('Standings could not be loaded. Please retry.')
        if (active) setData(result)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Standings could not be loaded. Please retry.')
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [leagueId, revision])
  useEffect(() => { setFilter('all'); setSort('survival'); setSearch('') }, [leagueId])
  const current = data?.leagueId === leagueId ? data : null
  if (!current) return (
    <section className="af-core af-league-overview af-bb-standings" aria-label="Big Brother standings">
      <h2>Big Brother standings</h2>
      {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(v => v + 1)}>Retry standings</button></div>
        : <p role="status">Loading standings…</p>}
    </section>
  )
  const rows = current.rows.filter(r => {
    const group = filter === 'all' || (filter === 'active' ? r.evictedWeek === null : filter === 'jury' ? r.status === 'JURY' : r.evictedWeek !== null)
    return group && r.teamName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  }).sort((a, b) => {
    if (sort === 'survival') return 0 // Preserve the engine projection order, including tied active houseguests.
    const aValue = sort === 'hoh' ? a.hohWins : sort === 'veto' ? a.vetoWins : a.processedPoints
    const bValue = sort === 'hoh' ? b.hohWins : sort === 'veto' ? b.vetoWins : b.processedPoints
    if (aValue === null || bValue === null) return aValue === bValue ? 0 : aValue === null ? 1 : -1
    return bValue - aValue
  })
  const names = new Map(current.rows.map(r => [r.rosterId, r.teamName]))
  const name = (id: string | null) => id ? names.get(id) ?? 'Houseguest no longer available' : 'Pending'
  const root = `/league/${encodeURIComponent(leagueId)}`
  return (
    <section className="af-core af-league-overview af-bb-standings" aria-label="Big Brother standings" aria-busy={loading}>
      <header className="af-overview-header border">
        <p className="text-sm text-white/60">{current.season} · Big Brother</p>
        <h2>House standings</h2>
        <p className="mt-2 text-sm text-white/60">{current.state === 'setup' ? 'The house is getting ready. Standings update when the commissioner starts the first cycle.'
          : current.state === 'completed' ? 'The finale result has been published.' : current.state === 'finale' ? 'The finalists are set. The jury decides the winner.'
          : `Week ${current.week} · ${current.phase?.replaceAll('_', ' ').toLowerCase()}`}</p>
        <nav aria-label="Big Brother standings actions" className="mt-3 flex flex-wrap gap-2">
          <Link href={`${root}?tab=big_brother`}>Open house</Link>
          <Link href={`${root}?tab=bb_history`}>Game history</Link>
          <Link href={`${root}?tab=bb_jury`}>Jury center</Link>
          <button type="button" disabled={loading} onClick={() => setRevision(v => v + 1)}>{loading ? 'Refreshing…' : 'Refresh standings'}</button>
        </nav>
      </header>
      {error && <div role="alert" className="af-overview-card border"><p>{error} Showing the last loaded standings.</p></div>}
      <dl className="af-bb-metrics">
        <div><dt>Houseguests</dt><dd>{current.rows.length}</dd></div>
        <div><dt>{current.state === 'setup' ? 'Awaiting start' : 'Remaining'}</dt><dd>{current.remainingCount}</dd></div>
        <div><dt>Jury members</dt><dd>{current.juryCount}</dd></div>
        <div><dt>Evicted</dt><dd>{current.rows.length - current.remainingCount}</dd></div>
      </dl>
      <div className="af-overview-card border space-y-3">
        <h3>Season standings</h3>
        <p className="text-sm text-white/60">Active houseguests remain in contention without a numbered finish. Evicted teams appear by finish; HOH and veto wins are competition records.</p>
        <div className="af-bb-tools">
          <label>Find a team<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Team name" /></label>
          <label>House status<select value={filter} onChange={e => setFilter(e.target.value as Filter)}>
            <option value="all">All houseguests</option><option value="active">In contention</option><option value="jury">Jury</option><option value="evicted">All evicted</option>
          </select></label>
          <label>Order by<select value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="survival">Survival / finish</option><option value="hoh">HOH wins</option><option value="veto">Veto wins</option><option value="points">Processed points</option>
          </select></label>
        </div>
        <p className="af-standings-scroll-hint" id="bb-standings-hint">Scroll horizontally for all columns. Points include finalized weeks processed in AllFantasy; a dash means no recorded score.</p>
        <p role="status" className="text-sm text-white/60">{rows.length} of {current.rows.length} houseguests</p>
        {current.rows.length === 0 ? <p>No houseguests have been added to this league yet.</p> : rows.length === 0 ? <p>No teams match these filters.</p> : (
          <div className="af-standings-scroll overflow-x-auto rounded-xl border" role="region" aria-label="Big Brother season standings" aria-describedby="bb-standings-hint" tabIndex={0}>
            <table className="w-full text-sm af-bb-table">
              <caption className="sr-only">Big Brother season standings and competition records</caption>
              <thead><tr>{['Finish', 'Team', 'House status', 'HOH wins', 'Veto wins', 'Nominations', 'Evicted week', 'Processed points'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => <tr key={r.rosterId} data-viewer={r.rosterId === current.viewerRosterId || undefined}>
                <td>{r.place ?? '—'}</td>
                <th scope="row"><span>{r.teamName}</span>{r.rosterId === current.viewerRosterId && <span className="af-bb-you">You</span>}</th>
                <td><span className="af-bb-status" data-status={r.status}>{LABELS[r.status]}</span></td>
                <td>{r.hohWins}</td><td>{r.vetoWins}</td><td>{r.timesNominated}</td><td>{r.evictedWeek ?? '—'}</td>
                <td>{r.processedPoints === null ? '—' : <><span>{r.processedPoints.toFixed(2)}</span><small>{r.scoredWeeks} scored {r.scoredWeeks === 1 ? 'week' : 'weeks'}</small></>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
      {current.history.length > 0 && <section className="af-overview-card border" aria-label="Weekly Big Brother results">
        <h3>Weekly results</h3>
        <ol className="af-bb-history">{current.history.map(c => <li key={c.week}>
          <h4>Week {c.week}</h4><dl><div><dt>HOH</dt><dd>{name(c.hohRosterId)}</dd></div><div><dt>Veto</dt><dd>{name(c.vetoWinnerRosterId)}</dd></div><div><dt>Evicted</dt><dd>{name(c.evictedRosterId)}</dd></div></dl>
        </li>)}</ol>
      </section>}
    </section>
  )
}
