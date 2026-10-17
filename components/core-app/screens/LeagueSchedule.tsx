'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import LocalDateTime from '../LocalDateTime'
import TeamDeadlineAlertTarget from '../TeamDeadlineAlertTarget'
import { LeagueScoreboardPanel } from './LeagueScoreboardPanel'
import '@/components/core-app/af-team-workspace.css'
import '@/components/core-app/af-league-home.css'

export default function LeagueSchedule({ data }: { data: LeagueHomeData }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams()
  const selectWeek = (value: string) => { const next = new URLSearchParams(params?.toString()); next.set('week', value); router.push(`${pathname}?${next}`, { scroll: false }) }
  return <div className="af-tw"><header className="af-tw-heading"><div><h1>Schedule and deadlines</h1><p>{data.league.name} · {data.league.sport} · {data.league.season ?? 'Season unavailable'}</p></div><Link href={`/core/my-team?league=${encodeURIComponent(data.league.id)}`}>Plan your roster</Link></header>
    <TeamDeadlineAlertTarget leagueId={data.league.id} events={data.calendar??[]} query={params?.toString()??''} />
    <section className="af-tw-panel"><h2>League calendar</h2>{data.calendar?.length ? <ul>{data.calendar.map(event => <li key={event.key}><strong>{event.label}</strong><p>{event.at ? <LocalDateTime value={event.at} /> : event.when}</p><small>{event.detail}</small></li>)}</ul> : <p>No dated deadlines have been supplied by this league. Review the provider’s rules before planning transactions.</p>}<nav className="af-tw-links"><Link href={`/core/waivers?league=${encodeURIComponent(data.league.id)}`}>Waiver rules and claims</Link><Link href={`/core/trades?league=${encodeURIComponent(data.league.id)}`}>Trade rules and offers</Link></nav></section>
    {data.timeline.available && <section className="af-tw-panel"><h2>Season phases</h2><ol>{data.timeline.data.map(phase => <li key={phase.key}><strong>{phase.label}</strong> · {phase.when ?? 'Date not supplied'} · {phase.state}{phase.detail && <p>{phase.detail}</p>}</li>)}</ol></section>}
    <section className="af-tw-panel"><div className="af-tw-heading"><h2>League fixtures</h2>{data.weekPicker && <label>Week<select value={data.weekPicker.selected} onChange={e => selectWeek(e.target.value)}>{data.weekPicker.weeks.map(week => <option key={week} value={week}>{week}{week === data.weekPicker?.current ? ' · current' : ''}</option>)}</select></label>}</div>{data.weekPicker?.isFuture && <p>Future week: these fixtures are scheduled, not results. Current roster projections do not establish a future lineup.</p>}{data.scoreboard.available ? <LeagueScoreboardPanel board={data.scoreboard.data} /> : <p>{data.scoreboard.reason}</p>}</section>
  </div>
}
