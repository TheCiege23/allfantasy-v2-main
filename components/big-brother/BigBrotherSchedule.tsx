'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { BigBrotherScheduleData } from '@/lib/big-brother/BigBrotherScheduleService'
import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'
import './big-brother-schedule.css'

type Data = BigBrotherScheduleData & { isCommissioner?: boolean }
const phaseName = (phase: string) => phase.toLowerCase().replaceAll('_', ' ')

export function BigBrotherSchedule({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void fetch(`/api/leagues/${leagueId}/big-brother/schedule`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null)
        throw new Error('Unable to load the league schedule. Please retry.')
      }
      const next = await response.json() as Data
      if (!controller.signal.aborted) { setData(next); setWeek(current => next.weeks.some(w => w.week === current) ? current : next.currentWeek) }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load schedule.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [leagueId, refresh])
  const cycle = data?.weeks.find(c => c.week === week)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return <section className="af-core af-league-overview bb-schedule" aria-label="Big Brother schedule" aria-busy={loading}>
    <header className="bb-schedule__header"><div><p className="bb-schedule__eyebrow">Big Brother</p><h2>Weekly house timeline</h2><p>Follow challenges, decisions, and eviction deadlines in one place.</p></div>
      <button type="button" className="bb-schedule__button" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh schedule</button></header>
    {error && <p role="alert">{error}</p>}
    {loading && !data && <p role="status">Loading schedule...</p>}
    {data && <>
      <nav className="bb-schedule__nav" aria-label="House schedule navigation">
        <Link href={`/league/${leagueId}?tab=big_brother`}>Open house</Link><Link href={`/league/${leagueId}?view=standings`}>Standings</Link>
        <Link href={`/league/${leagueId}?tab=bb_jury`}>Jury center</Link>
        {data.isCommissioner && <Link href={`/league/${leagueId}?tab=commissioner`}>Commissioner Hub</Link>}
      </nav>
      <div className="bb-schedule__summary"><p>{data.winnerPublished ? 'Winner published' : data.finaleReady ? 'Finale ready: jury voting' : data.paused ? 'Progression paused by the commissioner' : cycle ? `Week ${cycle.week}: ${phaseName(cycle.phase)}` : 'The first house cycle has not started.'}</p>
        {data.weeks.length > 0 && <label>House week<select aria-label="House week" value={week ?? ''} onChange={e => setWeek(Number(e.target.value))}>{data.weeks.map(w => <option key={w.week} value={w.week}>Week {w.week}{w.closed ? ' - completed' : ''}</option>)}</select></label>}
      </div>
      <p className="bb-schedule__note">Times shown in {timezone}. Unset deadlines need commissioner setup. Veto challenge results wait for finalized scores in score-based mode.</p>
      {cycle && <ol className="bb-schedule__timeline">{cycle.events.map(event => <li key={event.key} data-state={event.state} aria-current={event.state === 'current' ? 'step' : undefined}>
        <div><h3>{event.label}</h3><span>{event.state === 'current' ? 'Current action' : event.state === 'conditional' ? 'If needed' : event.state === 'skipped' ? 'Not needed' : event.state === 'complete' ? 'Completed' : 'Upcoming'}</span></div>
        {event.deadlineAt ? <time dateTime={event.deadlineAt}>{new Date(event.deadlineAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</time> : <p>Deadline not set</p>}
      </li>)}</ol>}
    </>}
  </section>
}
