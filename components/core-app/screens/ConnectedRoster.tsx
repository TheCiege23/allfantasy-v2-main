'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { FranchiseSide } from '@/lib/core-app/leaguePairing'

function Portrait({ src, name, crest = false }: { src: string | null; name: string; crest?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  return <span className={crest ? 'af-hub-logo' : 'af-hub-portrait'} aria-hidden="true">
    {src && failed !== src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
      : <span>{name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('')}</span>}
  </span>
}

export function ConnectedRoster({ sides }: { sides: FranchiseSide[] }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [position, setPosition] = useState('all')
  const positions = [...new Set(sides.flatMap((side) => (side.players ?? []).map((p) => p.position).filter((p): p is string => !!p)))].sort()
  const needle = query.trim().toLowerCase()
  return <div className="af-hub-roster">
    <div className="af-hub-heading"><div><span className="af-label">One franchise · every player</span><h3>Your connected roster</h3></div><span className="af-hub-badge">Connected both ways</span></div>
    <div className="af-hub-controls">
      <input type="search" aria-label="Search connected roster" placeholder="Find a player or team…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Filter roster by position" value={position} onChange={(e) => setPosition(e.target.value)}><option value="all">All positions</option>{positions.map((p) => <option key={p}>{p}</option>)}</select>
      <div className="af-hub-tabs" role="group" aria-label="Roster leagues">
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All leagues</button>
        {sides.map((side) => <button type="button" key={side.role} aria-pressed={scope === side.role} onClick={() => setScope(side.role)}>{side.name}</button>)}
      </div>
    </div>
    <div className="af-hub-columns">
      {sides.filter((side) => scope === 'all' || scope === side.role).map((side) => {
        const players = (side.players ?? []).filter((p) => (position === 'all' || p.position === position) && (!needle || `${p.name} ${p.team ?? ''}`.toLowerCase().includes(needle)))
        return <section key={side.role} className="af-hub-squad" aria-label={`${side.name} roster`}>
          <header><div><span className="af-label">{side.platform} · {side.sport?.toUpperCase()}</span><h4>{side.name}</h4></div><span className="af-hub-count">{side.playerCount ?? '—'}</span></header>
          {side.leagueId ? <Link className="af-hub-team-link" href={`/core/my-team?league=${encodeURIComponent(side.leagueId)}`}>Open team & lineup →</Link> : null}
          {side.unavailableReason ? <p className="af-hub-empty">{side.unavailableReason}</p> : players.length ? <ul>
            {players.map((p) => <li key={p.id}><Portrait src={p.imageUrl} name={p.name} /><div className="af-hub-player"><strong>{p.name}</strong><span>{p.position ?? 'Position unavailable'} · {p.team ?? 'Team unavailable'}</span></div><Portrait src={p.logoUrl} name={p.team ?? '?'} crest /></li>)}
          </ul> : <p className="af-hub-empty">{(side.players?.length ?? 0) > 0 ? 'No players match these filters.' : 'Player details are unavailable. Open this team to refresh its roster.'}</p>}
        </section>
      })}
    </div>
  </div>
}
