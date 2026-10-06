import Link from 'next/link'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import '@/components/core-app/af-team-workspace.css'
export default function LeagueMoves({ data }: { data: LeagueHomeData }) {
  const q = `?league=${encodeURIComponent(data.league.id)}`
  return <section className="af-tw"><h1>Moves</h1><p>{data.league.name} · Review claims, offers, and their effect on your roster before taking action.</p><div className="af-tw-compare"><Link className="af-tw-panel" href={`/core/waivers${q}`}><h2>Waivers</h2><p>Available players, claims, FAAB, and processing rules.</p></Link>{data.importCoverage.capabilities.trades !== false && <Link className="af-tw-panel" href={`/core/trades${q}`}><h2>Trades</h2><p>Pending offers, roster impact, and league-scored comparisons.</p></Link>}</div><nav className="af-tw-links"><Link href={`/core/my-team${q}`}>Roster health</Link><Link href={`/core/schedule${q}`}>Deadlines</Link></nav>{data.buzz.available && <section className="af-tw-panel"><h2>Recent league activity</h2><ul>{data.buzz.data.slice(0,8).map(item => <li key={item.id}>{item.actor} · {item.text}</li>)}</ul></section>}</section>
}
