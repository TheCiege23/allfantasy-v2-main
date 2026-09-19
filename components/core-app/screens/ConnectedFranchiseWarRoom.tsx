'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import '@/components/core-app/af-connected-war-room.css'

export type ConnectedFranchiseWarRoomSide = {
  role: string
  leagueId: string | null
  memberLeagueId: string
  name: string
  platform: string
  sport: string | null
  season: number | null
  teamLabel: string | null
  teamCandidates: Array<{ id: string; label: string }>
  avatarUrl: string | null
  playerCount: number | null
  unavailableReason: string | null
  players: Array<{ id: string; name: string; position: string | null; team: string | null }>
  draft: { phase: string; headline: string; detail: string | null; href: string | null } | null
  activity:
    | { available: true; trades: number; waivers: number; rosterMoves: number; newest: Date | string | null }
    | { available: false; reason: string }
    | null
}

function leagueHref(screen: string, leagueId: string) {
  return `/core/${screen}?league=${encodeURIComponent(leagueId)}`
}

function TeamCrest({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cwr-crest" aria-hidden="true">
      {src && !failed
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span>{name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</span>}
    </span>
  )
}

export function ConnectedFranchiseWarRoom({
  linkId,
  franchiseName,
  selectedLeagueId,
  sides,
}: {
  linkId: string
  franchiseName: string
  selectedLeagueId: string
  sides: ConnectedFranchiseWarRoomSide[]
}) {
  const router = useRouter()
  const [savingTeam, setSavingTeam] = useState<string | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)
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
  const activeMoves = sides.reduce((sum, side) => (
    side.activity?.available
      ? sum + side.activity.trades + side.activity.waivers + side.activity.rosterMoves
      : sum
  ), 0)

  async function updateTeam(side: ConnectedFranchiseWarRoomSide, teamExternalId: string) {
    setSavingTeam(side.memberLeagueId)
    setMappingError(null)
    try {
      const response = await fetch('/api/legacy/franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-team-mapping',
          linkId,
          member: { platform: side.platform, leagueId: side.memberLeagueId, teamExternalId },
        }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not save this team')
      router.refresh()
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Could not save this team')
    } finally {
      setSavingTeam(null)
    }
  }

  return (
    <section className="af-cwr" aria-label={`${franchiseName} connected franchise command center`}>
      <header className="af-cwr-head">
        <div>
          <span className="af-label">CONNECTED FRANCHISE · COMMAND CENTER</span>
          <h1>{franchiseName}</h1>
          <p>Every roster, draft and league pulse in one home. Each league still keeps its own rules, scoring and lineup.</p>
        </div>
        <div className="af-cwr-head-actions">
          <Link className="af-cwr-cta" href={`/core?league=${encodeURIComponent(selectedLeagueId)}`}>
            Open combined roster →
          </Link>
          <Link className="af-cwr-add" href={`/core/connect-leagues?league=${encodeURIComponent(selectedLeagueId)}`}>
            + Add another league
          </Link>
        </div>
      </header>

      <div className="af-cwr-scoreboard">
        <div><strong>{sides.length}</strong><span>connected leagues</span></div>
        <div><strong>{totalPlayers ?? '—'}</strong><span>players across the franchise</span></div>
        <div><strong>{positions.length}</strong><span>positions represented</span></div>
        <div><strong>{activeMoves}</strong><span>recorded roster moves</span></div>
      </div>

      {mappingError ? <p className="af-cwr-error" role="alert">{mappingError}</p> : null}

      <div className="af-cwr-pipeline" aria-label="Connected league dashboard">
        {sides.map((side, index) => {
          const current = side.leagueId === selectedLeagueId
          const selectedTeam = side.teamCandidates.find((team) => team.label === side.teamLabel || team.id === side.teamLabel)?.id ?? ''
          const activityText = side.activity?.available
            ? `${side.activity.trades} trades · ${side.activity.waivers} waivers · ${side.activity.rosterMoves} roster moves`
            : side.activity?.reason ?? 'Activity will appear after the next sync'
          return (
            <div className="af-cwr-lane-wrap" key={`${side.platform}:${side.memberLeagueId}`}>
              <article className="af-cwr-lane" data-current={current || undefined} aria-label={`${side.name}${current ? ', current league' : ''}`}>
                <div className="af-cwr-lane-top">
                  <span className="af-cwr-role">{side.sport?.toUpperCase() ?? side.role.toUpperCase()}</span>
                  {current ? <span className="af-cwr-current">CURRENT</span> : null}
                </div>
                <div className="af-cwr-identity"><TeamCrest src={side.avatarUrl} name={side.teamLabel ?? side.name} /><div><h2>{side.name}</h2><p className="af-cwr-platform">{side.platform.toUpperCase()}{side.season ? ` · ${side.season}` : ''}</p></div></div>

                <div className="af-cwr-team">
                  <span>Your team</span>
                  {side.teamCandidates.length > 1 ? (
                    <select
                      aria-label={`Your team in ${side.name}`}
                      value={selectedTeam}
                      disabled={savingTeam === side.memberLeagueId}
                      onChange={(event) => void updateTeam(side, event.target.value)}
                    >
                      <option value="" disabled>Choose your team</option>
                      {side.teamCandidates.map((team) => <option key={team.id} value={team.id}>{team.label}</option>)}
                    </select>
                  ) : <strong>{side.teamLabel ?? 'Team not mapped'}</strong>}
                </div>

                <div className="af-cwr-pulse">
                  <div><span>Roster</span><strong>{side.playerCount == null ? 'Needs attention' : `${side.playerCount} players`}</strong></div>
                  <div><span>Draft</span><strong>{side.draft?.headline ?? 'No draft on file'}</strong><small>{side.draft?.detail}</small></div>
                  <div><span>Activity</span><strong>{side.activity?.available ? 'Connected' : 'Limited'}</strong><small>{activityText}</small></div>
                </div>

                {side.unavailableReason ? <p className="af-cwr-warning">{side.unavailableReason}</p> : null}
                {side.leagueId ? (
                  <nav className="af-cwr-links" aria-label={`${side.name} shortcuts`}>
                    <Link href={leagueHref('my-team', side.leagueId)}>Roster</Link>
                    <Link href={leagueHref('matchup', side.leagueId)}>Matchup</Link>
                    <Link href={leagueHref('standings', side.leagueId)}>Standings</Link>
                    <Link href={side.draft?.href ?? leagueHref('draft-hq', side.leagueId)}>Draft</Link>
                    <Link href={leagueHref('trades', side.leagueId)}>Trades</Link>
                  </nav>
                ) : null}
              </article>
              {index < sides.length - 1 ? <span className="af-cwr-connector" aria-hidden="true">↔</span> : null}
            </div>
          )
        })}
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
