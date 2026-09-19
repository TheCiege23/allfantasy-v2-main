'use client'

import Link from 'next/link'
import '@/components/core-app/af-connected-war-room.css'

export type ConnectedFranchiseWarRoomSide = {
  role: string
  leagueId: string | null
  name: string
  platform: string
  sport: string | null
  playerCount: number | null
  unavailableReason: string | null
  players: Array<{ id: string; name: string; position: string | null; team: string | null }>
}

export function ConnectedFranchiseWarRoom({
  franchiseName,
  selectedLeagueId,
  sides,
}: {
  franchiseName: string
  selectedLeagueId: string
  sides: ConnectedFranchiseWarRoomSide[]
}) {
  const visibleCounts = sides.filter((side) => side.unavailableReason == null && side.playerCount != null)
  const totalPlayers = visibleCounts.length === sides.length
    ? visibleCounts.reduce((sum, side) => sum + (side.playerCount ?? 0), 0)
    : null
  const positionCounts = new Map<string, number>()
  for (const player of sides.flatMap((side) => side.players)) {
    if (!player.position) continue
    positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1)
  }
  const positions = [...positionCounts.entries()].sort((a, b) => b[1] - a[1])
  return (
    <section className="af-cwr" aria-label={`${franchiseName} connected franchise command center`}>
      <header className="af-cwr-head">
        <div>
          <span className="af-label">CONNECTED FRANCHISE · COMMAND CENTER</span>
          <h1>{franchiseName}</h1>
          <p>One strategy view across every connected roster, while each league keeps its own rules.</p>
        </div>
        <Link className="af-cwr-cta" href={`/core?league=${encodeURIComponent(selectedLeagueId)}`}>
          Open the combined roster →
        </Link>
      </header>

      <div className="af-cwr-scoreboard">
        <div><strong>{sides.length}</strong><span>connected leagues</span></div>
        <div><strong>{totalPlayers ?? '—'}</strong><span>players across the franchise</span></div>
        <div><strong>{positions.length}</strong><span>positions represented</span></div>
      </div>

      <div className="af-cwr-pipeline" aria-label="Connected roster pipeline">
        {sides.map((side, index) => (
          <div className="af-cwr-lane-wrap" key={`${side.platform}:${side.leagueId ?? side.name}`}>
            <article
              className="af-cwr-lane"
              data-current={side.leagueId === selectedLeagueId || undefined}
              aria-label={`${side.name}${side.leagueId === selectedLeagueId ? ', current league' : ''}`}
            >
              <span className="af-cwr-role">{side.sport?.toUpperCase() ?? side.role.toUpperCase()}</span>
              <h2>{side.name}</h2>
              <p>{side.platform} · {side.playerCount ?? 'Roster unavailable'}{side.playerCount != null ? ' players' : ''}</p>
              {side.unavailableReason ? <small>{side.unavailableReason}</small> : null}
              {side.leagueId ? <Link href={`/core/my-team?league=${encodeURIComponent(side.leagueId)}`}>Open roster →</Link> : null}
            </article>
            {index < sides.length - 1 ? <span className="af-cwr-connector" aria-hidden="true">↔</span> : null}
          </div>
        ))}
      </div>

      {positions.length > 0 ? (
        <div className="af-cwr-positions" aria-label="Combined roster positions">
          {positions.map(([position, count]) => <span key={position}><strong>{count}</strong> {position}</span>)}
        </div>
      ) : null}
    </section>
  )
}

export default ConnectedFranchiseWarRoom
