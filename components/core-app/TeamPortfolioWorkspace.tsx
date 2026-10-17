'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MyTeamPulse } from '@/lib/core-app/myTeamPulse'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { isAtRisk, isRuledOut } from '@/lib/core-app/injuryStatus'
import { FAVORITES_COOKIE, parseFavoriteIds, serializeFavoriteIds } from '@/lib/core-app/homeScope'
import LocalDateTime from './LocalDateTime'
import '@/components/core-app/af-team-workspace.css'

export default function TeamPortfolioWorkspace({ pulse }: { pulse: MyTeamPulse }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (text: string) => teamWorkspaceCopy(text, language)
  const router = useRouter()
  const rows = pulse.inventory ?? [...pulse.needs, ...pulse.set]
  const [query, setQuery] = useState('')
  const [sport, setSport] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [format, setFormat] = useState('all')
  const [filter, setFilter] = useState('all')
  const [favorites, setFavorites] = useState<string[]>([])
  const storageKey = `af-team-favorites:${pulse.viewerKey ?? 'local'}`
  useEffect(() => { const raw=document.cookie.split('; ').find(c=>c.startsWith(`${FAVORITES_COOKIE}=`))?.slice(FAVORITES_COOKIE.length+1); setFavorites([...parseFavoriteIds(raw, rows.map(r=>r.leagueId))]) }, [storageKey, pulse])
  const toggle = (id: string) => { const next=favorites.includes(id) ? favorites.filter(x=>x!==id) : [...favorites,id]; document.cookie=`${FAVORITES_COOKIE}=${encodeURIComponent(serializeFavoriteIds(next))}; Path=/; Max-Age=31536000; SameSite=Lax`; setFavorites(next); router.refresh() }
  const visible = rows.filter(row => (sport === 'all' || row.sport === sport) && (platform === 'all' || row.platform === platform) && (format === 'all' || row.format === format) && (filter !== 'favorites' || favorites.includes(row.leagueId)) && (filter !== 'attention' || row.severity > 0) && (filter !== 'active' || !row.archived) && (filter !== 'history' || row.archived) && (filter !== 'unreadable' || !!row.coverageReason && !row.archived) && [row.leagueName, row.teamName, ...(row.players ?? []).map(p => p.name)].join(' ').toLowerCase().includes(query.toLowerCase()))
  const players = useMemo(() => {
    const map = new Map<string, { name: string; entries: Array<{ row: typeof rows[number]; player: NonNullable<typeof rows[number]['players']>[number] }> }>()
    for (const row of visible) for (const player of row.players ?? []) {
      const key = `${row.sport}:${player.id}`
      const group = map.get(key) ?? { name: player.name, entries: [] }
      group.entries.push({ row, player }); map.set(key, group)
    }
    return [...map.values()].sort((a,b) => b.entries.filter(e => e.player.starter && (isRuledOut(e.player.status) || e.player.onBye)).length - a.entries.filter(e => e.player.starter && (isRuledOut(e.player.status) || e.player.onBye)).length)
  }, [visible])
  const issues = players.filter(p => p.entries.some(e => isRuledOut(e.player.status) || isAtRisk(e.player.status) || e.player.onBye))
  const visibleLeagueIds = new Set(visible.map(row => row.leagueId))
  const opponentExposure = (pulse.opponentExposure ?? []).map(player => ({ ...player, leagues: player.leagues.filter(league => visibleLeagueIds.has(league.id)) })).filter(player => player.leagues.length > 0)

  const options = (key: 'sport' | 'platform' | 'format') => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort() as string[]
  return <section className="af-tw" aria-labelledby="af-team-workspace-title">
    <header className="af-tw-heading"><div><h2 id="af-team-workspace-title">{copy("Your team workspace")}</h2><p>{copy("Search teams and players, group issues, and plan the next action.")}</p></div><button type="button" className="af-btn" onClick={() => router.refresh()}>{copy("Refresh saved evidence")}</button></header>
    <p className="af-tw-note">{copy("Refresh reads the latest saved evidence. Use league sync to check your provider after making a change.")}</p>
    <details className="af-tw-panel" open={issues.length > 0}><summary>{es ? 'Problemas de jugadores entre equipos' : 'Player issues across teams'} · {issues.length}</summary>
      {issues.length ? issues.map(group => <details key={`${group.entries[0].row.sport}:${group.entries[0].player.id}`} className="af-tw-group"><summary>{group.name} · {group.entries.length} {es ? (group.entries.length === 1 ? 'equipo' : 'equipos') : (group.entries.length === 1 ? 'team' : 'teams')}</summary><ul>{group.entries.map(({ row, player }) => <li key={row.leagueId}><Link href={`${row.href}#lineup-player-${player.id}`}>{row.leagueName}</Link><span>{player.onBye ? copy("Bye") : player.status ? coreUiCopy(player.status, language) : copy("No injury designation")} · {row.automatic ? copy("Automatic scoring; review depth") : player.starter ? copy("Starting") : copy("Bench")}{player.kickoff && <> · <LocalDateTime value={player.kickoff} /></>}</span><Link href={`/core/players?league=${encodeURIComponent(row.leagueId)}&q=${encodeURIComponent(group.name)}`}>{copy("Review alternatives")}</Link></li>)}</ul></details>) : <p>{copy("No player issues found in readable rosters. This does not verify provider eligibility.")}</p>}
    </details>
    <div className="af-tw-filters">
      <label>{copy("Search")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={copy("Team, league, or player")} /></label>
      <label>{copy("Sport")}<select value={sport} onChange={e => setSport(e.target.value)}><option value="all">{copy("All sports")}</option>{options('sport').map(v => <option key={v}>{v}</option>)}</select></label>
      <label>{copy("Platform")}<select value={platform} onChange={e => setPlatform(e.target.value)}><option value="all">{copy("All platforms")}</option>{options('platform').map(v => <option key={v} value={v}>{platformLabel(v)}</option>)}</select></label>
      <label>{copy("Format")}<select value={format} onChange={e => setFormat(e.target.value)}><option value="all">{copy("All formats")}</option>{options('format').map(v => <option key={v}>{v}</option>)}</select></label>
      <label>{copy("Show")}<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{copy("All teams")}</option><option value="active">{copy("Current seasons")}</option><option value="history">{copy("Prior seasons")}</option><option value="attention">{copy("Needs attention")}</option><option value="favorites">{copy("Favorites")}</option><option value="unreadable">{copy("Data unavailable")}</option></select></label>
    </div>
    <p role="status">{es ? `${visible.length} de ${rows.length} equipos mostrados` : `${visible.length} of ${rows.length} teams shown`}{pulse.checked < pulse.considered ? es ? ` · ${pulse.considered - pulse.checked} equipos no se pudieron revisar` : ` · ${pulse.considered - pulse.checked} teams could not be checked` : ''}.</p>
    <ul className="af-tw-inventory">{visible.map(row => <li key={row.leagueId}><button type="button" className="af-tw-favorite" aria-pressed={favorites.includes(row.leagueId)} aria-label={`${favorites.includes(row.leagueId) ? copy("Unfavorite") : copy("Favorite")} ${row.leagueName}`} onClick={() => toggle(row.leagueId)}>{favorites.includes(row.leagueId) ? '★' : '☆'}</button><div><Link href={row.href} prefetch={false}>{row.leagueName}</Link><p>{row.teamName} · {row.sport} · {platformLabel(row.platform)} · {row.automatic ? copy("Best Ball · automatic") : row.format ?? copy("Format unknown")}</p><span>{row.coverageReason ? copy(row.coverageReason) : (row.severity ? es ? `${row.severity} problemas de alineación por revisar` : `${row.severity} lineup issues to review` : row.automatic ? copy("Review roster availability") : copy("No certain lineup issue found"))}</span>{row.readAt && <small>{es ? 'Lectura guardada: ' : 'Saved read: '}<LocalDateTime value={row.readAt} /></small>}</div><Link href={`/core/sync?league=${encodeURIComponent(row.leagueId)}`}>{copy("Verify provider")}</Link></li>)}</ul>
    {!visible.length && <p>{copy("No teams match these filters.")}</p>}
    <details className="af-tw-panel"><summary>{copy("Ownership and league exposure")}</summary><p>{copy("Owned players and verified scheduled opponents are shown separately. Missing pairings or unreadable rosters are excluded.")}</p>{players.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(group => <div key={`${group.entries[0].row.sport}:${group.entries[0].player.id}`} className="af-tw-group"><strong>{group.name}</strong><p>{es ? 'En tu plantilla en' : 'Owned in'} {group.entries.length} {es ? 'ligas · titular en' : 'leagues · starting in'} {group.entries.filter(e => e.player.starter).length} · {es ? 'titular contra ti en' : 'starting against you in'} {opponentExposure.find(p => p.id === group.entries[0].player.id && p.sport === group.entries[0].row.sport)?.leagues.length ?? 0} {es ? 'enfrentamientos verificados.' : 'verified matchups.'}</p><div>{group.entries.map(({row}) => <Link key={row.leagueId} href={row.href}>{row.leagueName}</Link>)}</div></div>)}<h3>{copy("Scheduled opponent starters")}</h3>{opponentExposure.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=><div key={`${p.sport}:${p.id}`} className="af-tw-group"><strong>{p.name} · {p.leagues.length} {es ? (p.leagues.length===1 ? 'enfrentamiento' : 'enfrentamientos') : (p.leagues.length===1 ? 'matchup' : 'matchups')}</strong><div>{p.leagues.map(l=><Link key={l.id} href={`/core/matchup?league=${encodeURIComponent(l.id)}`}>{l.name} · {es ? 'Semana' : 'Week'} {l.week}</Link>)}</div></div>)}{!opponentExposure.length && <p>{copy("No readable scheduled opponent starters available.")}</p>}</details>
    <nav className="af-tw-links" aria-label={copy("Weekly planning")}><Link href="/core/week">{copy("Weekly plan")}</Link><Link href="/core/waivers">{copy("Waiver deadlines")}</Link><Link href="/core/trades">{copy("Pending trades")}</Link></nav>
  </section>
}
