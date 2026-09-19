'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { usePathname } from 'next/navigation'
import type { LeagueHub } from '@/lib/core-app/leagueHubGroups'
import './af-connected-navigation.css'

const SHARED_SCREENS = new Set(['/core', '/core/my-team', '/core/matchup', '/core/standings', '/core/war-room', '/core/trades', '/core/waivers', '/core/players', '/core/season-outlook'])
export function connectedLeagueHref(path: string | null, id: string): string {
  return (path && SHARED_SCREENS.has(path) ? path : '/core') + '?league=' + encodeURIComponent(id)
}

function HubMark({ count }: { count: number }) {
  return <span className="af-connected-mark" aria-hidden="true"><span>↔</span><small>{count}</small></span>
}

export function ConnectedLeagueRailGroup({ hub, selectedLeagueId, expanded, onNavigate }: {
  hub: LeagueHub; selectedLeagueId?: string | null; expanded: boolean; onNavigate: (href: string, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const selected = hub.members.find((m) => m.id === selectedLeagueId)
  const target = selected ?? hub.members[0]
  if (!target) return null
  const label = hub.name === 'My franchise' ? hub.members.map((m) => m.name).join(' + ') : hub.name
  if (!expanded) return <Link className="af-connected-rail-tile" href={target.href} title={label} aria-label={label + ' · connected franchise'} aria-current={selected ? 'true' : undefined} data-active={!!selected} onClick={(event) => onNavigate(target.href, event)}><HubMark count={hub.members.length} /></Link>
  return <details className="af-connected-rail-group" open={selected ? true : undefined} data-active={!!selected}>
    <summary><HubMark count={hub.members.length} /><span><strong>{label}</strong><small>{hub.members.length} connected leagues</small></span></summary>
    <nav aria-label={label + ' leagues'}>
      <Link className="af-connected-overview" href={target.href} onClick={(event) => onNavigate(target.href, event)}>Open franchise →</Link>
      {hub.members.map((member) => <Link key={member.id} href={member.href} aria-current={member.id === selectedLeagueId ? 'true' : undefined} onClick={(event) => onNavigate(member.href, event)}><span>{member.name}</span><small>{member.platform}</small></Link>)}
    </nav>
  </details>
}

export function ConnectedLeagueContext({ hub, selectedLeagueId }: { hub: LeagueHub; selectedLeagueId: string }) {
  const path = usePathname()
  const selected = hub.members.find((m) => m.id === selectedLeagueId)
  const label = hub.name === 'My franchise' ? 'Your connected franchise' : hub.name
  return <section className="af-connected-context" aria-label="Connected franchise">
    <div className="af-connected-identity"><HubMark count={hub.members.length} /><div><span className="af-connected-eyebrow">ONE FRANCHISE</span><h2>{label}</h2><p>{hub.members.map((m) => m.name).join(' + ')}</p></div></div>
    <nav aria-label="Switch connected league">{hub.members.map((member) => <Link key={member.id} href={connectedLeagueHref(path, member.id)} aria-current={member.id === selectedLeagueId ? 'true' : undefined}><span>{member.name}</span><small>{member.platform}</small></Link>)}</nav>
    <p className="af-connected-scope">Viewing {selected?.name ?? 'this league'} · scoring and actions use this league’s rules.</p>
  </section>
}
