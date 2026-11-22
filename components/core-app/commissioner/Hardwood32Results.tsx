'use client'

import { useEffect, useState } from 'react'
import type { Hardwood32Snapshot } from '@/lib/league-import/sleeper/hardwood32'

const formatPoints = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})

export function Hardwood32Results({ leagueId }: { leagueId: string }) {
  const [snapshot, setSnapshot] = useState<Hardwood32Snapshot | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'results' | 'standings'>('results')
  const [selectedWeek, setSelectedWeek] = useState('latest')
  const weeks = snapshot?.weeks ?? []
  const scores = weeks.find(entry => String(entry.week) === selectedWeek) ?? weeks[weeks.length - 1]

  useEffect(() => {
    const controller = new AbortController()
    const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/hardwood-32`
    async function refresh() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal })
        if (!response.ok) throw new Error('Sleeper scores unavailable')
        const result = await response.json() as Hardwood32Snapshot
        if (controller.signal.aborted) return
        setSnapshot(result)
        setError(false)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 300_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [leagueId])

  return (
    <section aria-labelledby="hardwood-32-title" className="space-y-3 rounded-md border border-current/25 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hardwood-32-title" className="text-lg font-semibold">The Hardwood 32</h2>
        <a className="underline" href="https://sleeper.com/beta/leagues/1419790450268635136/matchup">Open in Sleeper</a>
      </div>
      {!snapshot && !error && <p role="status">Loading standings and weekly results…</p>}
      {error && <p role="status">Sleeper refresh unavailable. {snapshot ? 'Showing the last successful update.' : 'The next refresh will retry.'}</p>}
      {snapshot && (
        <>
          <p className="text-sm">Season {snapshot.season} · Sleeper update {formatTime.format(new Date(snapshot.fetchedAt))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="afh-btn" aria-pressed={view === 'results'} onClick={() => setView('results')}>Weekly results</button>
            <button type="button" className="afh-btn" aria-pressed={view === 'standings'} onClick={() => setView('standings')}>Standings</button>
          </div>
          {view === 'results' && scores && (
            <label className="inline-flex items-center gap-2 text-sm">
              Scoring week
              <select className="afh-btn" value={weeks.some(entry => String(entry.week) === selectedWeek) ? selectedWeek : 'latest'} onChange={event => setSelectedWeek(event.target.value)}>
                <option value="latest">Latest week ({weeks[weeks.length - 1].week})</option>
                {weeks.map(entry => <option key={entry.week} value={entry.week}>Week {entry.week}</option>)}
              </select>
              <span>{scores.completed ? 'Final' : 'In progress'}</span>
            </label>
          )}
          <div className="overflow-x-auto">
            {view === 'standings' ? (
              <table className="w-full text-left text-sm" aria-label="Hardwood 32 overall standings">
                <thead><tr>{['Rank', 'Team', 'Division', 'W', 'L', 'T', 'Points for', 'Points against'].map(label =>
                  <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
                <tbody>{snapshot.standings.map(row => (
                  <tr key={row.rosterId} className="border-t border-current/20">
                    {[row.rank, row.team, row.division, row.wins, row.losses, row.ties, formatPoints.format(row.pointsFor), formatPoints.format(row.pointsAgainst)].map((value, index) =>
                      <td key={index} className="p-2">{value}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            ) : scores ? (
              <table className="w-full text-left text-sm" aria-label={`Hardwood 32 Week ${scores.week} results`}>
                <thead><tr>{['Matchup', 'Team', 'Score', 'Opponent', 'Score', scores.completed ? 'Winner' : 'Leader'].map((label, index) =>
                  <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
                <tbody>{scores.matchups.map(row => (
                  <tr key={row.id} className="border-t border-current/20">
                    {[row.id, row.first.team, row.first.points == null ? '—' : formatPoints.format(row.first.points), row.second.team,
                      row.second.points == null ? '—' : formatPoints.format(row.second.points),
                      row.winner ?? (row.first.points == null || row.second.points == null ? '—' : 'Tie')].map((value, index) =>
                      <td key={index} className="p-2">{value}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            ) : <p role="status">Sleeper hasn’t posted any weekly scores yet.</p>}
          </div>
        </>
      )}
    </section>
  )
}
